/**
 * Run-liveness classifier — Paperclip pattern (`run-liveness.ts`).
 *
 * Distinguishes a run that actually moved a task forward from one that
 * just looked busy. Today AGEMS marks an AgentExecution COMPLETED on
 * any non-error exit — including the case where the agent wrote a
 * 200-word plan and called it done. That fools the wake/sleep heuristics
 * and the productivity-review job: the row looks healthy but the issue
 * hasn't moved.
 *
 * Classifier scans the run output (text + optional resultJson +
 * comments) and returns:
 *
 *   livenessState:
 *     - runnable          — code shipped / state changed / a concrete
 *                           result was produced; next iteration is fine
 *     - manager_review    — work happened but needs human sign-off
 *     - blocked_external  — explicitly stuck on an external dependency
 *     - approval_required — waiting on a HITL approval
 *     - unknown           — no signal either way
 *
 *   livenessReason       — short human-readable cause
 *   nextAction           — extracted "next step" line, if any
 *   plannedOnly          — true when ALL signal points to "talked but
 *                          didn't ship"
 *
 * Pure module. Pattern-based. The scheduler / productivity-review job
 * dispatches on the result.
 */

export type LivenessState =
  | 'runnable'
  | 'manager_review'
  | 'blocked_external'
  | 'approval_required'
  | 'unknown';

export interface LivenessClassification {
  state: LivenessState;
  reason: string;
  nextAction?: string;
  plannedOnly: boolean;
}

export interface LivenessInput {
  /** Final text from the agent execution. */
  output?: string | null;
  /** Optional JSON result the agent emitted alongside text. */
  resultJson?: unknown;
  /** Optional last-N comments the agent added to the task. */
  comments?: string[];
}

/** Patterns ordered specific → general. */
const RX = {
  APPROVAL_REQUIRED:    /\b(approval\s+(required|pending)|waiting\s+for\s+approval|awaiting\s+human|need\s+sign-?off|hitl\s+gate)\b/i,
  BLOCKED_EXTERNAL:     /\b(blocked\s+by|waiting\s+(on|for)\s+(?!approval)|stuck\s+on|external\s+dependency|api\s+(is\s+)?down|rate\s+limited)\b/i,
  MANAGER_REVIEW:       /\b(needs\s+review|please\s+review|ready\s+for\s+review|in\s+review|awaiting\s+review)\b/i,
  PLANNED_ONLY:         /\b(here['']?s\s+(a|my|the)\s+plan|i\s+(will|plan\s+to|am\s+going\s+to)|my\s+approach\s+would\s+be|the\s+next\s+steps?\s+are|i\s+would\s+(?:start|begin|first))\b/i,
  REAL_PROGRESS:        /\b(shipped|merged|deployed|pushed\s+commit|created\s+(?:pr|pull\s+request|issue|task)|updated\s+the\s+\w+|wrote\s+the\s+\w+|sent\s+the\s+(message|email|notification))\b/i,
};

const NEXT_ACTION_RX = [
  /next\s+(action|step|task)\s*:\s*([^\n]+)/i,
  /next\s+up\s*:\s*([^\n]+)/i,
  /todo\s*:\s*([^\n]+)/i,
];

/**
 * Classify a finished run. `now` parameter kept for symmetry with
 * other classifiers but not currently used.
 */
export function classifyRunLiveness(input: LivenessInput): LivenessClassification {
  const text = combineText(input);
  if (!text.trim()) {
    return { state: 'unknown', reason: 'empty output', plannedOnly: false };
  }

  const nextAction = extractNextAction(text);

  // Order matters — most-specific first.
  if (RX.APPROVAL_REQUIRED.test(text)) {
    return { state: 'approval_required', reason: 'matched approval-pending pattern', nextAction, plannedOnly: false };
  }
  if (RX.BLOCKED_EXTERNAL.test(text)) {
    return { state: 'blocked_external', reason: 'matched external-dependency pattern', nextAction, plannedOnly: false };
  }
  if (RX.MANAGER_REVIEW.test(text)) {
    return { state: 'manager_review', reason: 'matched review-requested pattern', nextAction, plannedOnly: false };
  }

  // Progress vs planning detection — runnable WITH real-progress signal,
  // planned-only when only planning verbs appear.
  const hasProgress = RX.REAL_PROGRESS.test(text);
  const planLike = RX.PLANNED_ONLY.test(text);

  if (hasProgress) {
    return { state: 'runnable', reason: 'matched real-progress verbs', nextAction, plannedOnly: false };
  }
  if (planLike) {
    return { state: 'runnable', reason: 'planning text only; no shipped change detected', nextAction, plannedOnly: true };
  }

  return { state: 'unknown', reason: 'no salient patterns matched', nextAction, plannedOnly: false };
}

function combineText(input: LivenessInput): string {
  const parts: string[] = [];
  if (input.output) parts.push(input.output);
  if (input.resultJson !== undefined && input.resultJson !== null) {
    try { parts.push(JSON.stringify(input.resultJson)); } catch { /* ignore */ }
  }
  for (const c of input.comments ?? []) {
    if (c) parts.push(c);
  }
  return parts.join('\n');
}

export function extractNextAction(text: string): string | undefined {
  for (const rx of NEXT_ACTION_RX) {
    const m = rx.exec(text);
    if (m) {
      // Group #2 for the first pattern (has two captures), #1 for others.
      const captured = m[2] ?? m[1];
      if (captured && captured.trim()) return captured.trim();
    }
  }
  return undefined;
}
