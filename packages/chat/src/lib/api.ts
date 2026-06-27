// Typed client for the AI Config API (agents + knowledge/RAG), generated from
// the service's OpenAPI spec. Server code (orchestration, route handlers) uses
// API_URL (internal); the browser admin UI uses NEXT_PUBLIC_API_URL (the API
// has CORS enabled for it).
import { createApiClient } from "@agent-routing/api-client";
import { TENANT_STORAGE_KEY } from "@/lib/tenant-client";

const baseUrl =
  (typeof window === "undefined"
    ? process.env.API_URL
    : process.env.NEXT_PUBLIC_API_URL) ?? "http://localhost:4000";

export const api = createApiClient(baseUrl);

// Browser calls (admin UI: agents/knowledge) must tell the API which tenant they
// act on. The signed-in tenant lives in localStorage (mirrored from the sign-in
// cookie); inject it as X-Tenant-Id on every request. Server-side callers don't
// hit this branch — they pass the header explicitly (see lib/agents/agent-api.ts).
if (typeof window !== "undefined") {
  api.use({
    onRequest({ request }) {
      if (request.headers.has("X-Tenant-Id")) return request;
      try {
        const raw = localStorage.getItem(TENANT_STORAGE_KEY);
        const id = raw ? (JSON.parse(raw) as { id?: string }).id : null;
        if (id) request.headers.set("X-Tenant-Id", id);
      } catch {
        // Malformed/absent storage — leave the header unset; the API 400s.
      }
      return request;
    },
  });
}

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
