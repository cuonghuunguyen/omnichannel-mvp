import type { UIMessage } from "ai";

/** Metadata attached to every assistant message (who authored it). */
export type ChatMessageMetadata = {
  authorAgentId?: string;
  /** AI agent name or human operator name, for the message badge. */
  agentName?: string;
  /** Distinguishes a human operator's reply from an AI agent's. */
  authorKind?: "ai" | "human";
};

/**
 * A `data-routing` part, streamed between hops so the guest sees a handoff live
 * ("→ Routed to Support"). Persisted as part of the message history.
 */
export type RoutingDataPart = {
  kind: "agent" | "human" | "end";
  /** Target AI agent (kind === "agent"). */
  agentId?: string;
  agentName?: string;
  /** The handing-off/closing agent's stated reason. */
  reason?: string;
};

/**
 * A `data-guardrail` part, streamed when the input guard blocks a message, so
 * the guest sees why and can opt to reach a human. Live-only (not persisted).
 */
export type GuardrailDataPart = {
  category: "off_topic" | "injection" | "other";
  reason?: string;
  /** Whether to offer the guest a button to escalate to a human. */
  offerHuman?: boolean;
};

/**
 * A `data-knowledge` part, streamed when an agent searches its knowledge base,
 * so the guest sees a grounding step ("Searched knowledge base — 3 sources").
 * Live-only (not persisted).
 */
export type KnowledgeDataPart = {
  query: string;
  resultCount: number;
  /** Short source labels (document titles) for the retrieved chunks. */
  sources: string[];
};

/** The app-wide UIMessage shape: typed metadata + the streamed data parts. */
export type ChatUIMessage = UIMessage<
  ChatMessageMetadata,
  {
    routing: RoutingDataPart;
    guardrail: GuardrailDataPart;
    knowledge: KnowledgeDataPart;
  }
>;
