/**
 * Unit tests for run-liveness classifier.
 *
 * If these break, the scheduler can't tell the difference between
 * "agent shipped a real change" and "agent wrote a 200-word plan and
 * called it done". Wake/sleep and productivity-review jobs then run
 * on noise.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRunLiveness, extractNextAction } from './run-liveness';

// ── State classification ────────────────────────────────────────

describe('classifyRunLiveness — state', () => {
  it('approval-required beats everything (most specific)', () => {
    const r = classifyRunLiveness({ output: 'Waiting for approval before I ship the PR' });
    assert.equal(r.state, 'approval_required');
  });

  it('blocked_external when "stuck on" appears', () => {
    const r = classifyRunLiveness({ output: 'I am stuck on the Stripe webhook signature' });
    assert.equal(r.state, 'blocked_external');
  });

  it('manager_review when work needs review', () => {
    const r = classifyRunLiveness({ output: 'Draft is ready for review' });
    assert.equal(r.state, 'manager_review');
  });

  it('runnable + real progress when concrete verbs appear', () => {
    const r = classifyRunLiveness({ output: 'Pushed commit abc123 to main, deployed to staging' });
    assert.equal(r.state, 'runnable');
    assert.equal(r.plannedOnly, false);
  });

  it('runnable + plannedOnly when only planning verbs appear', () => {
    const r = classifyRunLiveness({ output: "Here's my plan: I will refactor the auth module first, then add tests." });
    assert.equal(r.state, 'runnable');
    assert.equal(r.plannedOnly, true);
  });

  it('unknown for empty output', () => {
    const r = classifyRunLiveness({ output: '' });
    assert.equal(r.state, 'unknown');
  });

  it('unknown when no salient patterns match', () => {
    const r = classifyRunLiveness({ output: 'hmm, ok, sure, fine' });
    assert.equal(r.state, 'unknown');
  });
});

// ── Source combining ────────────────────────────────────────────

describe('classifyRunLiveness — input sources', () => {
  it('combines output + comments + resultJson', () => {
    const r = classifyRunLiveness({
      output: 'short message',
      resultJson: { status: 'awaiting review' },
      comments: ['just kicked off', 'see comments above'],
    });
    assert.equal(r.state, 'manager_review');
  });

  it('handles null / missing fields defensively', () => {
    const r = classifyRunLiveness({ output: null, resultJson: undefined, comments: [] });
    assert.equal(r.state, 'unknown');
  });

  it('JSON-stringify result is non-fatal on circular refs', () => {
    const obj: any = {};
    obj.self = obj;
    const r = classifyRunLiveness({ output: 'pushed commit abc', resultJson: obj });
    // Circular ref ignored, normal classification proceeds.
    assert.equal(r.state, 'runnable');
  });
});

// ── extractNextAction ──────────────────────────────────────────

describe('extractNextAction', () => {
  it('"Next action: do X"', () => {
    assert.equal(extractNextAction('Done for now.\nNext action: ping the team'), 'ping the team');
  });

  it('"Next step: do Y"', () => {
    assert.equal(extractNextAction('Next step: review with Bob'), 'review with Bob');
  });

  it('"Next up: Z"', () => {
    assert.equal(extractNextAction('Wrapped up.\nNext up: deploy on Friday'), 'deploy on Friday');
  });

  it('"TODO: X"', () => {
    assert.equal(extractNextAction('TODO: write the tests'), 'write the tests');
  });

  it('undefined when no pattern matches', () => {
    assert.equal(extractNextAction('Just a random line'), undefined);
  });

  it('returns first match only', () => {
    const r = extractNextAction('Next action: foo\nNext step: bar');
    assert.equal(r, 'foo');
  });
});

// ── nextAction propagation ─────────────────────────────────────

describe('classifyRunLiveness — nextAction', () => {
  it('embeds nextAction in classification when present', () => {
    const r = classifyRunLiveness({
      output: 'Stuck on Stripe API.\nNext step: ping support',
    });
    assert.equal(r.state, 'blocked_external');
    assert.equal(r.nextAction, 'ping support');
  });
});
