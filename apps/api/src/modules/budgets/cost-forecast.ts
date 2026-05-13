/**
 * Cost burn-rate analytics — pure functions.
 *
 * Given a daily-bucketed cost timeline (the same shape getOrgCostStats
 * already produces) these helpers compute:
 *   - 7-day weighted burn rate (recent days dominate)
 *   - projected exhaustion date against a monthly limit
 *   - direction-of-travel (rising / falling / flat)
 *   - spike detection vs. a 14-day rolling median
 *
 * Survive-or-Die uses this as the "runway gauge" on the dashboard, and
 * the same numbers feed proactive alerts ("at current rate you'll run
 * out in 4 days") in budget-notifications.service.
 */

export interface CostBucket {
  date: string; // ISO date YYYY-MM-DD or YYYY-MM
  cost: number;
}

export interface Forecast {
  /** Plain mean of the entire window. */
  avgDailyBurn: number;
  /** Mean over the trailing 7 buckets — what we extrapolate from. */
  recentDailyBurn: number;
  /** Sign of (recent - older) burn; flat when |delta| < 5% of recent. */
  trend: 'rising' | 'falling' | 'flat';
  /** % change of recentDailyBurn vs the 7-bucket window before it. NaN if no priorWindow. */
  trendDeltaPercent: number;
  /** Days of runway at recentDailyBurn given (limit - alreadySpent). null = no limit / already over. */
  daysToExhaust: number | null;
  /** ISO date at which budget exhausts (asOf + daysToExhaust). null when daysToExhaust is null. */
  exhaustDate: string | null;
  /** Buckets that exceeded MEDIAN(prior 14 buckets) * spikeMultiplier. */
  spikes: Array<{ date: string; cost: number; multiplier: number }>;
}

export interface ForecastInput {
  timeline: CostBucket[];
  monthlyLimitUsd?: number | null;
  alreadySpentUsd?: number;
  asOf?: Date;
  /** Default 3x rolling median. */
  spikeMultiplier?: number;
}

const RECENT_WINDOW_DAYS = 7;
const SPIKE_WINDOW_DAYS = 14;
const DEFAULT_SPIKE_MULTIPLIER = 3;
const FLAT_TREND_THRESHOLD_PERCENT = 5;

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Detect cost spikes: buckets where cost > median(previous N buckets) * multiplier.
 * Median is more robust than mean for spike detection (one big day doesn't
 * pull the threshold up and mask the next).
 */
export function detectSpikes(
  timeline: CostBucket[],
  multiplier: number = DEFAULT_SPIKE_MULTIPLIER,
  windowDays: number = SPIKE_WINDOW_DAYS,
): Array<{ date: string; cost: number; multiplier: number }> {
  const spikes: Array<{ date: string; cost: number; multiplier: number }> = [];
  for (let i = 0; i < timeline.length; i++) {
    if (i === 0) continue; // need at least one prior bucket
    const priorWindow = timeline.slice(Math.max(0, i - windowDays), i).map(b => b.cost);
    const baseline = median(priorWindow);
    // Baseline of 0 is meaningless (e.g. first non-zero day after silence) — skip.
    if (baseline <= 0) continue;
    const ratio = timeline[i].cost / baseline;
    if (ratio >= multiplier) {
      spikes.push({ date: timeline[i].date, cost: timeline[i].cost, multiplier: round2(ratio) });
    }
  }
  return spikes;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Add `days` calendar days to a date and return ISO YYYY-MM-DD. */
function addDaysISO(start: Date, days: number): string {
  const d = new Date(start.getTime());
  d.setUTCDate(d.getUTCDate() + Math.ceil(days));
  return d.toISOString().slice(0, 10);
}

export function buildForecast(input: ForecastInput): Forecast {
  const { timeline, monthlyLimitUsd, alreadySpentUsd = 0, asOf = new Date(), spikeMultiplier } = input;

  // Sort defensively so callers can pass any order.
  const sorted = [...timeline].sort((a, b) => a.date.localeCompare(b.date));

  const allCosts = sorted.map(b => b.cost);
  const avgDailyBurn = mean(allCosts);

  const recentWindow = sorted.slice(-RECENT_WINDOW_DAYS);
  const recentDailyBurn = mean(recentWindow.map(b => b.cost));

  // Trend: compare recent window vs the window before it. If we don't have
  // a full prior window, fall back to comparing against avgDailyBurn.
  let trendDeltaPercent = NaN;
  if (sorted.length >= RECENT_WINDOW_DAYS) {
    const priorWindow = sorted.slice(-2 * RECENT_WINDOW_DAYS, -RECENT_WINDOW_DAYS);
    if (priorWindow.length > 0) {
      const priorMean = mean(priorWindow.map(b => b.cost));
      if (priorMean > 0) {
        trendDeltaPercent = ((recentDailyBurn - priorMean) / priorMean) * 100;
      } else if (recentDailyBurn > 0) {
        trendDeltaPercent = Infinity; // came back from zero
      } else {
        trendDeltaPercent = 0;
      }
    }
  }
  let trend: Forecast['trend'] = 'flat';
  if (Number.isFinite(trendDeltaPercent)) {
    if (trendDeltaPercent > FLAT_TREND_THRESHOLD_PERCENT) trend = 'rising';
    else if (trendDeltaPercent < -FLAT_TREND_THRESHOLD_PERCENT) trend = 'falling';
  } else if (trendDeltaPercent === Infinity) {
    trend = 'rising';
  }

  // Runway projection — only meaningful when there's a limit AND burn > 0.
  let daysToExhaust: number | null = null;
  let exhaustDate: string | null = null;
  if (monthlyLimitUsd && monthlyLimitUsd > 0 && recentDailyBurn > 0) {
    const remaining = monthlyLimitUsd - alreadySpentUsd;
    if (remaining > 0) {
      daysToExhaust = round2(remaining / recentDailyBurn);
      exhaustDate = addDaysISO(asOf, daysToExhaust);
    } else {
      // Already over budget.
      daysToExhaust = 0;
      exhaustDate = asOf.toISOString().slice(0, 10);
    }
  }

  const spikes = detectSpikes(sorted, spikeMultiplier);

  return {
    avgDailyBurn: round6(avgDailyBurn),
    recentDailyBurn: round6(recentDailyBurn),
    trend,
    trendDeltaPercent: Number.isFinite(trendDeltaPercent) ? round2(trendDeltaPercent) : trendDeltaPercent,
    daysToExhaust,
    exhaustDate,
    spikes,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
