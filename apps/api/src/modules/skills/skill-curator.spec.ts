/**
 * Unit tests for the skill curator state machine.
 *
 * If these break, agent-created skills either accumulate forever (lost
 * STALE/ARCHIVED) or get retired prematurely (broken thresholds /
 * human-skill protection). Both are user-visible breakages.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStateTransitions,
  bucketByTargetState,
  daysBetween,
  effectiveLastActivity,
  DEFAULT_CURATOR_CONFIG,
  type SkillForCurator,
} from './skill-curator';

const now = new Date('2026-05-13T00:00:00.000Z');
function daysAgo(d: number): Date {
  return new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
}

function skill(opts: Partial<SkillForCurator> & { id: string }): SkillForCurator {
  return {
    id: opts.id,
    state: opts.state ?? 'ACTIVE',
    lastUsedAt: opts.lastUsedAt ?? null,
    createdAt: opts.createdAt ?? daysAgo(1),
    archivedAt: opts.archivedAt ?? null,
    authorType: opts.authorType ?? 'AGENT',
  };
}

// ── helpers ──────────────────────────────────────────────────────

describe('daysBetween', () => {
  it('returns the integer number of days between two dates', () => {
    assert.equal(daysBetween(daysAgo(7), now), 7);
  });
  it('returns 0 for same-day comparison', () => {
    assert.equal(daysBetween(now, now), 0);
  });
  it('returns negative when `to` is before `from`', () => {
    assert.equal(daysBetween(now, daysAgo(3)), -3);
  });
});

describe('effectiveLastActivity', () => {
  it('uses lastUsedAt when present', () => {
    const s = skill({ id: 'a', lastUsedAt: daysAgo(5), createdAt: daysAgo(100) });
    assert.equal(effectiveLastActivity(s).getTime(), daysAgo(5).getTime());
  });
  it('falls back to createdAt when lastUsedAt is null', () => {
    const s = skill({ id: 'b', lastUsedAt: null, createdAt: daysAgo(50) });
    assert.equal(effectiveLastActivity(s).getTime(), daysAgo(50).getTime());
  });
});

// ── core state machine ──────────────────────────────────────────

describe('computeStateTransitions — ACTIVE skill', () => {
  it('stays ACTIVE when recently used', () => {
    const skills = [skill({ id: 'a', state: 'ACTIVE', lastUsedAt: daysAgo(5) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 0);
  });

  it('moves to STALE after default 30 days idle', () => {
    const skills = [skill({ id: 'a', state: 'ACTIVE', lastUsedAt: daysAgo(31) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 1);
    assert.equal(ts[0].toState, 'STALE');
    assert.equal(ts[0].fromState, 'ACTIVE');
  });

  it('moves straight to ARCHIVED after default 90 days idle', () => {
    const skills = [skill({ id: 'a', state: 'ACTIVE', lastUsedAt: daysAgo(91) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 1);
    assert.equal(ts[0].toState, 'ARCHIVED');
    assert.equal(ts[0].fromState, 'ACTIVE');
  });

  it('exactly-at-threshold moves (>= not >)', () => {
    const skills = [skill({ id: 'a', state: 'ACTIVE', lastUsedAt: daysAgo(30) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 1);
    assert.equal(ts[0].toState, 'STALE');
  });

  it('uses createdAt when lastUsedAt is null (newly created, never invoked)', () => {
    const skills = [skill({ id: 'a', state: 'ACTIVE', lastUsedAt: null, createdAt: daysAgo(35) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 1);
    assert.equal(ts[0].toState, 'STALE');
  });
});

describe('computeStateTransitions — STALE skill', () => {
  it('stays STALE when total idle < archive threshold', () => {
    const skills = [skill({ id: 'a', state: 'STALE', lastUsedAt: daysAgo(60) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 0);
  });

  it('moves to ARCHIVED after archive threshold', () => {
    const skills = [skill({ id: 'a', state: 'STALE', lastUsedAt: daysAgo(91) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 1);
    assert.equal(ts[0].fromState, 'STALE');
    assert.equal(ts[0].toState, 'ARCHIVED');
  });
});

describe('computeStateTransitions — ARCHIVED is terminal', () => {
  it('never transitions out of ARCHIVED, regardless of age', () => {
    const skills = [skill({ id: 'a', state: 'ARCHIVED', lastUsedAt: daysAgo(365) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 0);
  });
});

describe('computeStateTransitions — authorType gating', () => {
  it('NEVER transitions HUMAN-authored skills (even if idle for a year)', () => {
    const skills = [skill({ id: 'a', state: 'ACTIVE', authorType: 'HUMAN', lastUsedAt: daysAgo(365) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 0);
  });

  it('NEVER transitions SYSTEM-authored skills', () => {
    const skills = [skill({ id: 'a', state: 'ACTIVE', authorType: 'SYSTEM', lastUsedAt: daysAgo(365) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 0);
  });

  it('protects HUMAN skill even if already STALE (admin can move back manually)', () => {
    const skills = [skill({ id: 'a', state: 'STALE', authorType: 'HUMAN', lastUsedAt: daysAgo(200) })];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 0);
  });
});

describe('computeStateTransitions — config edge cases', () => {
  it('zero staleAfterDays disables the curator (safety guard)', () => {
    const skills = [skill({ id: 'a', state: 'ACTIVE', lastUsedAt: daysAgo(1000) })];
    const ts = computeStateTransitions(skills, now, { staleAfterDays: 0, archiveAfterDays: 90 });
    assert.equal(ts.length, 0);
  });

  it('archiveAfterDays < staleAfterDays disables (misconfigured)', () => {
    const skills = [skill({ id: 'a', state: 'ACTIVE', lastUsedAt: daysAgo(50) })];
    const ts = computeStateTransitions(skills, now, { staleAfterDays: 30, archiveAfterDays: 10 });
    assert.equal(ts.length, 0);
  });

  it('honours custom thresholds', () => {
    const skills = [skill({ id: 'a', state: 'ACTIVE', lastUsedAt: daysAgo(8) })];
    const ts = computeStateTransitions(skills, now, { staleAfterDays: 7, archiveAfterDays: 30 });
    assert.equal(ts.length, 1);
    assert.equal(ts[0].toState, 'STALE');
  });
});

describe('computeStateTransitions — batch behaviour', () => {
  it('processes a mixed batch correctly', () => {
    const skills = [
      skill({ id: 'fresh', state: 'ACTIVE', lastUsedAt: daysAgo(5) }),
      skill({ id: 'becomes-stale', state: 'ACTIVE', lastUsedAt: daysAgo(35) }),
      skill({ id: 'becomes-archived', state: 'ACTIVE', lastUsedAt: daysAgo(120) }),
      skill({ id: 'already-stale', state: 'STALE', lastUsedAt: daysAgo(40) }),
      skill({ id: 'stale-now-archived', state: 'STALE', lastUsedAt: daysAgo(120) }),
      skill({ id: 'human-untouched', state: 'ACTIVE', authorType: 'HUMAN', lastUsedAt: daysAgo(120) }),
      skill({ id: 'terminal', state: 'ARCHIVED', lastUsedAt: daysAgo(120) }),
    ];
    const ts = computeStateTransitions(skills, now);
    assert.equal(ts.length, 3, `got ${ts.length} transitions, expected 3: ${JSON.stringify(ts)}`);
    const byId = Object.fromEntries(ts.map(t => [t.id, t.toState]));
    assert.equal(byId['becomes-stale'], 'STALE');
    assert.equal(byId['becomes-archived'], 'ARCHIVED');
    assert.equal(byId['stale-now-archived'], 'ARCHIVED');
  });
});

describe('bucketByTargetState', () => {
  it('partitions transitions into STALE / ARCHIVED ID lists', () => {
    const ts = [
      { id: 'a', fromState: 'ACTIVE' as const, toState: 'STALE' as const, reason: 'x' },
      { id: 'b', fromState: 'ACTIVE' as const, toState: 'ARCHIVED' as const, reason: 'y' },
      { id: 'c', fromState: 'STALE' as const, toState: 'ARCHIVED' as const, reason: 'z' },
    ];
    const { toStale, toArchived } = bucketByTargetState(ts);
    assert.deepEqual(toStale, ['a']);
    assert.deepEqual(toArchived.sort(), ['b', 'c']);
  });

  it('returns empty arrays for empty input', () => {
    const { toStale, toArchived } = bucketByTargetState([]);
    assert.deepEqual(toStale, []);
    assert.deepEqual(toArchived, []);
  });
});

describe('DEFAULT_CURATOR_CONFIG', () => {
  it('has sane defaults (30d stale, 90d archive)', () => {
    assert.equal(DEFAULT_CURATOR_CONFIG.staleAfterDays, 30);
    assert.equal(DEFAULT_CURATOR_CONFIG.archiveAfterDays, 90);
  });
});
