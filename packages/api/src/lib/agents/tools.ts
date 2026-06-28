// Built-in agent tools, assembled per request because two of them depend on
// live state (the set of routable agents) and on the active UI stream. Knowledge
// search runs the RAG pipeline locally (this service owns the RAG store).
import { jsonSchema, tool, type ToolSet, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import type { BuiltinToolFlags, CustomToolDef, KnowledgeConfig } from "@/lib/types";
import type { ChatUIMessage } from "@/lib/agents/ui-messages";
import { retrieve } from "@/lib/rag/retrieve";
import { cacheKey, getCachedChunks, setCachedChunks } from "@/lib/rag/retrieve-cache";
import { TIMEOUTS } from "@/lib/resilience";

/** What a handoff tool tells the orchestration loop to do next. */
export type HandoffSignal =
  | { kind: "agent"; targetAgentId: string; reason: string; context?: string }
  | { kind: "human"; reason: string; summary?: string }
  | { kind: "end"; reason: string };

/** A candidate target for `deliver_to_agent`. */
export type RoutableAgent = { id: string; name: string; description: string };

export type ToolContext = {
  /** Live UI message stream — used by `send_message` to speak to the guest. */
  writer: UIMessageStreamWriter<ChatUIMessage>;
  /** Called by a handoff tool to hand control back to the loop. */
  signalHandoff: (signal: HandoffSignal) => void;
  /** Records text spoken via `send_message` so it can be persisted. */
  recordSent: (text: string) => void;
};

/**
 * Build the enabled built-in tools for an agent. `deliver_to_agent` is omitted
 * when there are no routable targets; its enum + description are generated from
 * the live agent list so the model always sees current, accurate options.
 */
export function buildBuiltinTools(
  flags: BuiltinToolFlags,
  routable: RoutableAgent[],
  ctx: ToolContext,
): ToolSet {
  const tools: ToolSet = {};

  if (flags.sendMessage) {
    tools.send_message = tool({
      description:
        "Send a message to the user. Use this to greet, ask a clarifying " +
        "question, or reply before handing off to another agent.",
      inputSchema: z.object({
        text: z.string().describe("The message to show the user."),
      }),
      execute: async ({ text }) => {
        // Stream the text into the current assistant message so the guest sees
        // it live, and record it so the hop is persisted with this content.
        const id = `send-${crypto.randomUUID()}`;
        ctx.writer.write({ type: "text-start", id });
        ctx.writer.write({ type: "text-delta", id, delta: text });
        ctx.writer.write({ type: "text-end", id });
        ctx.recordSent(text);
        return { delivered: true };
      },
    });
  }

  if (flags.deliverToAgent && routable.length > 0) {
    const ids = routable.map((a) => a.id) as [string, ...string[]];
    const roster = routable
      .map((a) => `- ${a.name} (id: ${a.id}): ${a.description}`)
      .join("\n");
    tools.deliver_to_agent = tool({
      description:
        "Hand off the conversation to another AI agent better suited to help. " +
        "Choose the most relevant agent from this list:\n" +
        roster,
      inputSchema: z.object({
        targetAgentId: z.enum(ids).describe("The id of the agent to hand off to."),
        reason: z.string().describe("Why you are handing off."),
        context: z
          .string()
          .optional()
          .describe("Anything the next agent needs to know to continue."),
      }),
      execute: async ({ targetAgentId, reason, context }) => {
        ctx.signalHandoff({ kind: "agent", targetAgentId, reason, context });
        const target = routable.find((a) => a.id === targetAgentId);
        return { routedTo: target?.name ?? targetAgentId, reason };
      },
    });
  }

  if (flags.deliverToHuman) {
    tools.deliver_to_human = tool({
      description:
        "Escalate the conversation to a human operator. Use when the user asks " +
        "for a person, is upset, or you cannot resolve their issue.",
      inputSchema: z.object({
        reason: z.string().describe("Why this needs a human."),
        summary: z
          .string()
          .optional()
          .describe("A short summary of the conversation for the human."),
      }),
      execute: async ({ reason, summary }) => {
        ctx.signalHandoff({ kind: "human", reason, summary });
        return { escalated: true };
      },
    });
  }

  if (flags.endConversation) {
    tools.end_conversation = tool({
      description:
        "End the conversation when the user's request is fully resolved and there " +
        "is nothing left to do (e.g. they say goodbye or confirm they're all set). " +
        "Say a brief closing message to the user before calling this.",
      inputSchema: z.object({
        reason: z.string().describe("Why the conversation can be closed."),
      }),
      execute: async ({ reason }) => {
        ctx.signalHandoff({ kind: "end", reason });
        return { ended: true };
      },
    });
  }

  return tools;
}

/**
 * Build the `search_knowledge` tool when the agent has RAG enabled with at least
 * one bucket. It runs the full retrieval pipeline (rewrite → hybrid → rerank)
 * over the assigned buckets and returns numbered, cited passages the agent
 * should ground its answer in. `pipelineModel` drives query rewrite + rerank.
 *
 * `recentContext` (a short transcript of recent turns) is passed to the rewriter
 * so follow-ups resolve to standalone queries. Results are cached per conversation
 * + normalized query, so a repeated / near-identical ask skips the whole pipeline.
 */
export function buildKnowledgeTool(
  knowledge: KnowledgeConfig,
  pipelineModel: string,
  tenantId: string,
  conversationId: string,
  recentContext: string,
  ctx: ToolContext,
): ToolSet {
  const bucketIds = knowledge.bucketIds ?? [];
  if (!knowledge.enabled || bucketIds.length === 0) return {};
  const topK = knowledge.topK ?? 5;

  return {
    search_knowledge: tool({
      description:
        "Search the knowledge base for facts to answer the user. Use this BEFORE " +
        "answering any question that depends on specific policies, products, or " +
        "documented details, and ground your reply in the returned passages. If " +
        "nothing relevant comes back, say you don't know rather than guessing.",
      inputSchema: z.object({
        query: z.string().describe("A focused, standalone search query."),
      }),
      execute: async ({ query }) => {
        const key = cacheKey({ tenantId, conversationId, bucketIds, topK, query });
        let chunks = getCachedChunks(key);
        if (!chunks) {
          chunks = await retrieve({
            tenantId,
            bucketIds,
            query,
            context: recentContext,
            topK,
            pipelineModel,
          });
          setCachedChunks(key, chunks);
        }
        ctx.writer.write({
          type: "data-knowledge",
          data: {
            query,
            resultCount: chunks.length,
            sources: [...new Set(chunks.map((c) => c.documentTitle).filter(Boolean))],
          },
        });
        if (chunks.length === 0) {
          return { results: [], note: "No relevant knowledge found." };
        }
        return {
          results: chunks.map((c, i) => ({
            ref: i + 1,
            title: c.documentTitle,
            source: c.documentSource || undefined,
            content: c.content,
          })),
        };
      },
    }),
  };
}

/** Tool names that terminate the current agent's turn (used as stop conditions). */
export const HANDOFF_TOOL_NAMES = [
  "deliver_to_agent",
  "deliver_to_human",
  "end_conversation",
] as const;

/**
 * Turn an agent's configured custom tools into AI SDK tools. Each tool's JSON
 * Schema is handed to the model verbatim; on call, the input is POSTed to the
 * configured endpoint and the JSON (or raw text) response is returned to the LLM.
 */
export function buildCustomTools(defs: CustomToolDef[]): ToolSet {
  const tools: ToolSet = {};

  for (const def of defs) {
    if (!def.name || !def.endpoint) continue;
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(
        (def.schema as object) ?? { type: "object", properties: {} },
      ),
      execute: async (input) => {
        try {
          const res = await fetch(def.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
            // Bound the call so a hung endpoint can't stall the agent's turn.
            signal: AbortSignal.timeout(TIMEOUTS.toolFetchMs),
          });
          const text = await res.text();
          try {
            return JSON.parse(text);
          } catch {
            // Endpoint returned non-JSON; hand back the raw body + status.
            return { status: res.status, body: text };
          }
        } catch (err) {
          const timedOut = err instanceof Error && err.name === "TimeoutError";
          return {
            error: `Tool "${def.name}" request ${
              timedOut ? `timed out after ${TIMEOUTS.toolFetchMs}ms` : "failed"
            }: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    });
  }

  return tools;
}
