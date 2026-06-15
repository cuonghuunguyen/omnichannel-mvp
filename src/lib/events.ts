// In-process pub/sub for live conversation updates (guest ↔ human via SSE).
// A module-level singleton (stashed on globalThis to survive dev hot-reloads)
// is fine for a single-process prototype; swap for Redis/pubsub to scale out.
import type { ChatUIMessage } from "@/lib/agents/ui-messages";

/** Who produced a streamed message — lets each client ignore its own echoes. */
export type MessageOrigin = "guest" | "human" | "ai";

export type ConversationEvent =
  | { kind: "message"; origin: MessageOrigin; message: ChatUIMessage }
  | {
      kind: "status";
      status: string;
      assignmentType: string;
      humanAgentId: string | null;
    };

type Listener = (event: ConversationEvent) => void;

const globalForEvents = globalThis as unknown as {
  conversationChannels?: Map<string, Set<Listener>>;
};

const channels =
  globalForEvents.conversationChannels ??
  (globalForEvents.conversationChannels = new Map());

/** Subscribe to a conversation's events. Returns an unsubscribe function. */
export function subscribe(conversationId: string, listener: Listener): () => void {
  let set = channels.get(conversationId);
  if (!set) {
    set = new Set();
    channels.set(conversationId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) channels.delete(conversationId);
  };
}

/** Broadcast an event to every subscriber of a conversation. */
export function publish(conversationId: string, event: ConversationEvent): void {
  const set = channels.get(conversationId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      // A failed listener must not block the others.
    }
  }
}
