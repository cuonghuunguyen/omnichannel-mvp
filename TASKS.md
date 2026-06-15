# Agent Routing — Task Tracker

Multi-agent chat: guests talk to AI **or** human agents, with routing/handoff between them.
Stack: **Next.js 16 (App Router) · AI SDK v6 · Prisma 7 + SQLite · prompt-kit**. LLM: **DeepSeek** (`deepseek-chat`), provider chosen per-agent by model-id prefix.

Plan: `~/.claude/plans/wild-dazzling-giraffe.md`

Legend: ✅ done · 🚧 in progress · ⬜ todo

---

## M1 — Scaffold ✅
- ✅ Next.js + Tailwind + shadcn/ui + prompt-kit components
- ✅ Prisma 7 + SQLite (better-sqlite3 driver adapter), schema migrated
- ✅ AI SDK v6 + `@ai-sdk/deepseek` + `@ai-sdk/anthropic` + `@ai-sdk/mcp`
- ✅ Seed: Triage (default router), Sales, Support AI agents + 1 human operator

## M2 — Persistence + single-agent guest chat ✅
- ✅ `POST /api/users` — guest identify/upsert by name (info persists)
- ✅ `POST/GET /api/conversations`, `GET /api/conversations/:id` (history as UIMessages)
- ✅ `POST /api/chat` — streams current agent, persists both sides, graceful errors
- ✅ Guest chat UI: name-gate → session → prompt-kit chat, agent badge, handoff banner placeholder
- ✅ `lib/routing.ts` — flag→agent resolution (+ deliver_to_human rule evaluator, ready for M5)
- ✅ Verified live: DeepSeek streaming reply + persistence

## M3 — Agent builder ✅
- ✅ `GET/POST /api/agents`, `GET/PATCH/DELETE /api/agents/:id` (CRUD) — JSON cols (de)serialized in `lib/agents/agent-io.ts`; single-`isDefault` invariant enforced in a tx
- ✅ Admin UI `/agents`: list + create/edit form (`components/agents/{agents-admin,agent-form}.tsx`)
  - ✅ name, description, master prompt, model (`lib/models.ts`), temperature
  - ✅ built-in tool toggles (sendMessage / deliverToAgent / deliverToHuman)
  - ✅ isRoutable, isDefault
  - ✅ custom tools (name/description/schema/endpoint) rows
  - ✅ MCP servers (name/url/headers) rows
  - ✅ handoff rules (when flag/keywords → assignTo) rows
- ✅ Chat start screen picks an entry agent (routingFlag → agent id), defaults to `isDefault`
- ✅ Verified live: CRUD round-trip, single-default invariant, entry routing, 400 on empty name, 404 after delete

## M4 — Built-in tools + orchestration ✅
- ✅ `lib/agents/tools.ts`: `send_message` (streams text live + records for persistence), `deliver_to_agent` (dynamic `z.enum` of routable agent ids + auto-built roster description), `deliver_to_human` — handoff tools signal the loop; `HANDOFF_TOOL_NAMES` used as `stopWhen` conditions
- ✅ `lib/agents/runtime.ts`: `buildSystemPrompt` + `buildAgentRuntime` (system prompt + toolset per hop), `loadRoutableAgents`
- ✅ Orchestration loop in `/api/chat` via `createUIMessageStream` (multi-hop up to `MAX_HOPS`); one assistant message spans hops (`sendStart` only hop 0, single manual `finish`); `data-routing` status parts ("Routed to X") between hops; `lib/agents/stream-ids.ts` namespaces text/reasoning block ids per hop so DeepSeek's reused `txt-0` doesn't collapse
- ✅ Persist each hop as its own assistant row (correct `authorAgentId`); update `conversation.currentAgentId` on agent handoff
- ✅ UI: `chat-view` renders text + inline routing chips; reload joins `authorAgent.name` for per-agent badges (`ChatUIMessage` type in `lib/agents/ui-messages.ts`)
- ✅ Verified live: Triage→Sales & Triage→Support answer same turn, `currentAgentId` updated + per-hop rows persisted; `deliver_to_human` emits escalation part and stops the loop
- ⬜ Note: `deliver_to_human` only signals/stops in M4 — DB escalation (rule eval, `status=escalated`, AI gating) is M5

## M5 — Human routing + inbox ✅
- ✅ `deliver_to_human` evaluates `handoffRules` (in `/api/chat`) → sets `assignmentType=human`, `status=escalated`, `humanAgentId` (rule match or queue=null)
- ✅ `/api/chat` gates: `assignmentType==="human"` persists+broadcasts the guest message then returns an empty UI stream (no LLM)
- ✅ `lib/events.ts` in-process pub/sub (globalThis singleton); `GET /api/conversations/:id/stream` (SSE, heartbeat); `POST /api/conversations/:id/messages` (human reply, authored by human_agent User); `POST /api/conversations/:id/claim`
- ✅ `GET /api/conversations?status=escalated,assigned` (admin list w/ user+agent names); `GET /api/users?kind=human_agent`
- ✅ Admin `/inbox` (`components/inbox/inbox.tsx`): queue (polled 5s), claim, thread, reply box; live via SSE
- ✅ Guest live updates: `chat-view` opens SSE, appends human replies (dedupe by id), flips banner on escalation; human-author badge
- ✅ `messages.ts` `toUIMessage` resolves AI vs human author → `metadata.authorKind`/`agentName`; history GET joins `authorAgent`+`authorUser`
- ✅ Verified live: refund msg → escalated/human/seed-human-agent; gated guest follow-up returns `[DONE]` only; claim→reply reaches guest SSE; guest msg reaches inbox SSE; reload shows correct per-author badges

## M6 — Custom tools + remote MCP ✅
- ✅ HTTP custom-tool adapter (`buildCustomTools` in `lib/agents/tools.ts`): `CustomToolDef.schema` → `jsonSchema()`; `execute` POSTs input to `endpoint`, returns parsed JSON (or `{status,body}` / `{error}`)
- ✅ `lib/agents/mcp.ts` `connectMcpServers`: `createMCPClient` (http transport) per server, merge `.tools()`, one bad server is skipped (logged), returns `close()`
- ✅ `buildAgentRuntime` now async — merges `{ ...mcp, ...custom, ...builtin }` (built-ins last so routing tools can't be shadowed); `/api/chat` awaits it and closes MCP per hop in a `finally`
- ✅ Verified live (local stubs): custom `get_quote` POSTed to endpoint + MCP `get_server_time` (full initialize→tools/list→tools/call handshake) both called in one turn; answer synthesizes both; no connect errors; clients closed


## M7 — Terminate conversation ✅
- ✅ `end_conversation` built-in tool (`lib/agents/tools.ts`, gated by `builtinTools.endConversation`): signals `{ kind: "end", reason }`; added to `HANDOFF_TOOL_NAMES` so it stops the agent's turn
- ✅ `/api/chat`: on `end` signal → `status="closed"`, broadcasts a `status` event + emits a `data-routing` `kind:"end"` part, breaks the loop; closed conversations are gated (empty stream, no persist/LLM)
- ✅ Guest UI (`chat-view`): `initialStatus` prop + live SSE close → "Conversation ended" chip, banner, and disabled input; `chat-app` threads `conversation.status`
- ✅ Agent builder: `end_conversation` toggle (`agent-form`); seed Sales/Support enable it with farewell prompt guidance
- ✅ Human operator can also close: `POST /api/conversations/:id/close` + "Close" button in inbox thread header (broadcasts status → guest input disables)
- ⬜ Note: existing seeded agents need a DB reset to pick up the new flag, or toggle it in `/agents`

## M8 — Guardrails (off-topic / injection / hallucination) ✅
- ✅ Per-agent `guardrails` JSON column `{ enabled, scope, refusal }` (Prisma migration `agent_guardrails`); wired through `parseAgentConfig`, `agent-io` (DTO/input/data), agent builder UI section
- ✅ `lib/agents/guard.ts`: `runInputGuard` — classifier pre-pass (dedicated `GUARD_MODEL` env, else agent's model) judges the latest message's true intent vs `scope` → `{blocked, category: off_topic|injection|other, reason}`; tolerant JSON parse; **fail-open** on error; runs only when `enabled` + `scope` set (so a router can enable hardening without off-topic blocking)
- ✅ `guardHardening`: appends anti-injection + anti-hallucination (abstention: "say you don't know, offer a human, never fabricate") + scope limit into `buildSystemPrompt`
- ✅ `/api/chat` runs the guard after the human/closed gates; a block short-circuits with the refusal (persisted, attributed to the agent) + a `data-guardrail` part offering a human — no LLM agent run
- ✅ Guest UI: refusal renders as an assistant message with a "Connect me to a human" button → `POST /api/conversations/:id/escalate` (guest-initiated escalation via current agent's handoff rules)
- ✅ Seed: Sales/Support enabled with scopes + custom refusals; design notes captured below
- ⬜ Real grounding/citations deferred to M9 (RAG); M8 abstention is prompt-based only
- ⬜ Note: optional `GUARD_MODEL` env for a cheaper/faster guard; existing seeded agents need a DB reset to pick up guardrails, or set them in `/agents`


## M9 - Rag knowlege
- Knowlege builder - assign specific knowlege base with agents
- Rag store (docker? pgvector)
- Rag logic (opensource / self build), rag search (rewrite query/hybrid search / reranking)
---

## Verification checklist (end-to-end)
- ✅ Guest by name persists; new session per conversation
- ✅ Default AI agent streams a reply; assistant message persisted with `authorAgentId`
- ✅ Flag routing (agent name / `human`)
- ✅ Agent A `deliver_to_agent` → B answers same turn; `currentAgentId` updated
- ✅ `deliver_to_human` → escalated, AI stops; inbox claim + reply reaches guest via SSE
- ✅ Remote MCP server tools appear and are callable

## Notes / decisions
- No auth in v1 (admin routes open locally); guest = name only.
- DeepSeek key in `.env` (`DEEPSEEK_API_KEY`), gitignored. `resolveModel()` routes by prefix.
- Handoff tools NOT built until M4 — Triage can talk but can't actually route yet.
- Dev: `pnpm dev`. Reset sessions: `tsx prisma/reset-conversations.ts`. Re-seed: `pnpm db:seed`.
