/**
 * Webhook signature verification for inbound TaskTrigger requests.
 *
 * Supports the two most common signing schemes:
 *
 *   1. **HMAC-SHA256 of raw body**, with the signature delivered as a hex
 *      digest in a header (default: `X-Signature` or `X-Hub-Signature-256`).
 *      Used by Stripe, GitHub, generic-webhook integrations.
 *
 *   2. **Bearer token equality** — a plain shared secret in
 *      `Authorization: Bearer <token>`. Lower security but useful for
 *      ad-hoc integrations.
 *
 * Pure module: takes raw bytes / strings, returns booleans. No HTTP
 * coupling — the controller pulls the body and headers and hands them in.
 *
 * All comparisons use `timingSafeEqual` so attackers can't probe the
 * secret one character at a time.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Strip an optional `sha256=` prefix some providers (GitHub, Slack) add to
 * their signature header.
 */
export function stripSchemePrefix(signature: string): string {
  if (signature.startsWith('sha256=')) return signature.slice(7);
  if (signature.startsWith('sha1=')) return signature.slice(5);
  return signature;
}

/**
 * Constant-time equality on two strings. Length mismatch returns false
 * before allocating buffers — `timingSafeEqual` itself requires equal
 * lengths, so this short-circuit is mandatory.
 */
export function safeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Verify an HMAC-SHA256 signature against a raw body + secret.
 * `providedSignature` may be hex with or without `sha256=` prefix.
 */
export function verifyHmacSignature(args: {
  body: string | Buffer;
  secret: string;
  providedSignature: string;
}): VerifyResult {
  if (!args.secret) return { ok: false, reason: 'no secret configured' };
  if (!args.providedSignature) return { ok: false, reason: 'no signature header' };

  const expected = createHmac('sha256', args.secret)
    .update(args.body)
    .digest('hex');
  const actual = stripSchemePrefix(args.providedSignature.trim());

  if (safeStringEquals(expected, actual)) return { ok: true };
  return { ok: false, reason: 'signature mismatch' };
}

/**
 * Verify a bearer token from `Authorization: Bearer <token>`.
 * `authHeader` is the raw header value.
 */
export function verifyBearerToken(args: {
  authHeader: string | undefined | null;
  expectedToken: string;
}): VerifyResult {
  if (!args.expectedToken) return { ok: false, reason: 'no token configured' };
  if (!args.authHeader) return { ok: false, reason: 'no Authorization header' };
  const match = /^Bearer\s+(\S+)$/i.exec(args.authHeader);
  if (!match) return { ok: false, reason: 'malformed Authorization header' };
  if (safeStringEquals(match[1], args.expectedToken)) return { ok: true };
  return { ok: false, reason: 'token mismatch' };
}

export type TriggerAuthKind = 'HMAC' | 'BEARER' | 'NONE';

export interface TriggerAuthConfig {
  kind: TriggerAuthKind;
  /** Shared secret for HMAC signing OR the bearer token value. */
  secret?: string;
  /** Optional header name override for HMAC scheme (default looks at
   *  X-Signature, X-Hub-Signature-256, X-Webhook-Signature). */
  signatureHeader?: string;
}

/**
 * Dispatch a trigger based on its configured auth kind.
 *
 * `headers` is a case-INSENSITIVE map (typically populated from
 * Express's req.headers, which is already lowercase-normalised).
 */
export function verifyTrigger(args: {
  config: TriggerAuthConfig;
  body: string | Buffer;
  headers: Record<string, string | string[] | undefined>;
}): VerifyResult {
  const { config, body, headers } = args;

  switch (config.kind) {
    case 'NONE':
      // Caller chose unauthenticated trigger. Document the risk loudly
      // — but allow it for internal-network setups.
      return { ok: true };

    case 'BEARER':
      return verifyBearerToken({
        authHeader: headerValue(headers, 'authorization'),
        expectedToken: config.secret ?? '',
      });

    case 'HMAC': {
      const headerKey = (config.signatureHeader ?? 'x-signature').toLowerCase();
      const fallbackKeys = ['x-hub-signature-256', 'x-webhook-signature'];
      const sig =
        headerValue(headers, headerKey) ??
        fallbackKeys.map(k => headerValue(headers, k)).find(v => !!v);
      return verifyHmacSignature({
        body,
        secret: config.secret ?? '',
        providedSignature: sig ?? '',
      });
    }

    default: {
      // Exhaustiveness check at the type level — runtime guard for bad
      // config rows (e.g. legacy DB value, malformed migration).
      const _exhaustive: never = config.kind;
      return { ok: false, reason: `unsupported auth kind: ${_exhaustive}` };
    }
  }
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}
