/**
 * Unit tests for webhook signature verification.
 *
 * If these break, an attacker can forge a TaskTrigger fire (causing
 * agent runs / cost) without knowing the secret. Critical security
 * surface — over-test rather than under-test.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  stripSchemePrefix,
  safeStringEquals,
  verifyHmacSignature,
  verifyBearerToken,
  verifyTrigger,
} from './webhook-verify';

// Helper: produce a valid HMAC-SHA256 hex signature for body + secret.
function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

// ── stripSchemePrefix ────────────────────────────────────────────

describe('stripSchemePrefix', () => {
  it('removes sha256= prefix', () => {
    assert.equal(stripSchemePrefix('sha256=abc123'), 'abc123');
  });
  it('removes sha1= prefix (legacy)', () => {
    assert.equal(stripSchemePrefix('sha1=abc'), 'abc');
  });
  it('returns input unchanged when no scheme present', () => {
    assert.equal(stripSchemePrefix('abc123'), 'abc123');
  });
  it('does NOT confuse "sha256=" inside a hex string with a prefix at non-start', () => {
    assert.equal(stripSchemePrefix('xsha256=abc'), 'xsha256=abc');
  });
});

// ── safeStringEquals ─────────────────────────────────────────────

describe('safeStringEquals', () => {
  it('returns true for equal strings', () => {
    assert.equal(safeStringEquals('hello', 'hello'), true);
  });
  it('returns false for different strings of equal length', () => {
    assert.equal(safeStringEquals('hello', 'wo___'), false);
  });
  it('returns false for unequal length (no timingSafeEqual crash)', () => {
    assert.equal(safeStringEquals('a', 'aaa'), false);
  });
  it('returns true for empty == empty', () => {
    assert.equal(safeStringEquals('', ''), true);
  });
});

// ── verifyHmacSignature ──────────────────────────────────────────

describe('verifyHmacSignature', () => {
  const body = '{"event":"task.run","agentId":"sophia"}';
  const secret = 'shh-keep-this-private';

  it('accepts a valid bare hex signature', () => {
    const sig = sign(body, secret);
    assert.deepEqual(verifyHmacSignature({ body, secret, providedSignature: sig }), { ok: true });
  });

  it('accepts a valid signature with sha256= prefix', () => {
    const sig = `sha256=${sign(body, secret)}`;
    assert.deepEqual(verifyHmacSignature({ body, secret, providedSignature: sig }), { ok: true });
  });

  it('rejects when signature is missing', () => {
    const r = verifyHmacSignature({ body, secret, providedSignature: '' });
    assert.equal(r.ok, false);
  });

  it('rejects when secret is missing', () => {
    const sig = sign(body, secret);
    const r = verifyHmacSignature({ body, secret: '', providedSignature: sig });
    assert.equal(r.ok, false);
  });

  it('rejects a signature computed with a different secret', () => {
    const sig = sign(body, 'wrong-secret');
    const r = verifyHmacSignature({ body, secret, providedSignature: sig });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /mismatch/);
  });

  it('rejects when body has been tampered with', () => {
    const sig = sign(body, secret);
    const tampered = body.replace('sophia', 'evil');
    const r = verifyHmacSignature({ body: tampered, secret, providedSignature: sig });
    assert.equal(r.ok, false);
  });

  it('accepts Buffer body equivalently to string body', () => {
    const sig = sign(body, secret);
    const r = verifyHmacSignature({ body: Buffer.from(body), secret, providedSignature: sig });
    assert.equal(r.ok, true);
  });

  it('trims surrounding whitespace in the signature header (some proxies add it)', () => {
    const sig = sign(body, secret);
    const r = verifyHmacSignature({ body, secret, providedSignature: `  ${sig}  ` });
    assert.equal(r.ok, true);
  });
});

// ── verifyBearerToken ────────────────────────────────────────────

describe('verifyBearerToken', () => {
  const token = 's3cret-bearer';

  it('accepts a valid Bearer header', () => {
    const r = verifyBearerToken({ authHeader: `Bearer ${token}`, expectedToken: token });
    assert.deepEqual(r, { ok: true });
  });

  it('is case-insensitive on the "Bearer" keyword', () => {
    assert.equal(verifyBearerToken({ authHeader: `bearer ${token}`, expectedToken: token }).ok, true);
    assert.equal(verifyBearerToken({ authHeader: `BEARER ${token}`, expectedToken: token }).ok, true);
  });

  it('rejects when header is missing', () => {
    assert.equal(verifyBearerToken({ authHeader: undefined, expectedToken: token }).ok, false);
    assert.equal(verifyBearerToken({ authHeader: null, expectedToken: token }).ok, false);
  });

  it('rejects when expectedToken is empty (misconfigured)', () => {
    assert.equal(verifyBearerToken({ authHeader: `Bearer ${token}`, expectedToken: '' }).ok, false);
  });

  it('rejects a wrong token', () => {
    assert.equal(verifyBearerToken({ authHeader: 'Bearer wrong', expectedToken: token }).ok, false);
  });

  it('rejects malformed header (no Bearer scheme)', () => {
    assert.equal(verifyBearerToken({ authHeader: token, expectedToken: token }).ok, false);
    assert.equal(verifyBearerToken({ authHeader: `Basic ${token}`, expectedToken: token }).ok, false);
  });
});

// ── verifyTrigger (dispatch) ─────────────────────────────────────

describe('verifyTrigger', () => {
  const body = '{"hello":"world"}';
  const secret = 'shh';

  it('NONE auth always passes (caller opted out)', () => {
    const r = verifyTrigger({ config: { kind: 'NONE' }, body, headers: {} });
    assert.equal(r.ok, true);
  });

  it('BEARER auth reads `authorization` header (lowercase per Node convention)', () => {
    const r = verifyTrigger({
      config: { kind: 'BEARER', secret },
      body,
      headers: { authorization: `Bearer ${secret}` },
    });
    assert.equal(r.ok, true);
  });

  it('HMAC auth reads x-signature by default', () => {
    const r = verifyTrigger({
      config: { kind: 'HMAC', secret },
      body,
      headers: { 'x-signature': sign(body, secret) },
    });
    assert.equal(r.ok, true);
  });

  it('HMAC auth falls back to x-hub-signature-256 when x-signature is absent', () => {
    const r = verifyTrigger({
      config: { kind: 'HMAC', secret },
      body,
      headers: { 'x-hub-signature-256': `sha256=${sign(body, secret)}` },
    });
    assert.equal(r.ok, true);
  });

  it('HMAC auth honours custom signatureHeader override', () => {
    const r = verifyTrigger({
      config: { kind: 'HMAC', secret, signatureHeader: 'x-custom-sig' },
      body,
      headers: { 'x-custom-sig': sign(body, secret) },
    });
    assert.equal(r.ok, true);
  });

  it('HMAC fails closed when no signature header present anywhere', () => {
    const r = verifyTrigger({
      config: { kind: 'HMAC', secret },
      body,
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(r.ok, false);
  });

  it('handles array-valued headers (some Node setups deliver duplicates as arrays)', () => {
    const r = verifyTrigger({
      config: { kind: 'BEARER', secret },
      body,
      headers: { authorization: [`Bearer ${secret}`, 'discarded'] },
    });
    assert.equal(r.ok, true);
  });

  it('returns a reason on failure (for logging — never echo back to caller)', () => {
    const r = verifyTrigger({
      config: { kind: 'HMAC', secret },
      body,
      headers: { 'x-signature': 'totally-wrong' },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.reason.length > 0);
  });
});
