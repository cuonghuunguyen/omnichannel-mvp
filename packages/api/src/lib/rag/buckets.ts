// Bucket + document CRUD and ingestion. The relational registry (buckets,
// documents, counts) lives in the app's Prisma DB; the chunk vectors live in
// each bucket's Qdrant collection. A bucket pins one embedding
// provider+model+dimension; documents added to it are chunked, embedded with
// that provider, and upserted as points. Every read/write is scoped to a tenant
// so one tenant can never see or search another's knowledge.
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  collectionName,
  dropBucketCollection,
  ensureBucketCollection,
  qdrantClient,
  DENSE,
  SPARSE,
} from "@/lib/rag/store";
import { sparseVector } from "@/lib/rag/sparse";
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
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDim: number;
  createdAt: Date;
};

function toBucket(row: BucketRow, counts?: { docs: number; chunks: number }): Bucket {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    embeddingProvider: row.embeddingProvider as EmbeddingProviderId,
    embeddingModel: row.embeddingModel,
    embeddingDim: row.embeddingDim,
    createdAt: row.createdAt.toISOString(),
    documentCount: counts?.docs,
    chunkCount: counts?.chunks,
  };
}

export async function listBuckets(tenantId: string): Promise<Bucket[]> {
  const buckets = await db.bucket.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  // One grouped query for all of this tenant's document/chunk counts.
  const agg = await db.document.groupBy({
    by: ["bucketId"],
    where: { tenantId },
    _count: { _all: true },
    _sum: { chunkCount: true },
  });
  const byBucket = new Map(
    agg.map((a) => [a.bucketId, { docs: a._count._all, chunks: a._sum.chunkCount ?? 0 }]),
  );
  return buckets.map((b) => toBucket(b, byBucket.get(b.id) ?? { docs: 0, chunks: 0 }));
}

export async function getBucket(id: string, tenantId: string): Promise<Bucket | null> {
  const bucket = await db.bucket.findFirst({ where: { id, tenantId } });
  if (!bucket) return null;
  const agg = await db.document.aggregate({
    where: { bucketId: id, tenantId },
    _count: { _all: true },
    _sum: { chunkCount: true },
  });
  return toBucket(bucket, { docs: agg._count._all, chunks: agg._sum.chunkCount ?? 0 });
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
  const rows = await db.bucket.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, embeddingProvider: true, embeddingModel: true },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      { provider: r.embeddingProvider as EmbeddingProviderId, model: r.embeddingModel },
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
  const fallback = defaultEmbeddingConfig();
  const provider = input.provider ?? fallback.provider;
  const model = input.model || (input.provider ? "" : fallback.model);
  const resolvedModel = model || fallback.model;
  const dim = dimensionsFor(provider, resolvedModel);
  const bucket = await db.bucket.create({
    data: {
      tenantId: input.tenantId,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      embeddingProvider: provider,
      embeddingModel: resolvedModel,
      embeddingDim: dim,
    },
  });
  // Create the Qdrant collection up front so the bucket is searchable even
  // before its first document is ingested.
  await ensureBucketCollection(input.tenantId, bucket.id, dim);
  return toBucket(bucket, { docs: 0, chunks: 0 });
}

export async function deleteBucket(id: string, tenantId: string): Promise<boolean> {
  const bucket = await db.bucket.findFirst({ where: { id, tenantId } });
  if (!bucket) return false;
  await db.bucket.delete({ where: { id } }); // cascades documents in Prisma
  // Drop the whole collection; ignore if it was never created.
  await dropBucketCollection(tenantId, id).catch(() => {});
  return true;
}

type DocumentRow = {
  id: string;
  bucketId: string;
  title: string;
  source: string;
  metadata: string;
  chunkCount: number;
  createdAt: Date;
};

function toDocument(row: DocumentRow): RagDocument {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    bucketId: row.bucketId,
    title: row.title,
    source: row.source,
    metadata,
    createdAt: row.createdAt.toISOString(),
    chunkCount: row.chunkCount,
  };
}

export async function listDocuments(
  bucketId: string,
  tenantId: string,
): Promise<RagDocument[]> {
  const rows = await db.document.findMany({
    where: { bucketId, tenantId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDocument);
}

export async function deleteDocument(id: string, tenantId: string): Promise<boolean> {
  const doc = await db.document.findFirst({ where: { id, tenantId } });
  if (!doc) return false;
  await db.document.delete({ where: { id } });
  // Remove the document's chunk points from its bucket's collection.
  await qdrantClient()
    .delete(collectionName(tenantId, doc.bucketId), {
      wait: true,
      filter: { must: [{ key: "document_id", match: { value: id } }] },
    })
    .catch(() => {});
  return true;
}

/**
 * Ingest a document into a bucket: chunk → embed (with the bucket's provider) →
 * persist the document row + upsert chunk points into Qdrant. Returns the
 * document with its chunk count. The bucket must belong to the given tenant.
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

  await ensureBucketCollection(tenantId, bucketId, bucket.embeddingDim);

  const docId = randomUUID();
  const metadata = input.metadata ?? {};
  const title = input.title.trim();
  const source = input.source?.trim() ?? "";

  // Registry row first (so a listing reflects the document), then the vectors.
  await db.document.create({
    data: {
      id: docId,
      tenantId,
      bucketId,
      title,
      source,
      metadata: JSON.stringify(metadata),
      chunkCount: chunks.length,
    },
  });

  const points = chunks.map((content, i) => {
    const sparse = sparseVector(content);
    return {
      id: randomUUID(),
      vector: {
        [DENSE]: embeddings[i],
        ...(sparse ? { [SPARSE]: sparse } : {}),
      },
      payload: {
        tenant_id: tenantId,
        bucket_id: bucketId,
        document_id: docId,
        idx: i,
        content,
        metadata,
        document_title: title,
        document_source: source,
      },
    };
  });
  await qdrantClient().upsert(collectionName(tenantId, bucketId), { wait: true, points });

  return {
    id: docId,
    bucketId,
    title,
    source,
    metadata,
    createdAt: new Date().toISOString(),
    chunkCount: chunks.length,
  };
}
