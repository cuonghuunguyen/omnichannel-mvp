// The RAG vector store: a Qdrant instance reached over QDRANT_URL by
// @qdrant/js-client-rest. Qdrant replaces the old Postgres+pgvector store —
// it gives real ANN (HNSW) per collection, payload filtering, and native hybrid
// (dense + sparse) search, so the hand-rolled RRF + Postgres FTS machinery is
// gone (see retrieve.ts).
//
// Data model:
// - Collection per (tenant, bucket): the tenant is in the collection NAME, so a
//   tenant can never reach another's collection. A bucket pins one
//   provider+model+dimension, so each collection has a fixed dense vector size.
// - Each collection carries a named DENSE vector ("dense", Cosine — matches the
//   normalized bge-small embeddings) and a named SPARSE vector ("sparse", with
//   the IDF modifier) powering the keyword half of hybrid search.
// - Point = chunk: id = chunk id; vectors = {dense, sparse}; payload carries
//   tenant_id, bucket_id, document_id, idx, content, metadata, plus the
//   denormalized document_title / document_source (no joins in Qdrant).
//
// The buckets/documents REGISTRY (CRUD, listing, counts) lives in the app's
// Prisma DB, not here — Qdrant only stores chunk vectors+payload.
import { QdrantClient } from "@qdrant/js-client-rest";
import { TIMEOUTS } from "@/lib/resilience";

/** Named dense vector used for semantic search. */
export const DENSE = "dense";
/** Named sparse vector used for keyword (BM25/IDF) search. */
export const SPARSE = "sparse";

const globalForRag = globalThis as unknown as { qdrant?: QdrantClient };

export function qdrantClient(): QdrantClient {
  if (!process.env.QDRANT_URL) {
    throw new Error(
      "QDRANT_URL is not set. Start the store with `docker compose up -d` and add " +
        "QDRANT_URL to .env (e.g. http://localhost:6333).",
    );
  }
  if (!globalForRag.qdrant) {
    globalForRag.qdrant = new QdrantClient({
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY || undefined,
      // The REST client defaults to checking server compatibility on first call;
      // skip it so a version skew doesn't hard-fail the store.
      checkCompatibility: false,
      // Bound every query/upsert/delete/createCollection so a hung Qdrant
      // can't stall ingestion or retrieval. The JS client's setTimeout takes ms.
      timeout: TIMEOUTS.qdrantSec * 1000,
    });
  }
  return globalForRag.qdrant;
}

/**
 * Collection name for a bucket. The tenant is encoded in the name so isolation
 * is structural: a query against another tenant's bucket targets a collection
 * that doesn't exist for this tenant. Sanitized to Qdrant's allowed charset.
 */
export function collectionName(tenantId: string, bucketId: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `kb_${safe(tenantId)}_${safe(bucketId)}`;
}

// Memoize collection bootstrap per name so callers can `await` it cheaply
// before any read/write without re-issuing the create calls every time.
const ready = new Map<string, Promise<void>>();

/**
 * Ensure a bucket's collection exists with the right dense size + Cosine
 * distance, a sparse vector (IDF), and payload indexes for filtering/deletes.
 * Idempotent and memoized per process.
 */
export function ensureBucketCollection(
  tenantId: string,
  bucketId: string,
  dim: number,
): Promise<void> {
  const name = collectionName(tenantId, bucketId);
  let p = ready.get(name);
  if (!p) {
    p = createCollection(name, dim).catch((err) => {
      // Don't cache a failed bootstrap — let the next call retry.
      ready.delete(name);
      throw err;
    });
    ready.set(name, p);
  }
  return p;
}

async function createCollection(name: string, dim: number): Promise<void> {
  const client = qdrantClient();
  const { exists } = await client.collectionExists(name);
  if (!exists) {
    await client.createCollection(name, {
      vectors: { [DENSE]: { size: dim, distance: "Cosine" } },
      sparse_vectors: { [SPARSE]: { modifier: "idf" } },
    });
  }
  // Payload indexes for fast filtering and document-scoped deletes. Idempotent:
  // re-creating an existing index is a no-op on the server.
  for (const field of [
    "tenant_id",
    "bucket_id",
    "document_id",
    "tags",
    "source_type",
    "chunk_content_hash",
  ]) {
    await client
      .createPayloadIndex(name, { field_name: field, field_schema: "keyword", wait: true })
      .catch(() => {
        /* index already exists — ignore */
      });
  }
  // ingested_at is a datetime range/filter field (D-13/D-16), not keyword.
  await client
    .createPayloadIndex(name, { field_name: "ingested_at", field_schema: "datetime", wait: true })
    .catch(() => {
      /* index already exists — ignore */
    });
}

/** Drop a bucket's whole collection (used when the bucket is deleted). */
export async function dropBucketCollection(tenantId: string, bucketId: string): Promise<void> {
  const name = collectionName(tenantId, bucketId);
  ready.delete(name);
  await qdrantClient().deleteCollection(name);
}
