// The persistence callback "tool": the orchestration loop runs in this service,
// but the chat service owns the conversation/message DB and the live SSE bus.
// So instead of writing rows directly, the loop calls these typed callbacks,
// which POST conversation events back to the chat service. Chat performs the DB
// write + broadcasts to any watching human operator.
//
// Auth is a shared secret (INTERNAL_API_SECRET) on an internal-only endpoint.

const CHAT_URL = process.env.CHAT_URL ?? "http://localhost:3000";
const SECRET = process.env.INTERNAL_API_SECRET ?? "";

/** A conversation mutation the loop asks the chat service to apply + broadcast. */
export type ConversationEvent =
  | {
      type: "assistant_message";
      text: string;
      authorAgentId: string;
      authorAgentName: string;
    }
  | { type: "set_agent"; agentId: string; agentName: string }
  | { type: "escalate"; humanAgentId: string | null; reason?: string }
  | { type: "close"; reason?: string };

async function postEvent(
  conversationId: string,
  event: ConversationEvent,
): Promise<void> {
  try {
    const res = await fetch(
      `${CHAT_URL}/api/internal/conversations/${conversationId}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": SECRET,
        },
        body: JSON.stringify(event),
      },
    );
    if (!res.ok) {
      console.error(
        `[callbacks] ${event.type} failed (${res.status}):`,
        await res.text().catch(() => ""),
      );
    }
  } catch (err) {
    // Persistence is best-effort relative to the live stream: a failed callback
    // is logged but never aborts the agent's turn (the guest still gets a reply).
    console.error(`[callbacks] ${event.type} request failed:`, err);
  }
}

/**
 * A persistence handle bound to one conversation. The orchestrator calls these
 * as it progresses; each maps to a DB write + broadcast in the chat service.
 */
export function conversationCallbacks(conversationId: string) {
  return {
    /** Persist a completed assistant hop, attributed to the producing agent. */
    appendAssistantMessage: (input: {
      text: string;
      authorAgentId: string;
      authorAgentName: string;
    }) => postEvent(conversationId, { type: "assistant_message", ...input }),

    /** Record an agent handoff so the conversation's owner is updated. */
    setCurrentAgent: (input: { agentId: string; agentName: string }) =>
      postEvent(conversationId, { type: "set_agent", ...input }),

    /** Flip the conversation to human ownership (escalation). */
    escalateToHuman: (input: { humanAgentId: string | null; reason?: string }) =>
      postEvent(conversationId, { type: "escalate", ...input }),

    /** Close the conversation (terminal). */
    closeConversation: (input: { reason?: string }) =>
      postEvent(conversationId, { type: "close", ...input }),
  };
}

export type ConversationCallbacks = ReturnType<typeof conversationCallbacks>;
