// The full retrieval pipeline used by the search_knowledge tool:
//   1. rewrite the query (resolve follow-ups, expand keywords)
//   2. per bucket, run Qdrant native hybrid search: a dense (semantic) and a
//      sparse (keyword/IDF) prefetch fused server-side with Reciprocal Rank
//      Fusion (RRF) — replacing the old pgvector `<=>` + Postgres FTS + the
//      hand-rolled RRF in this file.
//   3. merge the per-bucket results and rerank the top candidates with an LLM
//
// Buckets are embedded with their own pinned provider, so queries spanning
// buckets with different embedding dimensions are embedded once per distinct
// config and searched independently (each in its own collection) before merge.
import { collectionName, qdrantClient, DENSE, SPARSE } from "@/lib/rag/store";
import { getBucketEmbeddingConfigs } from "@/lib/rag/buckets";
import { getEmbeddingProvider, type EmbeddingConfig } from "@/lib/rag/embeddings";
import { sparseVector } from "@/lib/rag/sparse";
import { rewriteQuery } from "@/lib/rag/query-rewrite";
import { llmReranker } from "@/lib/rag/rerank";
import { applyRelevanceFloor, buildRetrievalFilter } from "@/lib/rag/retrieve-filter";
import type { RetrievedChunk } from "@/lib/rag/types";
import { logger } from "@/lib/logger";

/** Candidates pulled per prefetch arm (dense / sparse) before fusion. */
const CANDIDATES_PER_LIST = 20;
/** Fused candidates handed to the reranker. */
const RERANK_POOL = 12;
/**
 * Workspace-wide default relevance floor (0-1 reranker scale), overridable
 * per bucket via `Bucket.relevanceFloorOverride` (D-06). Env-configurable
 * since there's no eval harness to tune it against (RESEARCH Assumption A1);
 * manual tuning via RAG_RELEVANCE_FLOOR is the intended workflow.
 */
const DEFAULT_FLOOR = Number(process.env.RAG_RELEVANCE_FLOOR) || 0.3;

type QdrantPoint = {
  id: string | number;
  score?: number;
  payload?: Record<string, unknown> | null;
};

function toChunk(point: QdrantPoint): RetrievedChunk {
  const p = point.payload ?? {};
  return {
    id: String(point.id),
    documentId: String(p.document_id ?? ""),
    bucketId: String(p.bucket_id ?? ""),
    content: String(p.content ?? ""),
    metadata: (p.metadata as Record<string, unknown>) ?? {},
    documentTitle: String(p.document_title ?? ""),
    documentSource: String(p.document_source ?? ""),
    score: point.score ?? 0,
  };
}

export type RetrieveOptions = {
  /** Tenant that owns the buckets — foreign bucket ids resolve to nothing. */
  tenantId: string;
  bucketIds: string[];
  /** The user's latest message (raw); rewriting happens inside. */
  query: string;
  /** Optional recent-conversation context for rewriting. */
  context?: string;
  topK?: number;
  /** Model used for query rewrite + reranking. */
  pipelineModel: string;
  /**
   * Inline BYOK embedding key (from X-Embedding-Key header). When present,
   * merged into each bucket's embedding config so the tenant's key is used
   * for query embedding (KB-05 / D-04). Never logged or persisted.
   */
  embeddingApiKey?: string;
  /**
   * BYOK per-request provider key (from X-Provider-Key header), used for the
   * query-rewrite and rerank LLM calls in this pipeline. Never logged or persisted.
   */
  providerApiKey?: string;
  /** Restrict to chunks tagged with any of these (OR semantics, D-15). */
  tags?: string[];
  /** Restrict to chunks ingested at/after this ISO date/datetime. */
  dateFrom?: string;
  /** Restrict to chunks ingested at/before this ISO date/datetime. */
  dateTo?: string;
  /** Restrict to chunks with this exact source type (e.g. "text" | "file"). */
  sourceType?: string;
};

export async function retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const bucketIds = [...new Set(opts.bucketIds)].filter(Boolean);
  if (bucketIds.length === 0) return [];

  const topK = opts.topK ?? 5;
  const { query, keywords } = await rewriteQuery(
    opts.pipelineModel,
    opts.query,
    opts.context,
    opts.providerApiKey,
  );
  // Sparse arm searches on the query plus expansion keywords for wider recall.
  // Query-mode: raw counts, no BM25 saturation/length-norm (D-09 asymmetry —
  // saturating query-side TF the same way as document-side is an accuracy
  // regression for repeated query terms).
  const sparse = sparseVector([query, ...keywords].join(" "), { mode: "query" });

  // Embed the query once per distinct bucket embedding config. Scoped by tenant:
  // buckets outside the tenant return no config and are skipped below.
  // Pass the inline BYOK embedding key so the tenant's own key is used (D-04/KB-05).
  const configs = await getBucketEmbeddingConfigs(bucketIds, opts.tenantId, opts.embeddingApiKey);
  const embeddingByKey = new Map<string, number[]>();
  const keyOf = (c: EmbeddingConfig) => `${c.provider}:${c.model}`;
  await Promise.all(
    [...new Map([...configs.values()].map((c) => [keyOf(c), c])).values()].map(async (cfg) => {
      const [vec] = await getEmbeddingProvider(cfg).embed([query], "query");
      embeddingByKey.set(keyOf(cfg), vec);
    }),
  );

  const client = qdrantClient();
  // Defense-in-depth: the collection name already isolates tenants, but we also
  // filter on the tenant_id payload so a foreign id can never leak a hit.
  // Optional tags/sourceType/date filters (D-13/D-14/D-15) are appended into
  // this same `must` array — never a separate/replacing filter object
  // (security-critical, T-45-02).
  const filter = buildRetrievalFilter({
    tenantId: opts.tenantId,
    tags: opts.tags,
    sourceType: opts.sourceType,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
  });
  // Per-bucket relevance-floor override (D-06), resolved once alongside the
  // embedding configs so no extra DB round trip is needed at floor-filter time.
  const floorByBucket = new Map<string, number | null | undefined>(
    [...configs.entries()].map(([bucketId, cfg]) => [bucketId, cfg.relevanceFloorOverride]),
  );

  // Hybrid search every bucket (each its own collection), collect all hits.
  const perBucket = await Promise.all(
    bucketIds.map(async (bucketId) => {
      const cfg = configs.get(bucketId);
      if (!cfg) return [] as RetrievedChunk[];
      const dense = embeddingByKey.get(keyOf(cfg));
      if (!dense) return [] as RetrievedChunk[];
      try {
        const res = await client.query(collectionName(opts.tenantId, bucketId), {
          prefetch: [
            { query: dense, using: DENSE, limit: CANDIDATES_PER_LIST },
            ...(sparse
              ? [{ query: sparse, using: SPARSE, limit: CANDIDATES_PER_LIST }]
              : []),
          ],
          query: { fusion: "rrf" },
          filter,
          limit: RERANK_POOL,
          with_payload: true,
        });
        return (res.points as QdrantPoint[]).map(toChunk);
      } catch (err) {
        // A missing collection (bucket with no ingested docs yet) or transient
        // error shouldn't fail the whole search — just contribute no hits.
        logger.error({ err, bucketId }, `[rag] search failed for bucket ${bucketId}`);
        return [] as RetrievedChunk[];
      }
    }),
  );

  // Merge across buckets, dedupe by point id, keep the best fusion score.
  const merged = new Map<string, RetrievedChunk>();
  for (const chunk of perBucket.flat()) {
    const existing = merged.get(chunk.id);
    if (!existing || chunk.score > existing.score) merged.set(chunk.id, chunk);
  }
  const fused = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, RERANK_POOL);
  if (fused.length === 0) return [];

  const rerank = llmReranker(opts.pipelineModel, opts.providerApiKey);
  const reranked = await rerank(query, fused, topK);
  // Post-rerank quality gate (D-05): drop chunks below their bucket's
  // effective floor (override ?? env default). An all-below-floor result set
  // returns [] here, which search_knowledge already surfaces as a distinct
  // "no relevant knowledge found" empty state (D-08).
  return applyRelevanceFloor(reranked, floorByBucket, DEFAULT_FLOOR);
}
