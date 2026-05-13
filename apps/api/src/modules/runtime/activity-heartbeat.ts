/**
 * Activity heartbeat formatting + throttling for long-running tools.
 *
 * Hermes' `touch_activity_if_due` pattern: when a tool takes >5s the
 * agent UI shows "Working… 12s elapsed, last: read 4.3MB". Without this,
 * users see a silent spinner and assume the agent crashed.
 *
 * This module is the pure half — figures out WHEN to emit a heartbeat
 * (throttled to avoid spam) and WHAT the heartbeat text should say.
 * The comms gateway / runtime wrapping calls this and pushes the
 * resulting text out over WebSocket as a system message with
 * MessageContentType=ACTION or as an ephemeral reply.
 *
 * Pure: no clock, no I/O. `now` and `lastTickAt` come in as arguments.
 */

export interface HeartbeatState {
  /** When we last emitted a heartbeat. null = never. */
  lastTickAt: Date | null;
  /** Cumulative bytes / tokens / lines processed (tool-specific). */
  progress?: number;
  /** Last meaningful event (e.g. "tool:bash", "browser:click"). */
  lastEvent?: string;
}

export interface HeartbeatConfig {
  /** Minimum gap between heartbeat emissions. Default 5s. */
  intervalMs?: number;
  /** Don't emit until at least this many ms have passed since tool
   *  start. Short tools should NOT see a heartbeat at all. Default 5s. */
  warmupMs?: number;
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_WARMUP_MS = 5_000;

/**
 * Decide whether a heartbeat should fire right now. Pure: returns true
 * if (now - max(startedAt, lastTickAt)) >= intervalMs, AND
 * (now - startedAt) >= warmupMs.
 */
export function shouldEmitHeartbeat(args: {
  startedAt: Date;
  lastTickAt: Date | null;
  now: Date;
  config?: HeartbeatConfig;
}): boolean {
  const interval = args.config?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const warmup = args.config?.warmupMs ?? DEFAULT_WARMUP_MS;

  const sinceStart = args.now.getTime() - args.startedAt.getTime();
  if (sinceStart < warmup) return false;

  const sinceLast = args.lastTickAt
    ? args.now.getTime() - args.lastTickAt.getTime()
    : sinceStart;
  return sinceLast >= interval;
}

/**
 * Format the heartbeat message text. Caller decides the channel
 * (system message vs ephemeral); this just makes the line.
 *
 * Examples:
 *   "Working… 12s elapsed"
 *   "Working… 1m 23s elapsed, last: tool:bash"
 *   "Working… 45s elapsed, processed 4.3MB, last: browser:click"
 */
export function formatHeartbeatText(args: {
  startedAt: Date;
  now: Date;
  lastEvent?: string;
  progress?: number;
  /** Optional formatter for progress (defaults to integer with unit). */
  formatProgress?: (n: number) => string;
}): string {
  const elapsedMs = args.now.getTime() - args.startedAt.getTime();
  const parts: string[] = [`Working… ${formatElapsed(elapsedMs)} elapsed`];
  if (args.progress !== undefined && args.progress > 0) {
    const formatted = args.formatProgress ? args.formatProgress(args.progress) : `${args.progress}`;
    parts.push(`processed ${formatted}`);
  }
  if (args.lastEvent) {
    parts.push(`last: ${args.lastEvent}`);
  }
  return parts.join(', ');
}

/** Human-readable elapsed duration: "12s" / "1m 30s" / "1h 5m". */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return secs > 0 ? `${hours}h ${mins}m ${secs}s` : `${hours}h ${mins}m`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/** Common formatter for byte counts. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

/**
 * Convenience: combine decision + formatting. Returns the text to
 * emit, or null if no heartbeat is due. Caller updates state.lastTickAt
 * after a non-null return.
 */
export function maybeHeartbeat(args: {
  startedAt: Date;
  state: HeartbeatState;
  now: Date;
  config?: HeartbeatConfig;
  formatProgress?: (n: number) => string;
}): string | null {
  if (!shouldEmitHeartbeat({ startedAt: args.startedAt, lastTickAt: args.state.lastTickAt, now: args.now, config: args.config })) {
    return null;
  }
  return formatHeartbeatText({
    startedAt: args.startedAt,
    now: args.now,
    progress: args.state.progress,
    lastEvent: args.state.lastEvent,
    formatProgress: args.formatProgress,
  });
}
