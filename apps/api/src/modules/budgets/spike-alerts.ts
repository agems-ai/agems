/**
 * Proactive cost-spike detection.
 *
 * Pairs with cost-forecast.ts's `detectSpikes()` — that helper looks at a
 * pre-aggregated timeline and tells you which buckets exceeded the
 * rolling median. This module wraps that into a periodic check: bucket
 * the org's recent executions into days, hand the timeline to
 * detectSpikes, and emit a structured payload the notifier can act on.
 *
 * Why a separate module: detectSpikes is "given a timeline, find
 * spikes". This is "given a Prisma client, build the timeline + decide
 * whether to alert about the most recent one". Different concern.
 *
 * Pure-ish: the detection itself is pure (no I/O). The Prisma-touching
 * `findRecentSpikes()` accepts a minimal client interface, so tests
 * inject a fake.
 */

import { detectSpikes, median } from './cost-forecast';

export type SpikeSeverity = 'minor' | 'major' | 'severe';

export interface SpikeAlert {
  date: string;
  cost: number;
  multiplier: number;
  severity: SpikeSeverity;
  message: string;
}

/**
 * Severity bucket from the multiplier.
 *   3x – 5x  → minor
 *   5x – 10x → major
 *   10x+     → severe
 */
export function severityFor(multiplier: number): SpikeSeverity {
  if (multiplier >= 10) return 'severe';
  if (multiplier >= 5) return 'major';
  return 'minor';
}

/** Human-readable message line used by the notifier. */
export function buildAlertMessage(spike: { date: string; cost: number; multiplier: number; severity: SpikeSeverity }): string {
  return `${spike.severity === 'severe' ? '🚨' : spike.severity === 'major' ? '⚠️' : 'ℹ️'} Cost spike on ${spike.date}: $${spike.cost.toFixed(2)} (${spike.multiplier.toFixed(1)}× rolling median)`;
}

/**
 * Pre-aggregated execution → daily-bucket timeline. Pure. Same shape as
 * BudgetsService.getOrgCostStats() produces internally; extracted so it
 * can run from a cron tick without going through the controller.
 */
export interface ExecutionRow {
  startedAt: Date;
  costUsd: number | null;
}
export interface CostBucket { date: string; cost: number }

export function bucketExecutionsByDay(executions: ExecutionRow[]): CostBucket[] {
  const buckets = new Map<string, number>();
  for (const ex of executions) {
    if (!ex.costUsd || ex.costUsd <= 0) continue;
    const key = ex.startedAt.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + ex.costUsd);
  }
  return Array.from(buckets.entries())
    .map(([date, cost]) => ({ date, cost }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface SpikeDetectionOptions {
  /** Days of history to bucket (default 14 — matches detectSpikes' window). */
  windowDays?: number;
  /** Spike multiplier threshold (default 3x). */
  multiplier?: number;
  /** Only return spikes that landed AFTER this timestamp (filters out
   *  already-alerted history). */
  since?: Date;
}

/**
 * Run the full detection pass against an executions-row list. Pure
 * function — the caller is responsible for the DB read.
 */
export function detectSpikeAlerts(
  executions: ExecutionRow[],
  options: SpikeDetectionOptions = {},
): SpikeAlert[] {
  const multiplier = options.multiplier ?? 3;
  const timeline = bucketExecutionsByDay(executions);
  if (timeline.length < 2) return []; // not enough history to compare
  const spikes = detectSpikes(timeline, multiplier);

  return spikes
    .filter(s => !options.since || new Date(s.date) > options.since)
    .map(s => {
      const severity = severityFor(s.multiplier);
      return {
        date: s.date,
        cost: s.cost,
        multiplier: s.multiplier,
        severity,
        message: buildAlertMessage({ ...s, severity }),
      };
    });
}

/** Minimal Prisma surface used by findRecentSpikes. */
export interface SpikeAlertsClient {
  agentExecution: {
    findMany(args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
    }): Promise<ExecutionRow[]>;
  };
}

/**
 * Pull recent executions for an org and run spike detection. Used by the
 * cron-tick in TaskScheduler. `since` lets the caller pass last-tick
 * timestamp so the same spike isn't alerted twice.
 */
export async function findRecentSpikes(
  client: SpikeAlertsClient,
  args: { orgId: string; now?: Date; options?: SpikeDetectionOptions },
): Promise<SpikeAlert[]> {
  const now = args.now ?? new Date();
  const windowDays = args.options?.windowDays ?? 14;
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const executions = await client.agentExecution.findMany({
    where: {
      agent: { orgId: args.orgId },
      startedAt: { gte: cutoff },
      costUsd: { not: null },
    },
    select: { startedAt: true, costUsd: true },
    orderBy: { startedAt: 'asc' },
  });

  return detectSpikeAlerts(executions, args.options);
}

// Re-export for convenience.
export { median };
