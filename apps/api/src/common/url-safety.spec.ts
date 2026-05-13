/**
 * Unit tests for SSRF / URL safety guard.
 *
 * If these break, an agent can fetch cloud-instance-metadata URLs and
 * exfiltrate IAM credentials. Highest-stakes security helper in the
 * codebase — tests err strongly toward over-coverage.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrlSafety, checkIp, assertSafeUrl } from './url-safety';

// ── Always-blocked metadata IPs ──────────────────────────────────

describe('checkUrlSafety — cloud metadata IPs (always blocked)', () => {
  it('blocks AWS/GCP 169.254.169.254 even with allowPrivate', () => {
    const r = checkUrlSafety('http://169.254.169.254/latest/meta-data/', { allowPrivate: true });
    assert.equal(r.ok, false);
  });

  it('blocks Alibaba 100.100.100.200', () => {
    const r = checkIp('100.100.100.200', { allowPrivate: true });
    assert.equal(r.ok, false);
  });

  it('blocks metadata.google.internal hostname', () => {
    const r = checkUrlSafety('http://metadata.google.internal/');
    assert.equal(r.ok, false);
  });
});

// ── Loopback / link-local ────────────────────────────────────────

describe('checkUrlSafety — loopback', () => {
  it('blocks 127.0.0.1 by default', () => {
    assert.equal(checkUrlSafety('http://127.0.0.1/').ok, false);
  });

  it('blocks 127.0.0.5 (anywhere in 127/8)', () => {
    assert.equal(checkIp('127.0.0.5').ok, false);
  });

  it('allows loopback when allowLoopback=true', () => {
    assert.equal(checkUrlSafety('http://127.0.0.1/', { allowLoopback: true }).ok, true);
  });

  it('blocks ::1 by default', () => {
    assert.equal(checkIp('::1').ok, false);
  });

  it('blocks 169.254.x.x (link-local) — always', () => {
    assert.equal(checkIp('169.254.5.5').ok, false);
  });

  it('blocks IPv6 link-local fe80::', () => {
    assert.equal(checkIp('fe80::1').ok, false);
  });
});

// ── CGNAT ────────────────────────────────────────────────────────

describe('checkUrlSafety — CGNAT', () => {
  it('blocks 100.64.0.0 — 100.127.255.255', () => {
    assert.equal(checkIp('100.64.0.1').ok, false);
    assert.equal(checkIp('100.127.255.255').ok, false);
  });

  it('does NOT block 100.0.0.1 (outside CGNAT range)', () => {
    assert.equal(checkIp('100.0.0.1').ok, true);
  });
});

// ── Private addresses ────────────────────────────────────────────

describe('checkUrlSafety — private (RFC1918)', () => {
  it('blocks 10.0.0.1 by default', () => {
    assert.equal(checkIp('10.0.0.1').ok, false);
  });

  it('blocks 172.16.0.1 by default', () => {
    assert.equal(checkIp('172.16.0.1').ok, false);
  });

  it('blocks 192.168.1.1 by default', () => {
    assert.equal(checkIp('192.168.1.1').ok, false);
  });

  it('allows private when allowPrivate=true', () => {
    assert.equal(checkIp('192.168.1.1', { allowPrivate: true }).ok, true);
  });

  it('blocks IPv6 ULA fc00::/7 by default', () => {
    assert.equal(checkIp('fd12:3456::1').ok, false);
  });
});

// ── Public addresses ────────────────────────────────────────────

describe('checkUrlSafety — public addresses', () => {
  it('allows 8.8.8.8', () => {
    assert.equal(checkIp('8.8.8.8').ok, true);
  });

  it('allows a normal https://example.com', () => {
    assert.equal(checkUrlSafety('https://example.com/path').ok, true);
  });
});

// ── Scheme guard ────────────────────────────────────────────────

describe('checkUrlSafety — scheme', () => {
  it('rejects file:// always', () => {
    assert.equal(checkUrlSafety('file:///etc/passwd').ok, false);
  });

  it('rejects javascript: (XSS)', () => {
    assert.equal(checkUrlSafety('javascript:alert(1)').ok, false);
  });

  it('rejects data: (exfil channel)', () => {
    assert.equal(checkUrlSafety('data:text/plain,hello').ok, false);
  });

  it('rejects ftp://', () => {
    assert.equal(checkUrlSafety('ftp://example.com/').ok, false);
  });

  it('rejects http:// when allowHttp=false', () => {
    assert.equal(checkUrlSafety('http://example.com/', { allowHttp: false }).ok, false);
  });

  it('allows https:// when allowHttp=false', () => {
    assert.equal(checkUrlSafety('https://example.com/', { allowHttp: false }).ok, true);
  });
});

// ── Malformed input ─────────────────────────────────────────────

describe('checkUrlSafety — malformed', () => {
  it('rejects empty string', () => {
    assert.equal(checkUrlSafety('').ok, false);
  });

  it('rejects non-string input gracefully', () => {
    assert.equal(checkUrlSafety(null as any).ok, false);
    assert.equal(checkUrlSafety(undefined as any).ok, false);
  });

  it('rejects "not-a-url"', () => {
    assert.equal(checkUrlSafety('not-a-url').ok, false);
  });
});

// ── Custom blocked hosts ────────────────────────────────────────

describe('checkUrlSafety — custom blockedHosts', () => {
  it('blocks exact host match', () => {
    const r = checkUrlSafety('https://forbidden.com/', { blockedHosts: ['forbidden.com'] });
    assert.equal(r.ok, false);
  });

  it('blocks via *.suffix pattern', () => {
    const r = checkUrlSafety('https://api.forbidden.com/', { blockedHosts: ['*.forbidden.com'] });
    assert.equal(r.ok, false);
  });

  it('still allows non-matching hosts', () => {
    const r = checkUrlSafety('https://example.com/', { blockedHosts: ['*.forbidden.com'] });
    assert.equal(r.ok, true);
  });
});

// ── assertSafeUrl ───────────────────────────────────────────────

describe('assertSafeUrl', () => {
  it('throws on unsafe url', () => {
    assert.throws(() => assertSafeUrl('http://169.254.169.254/'), /URL rejected/);
  });

  it('does not throw on safe url', () => {
    assert.doesNotThrow(() => assertSafeUrl('https://example.com/'));
  });
});
