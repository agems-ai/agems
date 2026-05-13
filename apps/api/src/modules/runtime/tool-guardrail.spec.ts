/**
 * Unit tests for tool-call anti-loop guardrail.
 *
 * If these break, an agent stuck in a loop ("read file X" → no change →
 * "read file X" → no change → ...) burns through budget without making
 * progress and the existing simple loop detector doesn't catch the
 * subtler "same idempotent result N times" case.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolGuardrailController, hashCallPayload } from './tool-guardrail';

const IDEMPOTENT = 'IDEMPOTENT' as const;
const MUTATING = 'MUTATING' as const;

// ── hashCallPayload ─────────────────────────────────────────────

describe('hashCallPayload', () => {
  it('stable across key permutations', () => {
    assert.equal(hashCallPayload({ a: 1, b: 2 }), hashCallPayload({ b: 2, a: 1 }));
  });

  it('different inputs → different hashes', () => {
    assert.notEqual(hashCallPayload({ a: 1 }), hashCallPayload({ a: 2 }));
  });

  it('handles strings, null, undefined', () => {
    assert.ok(hashCallPayload('hello').length > 0);
    assert.ok(hashCallPayload(null).length > 0);
    assert.ok(hashCallPayload(undefined).length > 0);
  });
});

// ── ToolGuardrailController ─────────────────────────────────────

describe('ToolGuardrailController — allow path', () => {
  it('allows the first call', () => {
    const g = new ToolGuardrailController();
    const r = g.evaluate({ tool: 'read', argHash: 'h1', kind: IDEMPOTENT });
    assert.equal(r.kind, 'allow');
  });

  it('allows different-arg calls in any number', () => {
    const g = new ToolGuardrailController();
    for (let i = 0; i < 100; i++) {
      const r = g.evaluate({ tool: 'read', argHash: `h${i}`, kind: IDEMPOTENT });
      g.record({ tool: 'read', argHash: `h${i}`, resultHash: `r${i}`, failed: false });
      assert.equal(r.kind, 'allow');
    }
  });
});

describe('ToolGuardrailController — warn path', () => {
  it('warns ONCE at warnAfter boundary', () => {
    const g = new ToolGuardrailController({ warnAfter: 2, blockAfter: 5 });
    // Call 1: allow
    assert.equal(g.evaluate({ tool: 'read', argHash: 'h1', kind: IDEMPOTENT }).kind, 'allow');
    g.record({ tool: 'read', argHash: 'h1', resultHash: 'r1', failed: false });
    // Call 2: still allow (haven't hit warnAfter yet)
    assert.equal(g.evaluate({ tool: 'read', argHash: 'h1', kind: IDEMPOTENT }).kind, 'allow');
    g.record({ tool: 'read', argHash: 'h1', resultHash: 'r1', failed: false });
    // Call 3: warn (2 previous + this one would be 3, but warning fires on count>=2)
    const r3 = g.evaluate({ tool: 'read', argHash: 'h1', kind: IDEMPOTENT });
    assert.equal(r3.kind, 'warn');
    g.record({ tool: 'read', argHash: 'h1', resultHash: 'r1', failed: false });
    // Call 4: silent allow (already warned for this key)
    const r4 = g.evaluate({ tool: 'read', argHash: 'h1', kind: IDEMPOTENT });
    assert.equal(r4.kind, 'allow');
  });
});

describe('ToolGuardrailController — block path', () => {
  it('blocks on blockAfter consecutive identical calls', () => {
    const g = new ToolGuardrailController({ warnAfter: 2, blockAfter: 5 });
    for (let i = 0; i < 5; i++) {
      g.evaluate({ tool: 'read', argHash: 'h', kind: IDEMPOTENT });
      g.record({ tool: 'read', argHash: 'h', resultHash: 'always-same', failed: false });
    }
    const r = g.evaluate({ tool: 'read', argHash: 'h', kind: IDEMPOTENT });
    assert.equal(r.kind, 'block');
  });

  it('blocks idempotent tool when result hash repeats blockAfter times', () => {
    const g = new ToolGuardrailController({ warnAfter: 100, blockAfter: 3 });
    for (let i = 0; i < 3; i++) {
      g.record({ tool: 'read', argHash: 'h', resultHash: 'same', failed: false });
    }
    const r = g.evaluate({ tool: 'read', argHash: 'h', kind: IDEMPOTENT });
    assert.equal(r.kind, 'block');
    if (r.kind === 'block') assert.match(r.reason, /same result/);
  });

  it('does NOT idempotent-block when results actually change', () => {
    const g = new ToolGuardrailController({ warnAfter: 100, blockAfter: 3 });
    g.record({ tool: 'read', argHash: 'h', resultHash: 'r1', failed: false });
    g.record({ tool: 'read', argHash: 'h', resultHash: 'r2', failed: false });
    g.record({ tool: 'read', argHash: 'h', resultHash: 'r3', failed: false });
    const r = g.evaluate({ tool: 'read', argHash: 'h', kind: IDEMPOTENT });
    // 3 calls with DIFFERENT results — not stuck, allow.
    assert.equal(r.kind, 'allow');
  });
});

describe('ToolGuardrailController — failure-streak block', () => {
  it('blocks after failureBlockAfter consecutive failed calls', () => {
    const g = new ToolGuardrailController({ failureBlockAfter: 3 });
    for (let i = 0; i < 3; i++) {
      g.record({ tool: 'write', argHash: 'h', failed: true });
    }
    const r = g.evaluate({ tool: 'write', argHash: 'h', kind: MUTATING });
    assert.equal(r.kind, 'block');
    if (r.kind === 'block') assert.match(r.reason, /failed/);
  });

  it('does NOT block when only some calls failed', () => {
    const g = new ToolGuardrailController({ failureBlockAfter: 3, blockAfter: 100, warnAfter: 100 });
    g.record({ tool: 'write', argHash: 'h', failed: true });
    g.record({ tool: 'write', argHash: 'h', failed: false });
    g.record({ tool: 'write', argHash: 'h', failed: true });
    const r = g.evaluate({ tool: 'write', argHash: 'h', kind: MUTATING });
    assert.equal(r.kind, 'allow');
  });

  it('synthetic result is non-empty so the LLM sees explanation', () => {
    const g = new ToolGuardrailController({ failureBlockAfter: 2 });
    g.record({ tool: 'x', argHash: 'h', failed: true });
    g.record({ tool: 'x', argHash: 'h', failed: true });
    const r = g.evaluate({ tool: 'x', argHash: 'h', kind: MUTATING });
    if (r.kind === 'block') {
      assert.ok(r.syntheticResult.length > 0);
      assert.match(r.syntheticResult, /\[guardrail\]/);
    }
  });
});

describe('ToolGuardrailController — window scope', () => {
  it('forgets calls outside the window', () => {
    const g = new ToolGuardrailController({ warnAfter: 2, blockAfter: 3, windowSize: 5 });
    // Fill in 10 calls to a DIFFERENT tool, then come back.
    g.record({ tool: 'x', argHash: 'h', resultHash: 'r', failed: false });
    g.record({ tool: 'x', argHash: 'h', resultHash: 'r', failed: false });
    for (let i = 0; i < 10; i++) {
      g.record({ tool: 'noise', argHash: `n${i}`, failed: false });
    }
    // 'x' should be out of the recent-5 window now → fresh allow.
    const r = g.evaluate({ tool: 'x', argHash: 'h', kind: IDEMPOTENT });
    assert.equal(r.kind, 'allow');
  });
});
