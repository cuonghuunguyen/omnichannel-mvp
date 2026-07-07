// Zod schemas for the AI-config API. These are the single source of truth:
// Express validates requests against them, and src/openapi/document.ts converts
// them to the OpenAPI spec (via zod v4's native z.toJSONSchema), from which the
// TypeScript client is generated.
import { z } from "zod";

// ── Agent config (JSON columns) ──────────────────────────────────────────────
export const BuiltinToolFlags = z.object({
  sendMessage: z.boolean().optional(),
  deliverToAgent: z.boolean().optional(),
  deliverToHuman: z.boolean().optional(),
  endConversation: z.boolean().optional(),
});

export const CustomToolDef = z.object({
  name: z.string(),
  description: z.string(),
  /** JSON Schema (object) describing the tool input. */
  schema: z.record(z.string(), z.unknown()),
  /** HTTP endpoint invoked with the tool input as JSON body. */
  endpoint: z.string(),
});

export const McpServerDef = z.object({
  name: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const HandoffRule = z.object({
  when: z.object({
    flag: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  }),
  /** A human-agent User.id, or "queue" for an unassigned escalation. */
  assignTo: z.string(),
});

export const GuardrailsConfig = z.object({
  enabled: z.boolean().optional(),
  scope: z.string().optional(),
  refusal: z.string().optional(),
});

export const KnowledgeConfig = z.object({
  enabled: z.boolean().optional(),
  bucketIds: z.array(z.string()).optional(),
  topK: z.number().optional(),
});

// ── Agent DTO + input ────────────────────────────────────────────────────────
export const AgentDTO = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  model: z.string(),
  temperature: z.number(),
  maxTokens: z.number(),
  isRoutable: z.boolean(),
  isDefault: z.boolean(),
  builtinTools: BuiltinToolFlags,
  customTools: z.array(CustomToolDef),
  mcpServers: z.array(McpServerDef),
  handoffRules: z.array(HandoffRule),
  guardrails: GuardrailsConfig,
  knowledge: KnowledgeConfig,
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** POST/PATCH body — every field optional so PATCH can be partial. */
export const AgentInput = z
  .object({
    name: z.string(),
    description: z.string(),
    systemPrompt: z.string(),
    model: z.string(),
    temperature: z.number(),
    maxTokens: z.number().int().positive(),
    isRoutable: z.boolean(),
    isDefault: z.boolean(),
    builtinTools: BuiltinToolFlags,
    customTools: z.array(CustomToolDef),
    mcpServers: z.array(McpServerDef),
    handoffRules: z.array(HandoffRule),
    guardrails: GuardrailsConfig,
    knowledge: KnowledgeConfig,
  })
  .partial();

// ── Knowledge / RAG ──────────────────────────────────────────────────────────
export const EmbeddingProviderId = z.enum([
  "local",
  "openai",
  "voyage",
  "voyage-multimodal",
]);

/** Bucket-creation provider: a concrete provider or "auto" (resolve from config). */
export const CreateBucketProvider = z.enum([
  "local",
  "openai",
  "voyage",
  "voyage-multimodal",
  "auto",
]);

export const Bucket = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  embeddingProvider: EmbeddingProviderId,
  embeddingModel: z.string(),
  embeddingDim: z.number(),
  createdAt: z.string(),
  documentCount: z.number().optional(),
  chunkCount: z.number().optional(),
});

export const RagDocument = z.object({
  id: z.string(),
  bucketId: z.string(),
  title: z.string(),
  source: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  chunkCount: z.number().optional(),
});

export const RetrievedChunk = z.object({
  id: z.string(),
  documentId: z.string(),
  bucketId: z.string(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  documentTitle: z.string(),
  documentSource: z.string(),
  score: z.number(),
});

export const CreateBucketInput = z.object({
  name: z.string(),
  description: z.string().optional(),
  provider: CreateBucketProvider.optional(),
  model: z.string().optional(),
});

/** How a document is split into chunks; `auto` is detected from the content. */
export const ChunkStrategy = z.enum([
  "auto",
  "markdown",
  "recursive",
  "paragraph",
  "sentence",
]);

export const IngestDocumentInput = z.object({
  title: z.string(),
  source: z.string().optional(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  chunkStrategy: ChunkStrategy.optional(),
});

/**
 * Multipart file-ingest fields (the file rides as `file`; these are text form
 * fields). Numbers/objects arrive as strings, so this only covers the strings.
 */
export const IngestFileInput = z.object({
  title: z.string().optional(),
  source: z.string().optional(),
  chunkStrategy: ChunkStrategy.optional(),
});

/**
 * Update-document body (Phase 46, D-03): content-only — title/source are
 * immutable after creation, and the document id comes from the URL, never the
 * body, since D-01 means the id is never a caller-supplied field.
 */
export const UpdateDocumentInput = z.object({
  content: z.string(),
  chunkStrategy: ChunkStrategy.optional(),
});

export const SearchInput = z
  .object({
    bucketIds: z.array(z.string()),
    query: z.string(),
    topK: z.number().optional(),
    model: z.string().optional(),
    /** Bounded (V5) — prevents a pathologically large Qdrant OR-filter clause. */
    tags: z.array(z.string()).max(20).optional(),
    /** Enum, not a free string, so it can't inject arbitrary filter values (V5). */
    sourceType: z.enum(["text", "file"]).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  })
  .refine((v) => v.dateFrom === undefined || !Number.isNaN(Date.parse(v.dateFrom)), {
    message: "dateFrom must be a valid ISO-8601 date string",
    path: ["dateFrom"],
  })
  .refine((v) => v.dateTo === undefined || !Number.isNaN(Date.parse(v.dateTo)), {
    message: "dateTo must be a valid ISO-8601 date string",
    path: ["dateTo"],
  });

/** Per-bucket mutable settings (D-06): currently just the relevance-floor override. */
export const UpdateBucketInput = z.object({
  relevanceFloorOverride: z.number().min(0).max(1).nullable().optional(),
});

// ── Chat completion ──────────────────────────────────────────────────────────
/**
 * A UIMessage as the chat service sends it. Parts are AI SDK UI parts (text,
 * tool calls, data parts); validated loosely since the AI SDK owns their shape.
 */
export const ChatUIMessageInput = z.object({
  id: z.string().optional(),
  role: z.string(),
  parts: z.array(z.record(z.string(), z.unknown())),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * One AI turn: the conversation's history + which agent answers + the routing
 * flag (used for deliver_to_human rule evaluation). The response is a streamed
 * UIMessage stream, not JSON, so it isn't modeled as a response schema here.
 */
export const ChatTurnInput = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string(),
  agentId: z.string(),
  routingFlag: z.string().nullable().optional(),
  messages: z.array(ChatUIMessageInput),
});

/**
 * One turn of the config-builder conversation. Stateless: the chat history plus
 * the draft agent config built so far. The response is a streamed UIMessage
 * stream (text + config/knowledge proposal parts), not JSON.
 */
export const AgentBuilderInput = z.object({
  messages: z.array(ChatUIMessageInput),
  currentDraft: AgentInput.nullable().optional(),
  /** True when refining an existing agent (vs. designing one from scratch). */
  editing: z.boolean().optional(),
});

// ── Response envelopes + common ──────────────────────────────────────────────
export const ErrorResponse = z.object({ error: z.string() });
export const OkResponse = z.object({ ok: z.boolean() });

export const AgentResponse = z.object({ agent: AgentDTO });
export const AgentsResponse = z.object({ agents: z.array(AgentDTO) });

export const BucketResponse = z.object({ bucket: Bucket });
export const BucketsResponse = z.object({ buckets: z.array(Bucket) });
export const BucketDetailResponse = z.object({
  bucket: Bucket,
  documents: z.array(RagDocument),
});
export const DocumentsResponse = z.object({ documents: z.array(RagDocument) });
export const DocumentResponse = z.object({ document: RagDocument });
export const SearchResponse = z.object({ results: z.array(RetrievedChunk) });

/**
 * Named schemas emitted into the OpenAPI `components.schemas`. Keep this in sync
 * with what paths $ref. The generate script converts each with z.toJSONSchema.
 */
export const components = {
  BuiltinToolFlags,
  CustomToolDef,
  McpServerDef,
  HandoffRule,
  GuardrailsConfig,
  KnowledgeConfig,
  AgentDTO,
  AgentInput,
  EmbeddingProviderId,
  Bucket,
  RagDocument,
  RetrievedChunk,
  CreateBucketInput,
  ChunkStrategy,
  IngestDocumentInput,
  IngestFileInput,
  UpdateDocumentInput,
  SearchInput,
  UpdateBucketInput,
  ChatUIMessageInput,
  ChatTurnInput,
  AgentBuilderInput,
  ErrorResponse,
  OkResponse,
  AgentResponse,
  AgentsResponse,
  BucketResponse,
  BucketsResponse,
  BucketDetailResponse,
  DocumentsResponse,
  DocumentResponse,
  SearchResponse,
} as const;

export type AgentInputType = z.infer<typeof AgentInput>;
