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
    components: { schemas },
  };
}
