// Typed client for the AI Config API, generated from the service's OpenAPI spec.
// Regenerate the types with `pnpm --filter @agent-routing/api-client generate`
// after the API's schemas change.
import createClient, { type Client } from "openapi-fetch";
import type { paths, components } from "./schema";

export type { paths, components };

/** Create a typed client bound to the API service's base URL. */
export function createApiClient(baseUrl: string): Client<paths> {
  return createClient<paths>({ baseUrl });
}

export type ApiClient = Client<paths>;

// Convenience re-exports of the domain types (sourced from the OpenAPI schema).
export type Schemas = components["schemas"];
export type AgentDTO = Schemas["AgentDTO"];
export type AgentInput = Schemas["AgentInput"];
export type BuiltinToolFlags = Schemas["BuiltinToolFlags"];
export type CustomToolDef = Schemas["CustomToolDef"];
export type McpServerDef = Schemas["McpServerDef"];
export type HandoffRule = Schemas["HandoffRule"];
export type GuardrailsConfig = Schemas["GuardrailsConfig"];
export type KnowledgeConfig = Schemas["KnowledgeConfig"];
export type EmbeddingProviderId = Schemas["EmbeddingProviderId"];
export type Bucket = Schemas["Bucket"];
export type RagDocument = Schemas["RagDocument"];
export type RetrievedChunk = Schemas["RetrievedChunk"];
