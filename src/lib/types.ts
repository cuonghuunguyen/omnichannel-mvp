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

export type AgentConfig = {
  builtinTools: BuiltinToolFlags;
  customTools: CustomToolDef[];
  mcpServers: McpServerDef[];
  handoffRules: HandoffRule[];
  guardrails: GuardrailsConfig;
};

export function parseAgentConfig(agent: {
  builtinTools: string;
  customTools: string;
  mcpServers: string;
  handoffRules: string;
  guardrails: string;
}): AgentConfig {
  return {
    builtinTools: safeParse<BuiltinToolFlags>(agent.builtinTools, {}),
    customTools: safeParse<CustomToolDef[]>(agent.customTools, []),
    mcpServers: safeParse<McpServerDef[]>(agent.mcpServers, []),
    handoffRules: safeParse<HandoffRule[]>(agent.handoffRules, []),
    guardrails: safeParse<GuardrailsConfig>(agent.guardrails, {}),
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
