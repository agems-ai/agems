/**
 * Unit tests for combined scheduler-utils: backoff + cron stagger +
 * envelope.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBackoff,
  sleepWithAbort,
  DEFAULT_BACKOFF,
  isTopOfHourCron,
  staggerOffsetMs,
  DEFAULT_TOP_OF_HOUR_STAGGER_MS,
  buildEnvelope,
} from './scheduler-utils';

// ── computeBackoff ──────────────────────────────────────────────

describe('computeBackoff', () => {
  it('attempt 0 returns ~baseMs', () => {
    const ms = computeBackoff(0, { baseMs: 1000, ceilMs: 60000, factor: 2, jitter: 0 });
    assert.equal(ms, 1000);
  });

  it('attempt N doubles (factor=2)', () => {
    const cfg = { baseMs: 1000, ceilMs: 60_000, factor: 2, jitter: 0 };
    assert.equal(computeBackoff(0, cfg), 1000);
    assert.equal(computeBackoff(1, cfg), 2000);
    assert.equal(computeBackoff(2, cfg), 4000);
    assert.equal(computeBackoff(3, cfg), 8000);
  });

  it('clips to ceilMs', () => {
    const cfg = { baseMs: 1000, ceilMs: 5000, factor: 2, jitter: 0 };
    assert.equal(computeBackoff(10, cfg), 5000);
  });

  it('applies jitter within ±jitter*delay', () => {
    const cfg = { baseMs: 1000, ceilMs: 60_000, factor: 1, jitter: 0.5 };
    // rng=0 → jitter = -50%; rng=1 → jitter = +50%
    assert.equal(computeBackoff(0, cfg, () => 0), 500);
    assert.equal(computeBackoff(0, cfg, () => 1), 1500);
  });

  it('negative attempt → 0', () => {
    assert.equal(computeBackoff(-1), 0);
  });

  it('default policy yields sane numbers', () => {
    const ms = computeBackoff(0, DEFAULT_BACKOFF, () => 0.5);
    assert.ok(ms >= 500 && ms <= 1500);
  });
});

// ── sleepWithAbort ──────────────────────────────────────────────

describe('sleepWithAbort', () => {
  it('resolves after ms when no abort', async () => {
    const start = Date.now();
    await sleepWithAbort(50);
    assert.ok(Date.now() - start >= 40);
  });

  it('rejects immediately on pre-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(() => sleepWithAbort(1000, ac.signal), /aborted/);
  });

  it('rejects when abort fires during wait', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    await assert.rejects(() => sleepWithAbort(1000, ac.signal), /aborted/);
  });
});

// ── isTopOfHourCron ─────────────────────────────────────────────

describe('isTopOfHourCron', () => {
  it('matches "0 * * * *" (every hour)', () => {
    assert.equal(isTopOfHourCron('0 * * * *'), true);
  });

  it('matches "0 9 * * *" (daily at 9)', () => {
    assert.equal(isTopOfHourCron('0 9 * * *'), true);
  });

  it('does NOT match "5 * * * *" (5 past)', () => {
    assert.equal(isTopOfHourCron('5 * * * *'), false);
  });

  it('does NOT match "*/15 * * * *"', () => {
    assert.equal(isTopOfHourCron('*/15 * * * *'), false);
  });

  it('rejects malformed (< 5 parts)', () => {
    assert.equal(isTopOfHourCron('0 *'), false);
  });
});

// ── staggerOffsetMs ─────────────────────────────────────────────

describe('staggerOffsetMs', () => {
  it('same tenantId → same offset (stable)', () => {
    const a = staggerOffsetMs('tenant-1');
    const b = staggerOffsetMs('tenant-1');
    assert.equal(a, b);
  });

  it('different tenants → different offsets (most of the time)', () => {
    const offsets = new Set();
    for (const t of ['org-A', 'org-B', 'org-C', 'org-D', 'org-E']) {
      offsets.add(staggerOffsetMs(t));
    }
    assert.ok(offsets.size >= 4); // collisions allowed but rare
  });

  it('offset stays within windowMs', () => {
    for (const t of ['a', 'b', 'c', 'd', 'e']) {
      const o = staggerOffsetMs(t, 60_000);
      assert.ok(o >= 0 && o < 60_000);
    }
  });

  it('default window = 5 minutes', () => {
    assert.equal(DEFAULT_TOP_OF_HOUR_STAGGER_MS, 5 * 60_000);
    for (const t of ['x', 'y', 'z']) {
      const o = staggerOffsetMs(t);
      assert.ok(o < DEFAULT_TOP_OF_HOUR_STAGGER_MS);
    }
  });
});

// ── buildEnvelope ───────────────────────────────────────────────

describe('buildEnvelope', () => {
  const now = new Date('2026-05-13T10:00:00.000Z');

  it('full envelope: channel + sender + elapsed', () => {
    const r = buildEnvelope({
      channelName: 'Slack',
      senderDisplayName: 'max',
      lastMessageAt: new Date(now.getTime() - 12 * 60_000),
      body: 'hello',
      now,
    });
    assert.equal(r, '[Slack · @max · +12m] hello');
  });

  it('omits elapsed when no lastMessageAt', () => {
    const r = buildEnvelope({ channelName: 'Telegram', senderDisplayName: 'max', body: 'hi', now });
    assert.equal(r, '[Telegram · @max] hi');
  });

  it('uses senderId when display name absent', () => {
    const r = buildEnvelope({ channelName: 'Slack', senderId: 'U987', body: 'x', now });
    assert.equal(r, '[Slack · @U987] x');
  });

  it('returns body verbatim when no header parts', () => {
    const r = buildEnvelope({ body: 'plain', now });
    assert.equal(r, 'plain');
  });

  it('weekday prefix when includeWeekday=true', () => {
    const r = buildEnvelope({
      body: 'x', includeWeekday: true,
      now: new Date('2026-05-13T10:00:00.000Z'), // Wednesday
    });
    assert.match(r, /^\[Wed\]/);
  });

  it('sanitises [brackets] in display name (anti-injection)', () => {
    const r = buildEnvelope({ channelName: 'Slack', senderDisplayName: 'evil[user]', body: 'x', now });
    assert.equal(r.includes('['), true); // outer envelope ok
    assert.equal(r.includes('evil(user)'), true);
    assert.equal(r.includes('evil[user]'), false);
  });

  it('elapsed never negative (clock drift)', () => {
    const r = buildEnvelope({
      channelName: 'X', senderDisplayName: 's',
      lastMessageAt: new Date(now.getTime() + 60_000), // future
      body: 'x', now,
    });
    assert.match(r, /\+0m/);
  });
});
