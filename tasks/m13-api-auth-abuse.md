# M13 — API auth & abuse protection ⬜

Close the open admin/chat surface and add cost/abuse controls on `@agent-routing/api`. From the production-readiness audit (2026-06-28).

Legend: ✅ done · 🚧 in progress · ⬜ todo

---

- ⬜ 🔴 **Authenticate the admin/chat surface.** `/agents`, `/knowledge` trust the `X-Tenant-Id` header as identity ([src/lib/tenant.ts](../packages/api/src/lib/tenant.ts), [src/routes/agents.ts:25](../packages/api/src/routes/agents.ts)); `/chat` trusts `tenantId` in the body ([src/routes/chat.ts:25](../packages/api/src/routes/chat.ts)); `/agent-builder` has no auth at all ([src/routes/agent-builder.ts:15](../packages/api/src/routes/agent-builder.ts)). Add a shared service secret (like `/internal` already uses) or mTLS across the whole surface — don't rely on the private-network assumption alone.
- ⬜ 🔴 **Rate limiting + cost controls.** No rate-limit middleware; each `/chat` turn fans out to MAX_HOPS × MAX_STEPS LLM calls plus tools ([src/lib/chat/orchestrate.ts](../packages/api/src/lib/chat/orchestrate.ts)). Add per-tenant/IP limits and turn/step caps.

Do not regress: CORS already fails closed; `/internal` already fails closed when secret unset; `/v1` already authenticates via Bearer → `apiKeyHash`.
