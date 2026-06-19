// The RAG knowledge store: a dedicated Postgres + pgvector database, separate
// from the app's SQLite (Prisma) DB. We talk to it with raw SQL via `pg`
// because pgvector's distance operators and FTS are most naturally expressed in
// SQL, and Prisma's vector support is limited.
//
// Schema notes:
// - `chunks.embedding` is an UNCONSTRAINED `vector` column so different buckets
//   can use different embedding models/dimensions (multi-provider / BYOK). The
//   cost is that an unconstrained column can't carry an ANN (HNSW/ivfflat)
//   index, so vector search is a sequential scan with the `<=>` operator. Every
//   query is scoped to a single bucket, and a bucket pins exactly one
//   provider+model+dim, so the vectors compared in any one query always share a
//   dimension. For demo-scale corpora this is fast; pinning a single dimension
//   and adding an HNSW index is the documented path to scale.
// - `chunks.tsv` is a generated tsvector with a GIN index, powering the keyword
//   half of hybrid search.
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalForRag = globalThis as unknown as { ragPool?: Pool };

export function ragPool(): Pool {
  if (!process.env.RAG_DATABASE_URL) {
    throw new Error(
      "RAG_DATABASE_URL is not set. Start the store with `docker compose up -d` " +
        "and add RAG_DATABASE_URL to .env (e.g. postgresql://rag:rag@localhost:5433/rag).",
    );
  }
  if (!globalForRag.ragPool) {
    globalForRag.ragPool = new Pool({
      connectionString: process.env.RAG_DATABASE_URL,
      max: 5,
    });
  }
  return globalForRag.ragPool;
}

/** Run a parameterized query against the RAG store. */
export async function ragQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await ragPool().query<T>(text, params);
  return res.rows;
}

/** Run several statements inside a single transaction. */
export async function ragTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await ragPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** pgvector wants a literal like `[0.1,0.2,...]`; cast with `$n::vector`. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

let schemaReady: Promise<void> | null = null;

/**
 * Create the extension + tables + indexes if they don't exist. Idempotent and
 * memoized per process, so callers can `await ensureRagSchema()` cheaply before
 * any read/write without paying for it more than once.
 */
export function ensureRagSchema(): Promise<void> {
  if (!schemaReady) schemaReady = createSchema();
  return schemaReady;
}

async function createSchema(): Promise<void> {
  await ragQuery("CREATE EXTENSION IF NOT EXISTS vector");

  // `tenant_id` isolates each tenant's knowledge. Defaults to 'default' so it
  // back-fills cleanly onto rows created before multi-tenancy.
  await ragQuery(`
    CREATE TABLE IF NOT EXISTS buckets (
      id                 TEXT PRIMARY KEY,
      tenant_id          TEXT NOT NULL DEFAULT 'default',
      name               TEXT NOT NULL,
      description        TEXT NOT NULL DEFAULT '',
      embedding_provider TEXT NOT NULL,
      embedding_model    TEXT NOT NULL,
      embedding_dim      INTEGER NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await ragQuery(`
    CREATE TABLE IF NOT EXISTS documents (
      id         TEXT PRIMARY KEY,
      tenant_id  TEXT NOT NULL DEFAULT 'default',
      bucket_id  TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
      title      TEXT NOT NULL DEFAULT '',
      source     TEXT NOT NULL DEFAULT '',
      metadata   JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await ragQuery(`
    CREATE TABLE IF NOT EXISTS chunks (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL DEFAULT 'default',
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      bucket_id   TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
      idx         INTEGER NOT NULL DEFAULT 0,
      content     TEXT NOT NULL,
      metadata    JSONB NOT NULL DEFAULT '{}',
      embedding   VECTOR,
      tsv         TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Idempotent back-fill for stores created before multi-tenancy.
  await ragQuery("ALTER TABLE buckets ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default'");
  await ragQuery("ALTER TABLE documents ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default'");
  await ragQuery("ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default'");

  await ragQuery("CREATE INDEX IF NOT EXISTS chunks_bucket_idx ON chunks(bucket_id)");
  await ragQuery("CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks(document_id)");
  await ragQuery("CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING GIN(tsv)");
  await ragQuery("CREATE INDEX IF NOT EXISTS documents_bucket_idx ON documents(bucket_id)");
  await ragQuery("CREATE INDEX IF NOT EXISTS buckets_tenant_idx ON buckets(tenant_id)");
}
