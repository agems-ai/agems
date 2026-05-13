/**
 * Unit tests for proactive cost-spike detection.
 *
 * If these break, either Telegram alerts spam the admin with false
 * positives (regression in severity buckets / since-filter) or real
 * runaway cost spikes ship silently (broken bucket aggregation /
 * threshold). Both are user-visible.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  severityFor,
  buildAlertMessage,
  bucketExecutionsByDay,
  detectSpikeAlerts,
  findRecentSpikes,
  type ExecutionRow,
  type SpikeAlertsClient,
} from './spike-alerts';

function exec(date: string, cost: number): ExecutionRow {
  return { startedAt: new Date(`${date}T12:00:00.000Z`), costUsd: cost };
}

// ── severityFor ──────────────────────────────────────────────────

describe('severityFor', () => {
  it('returns "minor" for 3x-4.99x', () => {
    assert.equal(severityFor(3), 'minor');
    assert.equal(severityFor(4.99), 'minor');
  });
  it('returns "major" for 5x-9.99x', () => {
    assert.equal(severityFor(5), 'major');
    assert.equal(severityFor(9.99), 'major');
  });
  it('returns "severe" for 10x+', () => {
    assert.equal(severityFor(10), 'severe');
    assert.equal(severityFor(100), 'severe');
  });
});

// ── buildAlertMessage ────────────────────────────────────────────

describe('buildAlertMessage', () => {
  it('embeds date, cost, multiplier, severity icon', () => {
    const msg = buildAlertMessage({ date: '2026-05-10', cost: 12.34, multiplier: 4.5, severity: 'minor' });
    assert.ok(msg.includes('2026-05-10'));
    assert.ok(msg.includes('$12.34'));
    assert.ok(msg.includes('4.5×'));
  });

  it('uses different icons per severity', () => {
    assert.ok(buildAlertMessage({ date: 'x', cost: 1, multiplier: 3, severity: 'minor' }).startsWith('ℹ️'));
    assert.ok(buildAlertMessage({ date: 'x', cost: 1, multiplier: 6, severity: 'major' }).startsWith('⚠️'));
    assert.ok(buildAlertMessage({ date: 'x', cost: 1, multiplier: 20, severity: 'severe' }).startsWith('🚨'));
  });
});

// ── bucketExecutionsByDay ────────────────────────────────────────

describe('bucketExecutionsByDay', () => {
  it('returns empty array on no executions', () => {
    assert.deepEqual(bucketExecutionsByDay([]), []);
  });

  it('sums costs within the same day', () => {
    const rows = [
      { startedAt: new Date('2026-05-10T08:00:00.000Z'), costUsd: 1 },
      { startedAt: new Date('2026-05-10T20:00:00.000Z'), costUsd: 2 },
    ];
    assert.deepEqual(bucketExecutionsByDay(rows), [{ date: '2026-05-10', cost: 3 }]);
  });

  it('produces one bucket per day, sorted ascending', () => {
    const rows = [
      exec('2026-05-10', 1),
      exec('2026-05-12', 5),
      exec('2026-05-11', 3),
    ];
    const out = bucketExecutionsByDay(rows);
    assert.equal(out.length, 3);
    assert.equal(out[0].date, '2026-05-10');
    assert.equal(out[1].date, '2026-05-11');
    assert.equal(out[2].date, '2026-05-12');
  });

  it('ignores executions with null or zero cost', () => {
    const rows = [
      exec('2026-05-10', 1),
      { startedAt: new Date('2026-05-10T08:00:00.000Z'), costUsd: null as any },
      { startedAt: new Date('2026-05-10T08:00:00.000Z'), costUsd: 0 },
    ];
    assert.deepEqual(bucketExecutionsByDay(rows), [{ date: '2026-05-10', cost: 1 }]);
  });
});

// ── detectSpikeAlerts ────────────────────────────────────────────

describe('detectSpikeAlerts', () => {
  it('returns empty when fewer than 2 buckets', () => {
    const rows = [exec('2026-05-10', 100)];
    assert.deepEqual(detectSpikeAlerts(rows), []);
  });

  it('flags a 5x bucket as a "major" spike', () => {
    const rows = [
      exec('2026-05-08', 1),
      exec('2026-05-09', 1),
      exec('2026-05-10', 1),
      exec('2026-05-11', 1),
      exec('2026-05-12', 5),
    ];
    const alerts = detectSpikeAlerts(rows);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date, '2026-05-12');
    assert.equal(alerts[0].severity, 'major'); // 5x exactly → major
    assert.ok(alerts[0].message.includes('$5'));
  });

  it('filters out spikes before the `since` cutoff', () => {
    const rows = [
      exec('2026-05-08', 1),
      exec('2026-05-09', 1),
      exec('2026-05-10', 5), // earlier spike
      exec('2026-05-11', 1),
      exec('2026-05-12', 5), // recent spike
    ];
    const alerts = detectSpikeAlerts(rows, { since: new Date('2026-05-11T00:00:00.000Z') });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date, '2026-05-12');
  });

  it('respects custom multiplier threshold', () => {
    const rows = [
      exec('2026-05-08', 1),
      exec('2026-05-09', 1),
      exec('2026-05-10', 1),
      exec('2026-05-11', 1),
      exec('2026-05-12', 2), // 2x — below default 3x, above custom 1.5x
    ];
    assert.equal(detectSpikeAlerts(rows, { multiplier: 3 }).length, 0);
    assert.equal(detectSpikeAlerts(rows, { multiplier: 1.5 }).length, 1);
  });

  it('categorises a 10x spike as severe', () => {
    const rows = [
      exec('2026-05-08', 1),
      exec('2026-05-09', 1),
      exec('2026-05-10', 1),
      exec('2026-05-11', 1),
      exec('2026-05-12', 10),
    ];
    const alerts = detectSpikeAlerts(rows);
    assert.equal(alerts[0].severity, 'severe');
  });
});

// ── findRecentSpikes (fake client) ──────────────────────────────

function makeFakeClient(rows: ExecutionRow[]): SpikeAlertsClient {
  return {
    agentExecution: {
      async findMany() {
        return rows;
      },
    },
  };
}

describe('findRecentSpikes', () => {
  it('returns empty when org has no recent cost', async () => {
    const client = makeFakeClient([]);
    const alerts = await findRecentSpikes(client, { orgId: 'org-1', now: new Date('2026-05-13T00:00:00.000Z') });
    assert.deepEqual(alerts, []);
  });

  it('detects a spike against a stable baseline', async () => {
    const rows = [
      exec('2026-05-06', 1),
      exec('2026-05-07', 1),
      exec('2026-05-08', 1),
      exec('2026-05-09', 1),
      exec('2026-05-10', 1),
      exec('2026-05-11', 1),
      exec('2026-05-12', 6),
    ];
    const client = makeFakeClient(rows);
    const alerts = await findRecentSpikes(client, { orgId: 'org-1', now: new Date('2026-05-13T00:00:00.000Z') });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].date, '2026-05-12');
    assert.equal(alerts[0].severity, 'major');
  });

  it('passes `since` cutoff through to detectSpikeAlerts', async () => {
    const rows = [
      exec('2026-05-05', 1),
      exec('2026-05-06', 1),
      exec('2026-05-07', 5), // spike — but BEFORE since
      exec('2026-05-08', 1),
    ];
    const client = makeFakeClient(rows);
    const alerts = await findRecentSpikes(client, {
      orgId: 'org-1',
      now: new Date('2026-05-09T00:00:00.000Z'),
      options: { since: new Date('2026-05-08T00:00:00.000Z') },
    });
    assert.equal(alerts.length, 0);
  });
});
