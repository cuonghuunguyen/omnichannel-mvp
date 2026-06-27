// Lightweight sparse-vector encoder for the keyword half of Qdrant hybrid
// search. We tokenize text, hash each token to a u32 index, and emit term
// frequencies as the sparse values. The collection's `idf` modifier makes
// Qdrant apply the IDF weighting server-side at query time, giving BM25-style
// keyword scoring without an extra ML model or a Postgres FTS column.
//
// Document and query use the SAME tokenization so their hashed indices line up.

export type SparseVector = { indices: number[]; values: number[] };

// A small English stopword set — enough to keep very common words from
// dominating the sparse signal. Not exhaustive by design (cheap + good enough).
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has",
  "have", "i", "in", "is", "it", "its", "of", "on", "or", "that", "the", "to",
  "was", "were", "will", "with", "you", "your", "we", "they", "this", "these",
  "those", "do", "does", "did", "can", "could", "would", "should", "what",
  "when", "where", "which", "who", "how", "there", "their",
]);

/** Split into lowercased word tokens, dropping very short words and stopwords. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

/** FNV-1a 32-bit hash → stable unsigned index for a token (Qdrant needs u32). */
function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build a sparse vector from text: hashed-token index → term frequency.
 * Returns null when there are no usable tokens (caller skips the sparse arm).
 */
export function sparseVector(text: string): SparseVector | null {
  const counts = new Map<number, number>();
  for (const tok of tokenize(text)) {
    const idx = hashToken(tok);
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const indices: number[] = [];
  const values: number[] = [];
  for (const [idx, count] of counts) {
    indices.push(idx);
    values.push(count);
  }
  return { indices, values };
}
