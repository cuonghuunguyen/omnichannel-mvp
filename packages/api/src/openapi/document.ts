// Builds the OpenAPI 3.0 document from the zod schemas (code-first). Component
// schemas are derived with zod v4's native z.toJSONSchema; paths are declared
// here and $ref those components.
import { z } from "zod";
import { components as schemaMap } from "@/schemas";

const ref = (name: keyof typeof schemaMap) => ({
  $ref: `#/components/schemas/${name}`,
});

const json = (name: keyof typeof schemaMap) => ({
  content: { "application/json": { schema: ref(name) } },
});

const body = (name: keyof typeof schemaMap) => ({
  required: true,
  ...json(name),
});

const resp = (description: string, name?: keyof typeof schemaMap) =>
  name ? { description, ...json(name) } : { description };

const idParam = {
  name: "id",
  in: "path" as const,
  required: true,
  schema: { type: "string" as const },
};

export function buildOpenApiDocument() {
  const schemas: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemaMap)) {
    const js = z.toJSONSchema(schema, { target: "openapi-3.0" }) as Record<
      string,
      unknown
    >;
    delete js.$schema;
    schemas[name] = js;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Agent Routing — AI Config API",
      version: "0.1.0",
      description:
        "Management API for AI agents and the knowledge (RAG) store. " +
        "Consumed by the Next.js chat service via a generated TypeScript client.",
    },
    servers: [{ url: "/", description: "Relative to the API host" }],
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "Sidecar health check",
          description:
            "Returns service health including MySQL connectivity and build version. " +
            "Responds 200 when MySQL is connected, 503 otherwise. " +
            "Qdrant status is deferred (Phase 37).",
          tags: ["health"],
          responses: {
            "200": {
              description: "Service is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok", "version", "mysql", "qdrant"],
                    properties: {
                      ok: { type: "boolean", description: "true when all critical dependencies are connected" },
                      version: { type: "string", description: "npm package version" },
                      mysql: { type: "string", enum: ["connected", "error"], description: "MySQL connectivity status" },
                      qdrant: { type: "string", description: "Qdrant connectivity status (deferred: always 'not configured')" },
                    },
                  },
                },
              },
            },
            "503": {
              description: "Service is degraded (MySQL unavailable)",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ok", "version", "mysql", "qdrant"],
                    properties: {
                      ok: { type: "boolean" },
                      version: { type: "string" },
                      mysql: { type: "string", enum: ["connected", "error"] },
                      qdrant: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/chat/completions": {
        post: {
          operationId: "createChatCompletion",
          summary: "OpenAI-compatible chat completion",
          description:
            "OpenAI Chat Completions facade over the multi-agent loop. Auth is a " +
            "Bearer API key (resolves the tenant); `model` selects the entry agent " +
            "by id; `stream:true` returns SSE chat.completion.chunk events, else a " +
            "single chat.completion. Stateless — routing/escalation side-effects are " +
            "delivered via the tenant's webhook, not the response.",
          tags: ["openai"],
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["model", "messages"],
                  properties: {
                    model: { type: "string", description: "Entry agent id." },
                    messages: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["role"],
                        properties: {
                          role: { type: "string" },
                          content: { type: "string" },
                        },
                      },
                    },
                    stream: { type: "boolean" },
                    user: { type: "string" },
                    conversation_id: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "A chat.completion (JSON) or chat.completion.chunk stream (SSE).",
              content: { "application/json": {}, "text/event-stream": {} },
            },
            "400": resp("Validation error", "ErrorResponse"),
            "401": resp("Invalid API key", "ErrorResponse"),
            "404": resp("Model (agent) not found", "ErrorResponse"),
          },
        },
      },
      "/v1/models": {
        get: {
          operationId: "listModels",
          summary: "List the tenant's agents as OpenAI models",
          tags: ["openai"],
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "An OpenAI model list." },
            "401": resp("Invalid API key", "ErrorResponse"),
          },
        },
      },
      "/chat": {
        post: {
          operationId: "chatTurn",
          summary: "Run one AI turn for a conversation",
          description:
            "Runs the multi-agent orchestration loop for a conversation and " +
            "streams a UIMessage stream (text/event-stream) back. Persistence " +
            "and conversation-state changes are pushed to the chat service via " +
            "its internal callback endpoint, so there is no JSON response body.",
          tags: ["chat"],
          requestBody: body("ChatTurnInput"),
          responses: {
            "200": {
              description: "A UIMessage stream",
              content: { "text/event-stream": {} },
            },
            "400": resp("Validation error", "ErrorResponse"),
            "409": resp("No agent assigned", "ErrorResponse"),
          },
        },
      },
      "/agent-builder": {
        post: {
          operationId: "agentBuilderTurn",
          summary: "Run one config-builder turn",
          description:
            "Runs the (stateless) config-builder assistant and streams a UIMessage " +
            "stream (text/event-stream): plain text plus `config-proposal` and " +
            "`knowledge-seed` data parts the admin UI folds into an editable draft. " +
            "Nothing is persisted — the draft is saved via /agents.",
          tags: ["agents"],
          requestBody: body("AgentBuilderInput"),
          responses: {
            "200": {
              description: "A UIMessage stream",
              content: { "text/event-stream": {} },
            },
            "400": resp("Validation error", "ErrorResponse"),
          },
        },
      },
      "/agents": {
        get: {
          operationId: "listAgents",
          summary: "List all agents (newest first)",
          tags: ["agents"],
          responses: { "200": resp("Agents", "AgentsResponse") },
        },
        post: {
          operationId: "createAgent",
          summary: "Create a new agent",
          tags: ["agents"],
          requestBody: body("AgentInput"),
          responses: {
            "201": resp("Created agent", "AgentResponse"),
            "400": resp("Validation error", "ErrorResponse"),
          },
        },
      },
      "/agents/{id}": {
        get: {
          operationId: "getAgent",
          summary: "Fetch a single agent",
          tags: ["agents"],
          parameters: [idParam],
          responses: {
            "200": resp("Agent", "AgentResponse"),
            "404": resp("Not found", "ErrorResponse"),
          },
        },
        patch: {
          operationId: "updateAgent",
          summary: "Update an agent (partial)",
          tags: ["agents"],
          parameters: [idParam],
          requestBody: body("AgentInput"),
          responses: {
            "200": resp("Updated agent", "AgentResponse"),
            "400": resp("Validation error", "ErrorResponse"),
            "404": resp("Not found", "ErrorResponse"),
          },
        },
        delete: {
          operationId: "deleteAgent",
          summary: "Delete an agent",
          tags: ["agents"],
          parameters: [idParam],
          responses: {
            "200": resp("Deleted", "OkResponse"),
            "404": resp("Not found", "ErrorResponse"),
          },
        },
      },
      "/knowledge/buckets": {
        get: {
          operationId: "listBuckets",
          summary: "List knowledge buckets (with counts)",
          tags: ["knowledge"],
          responses: {
            "200": resp("Buckets", "BucketsResponse"),
            "503": resp("RAG store unavailable", "ErrorResponse"),
          },
        },
        post: {
          operationId: "createBucket",
          summary: "Create a knowledge bucket",
          tags: ["knowledge"],
          requestBody: body("CreateBucketInput"),
          responses: {
            "201": resp("Created bucket", "BucketResponse"),
            "400": resp("Validation error", "ErrorResponse"),
            "503": resp("RAG store unavailable", "ErrorResponse"),
          },
        },
      },
      "/knowledge/buckets/{id}": {
        get: {
          operationId: "getBucket",
          summary: "Fetch a bucket plus its documents",
          tags: ["knowledge"],
          parameters: [idParam],
          responses: {
            "200": resp("Bucket detail", "BucketDetailResponse"),
            "404": resp("Not found", "ErrorResponse"),
            "503": resp("RAG store unavailable", "ErrorResponse"),
          },
        },
        delete: {
          operationId: "deleteBucket",
          summary: "Delete a bucket (cascades documents + chunks)",
          tags: ["knowledge"],
          parameters: [idParam],
          responses: {
            "200": resp("Deleted", "OkResponse"),
            "404": resp("Not found", "ErrorResponse"),
            "503": resp("RAG store unavailable", "ErrorResponse"),
          },
        },
      },
      "/knowledge/buckets/{id}/documents": {
        get: {
          operationId: "listDocuments",
          summary: "List a bucket's documents",
          tags: ["knowledge"],
          parameters: [idParam],
          responses: {
            "200": resp("Documents", "DocumentsResponse"),
            "503": resp("RAG store unavailable", "ErrorResponse"),
          },
        },
        post: {
          operationId: "ingestDocument",
          summary: "Ingest a document (chunk → embed → store)",
          tags: ["knowledge"],
          parameters: [idParam],
          requestBody: body("IngestDocumentInput"),
          responses: {
            "201": resp("Ingested document", "DocumentResponse"),
            "400": resp("Validation error", "ErrorResponse"),
            "404": resp("Bucket not found", "ErrorResponse"),
            "503": resp("RAG store unavailable", "ErrorResponse"),
          },
        },
      },
      "/knowledge/buckets/{id}/files": {
        post: {
          operationId: "ingestFile",
          summary: "Ingest an uploaded file (extract → chunk → embed → store)",
          description:
            "Upload a file (PDF, DOCX, PPTX, XLSX, HTML, Markdown, CSV, text, image) " +
            "as multipart/form-data. The file is converted to text, chunked with an " +
            "auto-detected strategy, embedded with the bucket's provider, and stored.",
          tags: ["knowledge"],
          parameters: [idParam],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                    title: { type: "string" },
                    source: { type: "string" },
                    chunkStrategy: ref("ChunkStrategy"),
                  },
                },
              },
            },
          },
          responses: {
            "201": resp("Ingested document", "DocumentResponse"),
            "400": resp("Missing/invalid file or fields", "ErrorResponse"),
            "404": resp("Bucket not found", "ErrorResponse"),
            "413": resp("File too large", "ErrorResponse"),
            "422": resp("No extractable text in file", "ErrorResponse"),
            "503": resp("RAG store unavailable", "ErrorResponse"),
          },
        },
      },
      "/knowledge/documents/{id}": {
        delete: {
          operationId: "deleteDocument",
          summary: "Delete a document (cascades its chunks)",
          tags: ["knowledge"],
          parameters: [idParam],
          responses: {
            "200": resp("Deleted", "OkResponse"),
            "404": resp("Not found", "ErrorResponse"),
            "503": resp("RAG store unavailable", "ErrorResponse"),
          },
        },
      },
      "/knowledge/search": {
        post: {
          operationId: "searchKnowledge",
          summary: "Run the full retrieval pipeline against one or more buckets",
          tags: ["knowledge"],
          requestBody: body("SearchInput"),
          responses: {
            "200": resp("Retrieved chunks", "SearchResponse"),
            "400": resp("Validation error", "ErrorResponse"),
            "503": resp("RAG store unavailable", "ErrorResponse"),
          },
        },
      },
    },
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Tenant API key." },
      },
    },
  };
}
