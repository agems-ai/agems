/**
 * LLM-provider error classifier — Hermes pattern (`agent/error_classifier.py`).
 *
 * Today every adapter (runner.ts, claude-code, codex, openai, etc.)
 * does its own ad-hoc string-matching on error messages: "is this a
 * rate-limit?", "did we run out of context?", "should we retry?". This
 * is brittle, scatter-shot, and silently wrong when a provider changes
 * its error text.
 *
 * Classifier returns a structured `ClassifiedError` with intent flags:
 *   retryable          - safe to immediately retry (with backoff)
 *   shouldCompress     - context overflowed; compress and retry
 *   shouldRotateKey    - credential is bad; switch to a fallback key
 *   shouldFallbackModel- model unavailable; downgrade to fallback model
 *
 * Causes (FailoverReason taxonomy):
 *   AUTH              wrong/expired/missing api key
 *   BILLING           quota exhausted, payment required
 *   RATE_LIMIT        transient 429
 *   OVERLOADED        provider is overloaded but the key is fine
 *   CONTEXT_OVERFLOW  prompt too long
 *   MODEL_NOT_FOUND   model deprecated / not available on this key
 *   THINKING_SIGNATURE Anthropic thinking-signature mismatch
 *   PROVIDER_DOWN     network / 5xx
 *   TIMEOUT           our wall-clock timeout fired
 *   IMAGE_TOO_LARGE   multimodal payload rejected
 *   UNKNOWN           none matched
 *
 * Pure module. Takes string + status, returns classified result.
 * Adapters call it once on catch; runner.ts retry loop dispatches on
 * the flags.
 */

export type FailoverReason =
  | 'AUTH'
  | 'BILLING'
  | 'RATE_LIMIT'
  | 'OVERLOADED'
  | 'CONTEXT_OVERFLOW'
  | 'MODEL_NOT_FOUND'
  | 'THINKING_SIGNATURE'
  | 'PROVIDER_DOWN'
  | 'TIMEOUT'
  | 'IMAGE_TOO_LARGE'
  | 'UNKNOWN';

export interface ClassifiedError {
  cause: FailoverReason;
  /** Original error message, lower-cased for caller convenience. */
  message: string;
  /** HTTP status when known (-1 = not HTTP). */
  status: number;
  retryable: boolean;
  shouldCompress: boolean;
  shouldRotateKey: boolean;
  shouldFallbackModel: boolean;
  /** Suggested backoff ms hint (caller may multiply by attempt). */
  retryAfterMs?: number;
}

export interface ClassifyInput {
  /** Error message — caller passes raw, we lowercase. */
  message?: string | null;
  /** HTTP status code from the failed request, if any. */
  status?: number;
  /** retry-after header value (seconds), if provider returned one. */
  retryAfterSeconds?: number;
}

const RX = {
  AUTH:    /\b(invalid api key|incorrect api key|unauthorized|unauthenticated|api key not valid|expired token|x-api-key)\b/i,
  BILLING: /\b(insufficient quota|insufficient credits|billing|exceeded.*quota|payment required|out of credits|account.*disabled|quota_exceeded|billing_hard_limit)\b/i,
  RATE_LIMIT: /\b(rate.?limit|too many requests|rate exceeded|429)\b/i,
  OVERLOADED: /\b(overloaded|service unavailable|capacity|busy|model.*overloaded|server.*overload)\b/i,
  CONTEXT_OVERFLOW: /\b(context.*length|context.*window|maximum.*tokens|prompt.*too long|tokens?.*exceeded|context_length_exceeded|max_tokens.*exceeded)\b/i,
  MODEL_NOT_FOUND: /\b(model.*not found|model.*does not exist|model_not_found|unknown model|invalid model|model.*deprecated)\b/i,
  THINKING_SIGNATURE: /\b(thinking.*signature|invalid.*signature.*thinking|signature_invalid)\b/i,
  TIMEOUT: /\b(timeout|timed out|aborted|deadline exceeded|etimedout)\b/i,
  IMAGE_TOO_LARGE: /\b(image too large|file too large|payload too large|image dimensions|max image|413)\b/i,
};

/**
 * Classify a provider error message + optional HTTP status into a
 * ClassifiedError. Pattern order matters — more specific patterns
 * come first.
 */
export function classifyError(input: ClassifyInput): ClassifiedError {
  const message = (input.message ?? '').toString();
  const lower = message.toLowerCase();
  const status = input.status ?? -1;

  // Status-code fast paths.
  if (status === 401 || status === 403) {
    return classified('AUTH', lower, status, { shouldRotateKey: true, retryable: false });
  }
  if (status === 402) {
    return classified('BILLING', lower, status, { retryable: false });
  }
  if (status === 429) {
    return classified('RATE_LIMIT', lower, status, { retryable: true, retryAfterMs: (input.retryAfterSeconds ?? 30) * 1000 });
  }
  if (status === 413) {
    return classified('IMAGE_TOO_LARGE', lower, status, { retryable: false });
  }
  if (status === 503 || status === 502 || status === 504) {
    return classified('PROVIDER_DOWN', lower, status, { retryable: true, retryAfterMs: (input.retryAfterSeconds ?? 5) * 1000 });
  }

  // Pattern-based — order from most-specific to least.
  if (RX.AUTH.test(lower))               return classified('AUTH', lower, status, { shouldRotateKey: true, retryable: false });
  if (RX.BILLING.test(lower))            return classified('BILLING', lower, status, { retryable: false });
  if (RX.THINKING_SIGNATURE.test(lower)) return classified('THINKING_SIGNATURE', lower, status, { retryable: true });
  if (RX.CONTEXT_OVERFLOW.test(lower))   return classified('CONTEXT_OVERFLOW', lower, status, { shouldCompress: true, retryable: true });
  if (RX.MODEL_NOT_FOUND.test(lower))    return classified('MODEL_NOT_FOUND', lower, status, { shouldFallbackModel: true, retryable: false });
  if (RX.RATE_LIMIT.test(lower))         return classified('RATE_LIMIT', lower, status, { retryable: true, retryAfterMs: (input.retryAfterSeconds ?? 30) * 1000 });
  if (RX.OVERLOADED.test(lower))         return classified('OVERLOADED', lower, status, { retryable: true, retryAfterMs: 10_000 });
  if (RX.IMAGE_TOO_LARGE.test(lower))    return classified('IMAGE_TOO_LARGE', lower, status, { retryable: false });
  if (RX.TIMEOUT.test(lower))            return classified('TIMEOUT', lower, status, { retryable: true });

  return classified('UNKNOWN', lower, status, { retryable: false });
}

function classified(
  cause: FailoverReason,
  message: string,
  status: number,
  flags: Partial<Pick<ClassifiedError, 'retryable' | 'shouldCompress' | 'shouldRotateKey' | 'shouldFallbackModel' | 'retryAfterMs'>>,
): ClassifiedError {
  return {
    cause,
    message,
    status,
    retryable: flags.retryable ?? false,
    shouldCompress: flags.shouldCompress ?? false,
    shouldRotateKey: flags.shouldRotateKey ?? false,
    shouldFallbackModel: flags.shouldFallbackModel ?? false,
    ...(flags.retryAfterMs !== undefined && { retryAfterMs: flags.retryAfterMs }),
  };
}

/** Convenience: pull a numeric retry-after header (seconds) from a
 *  response. Handles "120" and "Wed, 21 Oct 2026 07:28:00 GMT" forms. */
export function parseRetryAfter(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum >= 0) return asNum;
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  }
  return undefined;
}
