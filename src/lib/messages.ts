import type { Message } from "@/generated/prisma/client";
import { safeParse } from "@/lib/types";
import type { ChatUIMessage } from "@/lib/agents/ui-messages";

/** A message row optionally joined with its author (for the UI badge). */
type MessageWithAuthors = Message & {
  authorAgent?: { name: string } | null;
  authorUser?: { name: string; kind: string } | null;
};

/** Flatten a UIMessage's parts into plain text (for the `content` column / previews). */
export function textFromParts(parts: ChatUIMessage["parts"] | undefined): string {
  if (!parts) return "";
  return parts
    .filter((p): p is Extract<ChatUIMessage["parts"][number], { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Map a persisted Message row into a UIMessage for the client / model. */
export function toUIMessage(m: MessageWithAuthors): ChatUIMessage {
  const parts = m.parts
    ? safeParse<ChatUIMessage["parts"]>(m.parts, [{ type: "text", text: m.content }])
    : [{ type: "text" as const, text: m.content }];

  // Surface the author (AI agent or human operator) to the UI for badges.
  let metadata: ChatUIMessage["metadata"];
  if (m.authorAgentId) {
    metadata = {
      authorAgentId: m.authorAgentId,
      agentName: m.authorAgent?.name,
      authorKind: "ai",
    };
  } else if (m.role !== "user" && m.authorUser?.kind === "human_agent") {
    metadata = { agentName: m.authorUser.name, authorKind: "human" };
  }

  return {
    id: m.id,
    role: m.role === "user" ? "user" : "assistant",
    parts,
    metadata,
  };
}
