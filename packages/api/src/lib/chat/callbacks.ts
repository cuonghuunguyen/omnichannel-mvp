// The persistence callback "tool": the orchestration loop runs in this service,
// but the conversation/message store + live SSE bus are owned by the subscriber
// (the in-repo chat service, or any integrator). The loop calls these typed
// callbacks as it progresses; each is delivered to the tenant's webhook target
// (see lib/webhooks/dispatch.ts), where the subscriber writes the row +
// broadcasts to any watching human operator.
import {
  dispatchEvent,
  type ConversationEvent,
  type WebhookTarget,
} from "@/lib/webhooks/dispatch";

export type { ConversationEvent };

/**
 * A persistence handle bound to one conversation + its delivery target. The
 * orchestrator calls these as it progresses; each maps to a webhook delivery,
 * which the subscriber turns into a DB write + broadcast.
 */
export function conversationCallbacks(
  conversationId: string,
  target: WebhookTarget | null,
) {
  return {
    /** Persist a completed assistant hop, attributed to the producing agent. */
    appendAssistantMessage: (input: {
      text: string;
      authorAgentId: string;
      authorAgentName: string;
      /** Present only when the hop's knowledge-tool retrieval found results (KB-05). */
      usedKnowledge?: { resultCount: number; sources: string[]; buckets?: string[] };
      /**
       * Present only when the hop had tool calls or reasoning (D-03). Tool-call
       * entries are intent-level summaries — never raw args/results (OBS-01).
       */
      aiDetail?: { toolCalls: { name: string; summary: string }[]; reasoning?: string };
    }) => dispatchEvent(target, conversationId, { type: "assistant_message", ...input }),

    /** Record an agent handoff so the conversation's owner is updated. */
    setCurrentAgent: (input: { agentId: string; agentName: string }) =>
      dispatchEvent(target, conversationId, { type: "set_agent", ...input }),

    /** Flip the conversation to human ownership (escalation). */
    escalateToHuman: (input: { humanAgentId: string | null; reason?: string }) =>
      dispatchEvent(target, conversationId, { type: "escalate", ...input }),

    /** Close the conversation (terminal). */
    closeConversation: (input: { reason?: string }) =>
      dispatchEvent(target, conversationId, { type: "close", ...input }),
  };
}

export type ConversationCallbacks = ReturnType<typeof conversationCallbacks>;
