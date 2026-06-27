# M6 — Custom tools + remote MCP ✅

- ✅ HTTP custom-tool adapter (`buildCustomTools` in `lib/agents/tools.ts`): `CustomToolDef.schema` → `jsonSchema()`; `execute` POSTs input to `endpoint`, returns parsed JSON (or `{status,body}` / `{error}`)
- ✅ `lib/agents/mcp.ts` `connectMcpServers`: `createMCPClient` (http transport) per server, merge `.tools()`, one bad server is skipped (logged), returns `close()`
- ✅ `buildAgentRuntime` now async — merges `{ ...mcp, ...custom, ...builtin }` (built-ins last so routing tools can't be shadowed); `/api/chat` awaits it and closes MCP per hop in a `finally`
- ✅ Verified live (local stubs): custom `get_quote` POSTed to endpoint + MCP `get_server_time` (full initialize→tools/list→tools/call handshake) both called in one turn; answer synthesizes both; no connect errors; clients closed
