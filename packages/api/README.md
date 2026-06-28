# @agent-routing/api — AI Config API

A standalone, multi-tenant **AI orchestration service**. It owns everything about
the AI side of a chat product — agent definitions, the turn/orchestration engine,
input guardrails, and a hybrid RAG knowledge base — and exposes it over a typed
HTTP API. Bring your own front-end: the in-repo [chat](../chat) app is one
consumer, but any OpenAI-protocol client can drive it too.

Routes are described with [zod](https://zod.dev) and emitted as an **OpenAPI 3.0**
spec, from which the [api-client](../api-client) is generated. Live docs at
`/docs` (Redoc), spec at `/openapi.json`.

---

## What it does

It runs a **multi-agent conversation turn**. Given a conversation's history and
its active agent, it:

1. screens the user's input through a guardrail classifier,
2. streams the active agent's reply,
3. lets the agent call tools — built-in (send message, escalate to human, end
   conversation), custom HTTP tools, remote MCP servers, or `search_knowledge`
   (RAG retrieval),
4. hands off between agents (up to `MAX_HOPS`) or to a human, and
5. emits conversation-state events (new message, agent switch, escalate, close)
   to the tenant's subscriber.

It also serves agent **CRUD**, an AI **agent-builder** (natural language → draft
config), and the full **knowledge/RAG** lifecycle (buckets, documents, hybrid
search).

## What it solves

- **Decoupled AI from the chat app.** Orchestration, model keys, guardrails, and
  RAG live here — not in your front-end. Your app keeps the conversation store
  and UI; this service keeps the AI. They talk over HTTP + a typed client.
- **Multi-tenant by construction.** One deployment serves every tenant; all data
  is tenant-scoped and the tenant is resolved per request. No per-tenant deploy.
- **Pluggable integration.** A first-class **OpenAI-compatible facade** means any
  tool that speaks the OpenAI Chat Completions protocol can use the full
  multi-agent loop by changing one `baseURL`. Side-effects are delivered
  out-of-band via a per-tenant **webhook**, keeping responses spec-clean.
- **Provider-agnostic.** Models are chosen by id prefix (Anthropic / DeepSeek);
  embeddings can be local (no key), OpenAI, or Voyage, pinned per knowledge
  bucket.

## Features

| | |
| --- | --- |
| 🧭 **Multi-agent orchestration** | Tool-calling loop with agent-to-agent handoff (`MAX_HOPS`) and human escalation |
| 🛡️ **Input guardrails** | Dedicated classifier (`GUARD_MODEL`) screens each user turn before the model runs |
| 📚 **Hybrid RAG** | Qdrant native dense + sparse (BM25/IDF) prefetch → RRF fusion → LLM rerank |
| 🧰 **Extensible tools** | Built-in tool flags, custom HTTP tools, remote MCP servers — per agent |
| 🤖 **Agent builder** | Stateless AI assistant turns a description into an editable draft config |
| 🔌 **OpenAI facade** | `/v1/chat/completions` + `/v1/models`, Bearer-key → tenant |
| 📨 **Per-tenant webhooks** | Conversation events delivered with HMAC signatures (or legacy callback) |
| 🏢 **Multi-tenancy** | Every route tenant-scoped; runtime tenant registration |
| 📑 **Typed contract** | zod → OpenAPI 3.0 → generated TS client; Redoc docs |

---

## Architecture

```mermaid
flowchart LR
    Client["Any client<br/>chat app · OpenAI SDK · admin UI"]

    subgraph api["api — Express  (:4000)"]
        Routes["routes/<br/>agents · knowledge · chat<br/>agent-builder · openai · internal"]
        Orchestrator["lib/chat/orchestrate<br/>guard · tools · handoff · stream"]
        RAG["lib/rag/<br/>chunk · embed · retrieve · rerank"]
        DB[("MySQL<br/>Tenant · Agent · Bucket · Document")]
        Qdrant[("Qdrant<br/>chunk vectors · :6333")]
    end

    LLM["LLM providers<br/>Anthropic · DeepSeek"]
    Subscriber["Tenant subscriber<br/>(chat service / 3rd party)"]

    Client -->|"HTTP + SSE"| Routes
    Routes --> Orchestrator
    Orchestrator --> RAG
    Orchestrator --> DB
    RAG --> DB
    RAG --> Qdrant
    Orchestrator --> LLM
    Orchestrator -.->|"webhook: events<br/>(HMAC / X-Internal-Secret)"| Subscriber
```

The relational store (MySQL: tenants, agents, knowledge registry) and the vector
store (Qdrant: chunk vectors) are **separate**. Both ship in the root
[`docker-compose.yml`](../../docker-compose.yml) — Qdrant on host port **6333**,
MySQL on host port **3307** (`agents` database).

### Turn flow

A single chat turn runs the orchestration loop: input guardrail → stream the
active agent → it may call tools or hand off, up to `MAX_HOPS` agent hops. Each
hop is persisted via events and pushed back to the tenant's subscriber.

```mermaid
flowchart TD
    Start([POST /chat]) --> Guard{"input guard<br/>(GUARD_MODEL)"}
    Guard -->|blocked| Refuse["stream refusal<br/>+ offer human"] --> Persist1["event: assistant_message"] --> Done([finish])
    Guard -->|allowed| Hop["load active agent runtime<br/>(system · tools · MCP)"]

    Hop --> Stream["streamText → UIMessage stream<br/>(proxied to client)"]
    Stream --> Tools{"tool calls?"}
    Tools -->|search_knowledge| RAG["RAG retrieval pipeline"] --> Stream
    Tools -->|custom / MCP| Stream
    Tools -->|none / done| Signal{"handoff signal?"}

    Signal -->|none| PersistHop["event: assistant_message"] --> Done
    Signal -->|end| Close["event: close"] --> Done
    Signal -->|human| Esc["evaluate handoff rules →<br/>event: escalate"] --> Done
    Signal -->|agent| Switch["event: set_agent"] --> HopCheck{"hop < MAX_HOPS?"}
    HopCheck -->|yes| Hop
    HopCheck -->|no| Done
```

`MAX_HOPS` (4) and `MAX_STEPS_PER_AGENT` (6) are defined in
[`src/lib/models.ts`](src/lib/models.ts).

### RAG retrieval

`search_knowledge` runs a hybrid pipeline ([`src/lib/rag/retrieve.ts`](src/lib/rag/retrieve.ts)):
rewrite the query, then per bucket run Qdrant **native hybrid** search — a dense
(semantic, Cosine) and a sparse (keyword/IDF) prefetch fused server-side with
Reciprocal Rank Fusion — and LLM-rerank the merged top pool. Buckets embed with
their own pinned provider, so the query is embedded once per distinct config.
Sparse vectors are produced locally by a small BM25 tokenizer
([`lib/rag/sparse.ts`](src/lib/rag/sparse.ts)) and weighted by Qdrant's `idf`
modifier — no FTS column, no separate model.

```mermaid
flowchart TD
    Q([search_knowledge query]) --> RW["rewrite query<br/>(RAG_PIPELINE_MODEL)"]
    RW --> Embed["embed query<br/>(once per distinct bucket config)"]
    Embed --> PerBucket["per bucket: Qdrant query API"]
    PerBucket --> Vec["dense prefetch<br/>(Cosine ANN)"]
    PerBucket --> Kw["sparse prefetch<br/>(BM25 / IDF)"]
    Vec --> Fuse["RRF fusion (server-side)"]
    Kw --> Fuse
    Fuse --> Rerank["LLM rerank merged pool"]
    Rerank --> TopK([top-K chunks])
```

---

## API reference

Base URL `http://localhost:4000`. All payloads are JSON; request bodies are
validated against the zod schemas in [`src/schemas.ts`](src/schemas.ts) (the
single source of truth for the OpenAPI spec and the generated client).

**Tenant resolution** differs per surface:

| Surface | How the tenant is resolved |
| --- | --- |
| `/agents`, `/knowledge` (admin/RAG) | `X-Tenant-Id` header (**required**) |
| `/chat`, `/agent-builder` | request body (`tenantId`) |
| `/v1/*` (OpenAI facade) | `Authorization: Bearer <key>` → `Tenant.apiKeyHash` |
| `/internal/*` | `X-Internal-Secret` shared secret (service-to-service) |

### Meta — [`src/server.ts`](src/server.ts)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness — `{ ok: true }` |
| `GET` | `/openapi.json` | The generated OpenAPI 3.0 spec |
| `GET` | `/docs` | Redoc documentation page |

### Agents — [`src/routes/agents.ts`](src/routes/agents.ts)

CRUD over agent config. Requires `X-Tenant-Id`. Agents from other tenants are
invisible. Only one agent per tenant may be `isDefault` (the entry agent) — the
service clears the flag on others when you set it.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/agents` | List the tenant's agents (newest first) |
| `POST` | `/agents` | Create an agent (`AgentInput`) → `201` |
| `GET` | `/agents/:id` | Fetch one agent |
| `PATCH` | `/agents/:id` | Partial update (`AgentInput`, all fields optional) |
| `DELETE` | `/agents/:id` | Delete an agent |

An agent (`AgentDTO`) carries: `model`, `temperature`, `systemPrompt`,
`isRoutable`/`isDefault`, `builtinTools` (sendMessage · deliverToAgent ·
deliverToHuman · endConversation), `customTools[]` (name, description, JSON-Schema
`schema`, HTTP `endpoint`), `mcpServers[]` (name, url, headers), `handoffRules[]`
(`when.flag`/`when.keywords` → `assignTo` = a human `User.id` or `"queue"`),
`guardrails` (enabled · scope · refusal), and `knowledge` (enabled · bucketIds ·
topK).

### Knowledge / RAG — [`src/routes/knowledge.ts`](src/routes/knowledge.ts)

Buckets, documents, and search. Requires `X-Tenant-Id`. A bucket pins its
embedding `provider` + `model` at creation (immutable thereafter); its chunk
vectors live in a per-tenant+bucket Qdrant collection. RAG/store failures return
`503` with a `ragError` message.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/knowledge/buckets` | List buckets (with document/chunk counts) |
| `POST` | `/knowledge/buckets` | Create a bucket (`CreateBucketInput`) → `201` |
| `GET` | `/knowledge/buckets/:id` | Bucket + its documents |
| `DELETE` | `/knowledge/buckets/:id` | Delete bucket (cascades to docs + chunks) |
| `GET` | `/knowledge/buckets/:id/documents` | List a bucket's documents |
| `POST` | `/knowledge/buckets/:id/documents` | Ingest a doc — chunk → embed → store (`IngestDocumentInput`) → `201` |
| `DELETE` | `/knowledge/documents/:id` | Delete a document (cascades to chunks) |
| `POST` | `/knowledge/search` | Run the retrieval pipeline (`SearchInput`: `bucketIds[]`, `query`, `topK?`, `model?`) → `RetrievedChunk[]` |

### Chat / orchestration — [`src/routes/chat.ts`](src/routes/chat.ts)

The turn engine. Tenant + agent come from the body (`ChatTurnInput`: `tenantId`,
`conversationId`, `agentId`, `routingFlag?`, `messages[]` as AI-SDK UIMessages).

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/chat` | Run one AI turn; **streams** a UIMessage stream (not JSON). `409` if the agent isn't assigned to the tenant |

### Agent builder — [`src/routes/agent-builder.ts`](src/routes/agent-builder.ts)

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/agent-builder` | One builder turn (`AgentBuilderInput`: `messages[]`, `currentDraft?`, `editing?`); **streams** text + config/knowledge proposal parts. Stateless — save the result via `POST /agents` |

### OpenAI-compatible facade — [`src/routes/openai.ts`](src/routes/openai.ts)

Drop-in for OpenAI Chat Completions. Auth via `Authorization: Bearer <key>`; the
`model` field selects the **entry agent by id**; `stream` toggles SSE vs JSON.
Stateless — the client sends full history and gets the final assistant text;
routing/escalation/persistence flow to the tenant's webhook. Errors use the
OpenAI error envelope.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/models` | List the tenant's agents as selectable "models" |
| `POST` | `/v1/chat/completions` | Run one turn, OpenAI-shaped (`stream` → `text/event-stream`) |

### Internal — [`src/routes/internal.ts`](src/routes/internal.ts)

Service-to-service, gated by `X-Internal-Secret`. Not in the public OpenAPI
surface.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/internal/tenants` | Upsert a tenant (`{ id, name }`) into this service's registry → `201` |

### Webhooks (outbound)

Orchestration runs here, but the conversation store + live bus live with the
subscriber. The loop emits `ConversationEvent`s — `assistant_message` ·
`set_agent` · `escalate` · `close` — delivered by
[`src/lib/webhooks/dispatch.ts`](src/lib/webhooks/dispatch.ts) per tenant:

- **signed** — `POST` to `Tenant.webhookUrl`, body `{ conversationId, ...event }`,
  header `X-Signature: sha256=<HMAC>` (secret = `Tenant.webhookSecret`),
  `X-Webhook-Event: <type>`.
- **legacy** — `POST` to `CHAT_URL/api/internal/conversations/:id/events`, body
  `event`, header `X-Internal-Secret` (the in-repo chat integration).

Delivery is best-effort: a failed POST is logged, never aborts the turn.

---

## Configuration

All via environment variables — see [`.env.example`](.env.example) for the full
annotated list. The important ones:

| Var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `mysql://app:app@localhost:3307/agents` | MySQL — tenants, agents, knowledge registry |
| `API_PORT` | `4000` | HTTP port |
| `CORS_ORIGIN` | reflect any | Comma-separated allowed origins (the chat app) |
| `INTERNAL_API_SECRET` | `dev-internal-secret` | Shared secret for `/internal` + legacy webhook callback |
| `CHAT_URL` | `http://localhost:3000` | Legacy webhook target; unset = events dropped unless a tenant registers its own webhook |
| `DEV_API_KEY` | `sk-agent-routing-dev` | Dev inbound key for the OpenAI facade (seeded hashed onto the default tenant) |
| `ANTHROPIC_API_KEY` | — | Models with a non-`deepseek` id prefix |
| `DEEPSEEK_API_KEY` | — | Models with a `deepseek-*` id prefix |
| `GUARD_MODEL` | `deepseek-v4-flash` | Input-guardrail classifier |
| `QDRANT_URL` | `http://localhost:6333` | Vector store |
| `QDRANT_API_KEY` | — | Only if Qdrant is secured |
| `EMBEDDING_PROVIDER` | `local` | Fallback when a bucket pins none: `local` (bge-small, 384d, no key) · `openai` (text-embedding-3-small, 1536d) · `voyage` (voyage-3, 1024d) |
| `OPENAI_API_KEY` / `VOYAGE_API_KEY` | — | For the respective embedding providers |
| `RAG_PIPELINE_MODEL` | `DEFAULT_MODEL_ID` (`deepseek-chat`) | Query-rewrite + rerank model |

**Model selection** is by id prefix ([`src/lib/models.ts`](src/lib/models.ts)):
`deepseek-*` → DeepSeek, everything else → Anthropic.

---

## Setup

```bash
cp .env.example .env                 # fill in DEEPSEEK_API_KEY / ANTHROPIC_API_KEY
pnpm install
docker compose -f ../../docker-compose.yml up -d   # Qdrant (:6333) + MySQL (:3307)
pnpm exec prisma migrate dev         # tenant + agent + knowledge registry DB (MySQL)
pnpm rag:setup                       # verify Qdrant + bootstrap bucket collections
pnpm db:seed                         # default tenant + 3 demo AI agents
pnpm rag:seed                        # optional demo knowledge base
pnpm dev                             # → http://localhost:4000  (docs: /docs)
```

### Try it

```bash
# Health
curl localhost:4000/health

# List agents (admin surface — needs the tenant header)
curl localhost:4000/agents -H 'X-Tenant-Id: default'

# Drive the multi-agent loop through the OpenAI facade
curl localhost:4000/v1/chat/completions \
  -H 'Authorization: Bearer sk-agent-routing-dev' \
  -H 'Content-Type: application/json' \
  -d '{"model":"<agent-id>","messages":[{"role":"user","content":"hello"}]}'
```

## Scripts

```bash
pnpm dev          # tsx watch src/server.ts  → http://localhost:4000
pnpm start        # run once (no watch)
pnpm build        # prisma generate + tsc --noEmit
pnpm typecheck    # tsc --noEmit
pnpm openapi      # regenerate openapi.json from the zod schemas
pnpm rag:setup    # verify Qdrant + bootstrap bucket collections
pnpm rag:seed     # seed the demo knowledge base
pnpm db:seed      # seed tenant + agents
```

After changing the zod route schemas, run `pnpm openapi` then regenerate the
client (`pnpm --filter @agent-routing/api-client generate`).

## Project structure

```
src/
  server.ts            Express app: CORS, routers, /health, /docs, error handler
  schemas.ts           zod schemas — single source of truth for OpenAPI + client
  routes/
    agents.ts          agent CRUD (X-Tenant-Id)
    knowledge.ts       buckets, documents, search (X-Tenant-Id)
    chat.ts            orchestration turn engine (UIMessage stream)
    agent-builder.ts   NL → draft agent config (streamed proposals)
    openai.ts          OpenAI-compatible facade (/v1)
    internal.ts        service-to-service tenant registry sync
  lib/
    chat/              orchestrate.ts (the loop) · callbacks.ts
    agents/            runtime · tools · guard · handoff · mcp · builder · messages
    rag/               chunk · embeddings · sparse · retrieve · rerank · query-rewrite · buckets · store
    webhooks/          dispatch.ts (signed / legacy event delivery)
    auth/              api-key.ts (Bearer → tenant for the facade)
    openai/            adapt.ts (OpenAI ⇄ UIMessage)
    models.ts          provider resolution + MAX_HOPS / MAX_STEPS
    tenant.ts          per-request tenant resolution
    db.ts              Prisma client (MariaDB adapter)
  openapi/             document.ts (build) · generate.ts (emit openapi.json)
prisma/                schema.prisma · migrations · seed.ts
scripts/               rag-setup.ts · rag-seed.ts
```

## Infrastructure

| Concern | Tech |
| --- | --- |
| Runtime | Node 20+, Express 5, `tsx` (dev: `tsx watch`) |
| Relational DB | MySQL via Prisma 7 (`@prisma/adapter-mariadb`) — Tenant, Agent, Bucket, Document |
| Vector store | Qdrant via `@qdrant/js-client-rest` — collection per tenant+bucket |
| AI SDK | Vercel AI SDK v6 (`@ai-sdk/anthropic`, `@ai-sdk/deepseek`, MCP) |
| Embeddings | `local` (`@huggingface/transformers`, bge-small, 384d) / `openai` / `voyage` |
| API surface | zod → OpenAPI 3.0 (`openapi.json`), Redoc at `/docs` |
