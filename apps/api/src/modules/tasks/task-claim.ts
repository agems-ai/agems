/**
 * Atomic task checkout primitives.
 *
 * Lets multiple scheduler instances (or process restarts) coexist without
 * double-executing a PENDING task. The pattern is the same as Paperclip's
 * issue checkout: optimistic UPDATE with a status+lock predicate.
 *
 * A task is "claimable" when:
 *   status = 'PENDING' AND (lockedBy IS NULL OR lockedUntil < NOW())
 *
 * Why two columns instead of one boolean: lockedUntil acts as a TTL so a
 * crashed worker's row reclaims itself automatically. lockedBy makes it
 * possible to spot orphan locks in observability and reject release
 * attempts from a different owner.
 */
import { randomUUID } from 'crypto';
import { hostname } from 'os';

/** Default time a claim is held before it's considered stale. */
export const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build a stable, unique identifier for the current process.
 * Format: <hostname>-<pid>-<uuid>. Survives the lifetime of a Node process;
 * regenerate per scheduler tick if you want per-claim ownership instead.
 */
export function buildLockOwnerId(opts?: { host?: string; pid?: number; uuid?: string }): string {
  const h = opts?.host ?? hostname();
  const p = opts?.pid ?? process.pid;
  const u = opts?.uuid ?? randomUUID();
  return `${h}-${p}-${u}`;
}

/** Compute the expiry timestamp for a new lock. */
export function computeLockUntil(now: Date, ttlMs: number = DEFAULT_LOCK_TTL_MS): Date {
  return new Date(now.getTime() + Math.max(0, ttlMs));
}

/**
 * Returns true if the lock has expired (or never existed). Used both in the
 * SQL predicate and for in-memory sanity checks.
 */
export function isStaleLock(lockedUntil: Date | null | undefined, now: Date): boolean {
  if (!lockedUntil) return true;
  return lockedUntil.getTime() < now.getTime();
}

/**
 * Build the Prisma `where` predicate that matches all tasks safe to claim:
 * PENDING and either unlocked or with a stale lock.
 *
 * The predicate is the source of correctness: it MUST be passed to
 * `updateMany` (atomic) — passing it to `findMany` then doing an `update`
 * recreates the race we're trying to eliminate.
 */
export function claimablePredicate(now: Date) {
  return {
    status: 'PENDING' as const,
    OR: [
      { lockedBy: null },
      { lockedUntil: { lt: now } },
    ],
  };
}

/**
 * Verify that a release attempt comes from the same process that took the
 * lock. Releasing somebody else's lock is benign here (the worst case is an
 * early re-claim by another worker), but logging it surfaces orphans.
 */
export function canReleaseLock(currentLockedBy: string | null | undefined, ourOwnerId: string): boolean {
  if (!currentLockedBy) return true; // already released
  return currentLockedBy === ourOwnerId;
}

/**
 * Minimal Prisma surface we depend on. Decoupled from the real client so
 * tests can inject a fake without spinning up the full app.
 */
export interface TaskClaimClient {
  task: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

/**
 * Try to claim a specific task atomically. Returns true if this caller
 * now owns the lock. Idempotent: a successful caller can claim again
 * (the predicate still matches because lockedBy=ourOwnerId would not be
 * NULL, but the lockedUntil would be < now if expired — and if it isn't,
 * we already own it).
 *
 * Note: the predicate intentionally does NOT include `lockedBy: ourOwnerId`
 * for renewals — that's a different operation (renewLock).
 */
export async function tryClaimTask(
  client: TaskClaimClient,
  args: { taskId: string; ownerId: string; now?: Date; ttlMs?: number },
): Promise<boolean> {
  const now = args.now ?? new Date();
  const ttlMs = args.ttlMs ?? DEFAULT_LOCK_TTL_MS;
  const lockedUntil = computeLockUntil(now, ttlMs);

  const result = await client.task.updateMany({
    where: {
      id: args.taskId,
      ...claimablePredicate(now),
    },
    data: {
      lockedBy: args.ownerId,
      lockedUntil,
    },
  });

  return result.count > 0;
}

/**
 * Release a claim. Safe to call from a `finally` block. Clears lock fields
 * only if we still own them — if the lock already expired and was reclaimed
 * by someone else, we leave it alone.
 *
 * Does NOT touch status — that's the caller's job (e.g. moving PENDING ->
 * IN_PROGRESS / COMPLETED / FAILED).
 */
export async function releaseTaskLock(
  client: TaskClaimClient,
  args: { taskId: string; ownerId: string },
): Promise<boolean> {
  const result = await client.task.updateMany({
    where: { id: args.taskId, lockedBy: args.ownerId },
    data: { lockedBy: null, lockedUntil: null },
  });
  return result.count > 0;
}

/**
 * Extend the lock TTL for a long-running task. Useful for jobs that legitimately
 * take >TTL minutes — heartbeat from the worker keeps the row claimed.
 * Only renews if WE still own the lock.
 */
export async function renewTaskLock(
  client: TaskClaimClient,
  args: { taskId: string; ownerId: string; now?: Date; ttlMs?: number },
): Promise<boolean> {
  const now = args.now ?? new Date();
  const ttlMs = args.ttlMs ?? DEFAULT_LOCK_TTL_MS;
  const result = await client.task.updateMany({
    where: { id: args.taskId, lockedBy: args.ownerId },
    data: { lockedUntil: computeLockUntil(now, ttlMs) },
  });
  return result.count > 0;
}
