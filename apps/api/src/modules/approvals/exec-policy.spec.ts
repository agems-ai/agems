/**
 * Unit tests for tool-execution policy evaluation.
 *
 * If these break, agents either bypass approvals they should ask for
 * (silent escalation of privileges) or re-ask for things the user
 * already approved (annoying, but also pushes users toward auto-allow
 * everything). Both are bad.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashToolInput,
  evaluatePolicy,
  shouldConsume,
  type PriorApproval,
} from './exec-policy';

const now = new Date('2026-05-13T10:00:00.000Z');

function prior(opts: Partial<PriorApproval> & { toolName: string; scope: PriorApproval['scope']; grantedAt?: Date }): PriorApproval {
  return {
    toolName: opts.toolName,
    scope: opts.scope,
    inputHash: opts.inputHash,
    grantedAt: opts.grantedAt ?? new Date(now.getTime() - 60_000),
    ttlSeconds: opts.ttlSeconds ?? null,
    consumedAt: opts.consumedAt ?? null,
  };
}

// ── hashToolInput ────────────────────────────────────────────────

describe('hashToolInput', () => {
  it('produces stable hex of 16 chars', () => {
    const h = hashToolInput({ a: 1, b: 'two' });
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]+$/);
  });

  it('is order-stable across key permutations (canonical sort)', () => {
    assert.equal(
      hashToolInput({ a: 1, b: 2, c: 3 }),
      hashToolInput({ c: 3, a: 1, b: 2 }),
    );
  });

  it('different inputs → different hashes', () => {
    assert.notEqual(hashToolInput({ x: 1 }), hashToolInput({ x: 2 }));
  });

  it('null / undefined / empty all hash to something (no crash)', () => {
    assert.ok(hashToolInput(null).length === 16);
    assert.ok(hashToolInput(undefined).length === 16);
  });
});

// ── BLOCKED beats everything ─────────────────────────────────────

describe('evaluatePolicy — BLOCKED', () => {
  it('blocks even with a valid prior approval', () => {
    const r = evaluatePolicy({
      toolName: 'bash', toolPolicy: 'BLOCKED', currentInputHash: 'h',
      priorApproval: prior({ toolName: 'bash', scope: 'allow-always-this-tool' }),
      now,
    });
    assert.equal(r.decision, 'block');
  });

  it('blocks regardless of input', () => {
    const r = evaluatePolicy({ toolName: 'x', toolPolicy: 'BLOCKED', currentInputHash: 'h', now });
    assert.equal(r.decision, 'block');
  });
});

// ── FREE always allows ───────────────────────────────────────────

describe('evaluatePolicy — FREE', () => {
  it('allows without any prior', () => {
    const r = evaluatePolicy({ toolName: 'x', toolPolicy: 'FREE', currentInputHash: 'h', now });
    assert.equal(r.decision, 'allow');
  });
  it('allows even with an expired prior (FREE ignores prior)', () => {
    const r = evaluatePolicy({
      toolName: 'x', toolPolicy: 'FREE', currentInputHash: 'h',
      priorApproval: prior({ toolName: 'x', scope: 'allow-once', grantedAt: new Date(0), ttlSeconds: 1 }),
      now,
    });
    assert.equal(r.decision, 'allow');
  });
});

// ── REQUIRES_APPROVAL — no prior ─────────────────────────────────

describe('evaluatePolicy — REQUIRES_APPROVAL, no prior', () => {
  it('requests approval', () => {
    const r = evaluatePolicy({ toolName: 'x', toolPolicy: 'REQUIRES_APPROVAL', currentInputHash: 'h', now });
    assert.equal(r.decision, 'request_approval');
  });
});

// ── allow-once ───────────────────────────────────────────────────

describe('evaluatePolicy — allow-once', () => {
  it('allows when not yet consumed', () => {
    const r = evaluatePolicy({
      toolName: 'x', toolPolicy: 'REQUIRES_APPROVAL', currentInputHash: 'h',
      priorApproval: prior({ toolName: 'x', scope: 'allow-once' }),
      now,
    });
    assert.equal(r.decision, 'allow');
  });

  it('requests approval when already consumed', () => {
    const r = evaluatePolicy({
      toolName: 'x', toolPolicy: 'REQUIRES_APPROVAL', currentInputHash: 'h',
      priorApproval: prior({ toolName: 'x', scope: 'allow-once', consumedAt: new Date(now.getTime() - 1000) }),
      now,
    });
    assert.equal(r.decision, 'request_approval');
  });
});

// ── allow-always-this-input ──────────────────────────────────────

describe('evaluatePolicy — allow-always-this-input', () => {
  it('allows when input hash matches', () => {
    const r = evaluatePolicy({
      toolName: 'x', toolPolicy: 'REQUIRES_APPROVAL', currentInputHash: 'h-same',
      priorApproval: prior({ toolName: 'x', scope: 'allow-always-this-input', inputHash: 'h-same' }),
      now,
    });
    assert.equal(r.decision, 'allow');
  });

  it('requests approval when input hash differs', () => {
    const r = evaluatePolicy({
      toolName: 'x', toolPolicy: 'REQUIRES_APPROVAL', currentInputHash: 'h-different',
      priorApproval: prior({ toolName: 'x', scope: 'allow-always-this-input', inputHash: 'h-original' }),
      now,
    });
    assert.equal(r.decision, 'request_approval');
  });
});

// ── allow-always-this-tool ───────────────────────────────────────

describe('evaluatePolicy — allow-always-this-tool', () => {
  it('allows regardless of input', () => {
    const r = evaluatePolicy({
      toolName: 'x', toolPolicy: 'REQUIRES_APPROVAL', currentInputHash: 'anything',
      priorApproval: prior({ toolName: 'x', scope: 'allow-always-this-tool' }),
      now,
    });
    assert.equal(r.decision, 'allow');
  });

  it('does NOT carry over to a different tool', () => {
    const r = evaluatePolicy({
      toolName: 'other-tool', toolPolicy: 'REQUIRES_APPROVAL', currentInputHash: 'h',
      priorApproval: prior({ toolName: 'x', scope: 'allow-always-this-tool' }),
      now,
    });
    assert.equal(r.decision, 'request_approval');
  });
});

// ── TTL expiry ───────────────────────────────────────────────────

describe('evaluatePolicy — TTL', () => {
  it('respects ttlSeconds — expired prior triggers re-approval', () => {
    const r = evaluatePolicy({
      toolName: 'x', toolPolicy: 'REQUIRES_APPROVAL', currentInputHash: 'h',
      priorApproval: prior({
        toolName: 'x', scope: 'allow-always-this-tool',
        grantedAt: new Date(now.getTime() - 3600_000), ttlSeconds: 60,
      }),
      now,
    });
    assert.equal(r.decision, 'request_approval');
  });

  it('not-yet-expired prior still allows', () => {
    const r = evaluatePolicy({
      toolName: 'x', toolPolicy: 'REQUIRES_APPROVAL', currentInputHash: 'h',
      priorApproval: prior({
        toolName: 'x', scope: 'allow-always-this-tool',
        grantedAt: new Date(now.getTime() - 60_000), ttlSeconds: 3600,
      }),
      now,
    });
    assert.equal(r.decision, 'allow');
  });

  it('null ttlSeconds means no expiry (the default)', () => {
    const r = evaluatePolicy({
      toolName: 'x', toolPolicy: 'REQUIRES_APPROVAL', currentInputHash: 'h',
      priorApproval: prior({
        toolName: 'x', scope: 'allow-always-this-tool',
        grantedAt: new Date(0), // ancient
        ttlSeconds: null,
      }),
      now,
    });
    assert.equal(r.decision, 'allow');
  });
});

// ── shouldConsume ────────────────────────────────────────────────

describe('shouldConsume', () => {
  it('true for allow-once + allow decision', () => {
    const p = prior({ toolName: 'x', scope: 'allow-once' });
    assert.equal(shouldConsume(p, { decision: 'allow', reason: '' }), true);
  });

  it('false for allow-always-this-tool', () => {
    const p = prior({ toolName: 'x', scope: 'allow-always-this-tool' });
    assert.equal(shouldConsume(p, { decision: 'allow', reason: '' }), false);
  });

  it('false when decision is not allow', () => {
    const p = prior({ toolName: 'x', scope: 'allow-once' });
    assert.equal(shouldConsume(p, { decision: 'request_approval', reason: '' }), false);
    assert.equal(shouldConsume(p, { decision: 'block', reason: '' }), false);
  });

  it('false when no prior was used (regular request_approval path)', () => {
    assert.equal(shouldConsume(undefined, { decision: 'allow', reason: '' }), false);
  });
});
