# M4 — Built-in tools + orchestration ✅

- ✅ `lib/agents/tools.ts`: `send_message` (streams text live + records for persistence), `deliver_to_agent` (dynamic `z.enum` of routable agent ids + auto-built roster description), `deliver_to_human` — handoff tools signal the loop; `HANDOFF_TOOL_NAMES` used as `stopWhen` conditions
- ✅ `lib/agents/runtime.ts`: `buildSystemPrompt` + `buildAgentRuntime` (system prompt + toolset per hop), `loadRoutableAgents`
- ✅ Orchestration loop in `/api/chat` via `createUIMessageStream` (multi-hop up to `MAX_HOPS`); one assistant message spans hops (`sendStart` only hop 0, single manual `finish`); `data-routing` status parts ("Routed to X") between hops; `lib/agents/stream-ids.ts` namespaces text/reasoning block ids per hop so DeepSeek's reused `txt-0` doesn't collapse
- ✅ Persist each hop as its own assistant row (correct `authorAgentId`); update `conversation.currentAgentId` on agent handoff
- ✅ UI: `chat-view` renders text + inline routing chips; reload joins `authorAgent.name` for per-agent badges (`ChatUIMessage` type in `lib/agents/ui-messages.ts`)
- ✅ Verified live: Triage→Sales & Triage→Support answer same turn, `currentAgentId` updated + per-hop rows persisted; `deliver_to_human` emits escalation part and stops the loop
- ⬜ Note: `deliver_to_human` only signals/stops in M4 — DB escalation (rule eval, `status=escalated`, AI gating) is M5
