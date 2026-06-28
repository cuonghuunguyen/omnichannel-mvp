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
import type { RetrievedChunk } from "@/lib/rag/types";

/** Candidates pulled per prefetch arm (dense / sparse) before fusion. */
const CANDIDATES_PER_LIST = 20;
/** Fused candidates handed to the reranker. */
const RERANK_POOL = 12;

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
};

export async function retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const bucketIds = [...new Set(opts.bucketIds)].filter(Boolean);
  if (bucketIds.length === 0) return [];

  const topK = opts.topK ?? 5;
  const { query, keywords } = await rewriteQuery(opts.pipelineModel, opts.query, opts.context);
  // Sparse arm searches on the query plus expansion keywords for wider recall.
  const sparse = sparseVector([query, ...keywords].join(" "));

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
  const tenantFilter = { must: [{ key: "tenant_id", match: { value: opts.tenantId } }] };

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
          filter: tenantFilter,
          limit: RERANK_POOL,
          with_payload: true,
        });
        return (res.points as QdrantPoint[]).map(toChunk);
      } catch (err) {
        // A missing collection (bucket with no ingested docs yet) or transient
        // error shouldn't fail the whole search — just contribute no hits.
        console.error(`[rag] search failed for bucket ${bucketId}:`, err);
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

  const rerank = llmReranker(opts.pipelineModel);
  return rerank(query, fused, topK);
}
