/**
 * Secret redaction for log lines, audit details, error messages, and
 * exports. Inspired by Paperclip's `server/src/redaction.ts`.
 *
 * The aim is "no secret ever lands in audit_log, n8n call dumps, or
 * exported company templates by accident". We can't catch everything —
 * a hand-rolled "MY_TOKEN=…" with no recognisable key still escapes —
 * but the common shapes are covered:
 *
 *   1. **Sensitive object keys** — case-insensitive name match (apikey,
 *      access_token, password, secret, credential, jwt, private_key,
 *      cookie, connectionstring, etc.). Value becomes "[REDACTED]".
 *   2. **JWTs** — three base64url segments separated by dots. Replaced
 *      with "[REDACTED_JWT]" regardless of where they appear.
 *   3. **`{type: "secret_ref", secretId}` envelopes** — kept structurally
 *      (the ref isn't the secret), but accompanying `value` field is
 *      cleared.
 *   4. **CLI flag args** — `--token VALUE` / `--api-key=VALUE` /
 *      `-X VALUE` patterns in strings. The flag stays, the value is
 *      [REDACTED].
 *
 * Pure module: no Nest, no Prisma, no Buffer except for short JWT regex.
 * Safe to call from anywhere (request loggers, exporters, error
 * formatters). Returns a NEW value — never mutates input.
 */

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /apikey/i,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /bearer[_-]?token/i,
  /session[_-]?token/i,
  /^token$/i,
  /tokens?$/i, // accessTokens, idToken, idTokens
  /authorization/i,
  /^auth$/i,
  /bearer/i,
  // No word-boundary around 'secret' — underscores are word chars in JS
  // regex, so /\bsecret\b/ does NOT match CLIENT_SECRET.
  /secret/i,
  /password/i,
  /credential/i,
  /^jwt$/i,
  /private[_-]?key/i,
  /^cookie$/i,
  /set[_-]?cookie/i,
  /connection[_-]?string/i,
  /database[_-]?url/i,
  /smtp[_-]?password/i,
];

/** Returns true if the field name matches any sensitive pattern. */
export function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  return SENSITIVE_KEY_PATTERNS.some(pat => pat.test(key));
}

/**
 * Match a JWT (three dot-separated base64url segments). We're deliberately
 * conservative: must be at least 20 chars total per segment to avoid
 * false positives on "a.b.c"-style strings.
 *
 * Regex notes: base64url alphabet is [A-Za-z0-9_-]; segments ≥ 6 chars
 * for header, ≥ 10 for payload, ≥ 10 for signature. Total ≥ ~30 chars
 * keeps it out of "version 1.2.3" territory.
 */
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

/** Match CLI-style flags with values: `--token=xxx`, `--api-key xxx`, `-T xxx`. */
const CLI_FLAG_INLINE_REGEX = /(--?(?:token|api[_-]?key|password|secret|auth)[a-z0-9_-]*)=([^\s]+)/gi;

export const REDACTED = '[REDACTED]';
export const REDACTED_JWT = '[REDACTED_JWT]';

/**
 * Redact known-secret patterns inside a string. Used for log lines,
 * tool-call dumps, error messages.
 */
export function redactString(input: string): string {
  if (!input || typeof input !== 'string') return input;
  let out = input;

  // 1. JWTs anywhere.
  out = out.replace(JWT_REGEX, REDACTED_JWT);

  // 2. Inline CLI flags with values: --token=xxx → --token=[REDACTED]
  out = out.replace(CLI_FLAG_INLINE_REGEX, (_match, flag) => `${flag}=${REDACTED}`);

  return out;
}

/**
 * Detect the `{type: "secret_ref", secretId, value?}` envelope used by
 * Paperclip-style portability exports. The ref ID is kept (it's just a
 * lookup key), but any inline `value` is stripped.
 */
function isSecretRef(value: unknown): value is { type: string; secretId?: string; value?: unknown } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as Record<string, unknown>).type === 'secret_ref';
}

export interface RedactOptions {
  /** Maximum recursion depth (default 10). Guards against deep cycles. */
  maxDepth?: number;
  /** Extra key patterns to consider sensitive in this call only. */
  extraSensitiveKeys?: RegExp[];
}

/**
 * Recursively redact an arbitrary value. Returns a NEW value — input is
 * never mutated.
 *
 * Strings: pattern-redacted.
 * Objects: sensitive keys have their values replaced; rest recurse.
 * Arrays: elements recurse.
 * Other primitives (number / boolean / null / undefined): returned as-is.
 *
 * Circular references are not detected; pass plain JSON-y data only.
 */
export function redact<T>(value: T, options: RedactOptions = {}): T {
  return redactInternal(value, options, options.maxDepth ?? 10) as T;
}

function redactInternal(value: unknown, options: RedactOptions, depthRemaining: number): unknown {
  if (depthRemaining < 0) return REDACTED;

  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(v => redactInternal(v, options, depthRemaining - 1));
  }

  // Object branch.
  if (isSecretRef(value)) {
    // Preserve the ref shape but strip inline value if present.
    const ref = value as Record<string, unknown>;
    const out: Record<string, unknown> = { type: 'secret_ref' };
    if (ref.secretId !== undefined) out.secretId = ref.secretId;
    if ('value' in ref) out.value = REDACTED;
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const sensitive = isSensitiveKey(key) || (options.extraSensitiveKeys ?? []).some(p => p.test(key));
    if (sensitive) {
      // For sensitive keys: redact the value entirely. Don't recurse —
      // we don't care about the shape of a credential bag.
      out[key] = v === null || v === undefined ? v : REDACTED;
    } else {
      out[key] = redactInternal(v, options, depthRemaining - 1);
    }
  }
  return out;
}
