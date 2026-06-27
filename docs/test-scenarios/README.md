# E2E test scenarios (Playwright MCP)

UI-driven scenarios that exercise every API feature **through the chat app**.
Written for an AI agent driving Playwright MCP. Each scenario is a short list of
actions + checks. Run them top to bottom.

## Setup

- Start the stack **with the demo knowledge base**: `./start.sh --rag-seed`
  (needs `ANTHROPIC_API_KEY` and/or `DEEPSEEK_API_KEY` in `packages/api/.env` —
  replies, guardrails, and RAG are real LLM calls).
- App: **http://localhost:3000**. Seeded tenant name: **Default Tenant**.
- Seeded agents: **Concierge** (default greeter/router), **Reservations**,
  **Guest Services**. Human operator: **Dana (Front Desk Manager)**.

## Action grammar

- `go /path` — navigate to `http://localhost:3000/path`.
- `click "X"` — click the control whose visible text is X.
- `fill "F" = "v"` — type v into the field with label/placeholder F.
- `select "Agent" = "Name"` — choose a dropdown option.
- `see "X"` / `not see "X"` — assert text is / isn't visible.
- `send "text"` — fill the message box `Type your message…` and click Send.

## Rules for the AI runner

- **Replies stream.** After `send`, wait until the message box / Send re-enables
  before asserting. Allow up to ~30 s per turn.
- **LLM output varies.** Assert the *structural* signal (a banner, which agent
  answered, a status), not exact wording. If a routing/guard check fails once,
  retry the turn once before failing.
- Each scenario lists `Pre:` (entry state). Reuse the macros below.

## Macros

- **[T]** Sign in tenant: `go /` → if `see "Tenant name"`: `fill "Tenant name" = "Default Tenant"`, `click "Continue"`.
- **[G name]** Identify guest: on `/`, if `see "Your name"`: `fill "Your name" = "name"`, `click "Start chat"`.
- **[C agent]** Start chat: on `see "Who should help you?"`: `select "Agent" = "agent"`, `click "Start chat"`.

## Coverage

| # | Scenario | API features |
|---|----------|--------------|
| 1 | [Tenancy & guest](scenarios.md#1-tenancy--guest-identity) | tenant sign-up→API sync, guest upsert |
| 2 | [Routing to specialist](scenarios.md#2-routing-to-a-specialist) | `/chat`, `deliver_to_agent`, `set_agent` |
| 3 | [Routing sticks](scenarios.md#3-routing-sticks) | conversation ownership |
| 4 | [Guardrail: off-topic](scenarios.md#4-guardrail--off-topic) | input guard, `data-guardrail` |
| 5 | [Guardrail: injection](scenarios.md#5-guardrail--injection) | input guard |
| 6 | [Guardrail: in-system pass](scenarios.md#6-guardrail--in-system-request-passes) | scope widening |
| 7 | [Agent escalates (billing)](scenarios.md#7-agent-escalates-to-human-billing) | `deliver_to_human`, handoff rules |
| 8 | [Guest escalates](scenarios.md#8-guest-initiated-escalation) | `/escalate`, AI-out gate |
| 9 | [Inbox handoff](scenarios.md#9-human-operator-handoff-inbox) | claim / reply / close callbacks |
| 10 | [End conversation](scenarios.md#10-end-conversation) | `end_conversation`, closed gate |
| 11 | [Knowledge in chat](scenarios.md#11-knowledge-grounded-answer) | `search_knowledge`, RAG |
| 12 | [Agents CRUD](scenarios.md#12-agents-admin-crud) | `/agents` create·edit·delete, default invariant |
| 13 | [Agent builder](scenarios.md#13-agent-builder) | `/agent-builder` proposals |
| 14 | [Knowledge admin](scenarios.md#14-knowledge-admin) | buckets, documents, `/search` |

**Not browser-testable** (API-only, verify with curl if needed): OpenAI facade
`/v1/*`, signed webhooks, internal tenant-sync endpoint. The internal sync and
callbacks are still proven *indirectly* — sign-up works (sync ran) and AI replies
+ status changes appear in chat/inbox (callbacks ran).

All scenarios live in **[scenarios.md](scenarios.md)**.
