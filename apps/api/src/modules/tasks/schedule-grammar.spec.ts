/**
 * Unit tests for parseSchedule() — natural-language schedule grammar.
 *
 * If these break, RECURRING tasks created with user-friendly schedule
 * strings ("every 5m", "30m", "2026-02-03T14:00") either fire wrong
 * times or never fire at all. The existing 5-field cron path stays
 * compatible — first regression test in the cron section guards that.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSchedule,
  isOneShotDue,
  isIntervalDue,
  nextFireAfter,
} from './schedule-grammar';

const now = new Date('2026-05-13T10:00:00.000Z');

// ── Relative one-shot ────────────────────────────────────────────

describe('parseSchedule — relative one-shot', () => {
  it('parses "30s" as +30000ms one-shot', () => {
    const r = parseSchedule('30s', now);
    assert.equal(r.kind, 'one-shot');
    if (r.kind === 'one-shot') {
      assert.equal(r.fireAt.getTime() - now.getTime(), 30_000);
    }
  });

  it('parses "15m" as +15min one-shot', () => {
    const r = parseSchedule('15m', now);
    assert.equal(r.kind, 'one-shot');
    if (r.kind === 'one-shot') {
      assert.equal(r.fireAt.getTime() - now.getTime(), 15 * 60_000);
    }
  });

  it('parses "2h" as +2h', () => {
    const r = parseSchedule('2h', now);
    assert.equal(r.kind, 'one-shot');
    if (r.kind === 'one-shot') {
      assert.equal(r.fireAt.getTime() - now.getTime(), 2 * 60 * 60_000);
    }
  });

  it('parses "1d" as +1 day', () => {
    const r = parseSchedule('1d', now);
    assert.equal(r.kind, 'one-shot');
    if (r.kind === 'one-shot') {
      assert.equal(r.fireAt.getTime() - now.getTime(), 24 * 60 * 60_000);
    }
  });

  it('accepts long-form units: "30 minutes"', () => {
    const r = parseSchedule('30 minutes', now);
    assert.equal(r.kind, 'one-shot');
    if (r.kind === 'one-shot') {
      assert.equal(r.fireAt.getTime() - now.getTime(), 30 * 60_000);
    }
  });

  it('rejects zero / negative delay', () => {
    assert.equal(parseSchedule('0m', now).kind, 'error');
    assert.equal(parseSchedule('-5m', now).kind, 'error');
  });
});

// ── Interval ─────────────────────────────────────────────────────

describe('parseSchedule — interval', () => {
  it('parses "every 5m" as 5-minute interval', () => {
    const r = parseSchedule('every 5m', now);
    assert.equal(r.kind, 'interval');
    if (r.kind === 'interval') assert.equal(r.everyMs, 5 * 60_000);
  });

  it('parses "every 30 seconds"', () => {
    const r = parseSchedule('every 30 seconds', now);
    assert.equal(r.kind, 'interval');
    if (r.kind === 'interval') assert.equal(r.everyMs, 30_000);
  });

  it('parses "every 1h"', () => {
    const r = parseSchedule('every 1h', now);
    assert.equal(r.kind, 'interval');
    if (r.kind === 'interval') assert.equal(r.everyMs, 60 * 60_000);
  });

  it('case-insensitive ("EVERY 5M")', () => {
    const r = parseSchedule('EVERY 5M', now);
    assert.equal(r.kind, 'interval');
  });

  it('rejects "every 0m"', () => {
    assert.equal(parseSchedule('every 0m', now).kind, 'error');
  });

  it('keeps the original string for round-trip display', () => {
    const r = parseSchedule('every 5m', now);
    if (r.kind === 'interval') assert.equal(r.original, 'every 5m');
  });
});

// ── ISO 8601 ─────────────────────────────────────────────────────

describe('parseSchedule — ISO 8601 timestamp', () => {
  it('parses "2026-02-03T14:00" as local-time (matches JS Date semantics)', () => {
    // Without timezone suffix, JS Date treats ISO as LOCAL time. We don't
    // override that — better to be predictable than to redefine the spec.
    // Test asserts the schedule parses and round-trips through new Date().
    const r = parseSchedule('2026-02-03T14:00', now);
    assert.equal(r.kind, 'one-shot');
    if (r.kind === 'one-shot') {
      assert.equal(r.fireAt.getTime(), new Date('2026-02-03T14:00').getTime());
    }
  });

  it('parses with seconds: "2026-02-03T14:00:30" (local time)', () => {
    const r = parseSchedule('2026-02-03T14:00:30', now);
    assert.equal(r.kind, 'one-shot');
    if (r.kind === 'one-shot') {
      assert.equal(r.fireAt.getTime(), new Date('2026-02-03T14:00:30').getTime());
    }
  });

  it('parses full RFC 3339 with Z: "2026-02-03T14:00:00Z"', () => {
    const r = parseSchedule('2026-02-03T14:00:00Z', now);
    assert.equal(r.kind, 'one-shot');
  });

  it('parses timezone offset: "2026-02-03T14:00:00+03:00"', () => {
    const r = parseSchedule('2026-02-03T14:00:00+03:00', now);
    assert.equal(r.kind, 'one-shot');
    if (r.kind === 'one-shot') {
      assert.equal(r.fireAt.toISOString(), '2026-02-03T11:00:00.000Z');
    }
  });
});

// ── Cron (5-field passthrough) ──────────────────────────────────

describe('parseSchedule — cron passthrough', () => {
  it('passes 5-field cron through unchanged', () => {
    const r = parseSchedule('0 9 * * 1-5', now);
    assert.equal(r.kind, 'cron');
    if (r.kind === 'cron') assert.equal(r.expression, '0 9 * * 1-5');
  });

  it('passes "* * * * *" through (every minute)', () => {
    const r = parseSchedule('* * * * *', now);
    assert.equal(r.kind, 'cron');
  });

  it('passes 6-field cron (with seconds)', () => {
    const r = parseSchedule('*/30 * * * * *', now);
    assert.equal(r.kind, 'cron');
  });

  it('does NOT validate cron field syntax (existing matcher does that)', () => {
    // 5 tokens — accepted as cron even if fields are wrong.
    const r = parseSchedule('garbage stuff here too much', now);
    assert.equal(r.kind, 'cron');
  });
});

// ── Errors ───────────────────────────────────────────────────────

describe('parseSchedule — errors', () => {
  it('empty string', () => {
    assert.equal(parseSchedule('', now).kind, 'error');
  });

  it('whitespace only', () => {
    assert.equal(parseSchedule('   ', now).kind, 'error');
  });

  it('garbage', () => {
    assert.equal(parseSchedule('nonsense', now).kind, 'error');
  });

  it('unknown unit ("5y" — years not supported)', () => {
    assert.equal(parseSchedule('5y', now).kind, 'error');
  });

  it('non-string input', () => {
    assert.equal(parseSchedule(null as any, now).kind, 'error');
    assert.equal(parseSchedule(42 as any, now).kind, 'error');
  });
});

// ── isOneShotDue ─────────────────────────────────────────────────

describe('isOneShotDue', () => {
  it('true when fireAt <= now', () => {
    const s = parseSchedule('5m', new Date('2026-05-13T09:00:00.000Z'));
    // s.fireAt = 09:05 — by 10:00 it's past due.
    assert.equal(isOneShotDue(s, now), true);
  });

  it('false when fireAt > now', () => {
    const s = parseSchedule('5m', now); // fireAt = now + 5m
    assert.equal(isOneShotDue(s, now), false);
  });

  it('false for non-one-shot kinds', () => {
    const interval = parseSchedule('every 5m', now);
    assert.equal(isOneShotDue(interval, now), false);
    const cron = parseSchedule('0 9 * * *', now);
    assert.equal(isOneShotDue(cron, now), false);
  });
});

// ── isIntervalDue ────────────────────────────────────────────────

describe('isIntervalDue', () => {
  const schedule = parseSchedule('every 5m', now);

  it('true when never fired before (lastFireAt = null)', () => {
    assert.equal(isIntervalDue(schedule, null, now), true);
  });

  it('false when last fire was less than interval ago', () => {
    const lastFire = new Date(now.getTime() - 2 * 60_000); // 2 min ago
    assert.equal(isIntervalDue(schedule, lastFire, now), false);
  });

  it('true when last fire was >= interval ago', () => {
    const lastFire = new Date(now.getTime() - 5 * 60_000); // exactly 5 min ago
    assert.equal(isIntervalDue(schedule, lastFire, now), true);
  });

  it('false for non-interval kinds', () => {
    const oneShot = parseSchedule('5m', now);
    assert.equal(isIntervalDue(oneShot, null, now), false);
  });
});

// ── nextFireAfter ────────────────────────────────────────────────

describe('nextFireAfter', () => {
  it('returns fireAt for future one-shot', () => {
    const s = parseSchedule('5m', now); // fires at 10:05
    const next = nextFireAfter(s, now);
    assert.equal(next?.getTime(), now.getTime() + 5 * 60_000);
  });

  it('returns null for past one-shot', () => {
    const s = parseSchedule('5m', new Date(now.getTime() - 10 * 60_000));
    assert.equal(nextFireAfter(s, now), null);
  });

  it('returns now + everyMs for interval', () => {
    const s = parseSchedule('every 5m', now);
    const next = nextFireAfter(s, now);
    assert.equal(next?.getTime(), now.getTime() + 5 * 60_000);
  });

  it('returns null for cron (we lack a full cron evaluator here)', () => {
    const s = parseSchedule('0 9 * * *', now);
    assert.equal(nextFireAfter(s, now), null);
  });

  it('returns null for error result', () => {
    const s = parseSchedule('nonsense', now);
    assert.equal(nextFireAfter(s, now), null);
  });
});
