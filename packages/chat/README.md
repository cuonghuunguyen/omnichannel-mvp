# @agent-routing/chat

The **chat service** — a Next.js 16 app that is both the chat UI (guest chat,
agent inbox, admin screens for agents + knowledge) and its own real-time
backend. It persists conversations and proxies AI turns to the
[api](../api) service via the generated [api-client](../api-client); it does
**not** share a database with the API.

> ⚠️ This repo runs a **modified** Next.js — read `node_modules/next/dist/docs/`
> before writing app code. See the root [`AGENTS.md`](../../AGENTS.md).

## What it owns

- **Data** — `User`, `Conversation`, `Message` in SQLite (Prisma). Agent config
  lives in the API; cross-service references (`Conversation.currentAgentId`,
  `Message.authorAgentId`) are plain string ids with the agent name
  denormalized so history renders without a cross-service call.
- **Chat backend** (`src/app/api/`):
  - `chat/` — streaming turn endpoint (proxies orchestration to the API)
  - `conversations/` + `conversations/[id]/{claim,close,escalate,messages}` —
    conversation lifecycle and human handoff
  - `conversations/[id]/events/`, `stream/` — SSE for real-time updates
  - `users/` — guest/operator identity
  - `internal/` — callback endpoint the API calls to persist messages +
    broadcast SSE (auth'd with `INTERNAL_API_SECRET`)
- **UI** (`src/app/`): guest chat, `inbox/` (agent queue), `agents/` and
  `knowledge/` admin (calls the API through the typed client).

## Infrastructure

| Concern     | Tech                                                              |
| ----------- | ----------------------------------------------------------------- |
| Framework   | Next.js 16 (modified), React 19                                   |
| Data store  | SQLite via Prisma 7 (`better-sqlite3` adapter) — `DATABASE_URL`   |
| Real-time   | Server-Sent Events (route handlers)                               |
| Styling     | Tailwind v4, shadcn / Base UI, lucide, sonner                     |
| AI access   | HTTP to the API service via `@agent-routing/api-client`           |

Agent config, model keys, guardrails, RAG/embeddings **all live in the API
service** — this app holds no AI provider keys. It reaches the API at `API_URL`
(server-side) and `NEXT_PUBLIC_API_URL` (browser admin UI).

## Setup

```bash
cp .env.example .env
pnpm install
pnpm exec prisma migrate dev   # User/Conversation/Message DB
pnpm db:seed                   # 1 demo human operator
```

The API service must be running (default `http://localhost:4000`).

## Scripts

```bash
pnpm dev         # next dev   → http://localhost:3000
pnpm build       # next build
pnpm start       # next start (after build)
pnpm lint        # eslint
pnpm db:seed     # seed users
pnpm db:studio   # prisma studio
```

Note: Prisma does not auto-load `.env` — `prisma.config.ts` does
`import "dotenv/config"`.

## Environment

See [`.env.example`](.env.example). Key vars: `DATABASE_URL`, `API_URL`,
`NEXT_PUBLIC_API_URL`, `TENANT_ID`, `INTERNAL_API_SECRET` (must match the API's).
