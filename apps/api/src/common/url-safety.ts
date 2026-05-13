/**
 * SSRF / URL safety guard — Hermes pattern (`tools/url_safety.py`).
 *
 * The browser tool, http-fetch tool, and any url-accepting handler must
 * pass user-supplied URLs through `assertSafeUrl()` before fetching.
 * Without this an agent told to "fetch http://169.254.169.254/" on a
 * cloud VM can exfiltrate the host's IAM credentials via the cloud
 * instance metadata service.
 *
 * Blocked by default (cannot be overridden):
 *   - Cloud instance metadata: 169.254.169.254, fd00:ec2::254,
 *     100.100.100.200 (Alibaba), fe80::a9fe:a9fe (Azure).
 *   - Link-local: 169.254.0.0/16, fe80::/10
 *   - Loopback: 127.0.0.0/8, ::1
 *   - Carrier-grade NAT: 100.64.0.0/10
 *
 * Blocked unless { allowPrivate: true }:
 *   - RFC 1918 private: 10/8, 172.16/12, 192.168/16
 *   - Unique local IPv6: fc00::/7
 *
 * Always blocked schemes: file:, javascript:, data: (anything that
 *   isn't http/https).
 *
 * Pure module. Does NOT do DNS resolution — the caller resolves
 * hostname → IP, hands the IP in. Why: DNS resolution introduces I/O,
 * is hard to test, and is best done by the actual fetch path with the
 * IP fed back into checkIp() for a second-stage block.
 */

export type UrlSafetyResult = { ok: true } | { ok: false; reason: string };

/** Always-blocked metadata IPs, regardless of allowPrivate. */
const ALWAYS_BLOCKED_IPS = new Set<string>([
  '169.254.169.254',          // AWS / GCP IMDS
  '100.100.100.200',          // Alibaba ECS metadata
]);

const ALWAYS_BLOCKED_HOSTS = new Set<string>([
  'metadata.google.internal',
  'metadata.goog',
]);

const ALWAYS_BLOCKED_IPV6 = ['fd00:ec2::254', 'fe80::a9fe:a9fe'];

export interface UrlSafetyOptions {
  /** Allow RFC1918 private addresses (10/8, 172.16/12, 192.168/16) and ULA. */
  allowPrivate?: boolean;
  /** Allow loopback (127/8, ::1). */
  allowLoopback?: boolean;
  /** Allow http:// (not just https://). */
  allowHttp?: boolean;
  /** Hard blocklist of host patterns (fnmatch-style, but we support
   *  only exact + suffix matches "*.foo.com"). */
  blockedHosts?: string[];
}

const DEFAULT_OPTIONS: UrlSafetyOptions = {
  allowPrivate: false,
  allowLoopback: false,
  allowHttp: true,
};

/**
 * Check that a string URL is safe to fetch. Parses, validates scheme,
 * checks host/IP against blocklists.
 *
 * Returns either { ok: true } or { ok: false, reason } — never throws.
 */
export function checkUrlSafety(rawUrl: string, opts: UrlSafetyOptions = {}): UrlSafetyResult {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, reason: 'empty url' };
  }
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { return { ok: false, reason: 'malformed url' }; }

  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === 'file' || scheme === 'data' || scheme === 'javascript') {
    return { ok: false, reason: `scheme not allowed: ${scheme}` };
  }
  if (scheme !== 'http' && scheme !== 'https') {
    return { ok: false, reason: `scheme not allowed: ${scheme}` };
  }
  if (scheme === 'http' && options.allowHttp === false) {
    return { ok: false, reason: 'http:// disabled — use https://' };
  }

  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'no host' };

  // Strip [brackets] from IPv6 form.
  const bareHost = host.replace(/^\[|\]$/g, '');

  if (ALWAYS_BLOCKED_HOSTS.has(bareHost)) {
    return { ok: false, reason: `host on always-blocked list: ${bareHost}` };
  }

  for (const pattern of options.blockedHosts ?? []) {
    if (matchHostPattern(bareHost, pattern)) {
      return { ok: false, reason: `host matched custom block "${pattern}"` };
    }
  }

  // If host is an IPv4 or IPv6 address, check IP rules.
  const ipResult = checkIp(bareHost, options);
  if (!ipResult.ok) return ipResult;
  return { ok: true };
}

/**
 * Check a resolved IP address (string form). Use after DNS resolution
 * to catch DNS-rebinding attacks where hostname.example.com pointed to
 * 169.254.169.254 only at fetch time.
 */
export function checkIp(ip: string, opts: UrlSafetyOptions = {}): UrlSafetyResult {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  if (!ip) return { ok: false, reason: 'empty ip' };

  if (ALWAYS_BLOCKED_IPS.has(ip)) return { ok: false, reason: `metadata-ip blocked: ${ip}` };
  if (ALWAYS_BLOCKED_IPV6.some(b => ip.toLowerCase() === b.toLowerCase())) {
    return { ok: false, reason: `metadata-ip blocked: ${ip}` };
  }

  const v4 = parseIPv4(ip);
  if (v4 !== null) {
    if (isInRange(v4, '127.0.0.0', '127.255.255.255')) {
      return options.allowLoopback ? { ok: true } : { ok: false, reason: 'loopback blocked' };
    }
    if (isInRange(v4, '169.254.0.0', '169.254.255.255')) {
      return { ok: false, reason: 'link-local blocked' };
    }
    if (isInRange(v4, '100.64.0.0', '100.127.255.255')) {
      return { ok: false, reason: 'CGNAT 100.64/10 blocked' };
    }
    const isPrivate =
      isInRange(v4, '10.0.0.0', '10.255.255.255') ||
      isInRange(v4, '172.16.0.0', '172.31.255.255') ||
      isInRange(v4, '192.168.0.0', '192.168.255.255');
    if (isPrivate && !options.allowPrivate) {
      return { ok: false, reason: 'private (RFC1918) address blocked' };
    }
    return { ok: true };
  }

  // IPv6 — string-level checks for common ranges.
  const lower = ip.toLowerCase();
  if (lower === '::1') {
    return options.allowLoopback ? { ok: true } : { ok: false, reason: 'loopback (::1) blocked' };
  }
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) {
    return { ok: false, reason: 'link-local (fe80::/10) blocked' };
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return options.allowPrivate ? { ok: true } : { ok: false, reason: 'ULA (fc00::/7) blocked' };
  }
  return { ok: true };
}

/** Throw if the URL is unsafe. Convenience wrapper for tools. */
export function assertSafeUrl(rawUrl: string, opts: UrlSafetyOptions = {}): void {
  const r = checkUrlSafety(rawUrl, opts);
  if (!r.ok) throw new Error(`URL rejected: ${r.reason}`);
}

/** Match against fnmatch-lite: exact, or `*.suffix` (host endsWith suffix). */
function matchHostPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".foo.com"
    return host.endsWith(suffix) || host === suffix.slice(1);
  }
  return host === pattern;
}

/** Parse "a.b.c.d" → 32-bit int. null if not IPv4. */
function parseIPv4(s: string): number | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = parseInt(p, 10);
    if (n < 0 || n > 255) return null;
    acc = (acc << 8) >>> 0 | n;
  }
  return acc >>> 0;
}

function isInRange(ip: number, lo: string, hi: string): boolean {
  const a = parseIPv4(lo)!;
  const b = parseIPv4(hi)!;
  return ip >= a && ip <= b;
}
