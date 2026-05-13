/**
 * Tool-execution policy state machine.
 *
 * Existing AGEMS ToolApprovalMode is a flat three-way enum:
 *   FREE  → run always
 *   REQUIRES_APPROVAL → ask every single time
 *   BLOCKED → never run
 *
 * That works for "trusted tool" vs "blanket-banned tool". It does not
 * capture the everyday case "I clicked allow on `bash rm -rf node_modules`
 * — keep allowing the SAME command for the next 30 minutes". OpenClaw's
 * exec-policy is the inspiration: a prior approval carries a SCOPE
 * (allow-once / allow-always-this-input / allow-always-this-tool) and
 * an OPTIONAL TTL, and the evaluator combines policy + prior decision
 * into a final outcome.
 *
 * Pure module. No DB, no Nest, no clock except behind `now?` param.
 * The approvals service wraps it with persistence reads / writes.
 */
import { createHash } from 'crypto';

export type ToolPolicyKind = 'FREE' | 'REQUIRES_APPROVAL' | 'BLOCKED';

/** How broadly a prior approval applies. */
export type AllowScope =
  | 'allow-once'                  // single use, then expires
  | 'allow-always-this-input'     // any future call with the SAME input hash
  | 'allow-always-this-tool';     // any future call to this tool, regardless of input

export interface PriorApproval {
  toolName: string;
  scope: AllowScope;
  /** Hash of input from the originally-approved call. Only required for
   *  `allow-always-this-input`. */
  inputHash?: string;
  /** Granted timestamp (used with ttlSeconds to determine expiry). */
  grantedAt: Date;
  /** Optional TTL. null/undefined means "until manually revoked". */
  ttlSeconds?: number | null;
  /** Set by the evaluator when an `allow-once` is consumed — so a later
   *  evaluation against the same record won't re-approve. */
  consumedAt?: Date | null;
}

export type PolicyOutcome =
  | { decision: 'allow';            reason: string }
  | { decision: 'request_approval'; reason: string }
  | { decision: 'block';            reason: string };

export interface PolicyInput {
  toolName: string;
  toolPolicy: ToolPolicyKind;
  currentInputHash: string;
  priorApproval?: PriorApproval;
  now?: Date;
}

/** Deterministic hash of arbitrary tool input. Used as inputHash for
 *  `allow-always-this-input` scope. */
export function hashToolInput(input: unknown): string {
  const canonical = JSON.stringify(input ?? null, Object.keys(input ?? {}).sort());
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function isExpired(prior: PriorApproval, now: Date): boolean {
  if (!prior.ttlSeconds) return false;
  const expiresAt = prior.grantedAt.getTime() + prior.ttlSeconds * 1000;
  return expiresAt <= now.getTime();
}

function priorMatches(prior: PriorApproval, currentTool: string, currentInputHash: string): boolean {
  if (prior.toolName !== currentTool) return false;
  switch (prior.scope) {
    case 'allow-once':
      return prior.consumedAt == null;
    case 'allow-always-this-input':
      return prior.inputHash === currentInputHash;
    case 'allow-always-this-tool':
      return true;
  }
}

/**
 * Decide whether a tool call should run, be blocked, or require fresh
 * approval. Pure: caller is responsible for honoring `consumedAt` writes
 * after a one-shot approval is used.
 */
export function evaluatePolicy(input: PolicyInput): PolicyOutcome {
  const now = input.now ?? new Date();

  // 1. BLOCKED beats everything. No prior approval can ever unblock it
  //    — operator must change the tool's policy first.
  if (input.toolPolicy === 'BLOCKED') {
    return { decision: 'block', reason: 'tool is BLOCKED by policy' };
  }

  // 2. FREE → no approval ever needed.
  if (input.toolPolicy === 'FREE') {
    return { decision: 'allow', reason: 'tool is FREE' };
  }

  // 3. REQUIRES_APPROVAL: see if a prior approval covers this call.
  const prior = input.priorApproval;
  if (!prior) {
    return { decision: 'request_approval', reason: 'no prior approval on record' };
  }
  if (isExpired(prior, now)) {
    return { decision: 'request_approval', reason: 'prior approval expired' };
  }
  if (priorMatches(prior, input.toolName, input.currentInputHash)) {
    return { decision: 'allow', reason: `covered by ${prior.scope}` };
  }
  return { decision: 'request_approval', reason: 'prior approval scope does not match this call' };
}

/**
 * Returns the side-effect a caller should apply after `evaluatePolicy`
 * returned `allow` for an `allow-once` approval — i.e. mark it consumed.
 * No-op for the other scopes.
 */
export function shouldConsume(prior: PriorApproval | undefined, decision: PolicyOutcome): boolean {
  if (!prior) return false;
  if (decision.decision !== 'allow') return false;
  return prior.scope === 'allow-once';
}
