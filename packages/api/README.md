# @agent-routing/api

The **AI Config API** — an Express service that owns everything about the AI
side of the product: agent definitions, the AI orchestration/turn engine, input
guardrails, and the RAG knowledge base. The [chat](../chat) service consumes it
over HTTP through the generated [api-client](../api-client). Routes are described
with zod and emitted as an OpenAPI 3.0 spec.

## What it owns

- **Agents** — CRUD over agent config: model, system prompt, builtin tool flags,
  custom tools, MCP servers, handoff rules, guardrails, knowledge config.
  (`src/routes/agents.ts`, persisted in the agent SQLite DB.)
- **Orchestration** — runs a conversation turn for the active agent: tool calls,
  `search_knowledge` retrieval, handoff, streaming. (`src/lib/agents/`,
  `src/routes/chat.ts`.) Persists messages + broadcasts SSE by calling the chat
  service's internal callback endpoint.
- **Guardrails** — input classifier that screens user turns before the model
  runs. (`src/lib/agents/guard.ts`, `GUARD_MODEL`.)
- **Knowledge / RAG** — buckets, documents, chunking, embeddings, query rewrite,
  retrieval + reranking. (`src/routes/knowledge.ts`, `src/lib/rag/`.)

Everything is scoped to a `TENANT_ID`.

## Turn flow

A single chat turn runs the orchestration loop: input guardrail → stream the
active agent → it may call tools (`search_knowledge`, custom, MCP) or hand off,
up to `MAX_HOPS` agent hops. Each hop is persisted and conversation-state
changes are pushed back to the chat service via callbacks.

```mermaid
flowchart TD
    Start([POST /chat]) --> Guard{"input guard<br/>(GUARD_MODEL)"}
    Guard -->|blocked| Refuse["stream refusal<br/>+ offer human"] --> Persist1["callback: append message"] --> Done([finish])
    Guard -->|allowed| Hop["load active agent runtime<br/>(system · tools · MCP)"]

    Hop --> Stream["streamText → UIMessage stream<br/>(proxied to browser)"]
    Stream --> Tools{"tool calls?"}
    Tools -->|search_knowledge| RAG["RAG retrieval pipeline"] --> Stream
    Tools -->|custom / MCP| Stream
    Tools -->|none / done| Signal{"handoff signal?"}

    Signal -->|none| PersistHop["callback: append hop"] --> Done
    Signal -->|end| Close["callback: close conversation"] --> Done
    Signal -->|human| Esc["evaluate handoff rules →<br/>callback: escalate to human"] --> Done
    Signal -->|agent| Switch["callback: set current agent"] --> HopCheck{"hop < MAX_HOPS?"}
    HopCheck -->|yes| Hop
    HopCheck -->|no| Done
```

## RAG retrieval

`search_knowledge` runs a hybrid pipeline (`src/lib/rag/retrieve.ts`): rewrite
the query, hybrid-search each bucket (pgvector cosine + Postgres FTS), fuse with
Reciprocal Rank Fusion, then LLM-rerank the top pool. Buckets embed with their
own pinned provider, so the query is embedded once per distinct config.

```mermaid
flowchart TD
    Q([search_knowledge query]) --> RW["rewrite query<br/>(RAG_PIPELINE_MODEL)"]
    RW --> Embed["embed query<br/>(once per distinct bucket config)"]
    Embed --> PerBucket["per bucket: hybrid search"]
    PerBucket --> Vec["vector search<br/>pgvector &lt;=&gt;"]
    PerBucket --> Kw["keyword search<br/>FTS ts_rank"]
    Vec --> Fuse["Reciprocal Rank Fusion"]
    Kw --> Fuse
    Fuse --> Rerank["LLM rerank top pool"]
    Rerank --> TopK([top-K chunks])
```

## Infrastructure

| Concern        | Tech                                                                 |
| -------------- | -------------------------------------------------------------------- |
| Runtime        | Node 20+, Express 5, `tsx` (dev: `tsx watch`)                        |
| Agent store    | SQLite via Prisma 7 (`better-sqlite3` adapter) — `DATABASE_URL`      |
| RAG store      | Postgres 17 + pgvector via the `pg` driver — `RAG_DATABASE_URL`      |
| AI SDK         | Vercel AI SDK v6 (`@ai-sdk/anthropic`, `@ai-sdk/deepseek`, `@ai-sdk/mcp`) |
| Embeddings     | `local` (`@huggingface/transformers`, bge-small, 384d) / `openai` / `voyage` |
| API surface    | zod schemas → OpenAPI 3.0 (`openapi.json`), Redoc at `/docs`         |

The agent DB (SQLite) and the RAG store (Postgres/pgvector) are **separate**.
The Postgres store is provided by the root [`docker-compose.yml`](../../docker-compose.yml)
(`pgvector/pgvector:pg17`, host port **5434**).

## Endpoints

- `GET /health`
- `GET /openapi.json`, `GET /docs` (Redoc)
- `/agents` — agent CRUD
- `/knowledge` — buckets, documents, search
- `/chat` — orchestration / turn engine

Default port **4000** (`API_PORT`).

## Setup

```bash
cp .env.example .env                 # fill in DEEPSEEK_API_KEY / ANTHROPIC_API_KEY
pnpm install
docker compose -f ../../docker-compose.yml up -d   # pgvector RAG store (:5434)
pnpm exec prisma migrate dev         # agent SQLite DB
pnpm rag:setup                       # pgvector extension + tables
pnpm db:seed                         # 3 demo AI agents
pnpm rag:seed                        # optional demo knowledge base
```

## Scripts

```bash
pnpm dev          # tsx watch src/server.ts  → http://localhost:4000
pnpm start        # run once (no watch)
pnpm build        # prisma generate + tsc --noEmit
pnpm openapi      # regenerate ../api/openapi.json from the zod schemas
pnpm rag:setup    # create pgvector extension + tables
pnpm rag:seed     # seed the demo knowledge base
pnpm db:seed      # seed agents
```

After changing the zod route schemas, run `pnpm openapi` then regenerate the
client (`pnpm --filter @agent-routing/api-client generate`).

## Environment

See [`.env.example`](.env.example) for the full annotated list. Key vars:
`DATABASE_URL`, `API_PORT`, `CORS_ORIGIN`, `TENANT_ID`, `INTERNAL_API_SECRET`,
`CHAT_URL`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `GUARD_MODEL`,
`RAG_DATABASE_URL`, `EMBEDDING_PROVIDER` (+ `OPENAI_API_KEY` / `VOYAGE_API_KEY`).
