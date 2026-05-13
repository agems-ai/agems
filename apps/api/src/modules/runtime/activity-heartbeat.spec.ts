/**
 * Unit tests for activity heartbeat throttling + formatting.
 *
 * If these break, the agent chat either spams users with heartbeats
 * every tick (busted throttling) or never tells them the agent's
 * still alive on a 10-minute browser session (no heartbeat at all).
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldEmitHeartbeat,
  formatHeartbeatText,
  formatElapsed,
  formatBytes,
  maybeHeartbeat,
} from './activity-heartbeat';

const start = new Date('2026-05-13T10:00:00.000Z');
const at = (offsetSec: number) => new Date(start.getTime() + offsetSec * 1000);

// ── formatElapsed ───────────────────────────────────────────────

describe('formatElapsed', () => {
  it('seconds only when < 60s', () => {
    assert.equal(formatElapsed(12_000), '12s');
    assert.equal(formatElapsed(0), '0s');
  });
  it('minutes + seconds for 1m–59m59s', () => {
    assert.equal(formatElapsed(90_000), '1m 30s');
    assert.equal(formatElapsed(60_000), '1m');
  });
  it('hours + minutes for >= 1h', () => {
    assert.equal(formatElapsed(3600_000), '1h 0m');
    assert.equal(formatElapsed(3660_000), '1h 1m');
    assert.equal(formatElapsed(3725_000), '1h 2m 5s');
  });
});

// ── formatBytes ─────────────────────────────────────────────────

describe('formatBytes', () => {
  it('B / KB / MB / GB cutovers', () => {
    assert.equal(formatBytes(512), '512B');
    assert.equal(formatBytes(2048), '2.0KB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0MB');
    assert.equal(formatBytes(2 * 1024 * 1024 * 1024), '2.00GB');
  });
});

// ── shouldEmitHeartbeat ─────────────────────────────────────────

describe('shouldEmitHeartbeat — warmup', () => {
  it('NEVER emits in the first warmup window (default 5s)', () => {
    for (const sec of [0, 1, 3, 4]) {
      assert.equal(shouldEmitHeartbeat({ startedAt: start, lastTickAt: null, now: at(sec) }), false, `${sec}s`);
    }
  });

  it('emits at the warmup boundary', () => {
    assert.equal(shouldEmitHeartbeat({ startedAt: start, lastTickAt: null, now: at(5) }), true);
  });

  it('honours custom warmupMs', () => {
    const cfg = { warmupMs: 10_000, intervalMs: 5_000 };
    assert.equal(shouldEmitHeartbeat({ startedAt: start, lastTickAt: null, now: at(7), config: cfg }), false);
    assert.equal(shouldEmitHeartbeat({ startedAt: start, lastTickAt: null, now: at(10), config: cfg }), true);
  });
});

describe('shouldEmitHeartbeat — interval', () => {
  it('emits exactly intervalMs after the previous tick', () => {
    const lastTick = at(5);
    assert.equal(shouldEmitHeartbeat({ startedAt: start, lastTickAt: lastTick, now: at(9) }), false);
    assert.equal(shouldEmitHeartbeat({ startedAt: start, lastTickAt: lastTick, now: at(10) }), true);
  });

  it('honours custom intervalMs', () => {
    const cfg = { intervalMs: 15_000 };
    const lastTick = at(5);
    assert.equal(shouldEmitHeartbeat({ startedAt: start, lastTickAt: lastTick, now: at(15), config: cfg }), false);
    assert.equal(shouldEmitHeartbeat({ startedAt: start, lastTickAt: lastTick, now: at(20), config: cfg }), true);
  });
});

// ── formatHeartbeatText ─────────────────────────────────────────

describe('formatHeartbeatText', () => {
  it('elapsed only — minimal form', () => {
    assert.equal(formatHeartbeatText({ startedAt: start, now: at(12) }), 'Working… 12s elapsed');
  });

  it('adds progress when present', () => {
    const text = formatHeartbeatText({
      startedAt: start, now: at(30), progress: 1500,
      formatProgress: formatBytes,
    });
    assert.match(text, /1\.5KB/);
  });

  it('adds lastEvent when present', () => {
    const text = formatHeartbeatText({ startedAt: start, now: at(15), lastEvent: 'tool:bash' });
    assert.match(text, /last: tool:bash/);
  });

  it('combines all three: elapsed + progress + lastEvent', () => {
    const text = formatHeartbeatText({
      startedAt: start, now: at(45), progress: 4_500_000,
      lastEvent: 'browser:click', formatProgress: formatBytes,
    });
    assert.match(text, /45s elapsed/);
    assert.match(text, /4\.3MB/);
    assert.match(text, /last: browser:click/);
  });

  it('skips progress when value is 0 (don\'t show "processed 0")', () => {
    const text = formatHeartbeatText({ startedAt: start, now: at(15), progress: 0 });
    assert.equal(text.includes('processed'), false);
  });
});

// ── maybeHeartbeat — combined ──────────────────────────────────

describe('maybeHeartbeat', () => {
  it('null in warmup', () => {
    const r = maybeHeartbeat({ startedAt: start, state: { lastTickAt: null }, now: at(3) });
    assert.equal(r, null);
  });

  it('text after warmup', () => {
    const r = maybeHeartbeat({ startedAt: start, state: { lastTickAt: null }, now: at(7) });
    assert.match(r ?? '', /Working/);
  });

  it('null between intervals', () => {
    const r = maybeHeartbeat({
      startedAt: start,
      state: { lastTickAt: at(5) },
      now: at(7),
    });
    assert.equal(r, null);
  });

  it('text once interval has elapsed', () => {
    const r = maybeHeartbeat({
      startedAt: start,
      state: { lastTickAt: at(5), progress: 1024, lastEvent: 'tool:read' },
      now: at(15),
      formatProgress: formatBytes,
    });
    assert.match(r ?? '', /1\.0KB/);
    assert.match(r ?? '', /last: tool:read/);
  });
});
