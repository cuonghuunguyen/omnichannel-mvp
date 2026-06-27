# M3 — Agent builder ✅

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
