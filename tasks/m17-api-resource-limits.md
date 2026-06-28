# M17 — API resource limits & memory ⬜

Bound memory and ingestion so a single tenant/upload can't exhaust the process. From the production-readiness audit (2026-06-28).

Legend: ✅ done · 🚧 in progress · ⬜ todo

---

- ⬜ 🟠 **In-process HF embedding models** are cached in an unbounded global Map ([src/lib/rag/embeddings.ts](../packages/api/src/lib/rag/embeddings.ts)) — unbounded memory, cold starts, and blocks clean horizontal scaling (N model copies across replicas). Bound the cache or move embeddings to an out-of-process service.
- ⬜ 🟠 **Upload/ingestion limits.** Uploads are fully in-memory (`multer.memoryStorage`, [src/routes/knowledge.ts](../packages/api/src/routes/knowledge.ts)); raw-text ingestion has no length cap and no per-tenant chunk quota.
