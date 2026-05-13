/**
 * Unit tests for burn-rate forecast math.
 *
 * If these break, the runway gauge on the dashboard lies and the proactive
 * "you'll run out in N days" alert misfires (either falsely panicking
 * users or — worse — staying silent until they actually run out).
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mean,
  median,
  detectSpikes,
  buildForecast,
  type CostBucket,
} from './cost-forecast';

// Helper to make a flat timeline of N days ending today.
function flatTimeline(n: number, perDay: number, endDate = '2026-05-13'): CostBucket[] {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return { date: d.toISOString().slice(0, 10), cost: perDay };
  });
}

describe('mean', () => {
  it('returns 0 for empty list (no NaN propagation)', () => {
    assert.equal(mean([]), 0);
  });
  it('arithmetic mean of integers', () => {
    assert.equal(mean([1, 2, 3, 4, 5]), 3);
  });
  it('handles a single value', () => {
    assert.equal(mean([42]), 42);
  });
});

describe('median', () => {
  it('returns 0 for empty list', () => {
    assert.equal(median([]), 0);
  });
  it('odd-length: middle value', () => {
    assert.equal(median([1, 2, 3]), 2);
  });
  it('even-length: average of two middle values', () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });
  it('handles unsorted input (sorts internally)', () => {
    assert.equal(median([5, 1, 3, 2, 4]), 3);
  });
  it('a single spike does NOT pull median (unlike mean) — that\'s the whole point', () => {
    const withSpike = [1, 1, 1, 1, 1000];
    assert.equal(median(withSpike), 1);
    assert.ok(mean(withSpike) > 200, 'mean is dragged up');
  });
});

describe('detectSpikes', () => {
  it('flags a 3x bucket against the rolling median of prior buckets', () => {
    const timeline: CostBucket[] = [
      { date: '2026-05-01', cost: 1 },
      { date: '2026-05-02', cost: 1 },
      { date: '2026-05-03', cost: 1 },
      { date: '2026-05-04', cost: 1 },
      { date: '2026-05-05', cost: 5 }, // 5x — spike
    ];
    const spikes = detectSpikes(timeline, 3);
    assert.equal(spikes.length, 1);
    assert.equal(spikes[0].date, '2026-05-05');
    assert.equal(spikes[0].multiplier, 5);
  });

  it('does not flag a 2x bucket when threshold is 3x', () => {
    const timeline: CostBucket[] = [
      { date: '2026-05-01', cost: 1 },
      { date: '2026-05-02', cost: 1 },
      { date: '2026-05-03', cost: 2 },
    ];
    assert.deepEqual(detectSpikes(timeline, 3), []);
  });

  it('skips the first bucket (no prior to compare against)', () => {
    const timeline: CostBucket[] = [
      { date: '2026-05-01', cost: 100 },
      { date: '2026-05-02', cost: 100 },
    ];
    assert.deepEqual(detectSpikes(timeline, 3), []);
  });

  it('ignores buckets where prior median is 0 (cold-start noise)', () => {
    // Going from $0 spend to $1 spend is not a spike — it's just starting.
    const timeline: CostBucket[] = [
      { date: '2026-05-01', cost: 0 },
      { date: '2026-05-02', cost: 0 },
      { date: '2026-05-03', cost: 1 },
    ];
    assert.deepEqual(detectSpikes(timeline, 3), []);
  });

  it('catches multiple spikes in the same window', () => {
    const timeline: CostBucket[] = [
      { date: '2026-05-01', cost: 1 },
      { date: '2026-05-02', cost: 1 },
      { date: '2026-05-03', cost: 1 },
      { date: '2026-05-04', cost: 5 },
      { date: '2026-05-05', cost: 1 },
      { date: '2026-05-06', cost: 10 },
    ];
    const spikes = detectSpikes(timeline, 3);
    assert.equal(spikes.length, 2);
    assert.equal(spikes[0].date, '2026-05-04');
    assert.equal(spikes[1].date, '2026-05-06');
  });
});

describe('buildForecast — burn rate', () => {
  it('flat $5/day for 14 days → recentDailyBurn = 5', () => {
    const f = buildForecast({ timeline: flatTimeline(14, 5) });
    assert.equal(f.avgDailyBurn, 5);
    assert.equal(f.recentDailyBurn, 5);
  });

  it('uses only the last 7 buckets for recentDailyBurn', () => {
    const timeline: CostBucket[] = [
      ...flatTimeline(7, 1, '2026-05-06'), // older window
      ...flatTimeline(7, 10, '2026-05-13'), // recent window
    ];
    const f = buildForecast({ timeline });
    assert.equal(f.recentDailyBurn, 10, 'recent = 10');
    assert.equal(f.avgDailyBurn, 5.5, 'overall avg = 5.5');
  });

  it('handles empty timeline (zero everything, no crash)', () => {
    const f = buildForecast({ timeline: [] });
    assert.equal(f.avgDailyBurn, 0);
    assert.equal(f.recentDailyBurn, 0);
    assert.equal(f.daysToExhaust, null);
  });
});

describe('buildForecast — trend', () => {
  it('detects rising trend when recent week > prior week by >5%', () => {
    const timeline = [
      ...flatTimeline(7, 1, '2026-05-06'),
      ...flatTimeline(7, 2, '2026-05-13'),
    ];
    const f = buildForecast({ timeline });
    assert.equal(f.trend, 'rising');
    assert.equal(f.trendDeltaPercent, 100); // doubled
  });

  it('detects falling trend when recent week < prior week by >5%', () => {
    const timeline = [
      ...flatTimeline(7, 10, '2026-05-06'),
      ...flatTimeline(7, 1, '2026-05-13'),
    ];
    const f = buildForecast({ timeline });
    assert.equal(f.trend, 'falling');
    assert.equal(f.trendDeltaPercent, -90);
  });

  it('reports flat when delta < 5%', () => {
    const timeline = [
      ...flatTimeline(7, 100, '2026-05-06'),
      ...flatTimeline(7, 103, '2026-05-13'), // +3%
    ];
    const f = buildForecast({ timeline });
    assert.equal(f.trend, 'flat');
  });

  it('marks as rising when zero burn returns to non-zero (Infinity delta)', () => {
    const timeline = [
      ...flatTimeline(7, 0, '2026-05-06'),
      ...flatTimeline(7, 5, '2026-05-13'),
    ];
    const f = buildForecast({ timeline });
    assert.equal(f.trend, 'rising');
  });

  it('trendDeltaPercent is NaN when timeline shorter than 7 days (no comparison possible)', () => {
    const f = buildForecast({ timeline: flatTimeline(3, 5) });
    assert.ok(Number.isNaN(f.trendDeltaPercent));
    assert.equal(f.trend, 'flat');
  });
});

describe('buildForecast — runway projection', () => {
  const asOf = new Date('2026-05-13T00:00:00.000Z');

  it('null limit → daysToExhaust is null', () => {
    const f = buildForecast({ timeline: flatTimeline(7, 5), asOf });
    assert.equal(f.daysToExhaust, null);
    assert.equal(f.exhaustDate, null);
  });

  it('$100 limit at $10/day with $0 spent = 10 days', () => {
    const f = buildForecast({
      timeline: flatTimeline(7, 10),
      monthlyLimitUsd: 100,
      alreadySpentUsd: 0,
      asOf,
    });
    assert.equal(f.daysToExhaust, 10);
    assert.equal(f.exhaustDate, '2026-05-23');
  });

  it('$100 limit at $10/day with $40 already spent = 6 days', () => {
    const f = buildForecast({
      timeline: flatTimeline(7, 10),
      monthlyLimitUsd: 100,
      alreadySpentUsd: 40,
      asOf,
    });
    assert.equal(f.daysToExhaust, 6);
    assert.equal(f.exhaustDate, '2026-05-19');
  });

  it('already over budget: daysToExhaust = 0, exhaustDate = today', () => {
    const f = buildForecast({
      timeline: flatTimeline(7, 10),
      monthlyLimitUsd: 100,
      alreadySpentUsd: 120,
      asOf,
    });
    assert.equal(f.daysToExhaust, 0);
    assert.equal(f.exhaustDate, '2026-05-13');
  });

  it('zero burn but with limit → daysToExhaust is null (forever)', () => {
    const f = buildForecast({
      timeline: flatTimeline(7, 0),
      monthlyLimitUsd: 100,
      alreadySpentUsd: 0,
      asOf,
    });
    assert.equal(f.daysToExhaust, null);
  });
});

describe('buildForecast — spike inclusion', () => {
  it('embeds spikes in the result', () => {
    const timeline: CostBucket[] = [
      ...flatTimeline(7, 1, '2026-05-06'),
      { date: '2026-05-07', cost: 10 }, // spike
      ...flatTimeline(6, 1, '2026-05-13'),
    ];
    const f = buildForecast({ timeline });
    assert.ok(f.spikes.length >= 1);
    assert.equal(f.spikes[0].date, '2026-05-07');
  });

  it('sorts unordered input internally', () => {
    const timeline: CostBucket[] = [
      { date: '2026-05-03', cost: 5 },
      { date: '2026-05-01', cost: 1 },
      { date: '2026-05-02', cost: 1 },
    ];
    // After sort: 1, 1, 5 — last value is 5, recent burn should reflect that.
    const f = buildForecast({ timeline });
    assert.equal(f.avgDailyBurn, round((1 + 1 + 5) / 3));
  });
});

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
