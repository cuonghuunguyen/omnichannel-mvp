# M7 — Terminate conversation ✅

- ✅ `end_conversation` built-in tool (`lib/agents/tools.ts`, gated by `builtinTools.endConversation`): signals `{ kind: "end", reason }`; added to `HANDOFF_TOOL_NAMES` so it stops the agent's turn
- ✅ `/api/chat`: on `end` signal → `status="closed"`, broadcasts a `status` event + emits a `data-routing` `kind:"end"` part, breaks the loop; closed conversations are gated (empty stream, no persist/LLM)
- ✅ Guest UI (`chat-view`): `initialStatus` prop + live SSE close → "Conversation ended" chip, banner, and disabled input; `chat-app` threads `conversation.status`
- ✅ Agent builder: `end_conversation` toggle (`agent-form`); seed Sales/Support enable it with farewell prompt guidance
- ✅ Human operator can also close: `POST /api/conversations/:id/close` + "Close" button in inbox thread header (broadcasts status → guest input disables)
- ⬜ Note: existing seeded agents need a DB reset to pick up the new flag, or toggle it in `/agents`
