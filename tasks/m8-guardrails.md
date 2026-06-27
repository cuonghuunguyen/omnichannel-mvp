# M8 — Guardrails (off-topic / injection / hallucination) ✅

- ✅ Per-agent `guardrails` JSON column `{ enabled, scope, refusal }` (Prisma migration `agent_guardrails`); wired through `parseAgentConfig`, `agent-io` (DTO/input/data), agent builder UI section
- ✅ `lib/agents/guard.ts`: `runInputGuard` — classifier pre-pass (dedicated `GUARD_MODEL` env, else agent's model) judges the latest message's true intent vs `scope` → `{blocked, category: off_topic|injection|other, reason}`; tolerant JSON parse; **fail-open** on error; runs only when `enabled` + `scope` set (so a router can enable hardening without off-topic blocking)
- ✅ `guardHardening`: appends anti-injection + anti-hallucination (abstention: "say you don't know, offer a human, never fabricate") + scope limit into `buildSystemPrompt`
- ✅ `/api/chat` runs the guard after the human/closed gates; a block short-circuits with the refusal (persisted, attributed to the agent) + a `data-guardrail` part offering a human — no LLM agent run
- ✅ Guest UI: refusal renders as an assistant message with a "Connect me to a human" button → `POST /api/conversations/:id/escalate` (guest-initiated escalation via current agent's handoff rules)
- ✅ Seed: Sales/Support enabled with scopes + custom refusals; design notes captured below
- ⬜ Real grounding/citations deferred to M9 (RAG); M8 abstention is prompt-based only
- ⬜ Note: optional `GUARD_MODEL` env for a cheaper/faster guard; existing seeded agents need a DB reset to pick up guardrails, or set them in `/agents`
