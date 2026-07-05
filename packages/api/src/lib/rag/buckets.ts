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
import { sparseVector, tokenize } from "@/lib/rag/sparse";
import {
  dimensionsFor,
  getEmbeddingProvider,
  isMultimodalProvider,
  PROVIDER_DEFAULTS,
  type EmbeddingConfig,
} from "@/lib/rag/embeddings";
import { resolveAutoEmbedding } from "@/lib/rag/resolve";
import { chunkDocument, type Chunk, type ChunkStrategy } from "@/lib/rag/chunk";
import { extractFile, type ExtractedImage } from "@/lib/rag/extract";
import { imageToText } from "@/lib/rag/extract/vision";
import { contentHash } from "@/lib/rag/dedup";
import { nextAvgChunkLength } from "@/lib/rag/ingest-stats";
import { DuplicateDocumentError } from "@/lib/rag/errors";
import type { Bucket, EmbeddingProviderId, RagDocument } from "@/lib/rag/types";

/** An image to embed natively into a multimodal bucket, plus its display text. */
type ImageUnit = { image: ExtractedImage; text: string };

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
 * A bucket's embedding config plus the extra per-bucket stats retrieval/reindex
 * need at query time: the relevance-floor override (plan 45-04) and the
 * current BM25 length-norm average (plan 45-05 reindex, document-mode encoding).
 */
export type BucketEmbeddingConfig = EmbeddingConfig & {
  relevanceFloorOverride: number | null;
  avgChunkLength: number;
};

/**
 * Resolve only the embedding config buckets need at query time (cheap). Scoped
 * by tenant: buckets outside the tenant are simply not returned, so retrieval
 * over a foreign bucket id finds no config and searches nothing.
 *
 * @param embeddingApiKey - Optional inline BYOK embedding key (from X-Embedding-Key
 *   header). When provided, spread onto each config's `apiKey` field so the
 *   tenant's key is used instead of any shared env key (D-04).
 */
export async function getBucketEmbeddingConfigs(
  ids: string[],
  tenantId: string,
  embeddingApiKey?: string,
): Promise<Map<string, BucketEmbeddingConfig>> {
  if (ids.length === 0) return new Map();
  const rows = await db.bucket.findMany({
    where: { id: { in: ids }, tenantId },
    select: {
      id: true,
      embeddingProvider: true,
      embeddingModel: true,
      relevanceFloorOverride: true,
      avgChunkLength: true,
    },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        provider: r.embeddingProvider as EmbeddingProviderId,
        model: r.embeddingModel,
        relevanceFloorOverride: r.relevanceFloorOverride,
        avgChunkLength: r.avgChunkLength,
        ...(embeddingApiKey ? { apiKey: embeddingApiKey } : {}),
      },
    ]),
  );
}

export async function createBucket(input: {
  tenantId: string;
  name: string;
  description?: string;
  /** A concrete provider, or "auto" to pick the best available from config. */
  provider?: EmbeddingProviderId | "auto";
  model?: string;
  /**
   * Inline BYOK embedding key from the request (X-Embedding-Key). Carried here
   * for D-04 enforcement: if the bucket pins a non-local provider and no inline
   * key is present, callers should not proceed to embed. The key is NOT stored
   * in the bucket record — it is an inline per-request secret (D-02).
   */
  embeddingApiKey?: string;
}): Promise<Bucket> {
  let provider: EmbeddingProviderId;
  let resolvedModel: string;
  if (!input.provider || input.provider === "auto") {
    // Auto-detect the embedding algorithm from what's configured, unless a model
    // was given explicitly (then honor the system default provider for it).
    const auto = resolveAutoEmbedding();
    provider = auto.provider;
    resolvedModel = input.model || auto.model;
  } else {
    provider = input.provider;
    resolvedModel = input.model || PROVIDER_DEFAULTS[provider].model;
  }
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
 * Embedding input for a chunk: the structural context (doc title + heading path)
 * is prepended so the embedder sees a self-contained passage ("contextual
 * retrieval"), but the raw chunk text is what we store + show in citations.
 */
function embedInput(title: string, chunk: Chunk): string {
  const ctx = [title.trim(), chunk.context].filter(Boolean).join(" › ");
  return ctx ? `${ctx}\n\n${chunk.content}` : chunk.content;
}

/**
 * Shared ingestion tail: embed chunks with the bucket's provider, persist the
 * document registry row, and upsert the chunk points into Qdrant. Both text and
 * file ingestion funnel through here so chunking/embedding/storage stay in sync.
 */
async function storeDocument(args: {
  bucket: Bucket;
  tenantId: string;
  bucketId: string;
  title: string;
  source: string;
  metadata: Record<string, unknown>;
  chunks: Chunk[];
  /** Images embedded natively (multimodal buckets only). */
  images?: ImageUnit[];
  /**
   * Raw pre-chunk text (the extracted document body). Hashed for exact-match
   * content dedup within the bucket (D-01/D-02/D-03/D-04) before any embed call.
   */
  rawText: string;
  /**
   * Inline BYOK embedding key (from X-Embedding-Key header). Passed into the
   * EmbeddingConfig so the tenant's own key is used for the embed call (D-02/D-04).
   * Never logged or persisted here.
   */
  embeddingApiKey?: string;
}): Promise<RagDocument> {
  const { bucket, tenantId, bucketId, title, source, metadata, rawText } = args;
  const chunks = args.chunks;
  const images = args.images ?? [];
  if (chunks.length === 0 && images.length === 0) {
    throw new Error("document has no content to ingest");
  }

  // Content-hash dedup: bucket-scoped, checked before any embed cost is
  // incurred (D-01/D-02/D-03/D-04). The same content is still ingestable into
  // a different bucket since the lookup is scoped by bucketId.
  const hash = contentHash(rawText);
  const existingDoc = await db.document.findFirst({ where: { bucketId, contentHash: hash } });
  if (existingDoc) {
    throw new DuplicateDocumentError(existingDoc.id, existingDoc.title);
  }

  // Resolve the bucket's current BM25 length-norm stat + total prior chunk
  // count once per call — used for document-mode sparse encoding below and to
  // fold this ingest's chunk lengths into the running average after upsert
  // (D-10/D-11). Read directly (not via the Bucket type) since avgChunkLength
  // isn't part of that shared shape.
  const bucketStats = await db.bucket.findUnique({
    where: { id: bucketId },
    select: { avgChunkLength: true },
  });
  const prevAvgChunkLength = bucketStats?.avgChunkLength ?? 0;
  const avgDocLen = prevAvgChunkLength > 0 ? prevAvgChunkLength : undefined;
  const priorAgg = await db.document.aggregate({
    where: { bucketId },
    _sum: { chunkCount: true },
  });
  const prevChunkCount = priorAgg._sum.chunkCount ?? 0;

  const provider = getEmbeddingProvider({
    provider: bucket.embeddingProvider,
    model: bucket.embeddingModel,
    ...(args.embeddingApiKey ? { apiKey: args.embeddingApiKey } : {}),
  });

  // Text chunks (context-prefixed) and images each embed into the same space.
  const textEmbeddings = await provider.embed(
    chunks.map((c) => embedInput(title, c)),
    "document",
  );
  const imageEmbeddings =
    images.length && provider.embedMultimodal
      ? await provider.embedMultimodal(
          images.map((u) => ({
            type: "image" as const,
            data: u.image.data.toString("base64"),
            mediaType: u.image.mediaType,
          })),
          "document",
        )
      : [];

  await ensureBucketCollection(tenantId, bucketId, bucket.embeddingDim);

  const totalPoints = chunks.length + imageEmbeddings.length;
  const docId = randomUUID();
  // Registry row first (so a listing reflects the document), then the vectors.
  await db.document.create({
    data: {
      id: docId,
      tenantId,
      bucketId,
      title,
      source,
      metadata: JSON.stringify(metadata),
      chunkCount: totalPoints,
      contentHash: hash,
    },
  });

  const ingestedAt = new Date().toISOString();

  const point = (
    idx: number,
    embedding: number[],
    content: string,
    extra: Record<string, unknown>,
  ) => {
    const sparse = sparseVector(content, { mode: "document", avgDocLen });
    return {
      id: randomUUID(),
      vector: { [DENSE]: embedding, ...(sparse ? { [SPARSE]: sparse } : {}) },
      payload: {
        tenant_id: tenantId,
        bucket_id: bucketId,
        document_id: docId,
        idx,
        content,
        metadata,
        document_title: title,
        document_source: source,
        // Promoted top-level keys (D-13/D-16) so retrieval/filtering can query
        // them directly without reaching into the nested `metadata` blob.
        tags: (metadata.tags as string[] | undefined) ?? [],
        source_type: (metadata.sourceType as string | undefined) ?? null,
        ingested_at: ingestedAt,
        content_hash: hash,
        ...extra,
      },
    };
  };

  const points = [
    ...chunks.map((chunk, i) =>
      point(i, textEmbeddings[i], chunk.content, chunk.context ? { context: chunk.context } : {}),
    ),
    ...imageEmbeddings.map((embedding, j) =>
      point(chunks.length + j, embedding, images[j].text || "[image]", { modality: "image" }),
    ),
  ];
  // MySQL + Qdrant can't share a transaction, so compensate: if the vector
  // upsert fails (incl. timeout), roll back the registry row and best-effort
  // clear any partially-written points. Net result matches a never-ingested doc,
  // preserving "registry row exists ⟺ its Qdrant points exist".
  try {
    await qdrantClient().upsert(collectionName(tenantId, bucketId), { wait: true, points });
  } catch (err) {
    await db.document.delete({ where: { id: docId } }).catch(() => {});
    await qdrantClient()
      .delete(collectionName(tenantId, bucketId), {
        wait: true,
        filter: { must: [{ key: "document_id", match: { value: docId } }] },
      })
      .catch(() => {});
    throw err;
  }

  // Fold this ingest's chunk token lengths into the bucket's running average
  // (D-10). Text chunks only — image points have no meaningful token length.
  const chunkTokenLengths = chunks.map((c) => tokenize(c.content).length);
  if (chunkTokenLengths.length > 0) {
    const newAvg = nextAvgChunkLength(prevAvgChunkLength, prevChunkCount, chunkTokenLengths);
    await db.bucket.update({ where: { id: bucketId }, data: { avgChunkLength: newAvg } });
  }

  return {
    id: docId,
    bucketId,
    title,
    source,
    metadata,
    createdAt: new Date().toISOString(),
    chunkCount: totalPoints,
  };
}

/**
 * Ingest pre-extracted text into a bucket: chunk (structure-aware, auto-detected)
 * → embed → store. The bucket must belong to the given tenant.
 */
export async function ingestDocument(
  bucketId: string,
  tenantId: string,
  input: {
    title: string;
    source?: string;
    content: string;
    metadata?: Record<string, unknown>;
    chunkStrategy?: ChunkStrategy;
    /** Inline BYOK embedding key — forwarded to the embed call (D-02/D-04). */
    embeddingApiKey?: string;
  },
): Promise<RagDocument> {
  const bucket = await getBucket(bucketId, tenantId);
  if (!bucket) throw new Error("bucket not found");

  const { chunks, strategy } = chunkDocument(input.content, { strategy: input.chunkStrategy });
  return storeDocument({
    bucket,
    tenantId,
    bucketId,
    title: input.title.trim(),
    source: input.source?.trim() ?? "",
    metadata: { ...(input.metadata ?? {}), sourceType: "text", chunkStrategy: strategy },
    chunks,
    rawText: input.content,
    embeddingApiKey: input.embeddingApiKey,
  });
}

/**
 * Ingest an uploaded file: extract to text (markitdown-style) → chunk (strategy
 * auto-detected from the extracted format) → embed → store. Image embedding is
 * layered on in Phase 2; here a file's text representation is what's indexed.
 */
export async function ingestFile(
  bucketId: string,
  tenantId: string,
  input: {
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    title?: string;
    source?: string;
    metadata?: Record<string, unknown>;
    chunkStrategy?: ChunkStrategy;
    /** Inline BYOK embedding key — forwarded to the embed call (D-02/D-04). */
    embeddingApiKey?: string;
  },
): Promise<RagDocument> {
  const bucket = await getBucket(bucketId, tenantId);
  if (!bucket) throw new Error("bucket not found");

  const extracted = await extractFile({
    buffer: input.buffer,
    filename: input.filename,
    mimeType: input.mimeType,
  });
  const { chunks, strategy } = chunkDocument(extracted.text, {
    strategy: input.chunkStrategy,
    format: extracted.format,
  });

  // Decide how images are handled by the bucket's embedder:
  //  - multimodal bucket → embed images natively (true shared-space retrieval)
  //  - text bucket → fall back: OCR/caption each image into a text chunk
  const multimodal = isMultimodalProvider(bucket.embeddingProvider);
  const images: ImageUnit[] = [];
  if (extracted.images.length) {
    if (multimodal) {
      for (const image of extracted.images) {
        images.push({ image, text: image.text?.trim() ?? "" });
      }
    } else {
      for (const image of extracted.images) {
        const text = await imageToText(image);
        if (text) chunks.push({ content: text, context: "image" });
      }
    }
  }

  if (chunks.length === 0 && images.length === 0) {
    throw new Error(
      `no extractable text in ${input.filename} (${extracted.meta.sourceFormat})` +
        (extracted.warnings?.length ? `: ${extracted.warnings.join("; ")}` : ""),
    );
  }

  return storeDocument({
    bucket,
    tenantId,
    bucketId,
    title: (input.title || extracted.meta.title || input.filename).trim(),
    source: input.source?.trim() || input.filename,
    metadata: {
      ...(input.metadata ?? {}),
      sourceType: "file",
      sourceFormat: extracted.meta.sourceFormat,
      mimeType: input.mimeType,
      chunkStrategy: strategy,
      ...(extracted.images.length
        ? { imageCount: extracted.images.length, imageMode: multimodal ? "embedded" : "text" }
        : {}),
    },
    chunks,
    images,
    rawText: extracted.text,
    embeddingApiKey: input.embeddingApiKey,
  });
}
