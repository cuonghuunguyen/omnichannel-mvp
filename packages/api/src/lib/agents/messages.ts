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
