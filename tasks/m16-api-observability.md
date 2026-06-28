# M16 — API observability ⬜

Make production failures traceable without leaking secrets. From the production-readiness audit (2026-06-28).

Legend: ✅ done · 🚧 in progress · ⬜ todo

---

- ⬜ 🟠 **Structured logging + request IDs.** Replace ad-hoc `console.error` with a structured logger and per-turn correlation IDs so a single chat turn can be traced across log lines.
- ⬜ 🟠 **Stop leaking secrets in error logs.** Raw provider/webhook response bodies are dumped on error ([src/lib/rag/embeddings.ts](../packages/api/src/lib/rag/embeddings.ts), [src/lib/webhooks/dispatch.ts](../packages/api/src/lib/webhooks/dispatch.ts)) — redact before logging.

Do not regress: BYOK provider keys are already stripped pre-logging ([src/middleware/strip-provider-key.ts](../packages/api/src/middleware/strip-provider-key.ts)); tenant keys stored as sha256 only.
