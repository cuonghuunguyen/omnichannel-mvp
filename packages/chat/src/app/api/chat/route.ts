import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  hasToolCall,
  stepCountIs,
  streamText,
  type ModelMessage,
} from "ai";
import { db } from "@/lib/db";
import { resolveModel, MAX_STEPS_PER_AGENT, MAX_HOPS } from "@/lib/agents/model";
import { textFromParts, toUIMessage } from "@/lib/messages";
import { buildAgentRuntime, loadRoutableAgents } from "@/lib/agents/runtime";
import { fetchAgent } from "@/lib/agents/agent-api";
import { HANDOFF_TOOL_NAMES, type HandoffSignal } from "@/lib/agents/tools";
import { runInputGuard, DEFAULT_REFUSAL } from "@/lib/agents/guard";
import { withUniqueBlockIds } from "@/lib/agents/stream-ids";
import { evaluateHandoffRules } from "@/lib/routing";
import { publish } from "@/lib/events";
import type { ChatUIMessage } from "@/lib/agents/ui-messages";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, conversationId } = (await req.json()) as {
    messages: ChatUIMessage[];
    conversationId: string;
  };

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) {
    return new Response(JSON.stringify({ error: "conversation not found" }), {
      status: 404,
    });
  }

  // Gate: a closed conversation is terminal. Don't persist or answer; the guest
  // UI disables input once closed, so this is just a defensive backstop.
  if (conversation.status === "closed") {
    const empty = createUIMessageStream<ChatUIMessage>({ execute: () => {} });
    return createUIMessageStreamResponse({ stream: empty });
  }

  // Persist the latest user message, and broadcast it so a watching human
  // operator sees it live (origin "guest" — the guest ignores its own echo).
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUser ? textFromParts(lastUser.parts) : "";
  if (lastUser) {
    const saved = await db.message.create({
      data: {
        conversationId,
        role: "user",
        content: lastUserText,
        parts: JSON.stringify(lastUser.parts),
        authorUserId: conversation.userId,
      },
      include: { authorUser: { select: { name: true, kind: true } } },
    });
    publish(conversationId, {
      kind: "message",
      origin: "guest",
      message: toUIMessage(saved),
    });
  }

  // Gate: once a conversation is owned by a human, the AI stays out of it. The
  // guest message above is already delivered to the human inbox via SSE; return
  // an empty stream so useChat completes without an assistant turn.
  if (conversation.assignmentType === "human") {
    const empty = createUIMessageStream<ChatUIMessage>({ execute: () => {} });
    return createUIMessageStreamResponse({ stream: empty });
  }

  // Agents live in the AI Config API; load the current agent's config via the
  // generated client.
  const entryAgent = conversation.currentAgentId
    ? await fetchAgent(conversation.currentAgentId)
    : null;
  if (!entryAgent) {
    return new Response(JSON.stringify({ error: "no agent assigned" }), {
      status: 409,
    });
  }

  // Input guardrail: classify the latest message against the current agent's
  // scope. A block short-circuits with a refusal (+ offer of a human) and never
  // invokes the agent. Returns null when disabled/no-scope/error (fail-open).
  const { guardrails } = entryAgent;
  const verdict = await runInputGuard(entryAgent.model, guardrails, messages);
  if (verdict?.blocked) {
    const refusalText = guardrails.refusal?.trim() || DEFAULT_REFUSAL;
    const saved = await db.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: refusalText,
        parts: JSON.stringify([{ type: "text", text: refusalText }]),
        authorAgentId: entryAgent.id,
        authorAgentName: entryAgent.name,
      },
    });
    publish(conversationId, {
      kind: "message",
      origin: "ai",
      message: toUIMessage(saved),
    });

    const refusalStream = createUIMessageStream<ChatUIMessage>({
      originalMessages: messages,
      execute: ({ writer }) => {
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
      },
    });
    return createUIMessageStreamResponse({ stream: refusalStream });
  }

  const stream = createUIMessageStream<ChatUIMessage>({
    originalMessages: messages,
    execute: async ({ writer }) => {
      let modelMessages: ModelMessage[] = await convertToModelMessages(messages);
      let current = entryAgent;

      for (let hop = 0; hop < MAX_HOPS; hop++) {
        let handoff: HandoffSignal | null = null;
        const sent: string[] = [];

        const routable = await loadRoutableAgents(current.id);
        const { system, tools, closeMcp } = await buildAgentRuntime(
          current,
          routable,
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
          const saved = await db.message.create({
            data: {
              conversationId,
              role: "assistant",
              content: fullText,
              parts: JSON.stringify([{ type: "text", text: fullText }]),
              authorAgentId: current.id,
              authorAgentName: current.name,
            },
          });
          publish(conversationId, {
            kind: "message",
            origin: "ai",
            message: toUIMessage(saved),
          });
        }

        // Cast resets TS's control-flow narrowing: `handoff` is only ever
        // assigned inside the tool's execute closure, which TS can't see.
        const signal = handoff as HandoffSignal | null;
        if (!signal) break;

        if (signal.kind === "end") {
          // The agent has resolved the request and closed the conversation.
          await db.conversation.update({
            where: { id: conversationId },
            data: { status: "closed" },
          });
          publish(conversationId, {
            kind: "status",
            status: "closed",
            assignmentType: conversation.assignmentType,
            humanAgentId: conversation.humanAgentId,
          });
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
            flag: conversation.routingFlag,
            text: lastUserText,
          });
          await db.conversation.update({
            where: { id: conversationId },
            data: {
              assignmentType: "human",
              status: "escalated",
              humanAgentId,
            },
          });
          publish(conversationId, {
            kind: "status",
            status: "escalated",
            assignmentType: "human",
            humanAgentId,
          });
          writer.write({
            type: "data-routing",
            data: { kind: "human", reason: signal.reason },
          });
          break;
        }

        const next = await fetchAgent(signal.targetAgentId);
        if (!next || !next.isRoutable) break;

        // Routing is server-authoritative: the conversation owns who answers.
        // The agent name is denormalized so history/badges need no API call.
        await db.conversation.update({
          where: { id: conversationId },
          data: { currentAgentId: next.id, currentAgentName: next.name },
        });
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
    onFinish: async () => {
      await db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
