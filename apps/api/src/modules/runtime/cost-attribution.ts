/**
 * Per-execution cost attribution shape.
 *
 * Lives in agent_executions.{provider,model,input_tokens,output_tokens,cached_input_tokens}
 * so dashboards can slice spend by model without joining CreditLedger.
 *
 * provider is always lowercased to match CreditLedger.provider (the billing
 * source of truth). model is stored verbatim — date-suffixed ids resolve to
 * tiers via pricing.config.ts.
 */
export interface ExecutionAttribution {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/** Tokens shape returned by AgentRunner (packages/ai/runner.ts RunResult). */
export interface RunnerTokens {
  input: number;
  output: number;
  cached?: number;
}

/** Minimal agent shape needed to attribute an execution. */
export interface AttributableAgent {
  /** LLMProvider enum value (uppercase: ANTHROPIC, OPENAI, ...). Lowercased on write. */
  llmProvider: string;
  llmModel: string;
}

/**
 * Build the attribution payload for an AgentExecution update.
 *
 * Pure function: no DB, no side effects, deterministic. Tested directly.
 */
export function buildExecutionAttribution(
  agent: AttributableAgent,
  tokens: RunnerTokens,
): ExecutionAttribution {
  const attr: ExecutionAttribution = {
    provider: String(agent.llmProvider || '').toLowerCase(),
    model: agent.llmModel,
    inputTokens: Math.max(0, Math.trunc(tokens.input || 0)),
    outputTokens: Math.max(0, Math.trunc(tokens.output || 0)),
  };
  if (typeof tokens.cached === 'number' && tokens.cached > 0) {
    attr.cachedInputTokens = Math.trunc(tokens.cached);
  }
  return attr;
}

/** Backward-compatible aggregate kept on AgentExecution.tokensUsed. */
export function totalTokens(tokens: RunnerTokens): number {
  return Math.max(0, Math.trunc(tokens.input || 0)) + Math.max(0, Math.trunc(tokens.output || 0));
}
