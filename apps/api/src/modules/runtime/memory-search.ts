/**
 * Token-based memory ranking.
 *
 * Stopgap before pgvector lands: the existing memory_read just does
 * `content.includes(query.toLowerCase())` which gives the agent either
 * everything or nothing. This adds a tiny scoring pass so we can return
 * the top-K MOST RELEVANT entries instead of the first match.
 *
 * Score per entry:
 *   matchScore   = sum over tokens of: 1 if content contains token, 0 otherwise
 *   phraseBonus  = +0.5 if full query phrase appears (rewards exact match)
 *   recencyBoost = up to +0.2 for entries written in the last 7 days
 *   final        = matchScore + phraseBonus + recencyBoost
 *
 * Why not embeddings: requires (a) a Postgres extension we may not have
 * yet on prod, (b) an embeddings provider key, (c) backfill of historical
 * memory rows. This ranker is a ~50-line pure function that ships today
 * and lays the groundwork — the helper signature is compatible with a
 * future embeddings-backed version (same input, same output shape).
 */

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: Date;
}

export interface RankedMemory<T extends MemoryEntry = MemoryEntry> {
  entry: T;
  score: number;
  matchedTokens: string[];
}

/** Stopwords to drop from the query — too noisy to be useful for matching. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'or', 'but',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
  'do', 'does', 'did', 'has', 'have', 'had', 'can', 'could', 'will', 'would',
  'should', 'may', 'might', 'must', 'shall',
]);

const MIN_TOKEN_LEN = 2;
const PHRASE_BONUS = 0.5;
const MAX_RECENCY_BOOST = 0.2;
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Split a query string into searchable tokens: lowercase, drop punctuation,
 * drop stopwords and very short fragments. Returns unique tokens.
 */
export function tokenize(query: string): string[] {
  if (!query) return [];
  const raw = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ') // strip punctuation, keep letters/digits across scripts
    .split(/\s+/)
    .filter(t => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
  return Array.from(new Set(raw));
}

/**
 * Score one entry against a tokenized query.
 *
 * @param contentLower content pre-lowercased by caller (saves work across many entries)
 * @param phraseLower full original query lowercased (for phrase-match bonus); empty string skips bonus
 * @param tokens deduped query tokens
 * @param createdAt entry timestamp for recency boost
 * @param now reference time (defaults to Date.now())
 */
export function scoreEntry(
  contentLower: string,
  phraseLower: string,
  tokens: string[],
  createdAt: Date,
  now: Date = new Date(),
): { score: number; matchedTokens: string[] } {
  if (!contentLower || tokens.length === 0) return { score: 0, matchedTokens: [] };

  const matchedTokens: string[] = [];
  for (const t of tokens) {
    if (contentLower.includes(t)) matchedTokens.push(t);
  }

  // Zero matches → return zero score immediately. Bonuses (recency, phrase)
  // must NEVER promote a content-irrelevant entry: otherwise every recent
  // memory leaks into search results.
  if (matchedTokens.length === 0) return { score: 0, matchedTokens };

  let score = matchedTokens.length;

  // Phrase bonus: full query as a single substring.
  if (phraseLower && phraseLower.length >= MIN_TOKEN_LEN && contentLower.includes(phraseLower)) {
    score += PHRASE_BONUS;
  }

  // Recency boost: linear decay over the last 7 days.
  const ageMs = now.getTime() - createdAt.getTime();
  if (ageMs >= 0 && ageMs < RECENCY_WINDOW_MS) {
    const recency = 1 - ageMs / RECENCY_WINDOW_MS;
    score += recency * MAX_RECENCY_BOOST;
  }

  return { score, matchedTokens };
}

/**
 * Rank a list of memories against a query. Drops zero-score entries.
 * Stable sort: ties resolved by createdAt DESC (newer wins).
 */
export function rankMemories<T extends MemoryEntry>(
  entries: T[],
  query: string,
  options: { topK?: number; now?: Date } = {},
): RankedMemory<T>[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const phraseLower = query.toLowerCase().trim();
  const now = options.now ?? new Date();

  const ranked: RankedMemory<T>[] = [];
  for (const entry of entries) {
    const contentLower = entry.content.toLowerCase();
    const { score, matchedTokens } = scoreEntry(contentLower, phraseLower, tokens, entry.createdAt, now);
    if (score > 0) ranked.push({ entry, score, matchedTokens });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.createdAt.getTime() - a.entry.createdAt.getTime();
  });

  return options.topK ? ranked.slice(0, options.topK) : ranked;
}
