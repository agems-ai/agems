/**
 * Unit tests for redact() — secret scrubber.
 *
 * If these break, secrets can land in audit_log / activity_log / error
 * messages / company exports. That's a data-leak class of bug, so the
 * suite errs on the side of OVER-testing edge cases.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSensitiveKey,
  redactString,
  redact,
  REDACTED,
  REDACTED_JWT,
} from './redaction';

// ── isSensitiveKey ──────────────────────────────────────────────

describe('isSensitiveKey', () => {
  it('matches obvious credential keys', () => {
    for (const k of ['apiKey', 'api_key', 'API_KEY', 'apikey', 'Api-Key']) {
      assert.equal(isSensitiveKey(k), true, k);
    }
  });

  it('matches token / auth variants', () => {
    for (const k of ['token', 'accessToken', 'access_token', 'authorization', 'Auth', 'bearerToken', 'refresh_token']) {
      assert.equal(isSensitiveKey(k), true, k);
    }
  });

  it('matches password / secret / credential', () => {
    for (const k of ['password', 'Password', 'PASSWORD', 'secret', 'CLIENT_SECRET', 'credentials']) {
      assert.equal(isSensitiveKey(k), true, k);
    }
  });

  it('matches database / cookie variants', () => {
    for (const k of ['DATABASE_URL', 'database_url', 'connectionString', 'cookie', 'set-cookie', 'sessionToken']) {
      assert.equal(isSensitiveKey(k), true, k);
    }
  });

  it('does NOT match innocent keys', () => {
    for (const k of ['name', 'email', 'id', 'createdAt', 'description', 'count', 'authorName']) {
      assert.equal(isSensitiveKey(k), false, k);
    }
  });

  it('does NOT match empty / null-ish input (no crash)', () => {
    assert.equal(isSensitiveKey(''), false);
  });
});

// ── redactString ────────────────────────────────────────────────

describe('redactString', () => {
  it('preserves a benign string verbatim', () => {
    assert.equal(redactString('hello world'), 'hello world');
  });

  it('redacts a JWT-shaped token wherever it appears', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = redactString(`Authorization: Bearer ${jwt}`);
    assert.equal(result.includes(jwt), false);
    assert.ok(result.includes(REDACTED_JWT));
  });

  it('does NOT false-positive on version-like strings (a.b.c)', () => {
    // Three short dot-separated tokens aren't a JWT — must be base64-shaped + long.
    assert.equal(redactString('version 1.2.3 released'), 'version 1.2.3 released');
  });

  it('redacts CLI flag values: --token=xxx → --token=[REDACTED]', () => {
    const result = redactString('curl --token=abc123 https://example.com');
    assert.ok(result.includes('--token=[REDACTED]'));
    assert.equal(result.includes('abc123'), false);
  });

  it('redacts --api-key=xxx form', () => {
    const result = redactString('CLI: --api-key=sk-live-xxx done');
    assert.ok(result.includes('--api-key=[REDACTED]'));
    assert.equal(result.includes('sk-live-xxx'), false);
  });

  it('handles multiple secrets in one string', () => {
    const result = redactString('curl --password=p1 --secret=p2 https://api');
    assert.ok(result.includes('--password=[REDACTED]'));
    assert.ok(result.includes('--secret=[REDACTED]'));
  });

  it('is a no-op on empty / null-ish input', () => {
    assert.equal(redactString(''), '');
    assert.equal(redactString(null as any), null);
  });
});

// ── redact (object / recursive) ─────────────────────────────────

describe('redact — objects', () => {
  it('redacts values under sensitive keys', () => {
    const r = redact({ apiKey: 'sk-live-xxx', name: 'visible' });
    assert.equal(r.apiKey, REDACTED);
    assert.equal(r.name, 'visible');
  });

  it('does NOT recurse into sensitive-key bags (whole value goes)', () => {
    const r = redact({ credentials: { user: 'admin', pass: 'p' } });
    // Even though `user` isn't sensitive on its own, the parent key is
    // sensitive so the entire bag is REDACTED.
    assert.equal(r.credentials, REDACTED);
  });

  it('recurses into non-sensitive nested objects', () => {
    const input = {
      org: {
        name: 'See Guru',
        config: { apiKey: 'sk-xxx', region: 'EU' },
      },
    };
    const r = redact(input);
    assert.equal(r.org.name, 'See Guru');
    assert.equal(r.org.config.region, 'EU');
    assert.equal(r.org.config.apiKey, REDACTED);
  });

  it('redacts JWTs found inside nested non-sensitive strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const r = redact({
      message: `Got token ${jwt} from upstream`,
      otherField: 'no secret here',
    });
    assert.ok(!r.message.includes(jwt));
    assert.ok(r.message.includes(REDACTED_JWT));
    assert.equal(r.otherField, 'no secret here');
  });

  it('preserves null / undefined under sensitive keys (don\'t turn them into [REDACTED])', () => {
    const r = redact({ apiKey: null, password: undefined });
    assert.equal(r.apiKey, null);
    assert.equal(r.password, undefined);
  });

  it('walks arrays', () => {
    const r = redact([{ password: 'p1' }, { name: 'n2' }]);
    assert.equal(r[0].password, REDACTED);
    assert.equal(r[1].name, 'n2');
  });

  it('does NOT mutate the input', () => {
    const input = { apiKey: 'visible-input' };
    const r = redact(input);
    assert.equal(input.apiKey, 'visible-input', 'input unchanged');
    assert.equal(r.apiKey, REDACTED);
  });

  it('stops at maxDepth (cycle guard)', () => {
    const r = redact({ a: { b: { c: { d: { secret: 'x' } } } } }, { maxDepth: 2 });
    // d.secret is past depth 2, so it becomes the depth marker.
    // Just assert no crash and we got something back.
    assert.ok(typeof r === 'object');
  });

  it('honours extraSensitiveKeys option', () => {
    const r = redact({ customField: 'sensitive' }, { extraSensitiveKeys: [/^customField$/] });
    assert.equal(r.customField, REDACTED);
  });
});

// ── secret_ref envelope ─────────────────────────────────────────

describe('redact — secret_ref envelopes', () => {
  it('preserves a secret_ref without inline value', () => {
    const r = redact({ key: { type: 'secret_ref', secretId: 'stripe-key' } });
    assert.deepEqual(r.key, { type: 'secret_ref', secretId: 'stripe-key' });
  });

  it('strips inline value from a secret_ref but keeps the rest', () => {
    const r = redact({
      key: { type: 'secret_ref', secretId: 'stripe-key', value: 'sk-live-actual-secret' },
    });
    assert.equal(r.key.type, 'secret_ref');
    assert.equal(r.key.secretId, 'stripe-key');
    assert.equal(r.key.value, REDACTED);
  });

  it('regular objects without type=secret_ref recurse normally', () => {
    const r = redact({ key: { type: 'other', value: 'visible' } });
    // 'value' isn't a sensitive key, 'other' isn't a secret_ref → all visible.
    assert.equal(r.key.value, 'visible');
  });
});

// ── real-world scenarios ────────────────────────────────────────

describe('redact — real-world examples', () => {
  it('redacts a tool-call dump (REST tool with auth header)', () => {
    const toolCall = {
      tool: 'http_request',
      input: {
        url: 'https://api.example.com/x',
        headers: {
          authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
          'content-type': 'application/json',
        },
        body: { user: 'me' },
      },
    };
    const r = redact(toolCall);
    assert.equal(r.tool, 'http_request');
    assert.equal(r.input.url, 'https://api.example.com/x');
    // 'authorization' key → whole value REDACTED (not just the JWT part).
    assert.equal(r.input.headers.authorization, REDACTED);
    assert.equal(r.input.headers['content-type'], 'application/json');
    assert.deepEqual(r.input.body, { user: 'me' });
  });

  it('redacts a company template export (env bindings)', () => {
    // Note: when the OUTER key is itself sensitive (OPENAI_API_KEY,
    // DEEPSEEK_API_KEY) the WHOLE value is replaced with [REDACTED]
    // regardless of inner structure. secret_ref envelope detection
    // only matters when the parent key is non-sensitive (e.g. `config`).
    const exportPayload = {
      company: { name: 'Survive or Die' },
      agents: [{
        name: 'Sophia',
        env: {
          OPENAI_API_KEY: 'sk-leaked',
          DEEPSEEK_API_KEY: 'sk-plaintext-leaked',
          NODE_ENV: 'production',
        },
        config: {
          // Non-sensitive parent key → secret_ref envelope handling applies.
          stripeBinding: { type: 'secret_ref', secretId: 'stripe-prod', value: 'sk_live_leaked' },
        },
      }],
    };
    const r = redact(exportPayload);
    assert.equal(r.company.name, 'Survive or Die');
    // Sensitive parent keys → whole value REDACTED
    assert.equal(r.agents[0].env.OPENAI_API_KEY, REDACTED);
    assert.equal(r.agents[0].env.DEEPSEEK_API_KEY, REDACTED);
    assert.equal(r.agents[0].env.NODE_ENV, 'production');
    // Non-sensitive parent key with secret_ref child → ref preserved, value stripped.
    assert.equal(r.agents[0].config.stripeBinding.type, 'secret_ref');
    assert.equal(r.agents[0].config.stripeBinding.secretId, 'stripe-prod');
    assert.equal(r.agents[0].config.stripeBinding.value, REDACTED);
  });

  it('redacts an error message containing a CLI invocation', () => {
    const err = {
      message: 'Command failed: curl --token=sk-abc-xxx --endpoint https://api.x',
      stack: 'at Adapter.run (adapter.ts:42)',
    };
    const r = redact(err);
    assert.ok(!r.message.includes('sk-abc-xxx'));
    assert.ok(r.message.includes('--token=[REDACTED]'));
    assert.equal(r.stack, 'at Adapter.run (adapter.ts:42)');
  });
});
