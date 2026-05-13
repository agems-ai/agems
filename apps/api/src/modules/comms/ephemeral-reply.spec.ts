/**
 * Unit tests for ephemeral reply helpers.
 *
 * If these break, system notifications either pile up forever in the
 * channel (UX clutter) or disappear too aggressively (users miss
 * important toasts). The filter is also the hot-path for every
 * Message.findMany — performance regression would be felt
 * platform-wide.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEphemeralPayload,
  isExpired,
  filterAlive,
  filterExpired,
  getExpiresAt,
} from './ephemeral-reply';

const now = new Date('2026-05-13T10:00:00.000Z');

// ── buildEphemeralPayload ───────────────────────────────────────

describe('buildEphemeralPayload', () => {
  it('sets expiresAt = now + ttlSeconds (ISO)', () => {
    const p = buildEphemeralPayload({ content: 'x', ttlSeconds: 30, now });
    const meta = p.metadata as any;
    assert.equal(meta.expiresAt, '2026-05-13T10:00:30.000Z');
    assert.equal(meta.ephemeral, true);
  });

  it('defaults contentType to ACTION', () => {
    const p = buildEphemeralPayload({ content: 'x', ttlSeconds: 30, now });
    assert.equal(p.contentType, 'ACTION');
  });

  it('honours a custom contentType', () => {
    const p = buildEphemeralPayload({ content: 'x', ttlSeconds: 30, now, contentType: 'TEXT' });
    assert.equal(p.contentType, 'TEXT');
  });

  it('merges extraMetadata', () => {
    const p = buildEphemeralPayload({
      content: 'x', ttlSeconds: 30, now,
      extraMetadata: { source: 'curator', batchId: 'abc' },
    });
    const meta = p.metadata as any;
    assert.equal(meta.source, 'curator');
    assert.equal(meta.batchId, 'abc');
    assert.equal(meta.ephemeral, true);
  });

  it('throws on non-positive ttl', () => {
    assert.throws(() => buildEphemeralPayload({ content: 'x', ttlSeconds: 0, now }));
    assert.throws(() => buildEphemeralPayload({ content: 'x', ttlSeconds: -5, now }));
  });
});

// ── isExpired ───────────────────────────────────────────────────

describe('isExpired', () => {
  it('false for messages without metadata.expiresAt', () => {
    assert.equal(isExpired({ id: 'm', metadata: null }, now), false);
    assert.equal(isExpired({ id: 'm', metadata: { other: 'field' } }, now), false);
    assert.equal(isExpired({ id: 'm', metadata: undefined }, now), false);
  });

  it('false when expiresAt is in the future', () => {
    const future = new Date(now.getTime() + 60_000).toISOString();
    assert.equal(isExpired({ id: 'm', metadata: { expiresAt: future } }, now), false);
  });

  it('true when expiresAt is in the past', () => {
    const past = new Date(now.getTime() - 60_000).toISOString();
    assert.equal(isExpired({ id: 'm', metadata: { expiresAt: past } }, now), true);
  });

  it('true at exact equality (lte, not lt)', () => {
    assert.equal(isExpired({ id: 'm', metadata: { expiresAt: now.toISOString() } }, now), true);
  });

  it('false on malformed expiresAt strings (don\'t delete by accident)', () => {
    assert.equal(isExpired({ id: 'm', metadata: { expiresAt: 'not-a-date' } }, now), false);
    assert.equal(isExpired({ id: 'm', metadata: { expiresAt: 42 } }, now), false);
  });
});

// ── filterAlive / filterExpired ────────────────────────────────

describe('filterAlive', () => {
  it('keeps non-expiring messages', () => {
    const rows = [
      { id: 'permanent', metadata: null },
      { id: 'expired', metadata: { expiresAt: new Date(now.getTime() - 1).toISOString() } },
      { id: 'alive', metadata: { expiresAt: new Date(now.getTime() + 60_000).toISOString() } },
    ];
    const out = filterAlive(rows, now);
    assert.deepEqual(out.map(r => r.id).sort(), ['alive', 'permanent']);
  });
});

describe('filterExpired', () => {
  it('returns only the expired set (for cron cleanup)', () => {
    const rows = [
      { id: 'permanent', metadata: null },
      { id: 'expired', metadata: { expiresAt: new Date(now.getTime() - 1).toISOString() } },
      { id: 'alive', metadata: { expiresAt: new Date(now.getTime() + 60_000).toISOString() } },
    ];
    const out = filterExpired(rows, now);
    assert.deepEqual(out.map(r => r.id), ['expired']);
  });

  it('returns empty array when no rows are expired', () => {
    const rows = [{ id: 'a', metadata: null }, { id: 'b', metadata: null }];
    assert.deepEqual(filterExpired(rows, now), []);
  });
});

// ── getExpiresAt ────────────────────────────────────────────────

describe('getExpiresAt', () => {
  it('returns Date when valid expiresAt exists', () => {
    const iso = '2026-05-13T10:01:00.000Z';
    const d = getExpiresAt({ id: 'm', metadata: { expiresAt: iso } });
    assert.equal(d?.toISOString(), iso);
  });

  it('returns null when no expiresAt', () => {
    assert.equal(getExpiresAt({ id: 'm', metadata: {} }), null);
    assert.equal(getExpiresAt({ id: 'm', metadata: null }), null);
  });

  it('returns null on malformed expiresAt', () => {
    assert.equal(getExpiresAt({ id: 'm', metadata: { expiresAt: 'garbage' } }), null);
  });
});
