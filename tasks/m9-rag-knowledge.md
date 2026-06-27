# M9 — RAG knowledge ✅

> **Superseded by [M12](m12-pgvector-to-qdrant.md):** the storage engine described
> below (Postgres + pgvector, raw SQL, generated `tsvector`/FTS, hand-rolled RRF)
> was replaced by **Qdrant** (collection per tenant+bucket, native dense+sparse
> hybrid with server-side RRF) and the buckets/documents registry moved to the
> app's **MySQL** Prisma DB. The retrieval *behavior* (multi-bucket, hybrid,
> citations, `search_knowledge`) is unchanged — only the engine differs. The
> notes below are kept for history; read M12 for the current design.

- ✅ **RAG store**: Postgres + pgvector in Docker (`docker-compose.yml`, `pgvector/pgvector:pg17`, host port 5433), separate from the SQLite app DB. Reached over `RAG_DATABASE_URL` via the `pg` driver with raw SQL (`lib/rag/store.ts`); idempotent `ensureRagSchema()` + `pnpm rag:setup`. Tables: `buckets`, `documents`, `chunks` (unconstrained `vector` col → multi-dim across buckets; generated `tsvector` + GIN for keyword/hybrid)
- ✅ **Multi-bucket + metadata**: buckets pin one embedding provider+model+dim; documents + chunks carry JSONB `metadata`; bucket/document CRUD + ingestion in `lib/rag/buckets.ts` (chunk → embed → store in a tx); paragraph-aware chunker (`lib/rag/chunk.ts`)
- ✅ **Pluggable embeddings (BYOK-ready)**: `lib/rag/embeddings.ts` provider interface + registry — `local` (transformers.js `bge-small`, 384d, no key, default), `openai` (1536d), `voyage` (1024d); per-bucket config, keys from config→env so per-tenant keys drop in later
- ✅ **Full retrieval pipeline** (`lib/rag/{query-rewrite,retrieve,rerank}.ts`): LLM **query rewrite** (resolve follow-ups + expand keywords, fail-soft) → **hybrid search** per bucket (pgvector `<=>` + Postgres FTS) fused with **Reciprocal Rank Fusion** → **LLM rerank** (pluggable `Reranker`, fail-soft). Query embedded once per distinct bucket config so mixed-dim buckets fuse correctly
- ✅ **Agent integration**: `knowledge` JSON column on Agent (migration `agent_knowledge`) → types/`agent-io`/`parseAgentConfig`; `search_knowledge` tool built in `runtime.ts` when enabled (rewrite+rerank model = `RAG_PIPELINE_MODEL` or agent's model); emits a `data-knowledge` stream part (rendered as a "Searched knowledge base — N sources" chip in `chat-view`)
- ✅ **Knowledge builder**: `/knowledge` admin (`components/knowledge/knowledge-admin.tsx`) — create buckets (provider+model), add/delete documents (paste text), live chunk counts, **Test retrieval** panel; agent builder gets a Knowledge section (toggle + bucket multi-select + topK); API under `/api/knowledge/*` (buckets, documents, search); nav link added
- ✅ Verified live: `docker compose up -d` → `rag:setup` (extension+tables) → `rag:seed` (5 hotel docs embedded locally, assigned to Reservations + Guest Services) → retrieval ranks the right doc at score 1.0 → real `/api/chat` turn: agent calls `search_knowledge`, streams the knowledge part (5 sources), answers grounded in the docs (no fabrication)
- ⬜ Note: existing seeded agents need `pnpm db:seed && pnpm rag:seed` (or set buckets in `/agents`) to pick up knowledge. ~~Scale note: the unconstrained `vector` column trades the ANN index for multi-dim flexibility (seq-scan `<=>`, fine at demo scale) — pin one dimension + add an HNSW index to scale~~ → **resolved in M12**: collection-per-bucket pins a fixed dimension, so every collection carries a real HNSW ANN index (no seq scan)
- ⬜ Multi-media ingestion (PDFs/images/audio → extracted text + captions before chunking) deferred to a follow-up; the document ingestion path already accepts arbitrary text + metadata, so it slots in upstream
