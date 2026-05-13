/**
 * Unit tests for execution cost attribution.
 *
 * These guard the shape that gets written to agent_executions.{provider,model,
 * input_tokens,output_tokens,cached_input_tokens}. If they break, slicing
 * spend by model in dashboards stops working — even though billing
 * (CreditLedger) continues unaffected.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutionAttribution,
  totalTokens,
  type AttributableAgent,
  type RunnerTokens,
} from './cost-attribution';

const agent = (p: string, m: string): AttributableAgent => ({ llmProvider: p, llmModel: m });

describe('buildExecutionAttribution', () => {
  it('lowercases provider to match CreditLedger.provider convention', () => {
    const attr = buildExecutionAttribution(agent('ANTHROPIC', 'claude-sonnet-4-6'), { input: 100, output: 50 });
    assert.equal(attr.provider, 'anthropic');
  });

  it('preserves model verbatim (date suffixes resolved downstream by pricing.config)', () => {
    const attr = buildExecutionAttribution(agent('ANTHROPIC', 'claude-haiku-4-5-20251001'), { input: 1, output: 1 });
    assert.equal(attr.model, 'claude-haiku-4-5-20251001');
  });

  it('maps runner tokensUsed.input/output to inputTokens/outputTokens', () => {
    const attr = buildExecutionAttribution(agent('OPENAI', 'gpt-4o'), { input: 1234, output: 5678 });
    assert.equal(attr.inputTokens, 1234);
    assert.equal(attr.outputTokens, 5678);
  });

  it('omits cachedInputTokens when runner did not report cache hits', () => {
    const attr = buildExecutionAttribution(agent('ANTHROPIC', 'claude-sonnet-4-6'), { input: 100, output: 50 });
    assert.equal(attr.cachedInputTokens, undefined);
    assert.equal('cachedInputTokens' in attr, false);
  });

  it('includes cachedInputTokens only when runner reports a positive count', () => {
    const attr = buildExecutionAttribution(agent('ANTHROPIC', 'claude-sonnet-4-6'), { input: 100, output: 50, cached: 80 });
    assert.equal(attr.cachedInputTokens, 80);
  });

  it('drops cachedInputTokens when value is zero (avoid noisy column)', () => {
    const attr = buildExecutionAttribution(agent('ANTHROPIC', 'claude-sonnet-4-6'), { input: 100, output: 50, cached: 0 });
    assert.equal(attr.cachedInputTokens, undefined);
  });

  it('clamps negative tokens to 0 (defensive: provider bugs / accounting errors)', () => {
    const attr = buildExecutionAttribution(agent('OPENAI', 'gpt-4o'), { input: -5, output: -10 });
    assert.equal(attr.inputTokens, 0);
    assert.equal(attr.outputTokens, 0);
  });

  it('truncates fractional token counts to integers (DB column is INTEGER)', () => {
    const attr = buildExecutionAttribution(agent('OPENAI', 'gpt-4o'), { input: 100.7, output: 50.4 });
    assert.equal(attr.inputTokens, 100);
    assert.equal(attr.outputTokens, 50);
  });

  it('handles empty/undefined provider gracefully (returns empty string, not crash)', () => {
    const attr = buildExecutionAttribution({ llmProvider: '', llmModel: 'unknown' }, { input: 0, output: 0 });
    assert.equal(attr.provider, '');
  });

  it('rejects NaN tokens (would corrupt aggregate queries)', () => {
    const tokens = { input: NaN, output: NaN } as RunnerTokens;
    const attr = buildExecutionAttribution(agent('OPENAI', 'gpt-4o'), tokens);
    // Math.trunc(NaN) is NaN; the `|| 0` coerces it back to 0 because NaN is falsy.
    assert.equal(attr.inputTokens, 0);
    assert.equal(attr.outputTokens, 0);
  });
});

describe('totalTokens', () => {
  it('returns input + output sum (backward-compat with tokens_used column)', () => {
    assert.equal(totalTokens({ input: 100, output: 50 }), 150);
  });

  it('returns 0 for empty tokens (no LLM call happened)', () => {
    assert.equal(totalTokens({ input: 0, output: 0 }), 0);
  });

  it('matches inputTokens + outputTokens from attribution (consistency invariant)', () => {
    const tokens: RunnerTokens = { input: 1234, output: 5678 };
    const attr = buildExecutionAttribution(agent('ANTHROPIC', 'claude-sonnet-4-6'), tokens);
    assert.equal(totalTokens(tokens), attr.inputTokens + attr.outputTokens);
  });

  it('does not count cached tokens (input already includes them)', () => {
    // Anthropic billing: total input tokens already include cache reads.
    // The cached count is informational — must not double-count.
    const tokens: RunnerTokens = { input: 100, output: 50, cached: 80 };
    assert.equal(totalTokens(tokens), 150);
  });
});
