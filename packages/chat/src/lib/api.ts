// Typed client for the AI Config API (agents + knowledge/RAG), generated from
// the service's OpenAPI spec. Server code (orchestration, route handlers) uses
// API_URL (internal); the browser admin UI uses NEXT_PUBLIC_API_URL (the API
// has CORS enabled for it).
import { createApiClient } from "@agent-routing/api-client";

const baseUrl =
  (typeof window === "undefined"
    ? process.env.API_URL
    : process.env.NEXT_PUBLIC_API_URL) ?? "http://localhost:4000";

export const api = createApiClient(baseUrl);

export type {
  AgentDTO,
  AgentInput,
  BuiltinToolFlags,
  CustomToolDef,
  McpServerDef,
  HandoffRule,
  GuardrailsConfig,
  KnowledgeConfig,
  EmbeddingProviderId,
  Bucket,
  RagDocument,
  RetrievedChunk,
} from "@agent-routing/api-client";
