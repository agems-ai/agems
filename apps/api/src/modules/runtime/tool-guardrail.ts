/**
 * Tool-call anti-loop guardrail — Hermes pattern (`tool_guardrails.py`).
 *
 * AgentRunner already has a basic ToolLoopDetector (sliding-window
 * exact-match hash). This module is the structured per-turn controller:
 *
 *   - Distinguishes IDEMPOTENT (read-only) vs MUTATING tool kinds.
 *   - For IDEMPOTENT tools that return the SAME result hash N times in
 *     a row, treats it as "agent is rereading the same answer" and
 *     blocks further calls.
 *   - For ANY tool that FAILED with the same args N times, blocks.
 *   - For ANY tool called with the same args+result N times after
 *     >M attempts in the window, warns once then blocks.
 *
 * Returns a structured GuardrailDecision the dispatcher uses to either
 * inject a synthetic tool result ("guardrail blocked: <reason>") or
 * allow the call through. The synthetic result is fed back to the LLM
 * which then has to try a different approach.
 *
 * Pure module. State lives in a small per-execution controller object
 * the dispatcher constructs once and disposes after the run.
 */

export type ToolKind = 'IDEMPOTENT' | 'MUTATING';

export type GuardrailDecision =
  | { kind: 'allow' }
  | { kind: 'warn'; reason: string }
  | { kind: 'block'; reason: string; syntheticResult: string };

export interface RecordedCall {
  tool: string;
  argHash: string;
  resultHash?: string;
  failed: boolean;
}

export interface GuardrailConfig {
  /** Warn after this many no-progress calls. Default 2. */
  warnAfter?: number;
  /** Block after this many. Default 5. */
  blockAfter?: number;
  /** Block on this many consecutive failures (per-tool+args). Default 3. */
  failureBlockAfter?: number;
  /** Window of recent calls to look at. Default 20. */
  windowSize?: number;
}

const DEFAULTS: Required<GuardrailConfig> = {
  warnAfter: 2,
  blockAfter: 5,
  failureBlockAfter: 3,
  windowSize: 20,
};

/** Stateful controller — one instance per AgentExecution. */
export class ToolGuardrailController {
  private readonly cfg: Required<GuardrailConfig>;
  private readonly history: RecordedCall[] = [];
  private readonly warnedKeys = new Set<string>();

  constructor(config: GuardrailConfig = {}) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  /** Call BEFORE dispatching the tool. Pass argHash; resultHash unknown yet. */
  evaluate(args: { tool: string; argHash: string; kind: ToolKind }): GuardrailDecision {
    const key = `${args.tool}:${args.argHash}`;

    // Count occurrences in the recent window.
    const recent = this.history.slice(-this.cfg.windowSize);
    const sameCalls = recent.filter(c => c.tool === args.tool && c.argHash === args.argHash);
    const failedCalls = sameCalls.filter(c => c.failed);

    // Block on consecutive failures.
    const tail = recent.slice(-this.cfg.failureBlockAfter);
    const allFailedSameWay =
      tail.length === this.cfg.failureBlockAfter &&
      tail.every(c => c.tool === args.tool && c.argHash === args.argHash && c.failed);
    if (allFailedSameWay) {
      return {
        kind: 'block',
        reason: `tool ${args.tool} failed ${this.cfg.failureBlockAfter}x in a row with identical args; try different inputs or a different tool`,
        syntheticResult: `[guardrail] ${args.tool} blocked after ${this.cfg.failureBlockAfter} consecutive failures`,
      };
    }

    // For idempotent tools — block only when results are also identical
    // (no progress). Different results = progress, even with identical
    // args, so we don't block.
    if (args.kind === 'IDEMPOTENT') {
      const successResults = sameCalls.filter(c => !c.failed && c.resultHash);
      if (successResults.length >= this.cfg.blockAfter) {
        const lastResults = successResults.slice(-this.cfg.blockAfter).map(c => c.resultHash!);
        if (new Set(lastResults).size === 1) {
          return {
            kind: 'block',
            reason: `idempotent tool ${args.tool} returned the same result ${this.cfg.blockAfter}x — stop re-reading and act on what you have`,
            syntheticResult: `[guardrail] same result as before; you already have this answer`,
          };
        }
      }
      // IDEMPOTENT with changing results = active progress; do NOT
      // apply the generic same-args block here.
    } else {
      // For MUTATING tools, same args N times is itself the problem —
      // even if the writes "succeed" the agent is making the same
      // change repeatedly. Block.
      if (sameCalls.length >= this.cfg.blockAfter) {
        return {
          kind: 'block',
          reason: `tool ${args.tool} called with identical args ${this.cfg.blockAfter}x — stop, this isn't making progress`,
          syntheticResult: `[guardrail] same mutating call ${this.cfg.blockAfter}x; change your approach`,
        };
      }
    }

    // Warn once on the warnAfter boundary.
    if (sameCalls.length >= this.cfg.warnAfter && !this.warnedKeys.has(key)) {
      this.warnedKeys.add(key);
      return { kind: 'warn', reason: `tool ${args.tool} already called ${sameCalls.length}x with these args` };
    }

    return { kind: 'allow' };
  }

  /** Record the result of a dispatched call. Caller hashes the result. */
  record(call: RecordedCall): void {
    this.history.push(call);
    // Cap memory; we only need the last windowSize for any decision.
    if (this.history.length > this.cfg.windowSize * 3) {
      this.history.splice(0, this.history.length - this.cfg.windowSize * 3);
    }
  }
}

/** Stable short hash for tool arguments / results. Used as the
 *  argHash / resultHash inputs to the controller. */
export function hashCallPayload(payload: unknown): string {
  // Canonical JSON, ordered keys at top level, then DJB2-style.
  const canonical = typeof payload === 'string'
    ? payload
    : JSON.stringify(payload ?? null, Object.keys(payload ?? {}).sort());
  let h = 5381;
  for (let i = 0; i < canonical.length; i++) h = ((h * 33) ^ canonical.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}
