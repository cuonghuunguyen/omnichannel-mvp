// Bucket + document CRUD and ingestion against the RAG store. A bucket pins one
// embedding provider+model+dimension; documents added to it are chunked,
// embedded with that provider, and stored for retrieval. Every read/write is
// scoped to a tenant so one tenant can never see or search another's knowledge.
import { randomUUID } from "node:crypto";
import { ensureRagSchema, ragQuery, ragTx, toVectorLiteral } from "@/lib/rag/store";
import {
  defaultEmbeddingConfig,
  dimensionsFor,
  getEmbeddingProvider,
  type EmbeddingConfig,
} from "@/lib/rag/embeddings";
import { chunkText } from "@/lib/rag/chunk";
import type { Bucket, EmbeddingProviderId, RagDocument } from "@/lib/rag/types";

type BucketRow = {
  id: string;
  name: string;
  description: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dim: number;
  created_at: Date;
  document_count?: string;
  chunk_count?: string;
};

function toBucket(row: BucketRow): Bucket {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    embeddingProvider: row.embedding_provider as EmbeddingProviderId,
    embeddingModel: row.embedding_model,
    embeddingDim: row.embedding_dim,
    createdAt: row.created_at.toISOString(),
    documentCount: row.document_count != null ? Number(row.document_count) : undefined,
    chunkCount: row.chunk_count != null ? Number(row.chunk_count) : undefined,
  };
}

export async function listBuckets(tenantId: string): Promise<Bucket[]> {
  await ensureRagSchema();
  const rows = await ragQuery<BucketRow>(
    `SELECT b.*,
      (SELECT count(*) FROM documents d WHERE d.bucket_id = b.id) AS document_count,
      (SELECT count(*) FROM chunks c WHERE c.bucket_id = b.id) AS chunk_count
     FROM buckets b
     WHERE b.tenant_id = $1
     ORDER BY b.created_at DESC`,
    [tenantId],
  );
  return rows.map(toBucket);
}

export async function getBucket(id: string, tenantId: string): Promise<Bucket | null> {
  await ensureRagSchema();
  const rows = await ragQuery<BucketRow>(
    `SELECT b.*,
      (SELECT count(*) FROM documents d WHERE d.bucket_id = b.id) AS document_count,
      (SELECT count(*) FROM chunks c WHERE c.bucket_id = b.id) AS chunk_count
     FROM buckets b WHERE b.id = $1 AND b.tenant_id = $2`,
    [id, tenantId],
  );
  return rows[0] ? toBucket(rows[0]) : null;
}

/**
 * Resolve only the embedding config buckets need at query time (cheap). Scoped
 * by tenant: buckets outside the tenant are simply not returned, so retrieval
 * over a foreign bucket id finds no config and searches nothing.
 */
export async function getBucketEmbeddingConfigs(
  ids: string[],
  tenantId: string,
): Promise<Map<string, EmbeddingConfig>> {
  if (ids.length === 0) return new Map();
  await ensureRagSchema();
  const rows = await ragQuery<BucketRow>(
    `SELECT * FROM buckets WHERE id = ANY($1::text[]) AND tenant_id = $2`,
    [ids, tenantId],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      { provider: r.embedding_provider as EmbeddingProviderId, model: r.embedding_model },
    ]),
  );
}

export async function createBucket(input: {
  tenantId: string;
  name: string;
  description?: string;
  provider?: EmbeddingProviderId;
  model?: string;
}): Promise<Bucket> {
  await ensureRagSchema();
  const fallback = defaultEmbeddingConfig();
  const provider = input.provider ?? fallback.provider;
  const model = input.model || (input.provider ? "" : fallback.model);
  const resolvedModel = model || fallback.model;
  const dim = dimensionsFor(provider, resolvedModel);
  const id = randomUUID();
  const rows = await ragQuery<BucketRow>(
    `INSERT INTO buckets (id, tenant_id, name, description, embedding_provider, embedding_model, embedding_dim)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      id,
      input.tenantId,
      input.name.trim(),
      input.description?.trim() ?? "",
      provider,
      resolvedModel,
      dim,
    ],
  );
  return toBucket(rows[0]);
}

export async function deleteBucket(id: string, tenantId: string): Promise<boolean> {
  await ensureRagSchema();
  const res = await ragQuery(
    `DELETE FROM buckets WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [id, tenantId],
  );
  return res.length > 0;
}

type DocumentRow = {
  id: string;
  bucket_id: string;
  title: string;
  source: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  chunk_count?: string;
};

function toDocument(row: DocumentRow): RagDocument {
  return {
    id: row.id,
    bucketId: row.bucket_id,
    title: row.title,
    source: row.source,
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
    chunkCount: row.chunk_count != null ? Number(row.chunk_count) : undefined,
  };
}

export async function listDocuments(
  bucketId: string,
  tenantId: string,
): Promise<RagDocument[]> {
  await ensureRagSchema();
  const rows = await ragQuery<DocumentRow>(
    `SELECT d.*, (SELECT count(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count
     FROM documents d WHERE d.bucket_id = $1 AND d.tenant_id = $2 ORDER BY d.created_at DESC`,
    [bucketId, tenantId],
  );
  return rows.map(toDocument);
}

export async function deleteDocument(id: string, tenantId: string): Promise<boolean> {
  await ensureRagSchema();
  const res = await ragQuery(
    `DELETE FROM documents WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [id, tenantId],
  );
  return res.length > 0;
}

/**
 * Ingest a document into a bucket: chunk → embed (with the bucket's provider) →
 * persist document + chunks in one transaction. Returns the document with its
 * chunk count. The bucket must belong to the given tenant.
 */
export async function ingestDocument(
  bucketId: string,
  tenantId: string,
  input: { title: string; source?: string; content: string; metadata?: Record<string, unknown> },
): Promise<RagDocument> {
  const bucket = await getBucket(bucketId, tenantId);
  if (!bucket) throw new Error("bucket not found");

  const chunks = chunkText(input.content);
  if (chunks.length === 0) throw new Error("document has no content to ingest");

  const provider = getEmbeddingProvider({
    provider: bucket.embeddingProvider,
    model: bucket.embeddingModel,
  });
  const embeddings = await provider.embed(chunks, "document");

  const docId = randomUUID();
  const metadata = input.metadata ?? {};

  await ragTx(async (client) => {
    await client.query(
      `INSERT INTO documents (id, tenant_id, bucket_id, title, source, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [docId, tenantId, bucketId, input.title.trim(), input.source?.trim() ?? "", metadata],
    );
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO chunks (id, tenant_id, document_id, bucket_id, idx, content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
        [
          randomUUID(),
          tenantId,
          docId,
          bucketId,
          i,
          chunks[i],
          metadata,
          toVectorLiteral(embeddings[i]),
        ],
      );
    }
  });

  return {
    id: docId,
    bucketId,
    title: input.title.trim(),
    source: input.source?.trim() ?? "",
    metadata,
    createdAt: new Date().toISOString(),
    chunkCount: chunks.length,
  };
}
