/**
 * Unit tests for subagent spawn guards.
 *
 * If these break, an agent can: (a) recurse without depth limit
 * causing cost runaway, (b) spawn a child with MORE tools than itself
 * (privilege escalation), or (c) bypass a deny by re-allowing in
 * extraAllow. All three are user-visible breakages of trust.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSpawn,
  mergeDeny,
  intersectAllow,
  isToolAllowedForChild,
  type SpawnContext,
  type SpawnRequest,
} from './subagent-spawn';

function ctx(o: Partial<SpawnContext>): SpawnContext {
  return {
    parentRole: o.parentRole ?? 'ORCHESTRATOR',
    parentDepth: o.parentDepth ?? 0,
    parentToolDeny: o.parentToolDeny ?? [],
    parentToolAllow: o.parentToolAllow ?? null,
    maxSpawnDepth: o.maxSpawnDepth,
  };
}

function req(o: Partial<SpawnRequest>): SpawnRequest {
  return {
    requestedRole: o.requestedRole ?? 'LEAF',
    extraDeny: o.extraDeny,
    extraAllow: o.extraAllow,
  };
}

// ── Hard recursion stop ──────────────────────────────────────────

describe('evaluateSpawn — LEAF cannot spawn', () => {
  it('rejects spawn from LEAF regardless of depth', () => {
    const r = evaluateSpawn(ctx({ parentRole: 'LEAF', parentDepth: 0 }), req({}));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /LEAF/);
  });
});

// ── Depth limit ──────────────────────────────────────────────────

describe('evaluateSpawn — depth limit', () => {
  it('allows depth 1 from root (default max=2)', () => {
    const r = evaluateSpawn(ctx({ parentRole: 'ORCHESTRATOR', parentDepth: 0 }), req({}));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resolved.depth, 1);
  });

  it('allows depth 2 with default', () => {
    const r = evaluateSpawn(ctx({ parentRole: 'ORCHESTRATOR', parentDepth: 1 }), req({}));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resolved.depth, 2);
  });

  it('rejects depth > max', () => {
    const r = evaluateSpawn(ctx({ parentRole: 'ORCHESTRATOR', parentDepth: 2 }), req({}));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /depth.*exceeds/);
  });

  it('honours custom maxSpawnDepth', () => {
    const r = evaluateSpawn(ctx({ parentRole: 'ORCHESTRATOR', parentDepth: 0, maxSpawnDepth: 1 }), req({ requestedRole: 'ORCHESTRATOR' }));
    assert.equal(r.ok, true);
    if (r.ok) {
      // depth 1 == max=1 → forced LEAF
      assert.equal(r.resolved.role, 'LEAF');
    }
  });
});

// ── Role demotion at max depth ───────────────────────────────────

describe('evaluateSpawn — role demotion at max depth', () => {
  it('forces requested ORCHESTRATOR → LEAF when child is at max depth', () => {
    const r = evaluateSpawn(ctx({ parentRole: 'ORCHESTRATOR', parentDepth: 1, maxSpawnDepth: 2 }), req({ requestedRole: 'ORCHESTRATOR' }));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resolved.role, 'LEAF');
  });

  it('preserves requested LEAF at max depth (no upgrade)', () => {
    const r = evaluateSpawn(ctx({ parentRole: 'ORCHESTRATOR', parentDepth: 1, maxSpawnDepth: 2 }), req({ requestedRole: 'LEAF' }));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resolved.role, 'LEAF');
  });

  it('keeps requested ORCHESTRATOR below max depth', () => {
    const r = evaluateSpawn(ctx({ parentRole: 'ORCHESTRATOR', parentDepth: 0, maxSpawnDepth: 3 }), req({ requestedRole: 'ORCHESTRATOR' }));
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resolved.role, 'ORCHESTRATOR');
  });
});

// ── Deny inheritance ─────────────────────────────────────────────

describe('mergeDeny', () => {
  it('unions and dedups', () => {
    assert.deepEqual(mergeDeny(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  });
  it('sorts output for stable comparison', () => {
    assert.deepEqual(mergeDeny(['c', 'a'], ['b']), ['a', 'b', 'c']);
  });
});

describe('evaluateSpawn — deny inheritance', () => {
  it("child inherits parent's deny entries", () => {
    const r = evaluateSpawn(ctx({ parentToolDeny: ['bash'] }), req({}));
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(r.resolved.toolDeny.includes('bash'));
  });

  it('extraDeny merges into the inherited set', () => {
    const r = evaluateSpawn(ctx({ parentToolDeny: ['bash'] }), req({ extraDeny: ['ssh'] }));
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(r.resolved.toolDeny.includes('bash'));
      assert.ok(r.resolved.toolDeny.includes('ssh'));
    }
  });
});

// ── Allow intersection ───────────────────────────────────────────

describe('intersectAllow', () => {
  it('null + null → null (no whitelist on either side)', () => {
    assert.equal(intersectAllow(null, null), null);
  });
  it('null + list → list (parent had no whitelist, child opted in)', () => {
    assert.deepEqual(intersectAllow(null, ['a', 'b']), ['a', 'b']);
  });
  it('list + null → parent list (child did not narrow)', () => {
    assert.deepEqual(intersectAllow(['a', 'b'], null), ['a', 'b']);
  });
  it('list + list → intersection', () => {
    assert.deepEqual(intersectAllow(['a', 'b'], ['b', 'c']), ['b']);
  });
  it('list + disjoint list → empty array (no tools allowed)', () => {
    assert.deepEqual(intersectAllow(['a'], ['z']), []);
  });
});

describe('evaluateSpawn — allow privilege escalation block', () => {
  it("child CANNOT gain tools beyond parent's whitelist", () => {
    const r = evaluateSpawn(
      ctx({ parentToolAllow: ['a', 'b'] }),
      req({ extraAllow: ['a', 'b', 'c'] }), // tries to add 'c'
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.resolved.toolAllow, ['a', 'b']);
  });

  it('deny shadows allow — listing same tool in both removes from allow', () => {
    const r = evaluateSpawn(
      ctx({ parentToolDeny: ['bash'], parentToolAllow: ['bash', 'read'] }),
      req({}),
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.resolved.toolAllow!.includes('bash'), false);
      assert.equal(r.resolved.toolDeny.includes('bash'), true);
    }
  });
});

// ── isToolAllowedForChild ────────────────────────────────────────

describe('isToolAllowedForChild', () => {
  it('blocks denied tools regardless of allow-list', () => {
    const resolved = { role: 'LEAF' as const, depth: 1, toolDeny: ['bash'], toolAllow: ['bash', 'read'] };
    assert.equal(isToolAllowedForChild(resolved, 'bash'), false);
  });

  it('allows everything when toolAllow is null', () => {
    const resolved = { role: 'LEAF' as const, depth: 1, toolDeny: ['bash'], toolAllow: null };
    assert.equal(isToolAllowedForChild(resolved, 'anything'), true);
    assert.equal(isToolAllowedForChild(resolved, 'bash'), false); // still denied
  });

  it('honours whitelist when present', () => {
    const resolved = { role: 'LEAF' as const, depth: 1, toolDeny: [], toolAllow: ['read'] };
    assert.equal(isToolAllowedForChild(resolved, 'read'), true);
    assert.equal(isToolAllowedForChild(resolved, 'write'), false);
  });
});
