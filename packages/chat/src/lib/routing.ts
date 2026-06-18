import type { HandoffRule } from "@/lib/types";
import { fetchAgents } from "@/lib/agents/agent-api";

export type EntryRouting = {
  assignmentType: "ai" | "human";
  agentId: string | null;
  /** Denormalized agent name, stored on the conversation for display. */
  agentName: string | null;
};

/**
 * Decide who answers a brand-new conversation, based on its routing flag.
 *
 * Conventions (intentionally simple, extend as needed):
 *  - flag === "human"        -> start as a human conversation (no AI)
 *  - flag matches an agent   -> start with that agent (by id or case-insensitive name)
 *  - otherwise               -> the default agent (Agent.isDefault)
 */
export async function resolveEntryRouting(flag?: string | null): Promise<EntryRouting> {
  if (flag && flag.toLowerCase() === "human") {
    return { assignmentType: "human", agentId: null, agentName: null };
  }

  // The API lists agents newest-first; resolve flag → agent, else the default.
  const agents = await fetchAgents();

  if (flag) {
    const match = agents.find(
      (a) => a.id === flag || a.name.toLowerCase() === flag.toLowerCase(),
    );
    if (match) {
      return { assignmentType: "ai", agentId: match.id, agentName: match.name };
    }
  }

  const fallback =
    agents.find((a) => a.isDefault) ??
    [...agents].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

  return {
    assignmentType: "ai",
    agentId: fallback?.id ?? null,
    agentName: fallback?.name ?? null,
  };
}

export type HandoffTarget = {
  /** A human-agent User.id, or null for an unassigned ("queue") escalation. */
  humanAgentId: string | null;
};

/**
 * Evaluate an agent's deliver_to_human rules top-down against the conversation
 * flag and the recent message text. First match wins; falls back to the queue.
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
