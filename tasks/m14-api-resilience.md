# M14 — API resilience (timeouts, shutdown, pool, atomic ingestion) ✅

Keep the API from hanging or corrupting data under dependency failure. From the production-readiness audit (2026-06-28).

Legend: ✅ done · 🚧 in progress · ⬜ todo

---

- ✅ 🔴 **Timeouts on every external call.** Central knobs in [src/lib/resilience.ts](../packages/api/src/lib/resilience.ts) (`TIMEOUTS` + `withTimeout`). Custom-tool `fetch` ([tools.ts](../packages/api/src/lib/agents/tools.ts)) and embedding providers ([embeddings.ts](../packages/api/src/lib/rag/embeddings.ts)) use `AbortSignal.timeout()`; Qdrant via the client constructor `timeout` ([store.ts](../packages/api/src/lib/rag/store.ts), covers query/upsert/delete/create); LLM via the AI SDK native `timeout` option (chat [orchestrate.ts](../packages/api/src/lib/chat/orchestrate.ts), RAG query-rewrite/rerank); MCP connect+discovery wrapped in `withTimeout` ([mcp.ts](../packages/api/src/lib/agents/mcp.ts)).
- ✅ 🔴 **Graceful shutdown.** `SIGTERM`/`SIGINT` handlers in [src/server.ts](../packages/api/src/server.ts): `server.close()` to drain in-flight turns, `db.$disconnect()`, idempotent, with a `SHUTDOWN_TIMEOUT_MS` force-exit guard.
- ✅ 🟠 **DB connection pool** now `DB_CONNECTION_LIMIT` (default raised 5→10) in [src/lib/db.ts](../packages/api/src/lib/db.ts).
- ✅ 🟠 **Atomic RAG ingestion.** `storeDocument` ([buckets.ts](../packages/api/src/lib/rag/buckets.ts)) compensates on Qdrant upsert failure — rolls back the registry row and best-effort deletes partial points — so a failed ingest leaves no orphan (cross-store saga; true MySQL+Qdrant transactions aren't possible).

New env vars (all optional, defaults shown): `TOOL_FETCH_TIMEOUT_MS=10000`, `EMBEDDING_TIMEOUT_MS=30000`, `MCP_TIMEOUT_MS=10000`, `LLM_TIMEOUT_MS=120000`, `RAG_LLM_TIMEOUT_MS=30000`, `QDRANT_TIMEOUT_SEC=30`, `DB_CONNECTION_LIMIT=10`, `SHUTDOWN_TIMEOUT_MS=10000`.

Do not regress: webhooks already have retry+backoff with dedupe event IDs ([src/lib/webhooks/dispatch.ts](../packages/api/src/lib/webhooks/dispatch.ts)).
