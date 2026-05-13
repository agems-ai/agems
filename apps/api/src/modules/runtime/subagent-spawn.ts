/**
 * Subagent-spawn guard logic — pure helper.
 *
 * The "agent can spawn a subagent and wait for the result" pattern is
 * powerful: an orchestrator agent breaks a task into parallel work,
 * launches three children, joins their results. The pattern is also
 * easy to break catastrophically — uncontrolled recursion or cost
 * explosion if every subagent in turn spawns three more.
 *
 * Inspired by Hermes' `tools/delegate_tool.py` two-level role taxonomy:
 *
 *   - LEAF — can do work, cannot spawn further. Hard recursion stop.
 *   - ORCHESTRATOR — can spawn LEAF or further ORCHESTRATOR children
 *     up to `maxSpawnDepth`.
 *
 * Plus permission inheritance: a parent's deny-list propagates to its
 * children (so a "no shell" agent can't escape by spawning a child).
 * The allow-list, conversely, is intersected — a child can NEVER do
 * more than its parent.
 *
 * Pure module. No DB. No Nest. Tests inject `now`/`spawnDepth` directly.
 */

export type SubagentRole = 'LEAF' | 'ORCHESTRATOR';

export interface SpawnContext {
  parentRole: SubagentRole;
  /** Depth of the parent in the spawn chain. Root agent = 0. */
  parentDepth: number;
  /** Effective deny-list inherited from parent. New denies merge in. */
  parentToolDeny: string[];
  /** Effective allow-list inherited from parent (null = no whitelist).
   *  Child's effective allow-list is the INTERSECTION with this. */
  parentToolAllow: string[] | null;
  /** Maximum depth the platform allows. Default 2 — Hermes default. */
  maxSpawnDepth?: number;
}

export interface SpawnRequest {
  /** Role the parent asked for. Sanitized against parentRole rules. */
  requestedRole: SubagentRole;
  /** Tools the parent explicitly wants to BLOCK for this child. Merged
   *  on top of inherited deny. */
  extraDeny?: string[];
  /** Tools the parent explicitly wants to make available to this child.
   *  Intersected with parentToolAllow (if any). */
  extraAllow?: string[];
}

export type SpawnDecision =
  | { ok: true; resolved: ResolvedSpawn }
  | { ok: false; reason: string };

export interface ResolvedSpawn {
  role: SubagentRole;
  depth: number;
  toolDeny: string[];
  toolAllow: string[] | null;
}

const DEFAULT_MAX_SPAWN_DEPTH = 2;

/**
 * Validate the spawn request against parent context, return either a
 * sanitised child configuration or a typed rejection.
 */
export function evaluateSpawn(ctx: SpawnContext, req: SpawnRequest): SpawnDecision {
  const max = ctx.maxSpawnDepth ?? DEFAULT_MAX_SPAWN_DEPTH;

  // 1. Hard recursion stop.
  if (ctx.parentRole === 'LEAF') {
    return { ok: false, reason: 'LEAF agents cannot spawn subagents' };
  }

  // 2. Depth limit.
  const childDepth = ctx.parentDepth + 1;
  if (childDepth > max) {
    return { ok: false, reason: `spawn depth ${childDepth} exceeds maxSpawnDepth ${max}` };
  }

  // 3. Role demotion only: an orchestrator can request LEAF or ORCHESTRATOR,
  // but at maximum depth the requested role is forced to LEAF (no further
  // recursion possible anyway, so make it explicit).
  let role = req.requestedRole;
  if (childDepth === max && role === 'ORCHESTRATOR') {
    role = 'LEAF';
  }

  // 4. Permission inheritance.
  const toolDeny = mergeDeny(ctx.parentToolDeny, req.extraDeny ?? []);
  const toolAllow = intersectAllow(ctx.parentToolAllow, req.extraAllow ?? null);

  // 5. Sanity: if a tool is both denied AND in the allow-intersection,
  // deny wins. We surface that as a warning in the resolved shape by
  // stripping it from the allow list.
  const allowSanitised = toolAllow == null ? null : toolAllow.filter(t => !toolDeny.includes(t));

  return {
    ok: true,
    resolved: { role, depth: childDepth, toolDeny, toolAllow: allowSanitised },
  };
}

/** Deny lists are union-merged with deduplication. */
export function mergeDeny(parent: string[], extra: string[]): string[] {
  const set = new Set<string>([...parent, ...extra]);
  return Array.from(set).sort();
}

/**
 * Allow lists intersect: a child can never have more tools than its
 * parent. null on either side means "no whitelist on this side", and
 * intersection with a whitelisted side returns the whitelisted side.
 * null ∩ null = null (everything allowed, no restriction).
 */
export function intersectAllow(parent: string[] | null, extra: string[] | null): string[] | null {
  if (parent == null && extra == null) return null;
  if (parent == null) return extra ?? null;
  if (extra == null) return parent;
  // Both arrays: intersect.
  const parentSet = new Set(parent);
  return extra.filter(t => parentSet.has(t)).sort();
}

/**
 * Convenience: tells the caller whether a SPECIFIC tool would be
 * allowed for a child given the resolved spawn. Combines deny check +
 * allow-list whitelisting.
 */
export function isToolAllowedForChild(resolved: ResolvedSpawn, toolName: string): boolean {
  if (resolved.toolDeny.includes(toolName)) return false;
  if (resolved.toolAllow == null) return true; // no whitelist → permitted
  return resolved.toolAllow.includes(toolName);
}
