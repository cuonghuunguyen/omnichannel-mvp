// The full retrieval pipeline used by the search_knowledge tool:
//   1. rewrite the query (resolve follow-ups, expand keywords)
//   2. per bucket, run hybrid search: vector (pgvector `<=>`) + keyword (FTS)
//   3. fuse the ranked lists with Reciprocal Rank Fusion (RRF)
//   4. rerank the fused top candidates with an LLM and return the top K
//
// Buckets are embedded with their own pinned provider, so queries spanning
// buckets with different embedding dimensions are embedded once per distinct
// config and searched independently before fusion.
import { ensureRagSchema, ragQuery, toVectorLiteral } from "@/lib/rag/store";
import { getBucketEmbeddingConfigs } from "@/lib/rag/buckets";
import { getEmbeddingProvider, type EmbeddingConfig } from "@/lib/rag/embeddings";
import { rewriteQuery } from "@/lib/rag/query-rewrite";
import { llmReranker } from "@/lib/rag/rerank";
import type { RetrievedChunk } from "@/lib/rag/types";

/** Candidates pulled per (bucket × method) before fusion. */
const CANDIDATES_PER_LIST = 20;
/** Fused candidates handed to the reranker. */
const RERANK_POOL = 12;
/** RRF constant; dampens the influence of low ranks. */
const RRF_K = 60;

type ChunkRow = {
  id: string;
  document_id: string;
  bucket_id: string;
  content: string;
  metadata: Record<string, unknown>;
  document_title: string;
  document_source: string;
};

function toChunk(row: ChunkRow): Omit<RetrievedChunk, "score"> {
  return {
    id: row.id,
    documentId: row.document_id,
    bucketId: row.bucket_id,
    content: row.content,
    metadata: row.metadata ?? {},
    documentTitle: row.document_title,
    documentSource: row.document_source,
  };
}

const SELECT = `
  SELECT c.id, c.document_id, c.bucket_id, c.content, c.metadata,
         d.title AS document_title, d.source AS document_source
  FROM chunks c JOIN documents d ON d.id = c.document_id
`;

async function vectorSearch(bucketId: string, embedding: number[]): Promise<ChunkRow[]> {
  return ragQuery<ChunkRow>(
    `${SELECT}
     WHERE c.bucket_id = $2 AND c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $1::vector
     LIMIT $3`,
    [toVectorLiteral(embedding), bucketId, CANDIDATES_PER_LIST],
  );
}

async function keywordSearch(bucketId: string, text: string): Promise<ChunkRow[]> {
  return ragQuery<ChunkRow>(
    `${SELECT}, websearch_to_tsquery('english', $1) q
     WHERE c.bucket_id = $2 AND c.tsv @@ q
     ORDER BY ts_rank(c.tsv, q) DESC
     LIMIT $3`,
    [text, bucketId, CANDIDATES_PER_LIST],
  );
}

/** Reciprocal Rank Fusion: merge ranked lists into one score per chunk. */
function fuse(lists: ChunkRow[][]): RetrievedChunk[] {
  const scores = new Map<string, number>();
  const chunks = new Map<string, Omit<RetrievedChunk, "score">>();
  for (const list of lists) {
    list.forEach((row, rank) => {
      scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1));
      if (!chunks.has(row.id)) chunks.set(row.id, toChunk(row));
    });
  }
  return [...chunks.values()]
    .map((c) => ({ ...c, score: scores.get(c.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);
}

export type RetrieveOptions = {
  bucketIds: string[];
  /** The user's latest message (raw); rewriting happens inside. */
  query: string;
  /** Optional recent-conversation context for rewriting. */
  context?: string;
  topK?: number;
  /** Model used for query rewrite + reranking. */
  pipelineModel: string;
};

export async function retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const bucketIds = [...new Set(opts.bucketIds)].filter(Boolean);
  if (bucketIds.length === 0) return [];
  await ensureRagSchema();

  const topK = opts.topK ?? 5;
  const { query, keywords } = await rewriteQuery(opts.pipelineModel, opts.query, opts.context);
  const ftsText = [query, ...keywords].join(" ");

  // Embed the query once per distinct bucket embedding config.
  const configs = await getBucketEmbeddingConfigs(bucketIds);
  const embeddingByKey = new Map<string, number[]>();
  const keyOf = (c: EmbeddingConfig) => `${c.provider}:${c.model}`;
  await Promise.all(
    [...new Map([...configs.values()].map((c) => [keyOf(c), c])).values()].map(async (cfg) => {
      const [vec] = await getEmbeddingProvider(cfg).embed([query], "query");
      embeddingByKey.set(keyOf(cfg), vec);
    }),
  );

  // Hybrid search every bucket, collect all ranked lists for fusion.
  const lists: ChunkRow[][] = [];
  await Promise.all(
    bucketIds.map(async (bucketId) => {
      const cfg = configs.get(bucketId);
      if (!cfg) return;
      const embedding = embeddingByKey.get(keyOf(cfg));
      const [vec, kw] = await Promise.all([
        embedding ? vectorSearch(bucketId, embedding) : Promise.resolve([]),
        keywordSearch(bucketId, ftsText),
      ]);
      lists.push(vec, kw);
    }),
  );

  const fused = fuse(lists).slice(0, RERANK_POOL);
  if (fused.length === 0) return [];

  const rerank = llmReranker(opts.pipelineModel);
  return rerank(query, fused, topK);
}
