/**
 * Small scheduler / messaging utilities — one module, three concerns
 * that are too small to live on their own.
 *
 * 1. Backoff policy (OpenClaw `src/infra/backoff.ts`)
 *    BackoffPolicy + computeBackoff + sleepWithAbort. Used by adapter
 *    retry loops, channel-restart supervisors, anything that needs
 *    exponential delay with jitter and a hard ceiling.
 *
 * 2. Top-of-hour cron stagger (OpenClaw `src/cron/stagger.ts`)
 *    Detects `0 *` style cron expressions and adds a tenant-specific
 *    minute offset to spread the thundering herd of jobs that all
 *    fire at HH:00. For multi-tenant AGEMS — critical against the
 *    every-tenant-syncs-Stripe-at-midnight spike.
 *
 * 3. Agent envelope formatter (OpenClaw `src/auto-reply/envelope.ts`)
 *    Wraps an inbound user message in "[Channel · @sender +5m] body"
 *    so the LLM has unambiguous context: which channel, which user,
 *    how long since the previous message.
 *
 * Pure module. No I/O except `sleepWithAbort` which awaits a timer.
 */

import { createHash } from 'crypto';

// ── 1. Backoff ──────────────────────────────────────────────────

export interface BackoffPolicy {
  baseMs: number;
  ceilMs: number;
  factor: number;
  /** Jitter as a fraction of the computed delay. 0 = no jitter,
   *  0.1 = ±10%. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 1_000,
  ceilMs: 5 * 60_000,
  factor: 2,
  jitter: 0.1,
};

/** Compute the delay for attempt N (0-based). Deterministic when
 *  `rng` is provided — tests pass a seeded fn so jitter is stable. */
export function computeBackoff(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF, rng: () => number = Math.random): number {
  if (attempt < 0) return 0;
  const raw = policy.baseMs * Math.pow(policy.factor, attempt);
  const capped = Math.min(raw, policy.ceilMs);
  if (policy.jitter <= 0) return Math.floor(capped);
  const j = (rng() * 2 - 1) * policy.jitter; // in [-jitter, +jitter]
  return Math.max(0, Math.floor(capped * (1 + j)));
}

/** Promise that resolves after `ms` OR rejects when abortSignal fires. */
export async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ── 2. Top-of-hour cron stagger ─────────────────────────────────

export const DEFAULT_TOP_OF_HOUR_STAGGER_MS = 5 * 60_000;

/**
 * Detect cron expressions that fire AT HH:00 (top of hour). Matches
 * `0 *` and `0 H` and `0 H *` forms — the patterns that cause every
 * tenant to fire simultaneously.
 */
export function isTopOfHourCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  // First field (minute) is exactly "0" — the spike pattern.
  return parts[0] === '0';
}

/**
 * Compute a stable per-tenant offset (in ms) within a stagger window.
 * Same tenant always lands on the same offset, so logs are predictable.
 * `windowMs` defaults to 5 minutes — wide enough to flatten a 1000-
 * tenant herd without delaying anyone meaningfully.
 */
export function staggerOffsetMs(tenantId: string, windowMs: number = DEFAULT_TOP_OF_HOUR_STAGGER_MS): number {
  const h = createHash('sha256').update(tenantId).digest();
  // Take first 4 bytes as uint32, modulo window.
  const n = h.readUInt32BE(0);
  return n % Math.max(1, windowMs);
}

// ── 3. Envelope formatter ───────────────────────────────────────

export interface EnvelopeInput {
  channelName?: string;
  senderDisplayName?: string;
  /** Sender id when display name isn't available (e.g. "U987"). */
  senderId?: string;
  /** When the previous message in this channel arrived. */
  lastMessageAt?: Date;
  /** Now reference (test-injectable). */
  now?: Date;
  /** Optional weekday prefix — handy for daily-context cues. */
  includeWeekday?: boolean;
  /** Message body. */
  body: string;
}

/**
 * Wrap an inbound message in a "[Channel · @sender +5m] body" envelope.
 * Empty channelName / senderName parts are omitted gracefully. The
 * elapsed-since-last-message portion is skipped when lastMessageAt is
 * missing.
 *
 * Brackets in display names are sanitised to round-parens so they can't
 * close the envelope prematurely.
 */
export function buildEnvelope(input: EnvelopeInput): string {
  const now = input.now ?? new Date();
  const headerParts: string[] = [];

  if (input.includeWeekday) {
    headerParts.push(weekdayShort(now));
  }
  if (input.channelName) headerParts.push(sanitiseHeaderPart(input.channelName));

  const sender = input.senderDisplayName || input.senderId;
  if (sender) headerParts.push('@' + sanitiseHeaderPart(sender));

  if (input.lastMessageAt) {
    const elapsedMin = Math.max(0, Math.floor((now.getTime() - input.lastMessageAt.getTime()) / 60_000));
    headerParts.push(`+${elapsedMin}m`);
  }

  if (headerParts.length === 0) return input.body;
  return `[${headerParts.join(' · ')}] ${input.body}`;
}

function sanitiseHeaderPart(s: string): string {
  return s.replace(/[\[\]]/g, c => c === '[' ? '(' : ')');
}

function weekdayShort(d: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
}
