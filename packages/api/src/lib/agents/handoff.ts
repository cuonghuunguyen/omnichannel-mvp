import type { HandoffRule } from "@/lib/types";

export type HandoffTarget = {
  /** A human-agent User.id (in the chat service), or null for the queue. */
  humanAgentId: string | null;
};

/**
 * Evaluate an agent's deliver_to_human rules top-down against the conversation
 * flag and the recent message text. First match wins; falls back to the queue.
 * `assignTo` is opaque here (a chat-service User.id) — this service only routes
 * the decision back to chat via the persistence callback.
 *
 * (Duplicated from the chat service's lib/routing.ts by design — the two
 * services don't share a package.)
 */
export function evaluateHandoffRules(
  rules: HandoffRule[],
  ctx: { flag?: string | null; text?: string },
): HandoffTarget {
  const haystack = (ctx.text ?? "").toLowerCase();

  for (const rule of rules) {
    const flagOk = rule.when.flag ? rule.when.flag === ctx.flag : true;
    const kwOk = rule.when.keywords?.length
      ? rule.when.keywords.some((k) => haystack.includes(k.toLowerCase()))
      : true;
    if (flagOk && kwOk) {
      return { humanAgentId: rule.assignTo === "queue" ? null : rule.assignTo };
    }
  }

  return { humanAgentId: null };
}
