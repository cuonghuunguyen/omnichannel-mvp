# Agent Routing — Task Tracker

Multi-agent chat: guests talk to AI **or** human agents, with routing/handoff between them.
Stack: **Next.js 16 (App Router) · AI SDK v6 · Prisma 7 + MySQL · Qdrant (RAG) · prompt-kit**. LLM: **DeepSeek** (`deepseek-chat`), provider chosen per-agent by model-id prefix.

Plan: `~/.claude/plans/wild-dazzling-giraffe.md`

Legend: ✅ done · 🚧 in progress · ⬜ todo

---

## Milestones

| # | Milestone | Status |
|---|-----------|--------|
| M1 | [Scaffold](m1-scaffold.md) | ✅ |
| M2 | [Persistence + single-agent guest chat](m2-persistence-single-agent-chat.md) | ✅ |
| M3 | [Agent builder](m3-agent-builder.md) | ✅ |
| M4 | [Built-in tools + orchestration](m4-builtin-tools-orchestration.md) | ✅ |
| M5 | [Human routing + inbox](m5-human-routing-inbox.md) | ✅ |
| M6 | [Custom tools + remote MCP](m6-custom-tools-remote-mcp.md) | ✅ |
| M7 | [Terminate conversation](m7-terminate-conversation.md) | ✅ |
| M8 | [Guardrails (off-topic / injection / hallucination)](m8-guardrails.md) | ✅ |
| M9 | [RAG knowledge](m9-rag-knowledge.md) | ✅ |
| M10 | [Move AI engine to API + full multi-tenancy](m10-api-engine-multitenancy.md) | ✅ |
| M11 | [Tenant switcher (remove `TENANT_ID`, sign up / sign in by tenant)](m11-tenant-switcher.md) | ✅ |
| M12 | [Migrate RAG vector store from pgvector to Qdrant](m12-pgvector-to-qdrant.md) | ✅ |
| M13 | [API auth & abuse protection](m13-api-auth-abuse.md) | ⬜ |
| M14 | [API resilience (timeouts, shutdown, pool, atomic ingestion)](m14-api-resilience.md) | ✅ |
| M15 | [API production runtime & deployment](m15-api-runtime-deploy.md) | ⬜ |
| M16 | [API observability](m16-api-observability.md) | ⬜ |
| M17 | [API resource limits & memory](m17-api-resource-limits.md) | ⬜ |
| M18 | [API test suite](m18-api-tests.md) | ⬜ |

---

## Reference

- [Verification checklist (end-to-end)](verification.md)
- [Notes / decisions](notes.md)
