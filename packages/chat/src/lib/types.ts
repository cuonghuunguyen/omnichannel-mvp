// Shared domain types. The JSON-typed columns on the Agent model are stored as
// strings in SQLite; these describe their parsed shape.

export type BuiltinToolFlags = {
  sendMessage?: boolean;
  deliverToAgent?: boolean;
  deliverToHuman?: boolean;
  endConversation?: boolean;
};

export type CustomToolDef = {
  name: string;
  description: string;
  /** JSON Schema (object) describing the tool input. */
  schema: Record<string, unknown>;
  /** HTTP endpoint invoked with the tool input as JSON body. */
  endpoint: string;
};

export type McpServerDef = {
  name: string;
  url: string;
  headers?: Record<string, string>;
};

/** A single deliver_to_human routing rule, evaluated top-down. */
export type HandoffRule = {
  when: {
    flag?: string;
    keywords?: string[];
  };
  /** A human-agent User.id, or "queue" for an unassigned escalation. */
  assignTo: string;
};

/**
 * Per-agent safety config. `enabled` turns on prompt hardening (anti-injection +
 * anti-hallucination). The classifier pre-pass only runs when `scope` is set, so
 * a router can enable guardrails (no fabrication) without off-topic blocking.
 */
export type GuardrailsConfig = {
  enabled?: boolean;
  /** Plain-English description of what this agent is allowed to discuss. */
  scope?: string;
  /** Message shown when a request is blocked (falls back to a default). */
  refusal?: string;
};

/**
 * RAG config. When `enabled` with at least one bucket, the agent gets a
 * `search_knowledge` tool that retrieves from the assigned buckets (buckets
 * live in the AI Config API's store, referenced here by id — cross-DB, so no FK).
 */
export type KnowledgeConfig = {
  enabled?: boolean;
  /** RAG store bucket ids this agent may search. */
  bucketIds?: string[];
  /** How many chunks retrieval returns to the agent (default 5). */
  topK?: number;
};

export type AgentConfig = {
  builtinTools: BuiltinToolFlags;
  customTools: CustomToolDef[];
  mcpServers: McpServerDef[];
  handoffRules: HandoffRule[];
  guardrails: GuardrailsConfig;
  knowledge: KnowledgeConfig;
};

export function parseAgentConfig(agent: {
  builtinTools: string;
  customTools: string;
  mcpServers: string;
  handoffRules: string;
  guardrails: string;
  knowledge: string;
}): AgentConfig {
  return {
    builtinTools: safeParse<BuiltinToolFlags>(agent.builtinTools, {}),
    customTools: safeParse<CustomToolDef[]>(agent.customTools, []),
    mcpServers: safeParse<McpServerDef[]>(agent.mcpServers, []),
    handoffRules: safeParse<HandoffRule[]>(agent.handoffRules, []),
    guardrails: safeParse<GuardrailsConfig>(agent.guardrails, {}),
    knowledge: safeParse<KnowledgeConfig>(agent.knowledge, {}),
  };
}

export function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
