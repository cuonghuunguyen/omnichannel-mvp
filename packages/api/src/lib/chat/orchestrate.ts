// The multi-agent orchestration loop. It used to live in the chat service's
// /api/chat route; it now runs here, where agents and the RAG store are local.
// It produces a UIMessage stream (proxied to the browser by chat) and persists
// each hop + conversation-state change via the chat-service callbacks ("tools").
import {
  convertToModelMessages,
  createUIMessageStream,
  hasToolCall,
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessageChunk,
} from "ai";
import { resolveModel, MAX_STEPS_PER_AGENT, MAX_HOPS } from "@/lib/models";
import { db } from "@/lib/db";
import { toAgentDTO, type AgentDTO } from "@/lib/agent-io";
import { textFromParts } from "@/lib/agents/messages";
import { buildAgentRuntime, loadRoutableAgents } from "@/lib/agents/runtime";
import { HANDOFF_TOOL_NAMES, type HandoffSignal } from "@/lib/agents/tools";
import { runInputGuard, DEFAULT_REFUSAL } from "@/lib/agents/guard";
import { withUniqueBlockIds } from "@/lib/agents/stream-ids";
import { evaluateHandoffRules } from "@/lib/agents/handoff";
import { conversationCallbacks } from "@/lib/chat/callbacks";
import type { ChatUIMessage } from "@/lib/agents/ui-messages";

export type OrchestrateInput = {
  /** Tenant the conversation belongs to — scopes every agent + knowledge read. */
  tenantId: string;
  conversationId: string;
  /** The current agent (already loaded + tenant-scoped by the route). */
  entryAgent: AgentDTO;
  routingFlag: string | null;
  messages: ChatUIMessage[];
};

/** Fetch a single agent's full config (within a tenant) from the local DB. */
async function fetchAgent(id: string, tenantId: string): Promise<AgentDTO | null> {
  const agent = await db.agent.findFirst({ where: { id, tenantId } });
  return agent ? toAgentDTO(agent) : null;
}

/**
 * Run the orchestration loop and return a UIMessage stream. Persistence and
 * conversation-state changes are pushed back to the chat service via callbacks.
 * The caller (the /chat route) is responsible for the open/human/closed gates
 * and for persisting the inbound user message — those are chat-DB concerns.
 */
export function orchestrate(input: OrchestrateInput): ReadableStream<UIMessageChunk> {
  const { tenantId, conversationId, entryAgent, routingFlag, messages } = input;
  const cb = conversationCallbacks(conversationId);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUser ? textFromParts(lastUser.parts) : "";

  return createUIMessageStream<ChatUIMessage>({
    originalMessages: messages,
    execute: async ({ writer }) => {
      // Input guardrail: classify the latest message against the entry agent's
      // scope. A block short-circuits with a refusal (+ offer of a human).
      const { guardrails } = entryAgent;
      const verdict = await runInputGuard(entryAgent.model, guardrails, messages);
      if (verdict?.blocked) {
        const refusalText = guardrails.refusal?.trim() || DEFAULT_REFUSAL;
        const id = `guard-${crypto.randomUUID()}`;
        writer.write({
          type: "start",
          messageMetadata: {
            authorAgentId: entryAgent.id,
            agentName: entryAgent.name,
          },
        });
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: refusalText });
        writer.write({ type: "text-end", id });
        writer.write({
          type: "data-guardrail",
          data: {
            category: verdict.category,
            reason: verdict.reason,
            offerHuman: true,
          },
        });
        writer.write({ type: "finish" });
        await cb.appendAssistantMessage({
          text: refusalText,
          authorAgentId: entryAgent.id,
          authorAgentName: entryAgent.name,
        });
        return;
      }

      let modelMessages: ModelMessage[] = await convertToModelMessages(messages);
      let current = entryAgent;

      for (let hop = 0; hop < MAX_HOPS; hop++) {
        let handoff: HandoffSignal | null = null;
        const sent: string[] = [];

        const routable = await loadRoutableAgents(current.id, tenantId);
        const { system, tools, closeMcp } = await buildAgentRuntime(
          current,
          routable,
          tenantId,
          {
            writer,
            signalHandoff: (s) => {
              handoff = s;
            },
            recordSent: (t) => sent.push(t),
          },
        );

        let text: string;
        try {
          const agentForMeta = current;
          const result = streamText({
            model: resolveModel(current.model),
            system,
            temperature: current.temperature,
            messages: modelMessages,
            tools,
            // Stop the turn on the agent's own budget, or as soon as it hands off.
            stopWhen: [
              stepCountIs(MAX_STEPS_PER_AGENT),
              ...HANDOFF_TOOL_NAMES.map((name) => hasToolCall(name)),
            ],
          });

          // One assistant message spans all hops: only the first emits `start`,
          // and we emit the single `finish` ourselves after the loop.
          writer.merge(
            withUniqueBlockIds(
              result.toUIMessageStream({
                sendStart: hop === 0,
                sendFinish: false,
                messageMetadata: ({ part }) =>
                  part.type === "start"
                    ? { authorAgentId: agentForMeta.id, agentName: agentForMeta.name }
                    : undefined,
              }),
              `h${hop}`,
            ),
          );

          // Wait for the hop to finish, then fold its turn into the running
          // transcript so the next agent sees the full context.
          text = await result.text;
          modelMessages = [...modelMessages, ...(await result.response).messages];
        } finally {
          // Close this hop's MCP clients once its stream is fully consumed.
          await closeMcp();
        }

        // Persist this hop, attributed to the agent that produced it.
        const fullText = [...sent, text].filter(Boolean).join("\n\n");
        if (fullText) {
          await cb.appendAssistantMessage({
            text: fullText,
            authorAgentId: current.id,
            authorAgentName: current.name,
          });
        }

        // Cast resets TS's control-flow narrowing: `handoff` is only ever
        // assigned inside the tool's execute closure, which TS can't see.
        const signal = handoff as HandoffSignal | null;
        if (!signal) break;

        if (signal.kind === "end") {
          // The agent has resolved the request and closed the conversation.
          await cb.closeConversation({ reason: signal.reason });
          writer.write({
            type: "data-routing",
            data: { kind: "end", reason: signal.reason },
          });
          break;
        }

        if (signal.kind === "human") {
          // Evaluate this agent's handoff rules to pick a human (or the queue),
          // flip the conversation to human ownership, and stop the AI loop.
          const { humanAgentId } = evaluateHandoffRules(current.handoffRules, {
            flag: routingFlag,
            text: lastUserText,
          });
          await cb.escalateToHuman({ humanAgentId, reason: signal.reason });
          writer.write({
            type: "data-routing",
            data: { kind: "human", reason: signal.reason },
          });
          break;
        }

        const next = await fetchAgent(signal.targetAgentId, tenantId);
        if (!next || !next.isRoutable) break;

        // Routing is server-authoritative: the conversation owns who answers.
        // The agent name is denormalized so history/badges need no extra call.
        await cb.setCurrentAgent({ agentId: next.id, agentName: next.name });
        writer.write({
          type: "data-routing",
          data: {
            kind: "agent",
            agentId: next.id,
            agentName: next.name,
            reason: signal.reason,
          },
        });
        current = next;
      }

      // Close the single assistant message we streamed across all hops.
      writer.write({ type: "finish" });
    },
    onError: (error) =>
      process.env.NODE_ENV === "production"
        ? "An error occurred."
        : `Agent error: ${error instanceof Error ? error.message : String(error)}`,
  });
}
