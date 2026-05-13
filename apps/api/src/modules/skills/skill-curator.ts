/**
 * Skill lifecycle curator — pure state-machine logic.
 *
 * Inspired by Hermes' `agent/curator.py:apply_automatic_transitions`. The
 * goal is to keep the agent's loadable-skill set tight: skills that
 * haven't been used in N days drop to STALE (hidden from the agent's tool
 * map but kept on disk); skills that have been STALE for M days move to
 * ARCHIVED (still preserved for audit, never offered to agents).
 *
 * Only AGENT-authored skills go through the auto state machine. Human-
 * curated skills stay ACTIVE forever unless an admin moves them by hand —
 * we never want a curator job to silently retire content someone wrote
 * deliberately.
 *
 * Pure: no DB, no Nest, no I/O. The CuratorService wraps it with reads
 * and `updateMany` calls.
 */

export type SkillState = 'ACTIVE' | 'STALE' | 'ARCHIVED';
export type ActorType = 'AGENT' | 'HUMAN' | 'SYSTEM';

export interface CuratorConfig {
  /** ACTIVE → STALE after this many days without use. */
  staleAfterDays: number;
  /** STALE → ARCHIVED after this many days. */
  archiveAfterDays: number;
}

export const DEFAULT_CURATOR_CONFIG: CuratorConfig = {
  staleAfterDays: 30,
  archiveAfterDays: 90,
};

export interface SkillForCurator {
  id: string;
  state: SkillState;
  lastUsedAt: Date | null;
  createdAt: Date;
  archivedAt: Date | null;
  authorType: ActorType;
}

export interface SkillTransition {
  id: string;
  fromState: SkillState;
  toState: SkillState;
  reason: string;
}

/** Reference point for "last activity" — falls back to createdAt if never used. */
export function effectiveLastActivity(skill: SkillForCurator): Date {
  return skill.lastUsedAt ?? skill.createdAt;
}

/** Days between two dates, integer floor. Negative if `to` is before `from`. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Compute the transitions to apply for one tick of the curator.
 *
 * Returns ONE transition per skill at most (a row that's eligible to skip
 * STALE and go straight to ARCHIVED still does so in one step here —
 * lifecycle is auditable through the resulting `reason` string).
 *
 * Skills are eligible for transitions only when authorType === 'AGENT'.
 * HUMAN/SYSTEM skills stay where they are.
 */
export function computeStateTransitions(
  skills: SkillForCurator[],
  now: Date,
  config: CuratorConfig = DEFAULT_CURATOR_CONFIG,
): SkillTransition[] {
  if (config.staleAfterDays <= 0 || config.archiveAfterDays <= 0) return [];
  if (config.archiveAfterDays < config.staleAfterDays) return []; // misconfigured

  const transitions: SkillTransition[] = [];

  for (const skill of skills) {
    if (skill.authorType !== 'AGENT') continue;

    const lastActivity = effectiveLastActivity(skill);
    const idleDays = daysBetween(lastActivity, now);

    if (skill.state === 'ACTIVE') {
      if (idleDays >= config.archiveAfterDays) {
        transitions.push({
          id: skill.id,
          fromState: 'ACTIVE',
          toState: 'ARCHIVED',
          reason: `unused for ${idleDays}d, exceeds archive threshold ${config.archiveAfterDays}d`,
        });
      } else if (idleDays >= config.staleAfterDays) {
        transitions.push({
          id: skill.id,
          fromState: 'ACTIVE',
          toState: 'STALE',
          reason: `unused for ${idleDays}d, exceeds stale threshold ${config.staleAfterDays}d`,
        });
      }
    } else if (skill.state === 'STALE') {
      if (idleDays >= config.archiveAfterDays) {
        transitions.push({
          id: skill.id,
          fromState: 'STALE',
          toState: 'ARCHIVED',
          reason: `stale for ${idleDays}d total, exceeds archive threshold ${config.archiveAfterDays}d`,
        });
      }
    }
    // ARCHIVED is terminal — never transitions out automatically.
  }

  return transitions;
}

/**
 * Bucket transitions by target state for efficient batch updates.
 * CuratorService uses these arrays in updateMany() calls.
 */
export function bucketByTargetState(transitions: SkillTransition[]): {
  toStale: string[];
  toArchived: string[];
} {
  const toStale: string[] = [];
  const toArchived: string[] = [];
  for (const t of transitions) {
    if (t.toState === 'STALE') toStale.push(t.id);
    else if (t.toState === 'ARCHIVED') toArchived.push(t.id);
  }
  return { toStale, toArchived };
}
