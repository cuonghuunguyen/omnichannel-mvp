# M12 — Migrate RAG vector store from Postgres + pgvector to Qdrant ✅

**Done.** Qdrant replaces pgvector (collection per `tenant+bucket`, dense `Cosine`
+ sparse `idf` named vectors, native Query-API RRF fusion); the buckets/documents
registry moved to Prisma, and **both** service DBs migrated SQLite → **MySQL**
(`@prisma/adapter-mariadb`). Sparse vectors come from a local BM25 tokenizer
(`lib/rag/sparse.ts`) — no FTS column, no extra model. Verified live: `docker
compose up -d` (Qdrant + MySQL healthy) → `migrate dev` (fresh baselines) →
`db:seed` + `rag:seed` (5 hotel docs embedded locally) → retrieval ranks the
right doc top (score 1.0) for check-out / pets / pool queries, a foreign tenant
returns 0 hits, and both packages typecheck clean. Decisions: Prisma registry +
MySQL · native sparse hybrid · tenant in collection name · Cosine.

> Note: MySQL TEXT columns can't carry a literal DEFAULT, so long/JSON columns
> dropped their DB default and get create-time defaults in app code
> (`AGENT_CREATE_DEFAULTS`, `createBucket`, `ingestDocument`, message creates).
> `migrate dev` needs DB-creation rights for its shadow DB — `docker/mysql-init.sql`
> grants the dev `app` user accordingly (`migrate deploy` in prod needs no shadow DB).

Replace the M9 knowledge store (dedicated **Postgres + pgvector**, raw SQL over the `pg`
driver) with **Qdrant** as the vector backend. The retrieval *behavior* stays the same from
the agent's point of view (`search_knowledge` tool, multi-bucket, hybrid search, citations) —
this milestone swaps the storage + search engine underneath `lib/rag/*`. Everything is in
`packages/api`; the chat package and the app's SQLite (Prisma) DB are untouched.

Legend: ✅ done · 🚧 in progress · ⬜ todo

---

## Why

- pgvector's unconstrained `vector` column (chosen in M9 for multi-dim buckets) can't carry an
  ANN index → every vector search is a sequential scan. Qdrant gives us real ANN (HNSW) per
  collection, plus first-class payload filtering and **native hybrid search / fusion**, which
  lets us delete the hand-rolled RRF + Postgres FTS machinery in `retrieve.ts`.
- One fewer SQL surface to maintain (`store.ts` raw SQL, generated `tsvector`, GIN index).

## Infra / env

- ⬜ **Docker**: replace the `rag-db` service in `docker-compose.yml` (`pgvector/pgvector:pg17`)
  with `qdrant/qdrant`. Expose REST `6333` and gRPC `6334`; new named volume for
  `/qdrant/storage` (drop `rag-pgdata`). Keep the healthcheck (Qdrant `/healthz`).
- ⬜ **Env**: drop `RAG_DATABASE_URL`; add `QDRANT_URL` (e.g. `http://localhost:6333`) and
  optional `QDRANT_API_KEY` in both `.env.example` files and the `ragPool()`-style guard.
- ⬜ **Deps**: add `@qdrant/js-client-rest` to `packages/api`; remove `pg` + `@types/pg`
  (grep confirms `pg` is used **only** by the RAG store, so it goes).

## Store rewrite (`lib/rag/store.ts`)

- ⬜ Replace the `pg` `Pool` + `ragQuery`/`ragTx`/`toVectorLiteral` helpers with a memoized
  Qdrant client (`qdrantClient()` mirroring the current `ragPool()` lazy-singleton pattern).
- ⬜ Replace `ensureRagSchema()` (CREATE EXTENSION/TABLE/INDEX) with collection bootstrap:
  ensure each bucket's collection exists with the right vector size + distance (Cosine), and
  create **payload indexes** on `tenant_id`, `bucket_id`, `document_id` for fast filtering.
  Keep it idempotent + memoized so callers can `await` it cheaply.

## Collection / data model

- ⬜ **Collection-per-bucket** (recommended): a bucket pins exactly one provider+model+dim, so
  its collection gets a fixed `size = embedding_dim`. This is the clean Qdrant mapping for the
  multi-dim requirement that forced the unconstrained pgvector column in M9. Collection name =
  a stable derivation from `bucket_id` (and tenant, if not in payload).
- ⬜ **Point = chunk**: point id = chunk id; vector = embedding; payload carries
  `tenant_id`, `bucket_id`, `document_id`, `idx`, `content`, `metadata`, plus the
  denormalized `document_title` / `document_source` that `retrieve.ts` currently JOINs in (no
  joins in Qdrant — denormalize onto the point).
- ⬜ **Tenant isolation** via a `tenant_id` payload filter on every query (replaces the
  `tenant_id` column + index). Foreign-bucket ids still resolve to nothing.

## Buckets + documents registry (decide first — see Open decisions)

The current pgvector store holds **three** things: `buckets`, `documents`, and `chunks`.
Qdrant stores vectors+payload (chunks) well, but the relational `buckets`/`documents` registry
(CRUD, list, chunk/doc **counts**, FK cascade) needs a home:

- ⬜ Pick one: **(A)** move `buckets` + `documents` into the app Prisma DB (new models), keep
  only chunk vectors in Qdrant; or **(B)** keep them as Qdrant payload + use `scroll`/`count`
  for listing. (A) is simpler for counts/CRUD and the relational shape; (B) keeps RAG fully
  self-contained in Qdrant. **Recommend (A).**
- ⬜ Update `lib/rag/buckets.ts` accordingly: `listBuckets`, `getBucket`,
  `getBucketEmbeddingConfigs`, `listDocuments`, `ingestDocument`, and bucket/document delete.
  `ingestDocument` becomes chunk → embed → **upsert points** (was: insert rows in a `pg` tx).
  Delete document = delete points by `document_id` filter; delete bucket = drop collection
  (+ registry row).

## Retrieval rewrite (`lib/rag/retrieve.ts`)

- ⬜ Replace `vectorSearch` (`<=>` SQL) + `keywordSearch` (Postgres FTS `tsvector`) + the
  hand-rolled `fuse()` RRF with Qdrant search. Query stays per-bucket (mixed-dim buckets are
  embedded once per distinct config, as today), with the `tenant_id` payload filter.
- ⬜ **Hybrid**: either use Qdrant's **Query API native fusion** (dense + sparse prefetch,
  `Fusion.RRF`) — requires generating **sparse vectors** (BM25/miniCOIL via fastembed) at
  ingest + query time — or ship **dense-only** first and keep keyword as a follow-up. The
  query-rewrite (`query-rewrite.ts`) and LLM rerank (`rerank.ts`) stages are storage-agnostic
  and stay as-is. (See Open decisions #2.)
- ⬜ Map Qdrant scored points back to `RetrievedChunk` (id, documentId, bucketId, content,
  metadata, documentTitle, documentSource, score) — `types.ts` shape is unchanged.

## Scripts + errors + docs

- ⬜ `scripts/rag-setup.ts` (`pnpm rag:setup`): becomes Qdrant collection bootstrap (or a
  no-op if collections are created lazily on first ingest) — keep the script so the documented
  flow still works.
- ⬜ `scripts/rag-seed.ts` (`pnpm rag:seed`): re-point the 5 hotel-doc seed at Qdrant. No live
  data migration from pgvector — demo-scale, just re-seed.
- ⬜ `lib/rag/errors.ts`: replace pgvector/`pg`-specific error mapping (e.g. connection
  refused, dimension mismatch) with Qdrant equivalents.
- ⬜ Update `DESIGN.md`, `README.md`, and the M9 note in `tasks/m9-rag-knowledge.md` to say
  Qdrant; correct the "unconstrained vector → seq scan, pin a dim + HNSW to scale" caveat
  (now resolved by collection-per-bucket + HNSW).

## Verify

- ⬜ `docker compose up -d` (Qdrant healthy) → `pnpm rag:setup` → `pnpm rag:seed` → **Test
  retrieval** in `/knowledge` ranks the right hotel doc top → a real `/api/chat` turn: agent
  calls `search_knowledge`, streams the `data-knowledge` part (N sources), answers grounded in
  the docs. Multi-bucket + mixed embedding dims still fuse correctly; a foreign tenant's
  buckets return nothing.

## Open decisions (confirm before building)

1. **Registry home (A vs B above)**: Prisma models for `buckets`/`documents` (recommended) vs
   keep-everything-in-Qdrant via payload + `scroll`/`count`. -> ok prisma model. I also think we should switch db to mysql
2. **Hybrid scope**: native Qdrant sparse-vector hybrid (adds a sparse embedding step at
   ingest+query) vs dense-only now + keyword search as a fast-follow. Dropping FTS without a
   sparse replacement is a (temporary) regression in keyword matching. -> native
3. **Collection layout**: collection-per-bucket (recommended; clean fixed dim) vs one shared
   collection using Qdrant **named vectors** per dimension (fewer collections, more complex
   upsert/query). Tenant in collection name vs payload-filter only. => tenant in collection
4. **Embeddings unchanged?** The `local`/`openai`/`voyage` provider registry stays as-is; only
   the *store* changes. Confirm we keep Cosine distance (matches normalized `bge-small`). -> yes
