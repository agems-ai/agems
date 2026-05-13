/**
 * User-friendly schedule parser. Accepts the same `Task.cronExpression`
 * field but understands more than 5-field cron.
 *
 * Grammars supported, in detection order:
 *
 *   1. **Relative one-shot** — `30s` / `15m` / `2h` / `1d`. Fire ONCE,
 *      `parsedAt + delta` from now. Useful for natural-language input
 *      like "remind me in 30 minutes".
 *
 *   2. **Interval** — `every 30s` / `every 5m` / `every 2h`. Fires
 *      repeatedly. Equivalent semantics to cron's `* / N` but readable.
 *
 *   3. **ISO 8601 timestamp** — `2026-02-03T14:00` / full RFC 3339.
 *      Fire ONCE at that absolute moment.
 *
 *   4. **Cron (5-field)** — `0 9 * * 1-5`. Passes through to the
 *      existing TaskScheduler cron matcher untouched.
 *
 * Pure module: no Date.now() except behind `now?` parameter for
 * determinism. No mutation. No dependencies.
 *
 * Inspired by Hermes' `cron/jobs.py:parse_schedule()`.
 */

export type ParsedSchedule =
  | { kind: 'cron'; expression: string }
  | { kind: 'interval'; everyMs: number; original: string }
  | { kind: 'one-shot'; fireAt: Date; original: string }
  | { kind: 'error'; reason: string };

const RELATIVE_RE = /^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days)$/i;
const EVERY_RE = /^every\s+(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days)$/i;
// 5- or 6-field cron expression. Each field can contain digits, *, ,, -, /.
// 6-field cron has a leading seconds field (some implementations).
const CRON_RE = /^(\S+\s+){4,5}\S+$/;
// ISO 8601 — covers "2026-02-03T14:00" through "2026-02-03T14:00:00.000Z".
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Convert a `<number><unit>` pair to milliseconds. Throws on unknown unit. */
function unitToMs(n: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('s') && !u.startsWith('se')) return n * 1000;       // s, sec, secs, second, seconds — but skip 'sec' triggering 'se'? wait
  // ^^^ above check is buggy — fix with explicit list below.
  if (['s', 'sec', 'secs', 'second', 'seconds'].includes(u)) return n * 1000;
  if (['m', 'min', 'mins', 'minute', 'minutes'].includes(u)) return n * 60 * 1000;
  if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(u)) return n * 60 * 60 * 1000;
  if (['d', 'day', 'days'].includes(u)) return n * 24 * 60 * 60 * 1000;
  throw new Error(`Unknown time unit: "${unit}"`);
}

/**
 * Parse a schedule string. Returns a tagged union — never throws,
 * always returns { kind: 'error' } for malformed input.
 *
 * @param input  user-supplied schedule string (trimmed internally)
 * @param now    reference timestamp for relative schedules (test injectable)
 */
export function parseSchedule(input: string, now: Date = new Date()): ParsedSchedule {
  if (typeof input !== 'string') return { kind: 'error', reason: 'input must be a string' };
  const trimmed = input.trim();
  if (!trimmed) return { kind: 'error', reason: 'empty schedule' };

  // 1. `every Ns` / `every 5m` — interval.
  const everyMatch = trimmed.match(EVERY_RE);
  if (everyMatch) {
    const [, nStr, unit] = everyMatch;
    const n = parseInt(nStr, 10);
    if (n <= 0) return { kind: 'error', reason: 'interval must be positive' };
    try {
      return { kind: 'interval', everyMs: unitToMs(n, unit), original: trimmed };
    } catch (e) {
      return { kind: 'error', reason: (e as Error).message };
    }
  }

  // 2. Relative `30m` / `2h` — one-shot.
  const relMatch = trimmed.match(RELATIVE_RE);
  if (relMatch) {
    const [, nStr, unit] = relMatch;
    const n = parseInt(nStr, 10);
    if (n <= 0) return { kind: 'error', reason: 'delay must be positive' };
    try {
      const ms = unitToMs(n, unit);
      return { kind: 'one-shot', fireAt: new Date(now.getTime() + ms), original: trimmed };
    } catch (e) {
      return { kind: 'error', reason: (e as Error).message };
    }
  }

  // 3. ISO 8601 timestamp.
  if (ISO_RE.test(trimmed)) {
    const dt = new Date(trimmed);
    if (Number.isNaN(dt.getTime())) {
      return { kind: 'error', reason: 'invalid ISO timestamp' };
    }
    return { kind: 'one-shot', fireAt: dt, original: trimmed };
  }

  // 4. Cron — last resort. We do NOT validate field syntax here; the
  // existing TaskScheduler.cronMatches() rejects malformed cron at
  // match time. Only the SHAPE (5 or 6 whitespace-separated tokens)
  // is checked.
  if (CRON_RE.test(trimmed)) {
    return { kind: 'cron', expression: trimmed };
  }

  return { kind: 'error', reason: 'unrecognised schedule format' };
}

/**
 * For one-shot schedules: is `now` past the fire time? Useful for the
 * scheduler tick to know "should I fire this now and mark complete".
 *
 * For other schedule kinds returns false (they have their own matchers).
 */
export function isOneShotDue(schedule: ParsedSchedule, now: Date): boolean {
  if (schedule.kind !== 'one-shot') return false;
  return schedule.fireAt.getTime() <= now.getTime();
}

/**
 * Compute the next scheduled fire time AFTER `after` for a given schedule.
 * Returns null for cron (we'd need a full cron evaluator) and for
 * one-shot schedules whose fireAt is already past.
 *
 * Used by the UI to show "next run: in 5 minutes".
 */
export function nextFireAfter(schedule: ParsedSchedule, after: Date): Date | null {
  switch (schedule.kind) {
    case 'one-shot':
      return schedule.fireAt.getTime() > after.getTime() ? schedule.fireAt : null;
    case 'interval':
      return new Date(after.getTime() + schedule.everyMs);
    case 'cron':
    case 'error':
      return null;
  }
}

/**
 * For interval schedules — is now a "fire moment" relative to a known
 * lastFireAt? Returns true if (now - lastFireAt) >= everyMs.
 *
 * Cron / one-shot return false — they have their own matchers.
 */
export function isIntervalDue(schedule: ParsedSchedule, lastFireAt: Date | null, now: Date): boolean {
  if (schedule.kind !== 'interval') return false;
  if (!lastFireAt) return true; // never fired → fire now
  return now.getTime() - lastFireAt.getTime() >= schedule.everyMs;
}
