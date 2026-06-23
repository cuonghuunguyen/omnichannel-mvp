// A small in-memory cache for `search_knowledge` results, keyed per conversation
// and normalized query. Retrieval is expensive (rewrite LLM → embed → hybrid
// search → rerank LLM), and agents re-search on follow-ups / repeated questions
// because prior passages are never persisted into the transcript. Caching lets a
// repeated or near-identical ask in the same conversation skip the whole pipeline.
//
// This is a per-process cache: in a multi-instance deployment instances won't
// share it. That's acceptable — it's a cost optimization, not a correctness
// requirement (a cold instance simply re-runs retrieval and gets the same answer).
import type { RetrievedChunk } from "@/lib/rag/types";

/** How long a cached result stays valid. */
const TTL_MS = 5 * 60 * 1000;
/** Hard cap on entries; oldest are evicted first to bound memory. */
const MAX_ENTRIES = 500;

type Entry = { chunks: RetrievedChunk[]; expiresAt: number };

const cache = new Map<string, Entry>();

/** Lowercase, trim, and collapse whitespace so trivially-different re-asks collide. */
function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export type CacheKeyParts = {
  tenantId: string;
  conversationId: string;
  bucketIds: string[];
  topK: number;
  query: string;
};

/** Build a stable cache key. Bucket set is order-independent. */
export function cacheKey(parts: CacheKeyParts): string {
  const buckets = [...new Set(parts.bucketIds)].sort().join(",");
  return [
    parts.tenantId,
    parts.conversationId,
    buckets,
    String(parts.topK),
    normalize(parts.query),
  ].join("|");
}

/** Return cached chunks for `key`, or null on miss / expiry. */
export function getCachedChunks(key: string): RetrievedChunk[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.chunks;
}

/** Store chunks for `key`, evicting the oldest entry if at capacity. */
export function setCachedChunks(key: string, chunks: RetrievedChunk[]): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { chunks, expiresAt: Date.now() + TTL_MS });
}
