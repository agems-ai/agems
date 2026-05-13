/**
 * Unit tests for LLM-provider error classifier.
 *
 * If these break, the retry/fallback loop either retries on a billing
 * error (sucks money) or fails to retry on transient 503 (user gets
 * a hard error for what should be a retry-able blip).
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, parseRetryAfter } from './error-classifier';

// ── Status-code fast paths ─────────────────────────────────────

describe('classifyError — status codes', () => {
  it('401 → AUTH (rotate key, no retry)', () => {
    const r = classifyError({ status: 401, message: 'Unauthorized' });
    assert.equal(r.cause, 'AUTH');
    assert.equal(r.shouldRotateKey, true);
    assert.equal(r.retryable, false);
  });

  it('402 → BILLING (no retry)', () => {
    const r = classifyError({ status: 402, message: 'Payment required' });
    assert.equal(r.cause, 'BILLING');
    assert.equal(r.retryable, false);
  });

  it('429 → RATE_LIMIT (retry with retry-after)', () => {
    const r = classifyError({ status: 429, message: 'rate limit', retryAfterSeconds: 60 });
    assert.equal(r.cause, 'RATE_LIMIT');
    assert.equal(r.retryable, true);
    assert.equal(r.retryAfterMs, 60_000);
  });

  it('429 without retry-after defaults to 30s', () => {
    const r = classifyError({ status: 429, message: '' });
    assert.equal(r.retryAfterMs, 30_000);
  });

  it('413 → IMAGE_TOO_LARGE (no retry)', () => {
    const r = classifyError({ status: 413 });
    assert.equal(r.cause, 'IMAGE_TOO_LARGE');
    assert.equal(r.retryable, false);
  });

  it('503 → PROVIDER_DOWN (retry)', () => {
    const r = classifyError({ status: 503 });
    assert.equal(r.cause, 'PROVIDER_DOWN');
    assert.equal(r.retryable, true);
  });

  it('502 / 504 → PROVIDER_DOWN', () => {
    assert.equal(classifyError({ status: 502 }).cause, 'PROVIDER_DOWN');
    assert.equal(classifyError({ status: 504 }).cause, 'PROVIDER_DOWN');
  });
});

// ── Message patterns ────────────────────────────────────────────

describe('classifyError — message patterns', () => {
  it('"invalid api key" → AUTH', () => {
    const r = classifyError({ message: 'Error: invalid api key' });
    assert.equal(r.cause, 'AUTH');
    assert.equal(r.shouldRotateKey, true);
  });

  it('"insufficient quota" → BILLING', () => {
    const r = classifyError({ message: 'You exceeded your insufficient quota' });
    assert.equal(r.cause, 'BILLING');
  });

  it('"rate limit" → RATE_LIMIT', () => {
    const r = classifyError({ message: 'You hit a rate limit' });
    assert.equal(r.cause, 'RATE_LIMIT');
    assert.equal(r.retryable, true);
  });

  it('"overloaded" → OVERLOADED with 10s backoff', () => {
    const r = classifyError({ message: 'The model is overloaded' });
    assert.equal(r.cause, 'OVERLOADED');
    assert.equal(r.retryAfterMs, 10_000);
  });

  it('"context length exceeded" → CONTEXT_OVERFLOW (compress + retry)', () => {
    const r = classifyError({ message: 'context length exceeded' });
    assert.equal(r.cause, 'CONTEXT_OVERFLOW');
    assert.equal(r.shouldCompress, true);
    assert.equal(r.retryable, true);
  });

  it('"model not found" → MODEL_NOT_FOUND (fallback model)', () => {
    const r = classifyError({ message: 'The model gpt-5-xl was not found' });
    assert.equal(r.cause, 'MODEL_NOT_FOUND');
    assert.equal(r.shouldFallbackModel, true);
  });

  it('"thinking signature" → THINKING_SIGNATURE (retry)', () => {
    const r = classifyError({ message: 'invalid thinking signature on message' });
    assert.equal(r.cause, 'THINKING_SIGNATURE');
    assert.equal(r.retryable, true);
  });

  it('"timeout" → TIMEOUT', () => {
    const r = classifyError({ message: 'Request timed out after 30s' });
    assert.equal(r.cause, 'TIMEOUT');
    assert.equal(r.retryable, true);
  });

  it('"image too large" → IMAGE_TOO_LARGE', () => {
    const r = classifyError({ message: 'image too large for the model' });
    assert.equal(r.cause, 'IMAGE_TOO_LARGE');
    assert.equal(r.retryable, false);
  });

  it('unknown garbage → UNKNOWN (not retryable)', () => {
    const r = classifyError({ message: 'something completely weird happened' });
    assert.equal(r.cause, 'UNKNOWN');
    assert.equal(r.retryable, false);
  });
});

// ── Order: more-specific wins ──────────────────────────────────

describe('classifyError — specificity order', () => {
  it('"context length exceeded due to rate limit" → CONTEXT_OVERFLOW (specific beats general)', () => {
    const r = classifyError({ message: 'context length exceeded due to rate limit' });
    assert.equal(r.cause, 'CONTEXT_OVERFLOW');
  });

  it('billing pattern beats rate-limit pattern', () => {
    const r = classifyError({ message: 'insufficient quota — rate limit applied' });
    assert.equal(r.cause, 'BILLING');
  });
});

// ── Empty / defensive ──────────────────────────────────────────

describe('classifyError — defensive', () => {
  it('empty message → UNKNOWN', () => {
    assert.equal(classifyError({}).cause, 'UNKNOWN');
  });

  it('null message → UNKNOWN', () => {
    assert.equal(classifyError({ message: null }).cause, 'UNKNOWN');
  });

  it('preserves lowercased message in result', () => {
    const r = classifyError({ message: 'WEIRD CAPS MESSAGE' });
    assert.equal(r.message, 'weird caps message');
  });
});

// ── parseRetryAfter ────────────────────────────────────────────

describe('parseRetryAfter', () => {
  it('parses integer seconds', () => {
    assert.equal(parseRetryAfter('120'), 120);
  });

  it('parses HTTP-date format relative to now', () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const r = parseRetryAfter(future);
    // Approximately 60s — but allow off-by-one second drift.
    assert.ok(r !== undefined && r >= 58 && r <= 62, `expected ~60, got ${r}`);
  });

  it('returns undefined on garbage', () => {
    assert.equal(parseRetryAfter('not-a-date'), undefined);
    assert.equal(parseRetryAfter(''), undefined);
    assert.equal(parseRetryAfter(null), undefined);
  });

  it('clamps past HTTP-date to 0', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    assert.equal(parseRetryAfter(past), 0);
  });
});
