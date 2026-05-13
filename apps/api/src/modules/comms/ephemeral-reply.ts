/**
 * Ephemeral (self-expiring) message helper.
 *
 * Hermes pattern (`EphemeralReply(str)` subclass): system notifications
 * the user sees briefly — "Budget updated", "Curator moved 3 skills
 * to STALE", "Agent paused: budget exceeded" — that don't clutter the
 * channel after the user has had a chance to read them.
 *
 * Stored as a normal Message row. Expiry lives in `metadata.expiresAt`
 * (no schema change). The comms gateway's findMany() can filter via
 * `filterAlive()`, and a periodic cron sweep can hard-delete the rows.
 *
 * Pure module. No DB / no Nest. Caller decides where to call
 * `buildEphemeralPayload()` (when creating) and where to call
 * `filterAlive()` (when reading).
 */

export interface EphemeralPayload {
  /** Plain text content. */
  content: string;
  /** Caller sets contentType — usually ACTION for system notifs. */
  contentType?: string;
  /** Metadata containing expiresAt, plus anything else the caller
   *  wants to keep alongside. */
  metadata: Record<string, unknown>;
}

/**
 * Build the message payload for an ephemeral reply. Caller passes it
 * to prisma.message.create({ data: { ...payload, channelId, senderType,
 * senderId } }).
 */
export function buildEphemeralPayload(args: {
  content: string;
  ttlSeconds: number;
  contentType?: string;
  /** Optional extra metadata to merge in. */
  extraMetadata?: Record<string, unknown>;
  /** Test-injectable clock. */
  now?: Date;
}): EphemeralPayload {
  if (args.ttlSeconds <= 0) {
    throw new Error('ttlSeconds must be positive');
  }
  const now = args.now ?? new Date();
  const expiresAt = new Date(now.getTime() + args.ttlSeconds * 1000).toISOString();
  return {
    content: args.content,
    contentType: args.contentType ?? 'ACTION',
    metadata: { ...args.extraMetadata, ephemeral: true, expiresAt },
  };
}

/** Minimal shape of a Message row that has been loaded from the DB. */
export interface MessageRow {
  id: string;
  metadata: unknown;
}

/**
 * Return true if `message.metadata.expiresAt` is set and in the past.
 * Messages without metadata.expiresAt (the vast majority) are NEVER
 * considered expired.
 */
export function isExpired(message: MessageRow, now: Date): boolean {
  const meta = message.metadata;
  if (typeof meta !== 'object' || meta === null) return false;
  const expiresAt = (meta as Record<string, unknown>).expiresAt;
  if (typeof expiresAt !== 'string') return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return t <= now.getTime();
}

/** Filter to messages that are still alive (not yet expired). */
export function filterAlive<T extends MessageRow>(messages: T[], now: Date): T[] {
  return messages.filter(m => !isExpired(m, now));
}

/** Filter to messages that ARE expired — the set a cleanup cron deletes. */
export function filterExpired<T extends MessageRow>(messages: T[], now: Date): T[] {
  return messages.filter(m => isExpired(m, now));
}

/**
 * Pull out the expiry timestamp from a message row, or null if it has
 * none. Handy for the comms WebSocket layer that may want to schedule
 * a delete-from-client timeout instead of polling.
 */
export function getExpiresAt(message: MessageRow): Date | null {
  const meta = message.metadata;
  if (typeof meta !== 'object' || meta === null) return null;
  const expiresAt = (meta as Record<string, unknown>).expiresAt;
  if (typeof expiresAt !== 'string') return null;
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) ? null : new Date(t);
}
