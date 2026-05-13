/**
 * Unit tests for atomic task checkout primitives.
 *
 * These guard the correctness of the DB claim predicate. If they break,
 * two scheduler instances can run the same task — the exact race we
 * introduced these primitives to prevent.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLockOwnerId,
  computeLockUntil,
  isStaleLock,
  claimablePredicate,
  canReleaseLock,
  tryClaimTask,
  releaseTaskLock,
  renewTaskLock,
  DEFAULT_LOCK_TTL_MS,
  type TaskClaimClient,
} from './task-claim';

// ── buildLockOwnerId ─────────────────────────────────────────────

describe('buildLockOwnerId', () => {
  it('uses host-pid-uuid format', () => {
    const id = buildLockOwnerId({ host: 'host1', pid: 42, uuid: 'abc' });
    assert.equal(id, 'host1-42-abc');
  });

  it('generates unique ids on successive calls (uuid component)', () => {
    const a = buildLockOwnerId();
    const b = buildLockOwnerId();
    assert.notEqual(a, b);
  });

  it('embeds the current pid by default', () => {
    const id = buildLockOwnerId();
    assert.ok(id.includes(`-${process.pid}-`), `pid not in id: ${id}`);
  });
});

// ── computeLockUntil ─────────────────────────────────────────────

describe('computeLockUntil', () => {
  it('adds ttlMs to now', () => {
    const now = new Date('2026-05-13T10:00:00.000Z');
    const until = computeLockUntil(now, 60_000);
    assert.equal(until.toISOString(), '2026-05-13T10:01:00.000Z');
  });

  it('uses 5-minute default when ttlMs omitted', () => {
    const now = new Date('2026-05-13T10:00:00.000Z');
    const until = computeLockUntil(now);
    assert.equal(until.getTime() - now.getTime(), DEFAULT_LOCK_TTL_MS);
  });

  it('clamps negative ttl to 0 (returns now)', () => {
    const now = new Date('2026-05-13T10:00:00.000Z');
    const until = computeLockUntil(now, -1000);
    assert.equal(until.getTime(), now.getTime());
  });
});

// ── isStaleLock ──────────────────────────────────────────────────

describe('isStaleLock', () => {
  const now = new Date('2026-05-13T10:00:00.000Z');

  it('treats null lockedUntil as stale (= unlocked)', () => {
    assert.equal(isStaleLock(null, now), true);
  });

  it('treats undefined as stale', () => {
    assert.equal(isStaleLock(undefined, now), true);
  });

  it('lock expiring in the past is stale', () => {
    const pastExpiry = new Date(now.getTime() - 1000);
    assert.equal(isStaleLock(pastExpiry, now), true);
  });

  it('lock expiring in the future is fresh', () => {
    const futureExpiry = new Date(now.getTime() + 1000);
    assert.equal(isStaleLock(futureExpiry, now), false);
  });

  it('lock expiring exactly at now is NOT stale (lt, not lte)', () => {
    // claimablePredicate uses `lockedUntil: { lt: now }`, so exact-equal
    // counts as still locked. Document the boundary here.
    assert.equal(isStaleLock(now, now), false);
  });
});

// ── claimablePredicate ───────────────────────────────────────────

describe('claimablePredicate', () => {
  it('matches PENDING status only', () => {
    const now = new Date();
    const p = claimablePredicate(now);
    assert.equal(p.status, 'PENDING');
  });

  it('OR clause matches null lockedBy OR stale lockedUntil', () => {
    const now = new Date('2026-05-13T10:00:00.000Z');
    const p = claimablePredicate(now);
    assert.equal(p.OR.length, 2);
    assert.deepEqual(p.OR[0], { lockedBy: null });
    assert.deepEqual(p.OR[1], { lockedUntil: { lt: now } });
  });
});

// ── canReleaseLock ───────────────────────────────────────────────

describe('canReleaseLock', () => {
  it('null lock is releasable by anyone (already released)', () => {
    assert.equal(canReleaseLock(null, 'me-123'), true);
  });

  it('our own lock is releasable', () => {
    assert.equal(canReleaseLock('me-123', 'me-123'), true);
  });

  it("someone else's lock is not releasable", () => {
    assert.equal(canReleaseLock('them-456', 'me-123'), false);
  });
});

// ── Fake client for claim/release/renew ──────────────────────────

interface FakeRow {
  id: string;
  status: string;
  lockedBy: string | null;
  lockedUntil: Date | null;
}

function makeFakeClient(rows: FakeRow[]): TaskClaimClient & { _rows: FakeRow[] } {
  return {
    _rows: rows,
    task: {
      async updateMany({ where, data }: { where: any; data: any }) {
        let count = 0;
        for (const row of rows) {
          if (!matchPredicate(row, where)) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
      async update({ where, data }: { where: any; data: any }) {
        const row = rows.find(r => r.id === where.id);
        if (!row) throw new Error(`Row ${where.id} not found`);
        Object.assign(row, data);
        return row;
      },
    },
  };
}

function matchPredicate(row: FakeRow, predicate: any): boolean {
  if (predicate.id && row.id !== predicate.id) return false;
  if (predicate.status && row.status !== predicate.status) return false;
  if (predicate.lockedBy !== undefined && row.lockedBy !== predicate.lockedBy) return false;
  if (predicate.OR) {
    const any = predicate.OR.some((clause: any) => {
      if ('lockedBy' in clause) return row.lockedBy === clause.lockedBy;
      if ('lockedUntil' in clause) {
        const cond = clause.lockedUntil;
        if (cond && 'lt' in cond) {
          return row.lockedUntil !== null && row.lockedUntil < cond.lt;
        }
      }
      return false;
    });
    if (!any) return false;
  }
  return true;
}

// ── tryClaimTask ─────────────────────────────────────────────────

describe('tryClaimTask', () => {
  const now = new Date('2026-05-13T10:00:00.000Z');

  it('claims a fresh PENDING task and sets owner+expiry', async () => {
    const rows: FakeRow[] = [{ id: 't1', status: 'PENDING', lockedBy: null, lockedUntil: null }];
    const client = makeFakeClient(rows);
    const ok = await tryClaimTask(client, { taskId: 't1', ownerId: 'me', now, ttlMs: 60_000 });
    assert.equal(ok, true);
    assert.equal(rows[0].lockedBy, 'me');
    assert.equal(rows[0].lockedUntil?.getTime(), now.getTime() + 60_000);
  });

  it('refuses to claim an already-locked task with future expiry', async () => {
    const rows: FakeRow[] = [{
      id: 't1', status: 'PENDING',
      lockedBy: 'other', lockedUntil: new Date(now.getTime() + 60_000),
    }];
    const client = makeFakeClient(rows);
    const ok = await tryClaimTask(client, { taskId: 't1', ownerId: 'me', now });
    assert.equal(ok, false);
    assert.equal(rows[0].lockedBy, 'other'); // unchanged
  });

  it('reclaims a stale lock (lockedUntil < now)', async () => {
    const rows: FakeRow[] = [{
      id: 't1', status: 'PENDING',
      lockedBy: 'crashed', lockedUntil: new Date(now.getTime() - 1000),
    }];
    const client = makeFakeClient(rows);
    const ok = await tryClaimTask(client, { taskId: 't1', ownerId: 'me', now });
    assert.equal(ok, true);
    assert.equal(rows[0].lockedBy, 'me');
  });

  it('refuses to claim a non-PENDING task even if unlocked', async () => {
    const rows: FakeRow[] = [{ id: 't1', status: 'IN_PROGRESS', lockedBy: null, lockedUntil: null }];
    const client = makeFakeClient(rows);
    const ok = await tryClaimTask(client, { taskId: 't1', ownerId: 'me', now });
    assert.equal(ok, false);
  });

  it('two simultaneous claims: exactly one wins (no double-claim)', async () => {
    // Single-row table — both callers try the same task at the same instant.
    // The fake client mutates serially, so the second updateMany sees
    // lockedBy='A' and rejects. This documents the invariant: only one
    // updateMany call ever flips lockedBy from null to a real owner.
    const rows: FakeRow[] = [{ id: 't1', status: 'PENDING', lockedBy: null, lockedUntil: null }];
    const client = makeFakeClient(rows);
    const [a, b] = await Promise.all([
      tryClaimTask(client, { taskId: 't1', ownerId: 'A', now }),
      tryClaimTask(client, { taskId: 't1', ownerId: 'B', now }),
    ]);
    assert.equal(a !== b, true, 'exactly one should succeed');
    assert.equal(['A', 'B'].includes(rows[0].lockedBy ?? ''), true);
  });
});

// ── releaseTaskLock ──────────────────────────────────────────────

describe('releaseTaskLock', () => {
  it('clears lock fields when we own the lock', async () => {
    const rows: FakeRow[] = [{
      id: 't1', status: 'PENDING',
      lockedBy: 'me', lockedUntil: new Date('2026-05-13T10:05:00.000Z'),
    }];
    const client = makeFakeClient(rows);
    const ok = await releaseTaskLock(client, { taskId: 't1', ownerId: 'me' });
    assert.equal(ok, true);
    assert.equal(rows[0].lockedBy, null);
    assert.equal(rows[0].lockedUntil, null);
  });

  it("does NOT clear someone else's lock", async () => {
    const rows: FakeRow[] = [{
      id: 't1', status: 'PENDING',
      lockedBy: 'them', lockedUntil: new Date('2026-05-13T10:05:00.000Z'),
    }];
    const client = makeFakeClient(rows);
    const ok = await releaseTaskLock(client, { taskId: 't1', ownerId: 'me' });
    assert.equal(ok, false);
    assert.equal(rows[0].lockedBy, 'them'); // untouched
  });

  it('is a no-op on already-released task (returns false, throws nothing)', async () => {
    const rows: FakeRow[] = [{ id: 't1', status: 'PENDING', lockedBy: null, lockedUntil: null }];
    const client = makeFakeClient(rows);
    const ok = await releaseTaskLock(client, { taskId: 't1', ownerId: 'me' });
    assert.equal(ok, false);
  });
});

// ── renewTaskLock ────────────────────────────────────────────────

describe('renewTaskLock', () => {
  it('extends our lock and leaves owner unchanged', async () => {
    const now = new Date('2026-05-13T10:00:00.000Z');
    const oldExpiry = new Date(now.getTime() + 1000);
    const rows: FakeRow[] = [{ id: 't1', status: 'IN_PROGRESS', lockedBy: 'me', lockedUntil: oldExpiry }];
    const client = makeFakeClient(rows);
    const ok = await renewTaskLock(client, { taskId: 't1', ownerId: 'me', now, ttlMs: 60_000 });
    assert.equal(ok, true);
    assert.equal(rows[0].lockedBy, 'me');
    assert.ok(rows[0].lockedUntil!.getTime() > oldExpiry.getTime());
  });

  it("refuses to renew someone else's lock", async () => {
    const now = new Date('2026-05-13T10:00:00.000Z');
    const rows: FakeRow[] = [{
      id: 't1', status: 'IN_PROGRESS',
      lockedBy: 'them', lockedUntil: new Date(now.getTime() + 1000),
    }];
    const client = makeFakeClient(rows);
    const ok = await renewTaskLock(client, { taskId: 't1', ownerId: 'me', now });
    assert.equal(ok, false);
  });
});

// ── End-to-end: claim → execute → release ────────────────────────

describe('claim/release lifecycle', () => {
  it('full cycle: claim, do work, release, re-claim is possible', async () => {
    const now = new Date('2026-05-13T10:00:00.000Z');
    const rows: FakeRow[] = [{ id: 't1', status: 'PENDING', lockedBy: null, lockedUntil: null }];
    const client = makeFakeClient(rows);

    // Worker A claims
    assert.equal(await tryClaimTask(client, { taskId: 't1', ownerId: 'A', now }), true);
    // Worker B is rejected while A holds the lock
    assert.equal(await tryClaimTask(client, { taskId: 't1', ownerId: 'B', now }), false);
    // A releases
    assert.equal(await releaseTaskLock(client, { taskId: 't1', ownerId: 'A' }), true);
    // Now B can claim
    assert.equal(await tryClaimTask(client, { taskId: 't1', ownerId: 'B', now }), true);
    assert.equal(rows[0].lockedBy, 'B');
  });
});
