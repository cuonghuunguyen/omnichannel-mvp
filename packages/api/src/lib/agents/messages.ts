import type { ChatUIMessage } from "@/lib/agents/ui-messages";

/** Flatten a UIMessage's parts into plain text (for guards / persistence). */
export function textFromParts(parts: ChatUIMessage["parts"] | undefined): string {
  if (!parts) return "";
  return parts
    .filter(
      (p): p is Extract<ChatUIMessage["parts"][number], { type: "text" }> =>
        p.type === "text",
    )
    .map((p) => p.text)
    .join("");
}

/**
 * Build a compact transcript of the most recent turns, formatted `role: text`
 * with the newest last — the shape `rewriteQuery` expects as conversation
 * context so it can resolve follow-ups ("what about the deluxe one?") into
 * standalone search queries. Capped by turn count and total characters.
 */
export function recentTranscript(
  messages: ChatUIMessage[],
  maxTurns = 6,
  maxChars = 1500,
): string {
  const lines = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-maxTurns)
    .map((m) => `${m.role}: ${textFromParts(m.parts).trim()}`)
    .filter((line) => line.length > line.indexOf(":") + 2);
  const text = lines.join("\n");
  return text.length > maxChars ? text.slice(-maxChars) : text;
}
