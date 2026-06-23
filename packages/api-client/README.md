# @agent-routing/api-client

A **generated, typed TypeScript client** for the [api](../api) service. Types
are generated from the API's OpenAPI spec (`../api/openapi.json`) with
`openapi-typescript`; requests are made with `openapi-fetch`. Consumed by the
[chat](../chat) service (server-side orchestration and the browser admin UI).

## Infrastructure

| Concern   | Tech                                                       |
| --------- | ---------------------------------------------------------- |
| Types     | `openapi-typescript` → `src/schema.d.ts` (generated)       |
| Transport | `openapi-fetch` (fetch-based, fully typed)                 |
| Shipping  | Source-only workspace package (no build step); `main`/`types` point at `src/index.ts` |

No infra of its own and no runtime config — it's a thin typed wrapper bound to a
base URL supplied by the caller.

## Usage

```ts
import { createApiClient, type AgentDTO } from "@agent-routing/api-client";

const api = createApiClient(process.env.API_URL!); // e.g. http://localhost:4000
const { data, error } = await api.GET("/agents");
```

`src/index.ts` exports `createApiClient(baseUrl)`, the `ApiClient` type, and
convenience domain types (`AgentDTO`, `Bucket`, `RagDocument`, `HandoffRule`, …)
re-exported from the generated schema.

## Regenerating

`src/schema.d.ts` is generated — do not hand-edit. After the API's zod schemas
change:

```bash
pnpm --filter @agent-routing/api openapi        # rebuild ../api/openapi.json
pnpm --filter @agent-routing/api-client generate # rebuild src/schema.d.ts
```

(`pnpm generate` from this package runs the second step.)
