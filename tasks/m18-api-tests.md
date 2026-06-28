# M18 — API test suite ⬜

Establish test coverage for the API sidecar (currently none). From the production-readiness audit (2026-06-28).

Legend: ✅ done · 🚧 in progress · ⬜ todo

---

- ⬜ 🔴 **Test infrastructure.** No test runner, no `test` script, zero `*.test.ts` in `packages/api` ([packages/api/package.json](../packages/api/package.json)). Add a runner (vitest) and a `test` script.
- ⬜ 🔴 **Tenant isolation tests** — prove one tenant cannot read/write another's agents or knowledge.
- ⬜ 🔴 **RAG retrieval tests** — hybrid search, fusion, rerank happy paths.
- ⬜ 🔴 **Error-path tests** — Qdrant down, embedding provider failure, Prisma transaction rollback.
