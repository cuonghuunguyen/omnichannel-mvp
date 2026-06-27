# Verification checklist (end-to-end)

- ✅ Guest by name persists; new session per conversation
- ✅ Default AI agent streams a reply; assistant message persisted with `authorAgentId`
- ✅ Flag routing (agent name / `human`)
- ✅ Agent A `deliver_to_agent` → B answers same turn; `currentAgentId` updated
- ✅ `deliver_to_human` → escalated, AI stops; inbox claim + reply reaches guest via SSE
- ✅ Remote MCP server tools appear and are callable
