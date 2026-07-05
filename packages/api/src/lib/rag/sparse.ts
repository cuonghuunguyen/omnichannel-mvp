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

// BM25 term-frequency saturation constants (fixed defaults, D-11). Qdrant's own
// `idf` collection modifier (already configured in store.ts) supplies the IDF
// half of BM25 server-side at query time — this module only ever computes the
// TF component (D-09: TF-only client-side fix, split-responsibility BM25).
const K1 = 1.2;
const B = 0.75;

/**
 * Build a sparse vector from text: hashed-token index → term-frequency value.
 *
 * Mode-aware (D-09/D-11), mirroring Qdrant's own `embed_query`/`embed_document`
 * asymmetry:
 * - "document" (default avgDocLen missing/≤0 bootstraps to the doc's own
 *   length, neutralizing length-norm to 1 rather than dividing by zero):
 *   k1/b-saturated, length-normalized TF — the classic Okapi BM25 TF term.
 * - "query" (default): raw integer term counts, no saturation/length-norm —
 *   queries are short, so saturating them adds no value.
 *
 * Returns null when there are no usable tokens (caller skips the sparse arm).
 */
export function sparseVector(
  text: string,
  opts: { mode: "query" | "document"; avgDocLen?: number } = { mode: "query" },
): SparseVector | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  const counts = new Map<number, number>();
  for (const tok of tokens) {
    const idx = hashToken(tok);
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }
  const indices: number[] = [];
  const values: number[] = [];
  const docLen = tokens.length;
  // Bootstrap: if the bucket has no prior corpus stat yet, neutralize length-norm
  // (avgLen = docLen makes the length-norm term equal 1) rather than dividing by 0.
  const avgLen =
    opts.mode === "document"
      ? opts.avgDocLen && opts.avgDocLen > 0
        ? opts.avgDocLen
        : docLen || 1
      : 1;
  for (const [idx, tf] of counts) {
    indices.push(idx);
    if (opts.mode === "document") {
      // Saturated, length-normalized TF (the BM25 "TF component").
      values.push((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLen / avgLen))));
    } else {
      // Query-side: raw term frequency, no saturation/length-norm — mirrors
      // Qdrant's own Qdrant/bm25 FastEmbed model's embed_query vs embed_document
      // distinction (queries are short; saturating them adds no value and
      // deviates from classic Robertson/Sparck-Jones BM25 query-term treatment).
      values.push(tf);
    }
  }
  return { indices, values };
}
