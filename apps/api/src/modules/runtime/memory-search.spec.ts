/**
 * Unit tests for memory_search token ranker.
 *
 * If these break, agents will get less-relevant memories returned for
 * their search queries — possibly hallucinating because they "remember"
 * the wrong thing. Easier to catch here than via integration tests.
 *
 * Run with: pnpm --filter @agems/api test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize,
  scoreEntry,
  rankMemories,
  type MemoryEntry,
} from './memory-search';

const baseDate = new Date('2026-05-13T10:00:00.000Z');

function entry(id: string, content: string, ageHours = 0): MemoryEntry {
  return {
    id,
    content,
    createdAt: new Date(baseDate.getTime() - ageHours * 3600_000),
  };
}

// ── tokenize ─────────────────────────────────────────────────────

describe('tokenize', () => {
  it('lowercases and splits on whitespace', () => {
    assert.deepEqual(tokenize('Hello World'), ['hello', 'world']);
  });

  it('strips punctuation', () => {
    // Note: 't' is dropped because MIN_TOKEN_LEN = 2 (single-char fragments
    // from apostrophe-splits are noise, not signal).
    assert.deepEqual(tokenize("don't, hello!"), ['don', 'hello']);
  });

  it('drops stopwords', () => {
    assert.deepEqual(tokenize('the quick brown fox'), ['quick', 'brown', 'fox']);
  });

  it('drops single-character fragments', () => {
    assert.deepEqual(tokenize('a b c hello'), ['hello']);
  });

  it('deduplicates tokens (a word twice = one token)', () => {
    assert.deepEqual(tokenize('budget budget budget'), ['budget']);
  });

  it('preserves digits', () => {
    assert.deepEqual(tokenize('order 42 placed'), ['order', '42', 'placed']);
  });

  it('handles cyrillic and other scripts', () => {
    // Stopwords list is English-only by design, so Russian content tokens survive.
    const out = tokenize('запомни клиента');
    assert.deepEqual(out, ['запомни', 'клиента']);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize('   '), []);
  });
});

// ── scoreEntry ───────────────────────────────────────────────────

describe('scoreEntry', () => {
  it('zero score when no tokens', () => {
    const r = scoreEntry('any content', 'any content', [], baseDate);
    assert.equal(r.score, 0);
    assert.deepEqual(r.matchedTokens, []);
  });

  it('one point per matched token', () => {
    const r = scoreEntry('the api key is sk-123', 'api key', ['api', 'key'], baseDate, baseDate);
    // Recency boost: ageMs = 0, recency = 1, +0.2.
    // Phrase bonus: 'api key' substring present, +0.5.
    // Match score: 2 tokens.
    // Total: 2 + 0.5 + 0.2 = 2.7
    assert.ok(Math.abs(r.score - 2.7) < 0.001, `got ${r.score}`);
    assert.deepEqual(r.matchedTokens.sort(), ['api', 'key']);
  });

  it('phrase bonus only when full phrase appears as substring', () => {
    // Tokens both match but the phrase order differs — no bonus.
    const r = scoreEntry('the key is for the api', 'api key', ['api', 'key'], baseDate, baseDate);
    // 2 tokens matched + recency 0.2 = 2.2 (no phrase bonus).
    assert.ok(Math.abs(r.score - 2.2) < 0.001, `got ${r.score}`);
  });

  it('recency boost decays linearly to 0 over 7 days', () => {
    // 3.5 days old → recency = 0.5 → boost = 0.1
    const halfWeekOld = new Date(baseDate.getTime() - 3.5 * 24 * 3600_000);
    const r = scoreEntry('foo bar', 'foo bar', ['foo'], halfWeekOld, baseDate);
    // Tokens=1, phrase bonus (phraseLower='foo bar' is in 'foo bar') = 0.5, recency = 0.1
    assert.ok(Math.abs(r.score - 1.6) < 0.001, `got ${r.score}`);
  });

  it('no recency boost for entries older than 7 days', () => {
    const eightDaysOld = new Date(baseDate.getTime() - 8 * 24 * 3600_000);
    const r = scoreEntry('foo bar', 'foo bar', ['foo'], eightDaysOld, baseDate);
    // 1 (token) + 0.5 (phrase) = 1.5, no recency
    assert.ok(Math.abs(r.score - 1.5) < 0.001, `got ${r.score}`);
  });

  it('case-insensitive matching (caller pre-lowercases)', () => {
    const r = scoreEntry('api key is sk-123', 'api', ['api'], baseDate, baseDate);
    assert.ok(r.score > 0);
    assert.deepEqual(r.matchedTokens, ['api']);
  });
});

// ── rankMemories ─────────────────────────────────────────────────

describe('rankMemories', () => {
  it('returns empty array for empty query', () => {
    const out = rankMemories([entry('m1', 'anything')], '', { now: baseDate });
    assert.deepEqual(out, []);
  });

  it('drops zero-score entries', () => {
    const entries = [
      entry('m1', 'api key info'),
      entry('m2', 'completely unrelated content'),
    ];
    const out = rankMemories(entries, 'api key', { now: baseDate });
    assert.equal(out.length, 1);
    assert.equal(out[0].entry.id, 'm1');
  });

  it('orders by descending score', () => {
    const entries = [
      entry('low',  'api documentation', 0),
      entry('high', 'api key documentation example', 0),
    ];
    const out = rankMemories(entries, 'api key documentation example', { now: baseDate });
    assert.equal(out[0].entry.id, 'high');
    assert.equal(out[1].entry.id, 'low');
  });

  it('ties broken by recency (newer wins)', () => {
    const entries = [
      entry('old',   'api key', 100),
      entry('newer', 'api key', 1),
    ];
    const out = rankMemories(entries, 'api key', { now: baseDate });
    assert.equal(out[0].entry.id, 'newer');
  });

  it('respects topK cap', () => {
    const entries = [
      entry('a', 'api'),
      entry('b', 'api'),
      entry('c', 'api'),
    ];
    const out = rankMemories(entries, 'api', { topK: 2, now: baseDate });
    assert.equal(out.length, 2);
  });

  it('preserves matchedTokens list per result', () => {
    const out = rankMemories(
      [entry('m1', 'the stripe webhook signature is hmac-sha256')],
      'stripe signature webhook',
      { now: baseDate },
    );
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].matchedTokens.sort(), ['signature', 'stripe', 'webhook']);
  });

  it('relevance over recency: an older perfect match beats a recent near-miss', () => {
    const entries = [
      entry('weak',   'api key info',                              0),    // 1 match, fresh
      entry('strong', 'stripe webhook hmac api key signature info', 100), // 3-4 matches, old
    ];
    const out = rankMemories(entries, 'stripe webhook signature', { now: baseDate });
    assert.equal(out[0].entry.id, 'strong');
  });

  it('handles bilingual content (English query + Russian memory)', () => {
    const entries = [
      entry('ru', 'webhook от stripe приходит на /api/webhook'),
      entry('unrelated', 'completely different content'),
    ];
    const out = rankMemories(entries, 'webhook stripe', { now: baseDate });
    assert.equal(out.length, 1);
    assert.equal(out[0].entry.id, 'ru');
  });
});
