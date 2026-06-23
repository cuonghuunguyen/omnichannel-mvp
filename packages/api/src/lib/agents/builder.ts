// The config-builder assistant. Unlike the runtime orchestration loop, this is a
// single, stateless agent: it interviews the user about the agent they want and
// streams back text PLUS structured "proposal" data parts (a partial agent config
// and optional seed knowledge) that the builder UI folds into an editable draft.
// Nothing is persisted here — the user reviews the draft and saves it through the
// normal /agents endpoint.
import {
  convertToModelMessages,
  createUIMessageStream,
  hasToolCall,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { z } from "zod";
import { resolveModel, DEFAULT_MODEL_ID } from "@/lib/models";
import { AgentInput as AgentInputSchema } from "@/schemas";
import type { AgentInput } from "@/lib/agent-io";

/** A partial agent config the assistant proposes, folded into the draft form. */
export type ConfigProposalPart = {
  /** One-line, human-readable summary of what this proposal sets. */
  summary: string;
  /** Partial agent config to merge into the draft. */
  config: AgentInput;
};

/** Seed knowledge the assistant proposes — a bucket plus a few starter docs. */
export type KnowledgeSeedPart = {
  summary: string;
  bucketName: string;
  description?: string;
  documents: { title: string; content: string }[];
};

/** A question the assistant asks as selectable options instead of free text. */
export type AskChoicePart = {
  /** Stable id so the UI can track whether this prompt was answered. */
  id: string;
  question: string;
  options: { label: string; description?: string }[];
  /** Allow selecting more than one option. */
  multi: boolean;
  /** Also offer a free-text box so the user can answer outside the options. */
  allowFreeText: boolean;
};

/** The builder's streamed UIMessage shape: plain text + the interaction parts. */
export type BuilderUIMessage = UIMessage<
  never,
  {
    "config-proposal": ConfigProposalPart;
    "knowledge-seed": KnowledgeSeedPart;
    "ask-choice": AskChoicePart;
  }
>;

export type BuildConfigInput = {
  messages: BuilderUIMessage[];
  /** The draft built so far, given to the assistant so it can refine it. */
  currentDraft?: AgentInput | null;
  /** True when refining an existing agent (vs. designing one from scratch). */
  editing?: boolean;
};

/** The builder model: a dedicated one via env, else the default chat model. */
function builderModelId(): string {
  return process.env.BUILDER_MODEL?.trim() || DEFAULT_MODEL_ID;
}

/** A compact rendering of the draft so far, for the system prompt. */
function draftContext(draft: AgentInput | null | undefined, editing: boolean): string {
  if (!draft || Object.keys(draft).length === 0) {
    return "The draft is currently empty — nothing has been proposed yet.";
  }
  const json = "```json\n" + JSON.stringify(draft, null, 2) + "\n```";
  if (editing) {
    return (
      "You are EDITING an existing agent. Its current configuration is below. " +
      "Don't re-interview the user from scratch — ask what they want to change, " +
      "then call propose_agent_config with just the fields you're changing. Keep " +
      "everything else as-is.\n" +
      json
    );
  }
  return `The draft so far (your proposals are merged into this):\n${json}`;
}

const SYSTEM = `You are an agent-configuration assistant. Through a short conversation, you help the user design ONE AI support agent for a multi-agent customer-chat platform, then emit a structured config they can review and save.

How you work:
- Interview the user one topic at a time. Ask a single focused question, wait for the answer, then move on. Do NOT dump a long questionnaire. Keep messages short.
- Cover, roughly in this order, only what's relevant: (1) the agent's purpose and the customers it serves, (2) tone/persona for its system prompt, (3) what it should be allowed to discuss (guardrail scope), (4) whether it routes to other agents or escalates to a human, (5) any external tools/APIs it needs, (6) what knowledge it should ground answers in.
- As soon as you have enough to fill part of the config, call the propose_agent_config tool with just that part. You can call it many times as the conversation progresses — each call patches the draft. Don't wait until the end.
- After proposing, briefly tell the user what you set and ask the next question. The user edits the form directly, so your proposals are starting points, not final.
- When the agent would benefit from grounded facts, call propose_knowledge_seed with a small set of starter documents (1-4 short docs) the user can turn into a knowledge base.

Interaction:
- ask_choice: ask a question as selectable options whenever the answer is one of a few known choices (yes/no, pick a tone, choose which built-in tools to enable, pick a model tier). Use multi: true when several answers apply (e.g. which tools to enable). Set allowFreeText: true when the user might have an answer outside your options (e.g. "what should this agent be named?" with a few suggestions). It's faster than making the user type. After calling it, stop and wait — don't keep talking.
- The user can attach text documents via the input. When their message contains uploaded file contents, read them and (if useful) call propose_knowledge_seed to turn them into a knowledge base.

Config field guidance:
- name: short, e.g. "Sales" or "Billing Support".
- description: one line shown to OTHER agents deciding whether to route here.
- systemPrompt: the agent's full instructions/persona. Write it in full prose.
- model: leave unset unless the user asks; the platform default is fine.
- builtinTools: { sendMessage: speak to the user (almost always true), deliverToAgent: hand off to another agent, deliverToHuman: escalate to a human operator, endConversation: close when resolved }.
- guardrails: { enabled, scope: plain-English of what it may discuss, refusal: optional message when blocked }. Enable when the agent should stay on-topic.
- knowledge: leave bucketIds empty (the user assigns real buckets after creating them); just set enabled when the agent should search a knowledge base.
- customTools / mcpServers / handoffRules: only when the user describes them; otherwise omit.

Keep a warm, efficient tone. You are configuring software, not role-playing the agent.`;

/**
 * Run the builder conversation and return a UIMessage stream. The two tools write
 * proposal data parts straight into the stream (the model's text continues
 * around them); the UI maps each part to a card and merges the config patch.
 */
export function buildConfig(input: BuildConfigInput): ReadableStream<UIMessageChunk> {
  const { messages, currentDraft, editing = false } = input;

  return createUIMessageStream<BuilderUIMessage>({
    originalMessages: messages,
    execute: async ({ writer }) => {
      const tools = {
        propose_agent_config: tool({
          description:
            "Propose a partial agent configuration to merge into the draft. Call " +
            "this whenever you've learned enough to set one or more fields; you may " +
            "call it repeatedly as the conversation refines the design.",
          inputSchema: z.object({
            summary: z
              .string()
              .describe("One short line describing what this proposal sets."),
            config: AgentInputSchema.describe(
              "Partial agent config — include only the fields you're setting now.",
            ),
          }),
          execute: async ({ summary, config }) => {
            writer.write({
              type: "data-config-proposal",
              data: { summary, config: config as AgentInput },
            });
            return { applied: true };
          },
        }),
        propose_knowledge_seed: tool({
          description:
            "Propose a starter knowledge base for this agent — a bucket name and a " +
            "few short seed documents the user can create and assign.",
          inputSchema: z.object({
            summary: z.string().describe("One short line describing the seed knowledge."),
            bucketName: z.string().describe("A name for the knowledge base."),
            description: z.string().optional(),
            documents: z
              .array(
                z.object({
                  title: z.string(),
                  content: z.string().describe("The document body (plain text/markdown)."),
                }),
              )
              .min(1)
              .max(4),
          }),
          execute: async ({ summary, bucketName, description, documents }) => {
            writer.write({
              type: "data-knowledge-seed",
              data: { summary, bucketName, description, documents },
            });
            return { proposed: true };
          },
        }),
        ask_choice: tool({
          description:
            "Ask the user a question as a set of selectable options instead of " +
            "free text. PREFER this whenever the answer is one of a few known " +
            "choices — yes/no, picking a tone, choosing which built-in tools to " +
            "enable, etc. Set multi: true to let the user pick several. After " +
            "calling this, stop and wait for their selection.",
          inputSchema: z.object({
            question: z.string(),
            options: z
              .array(
                z.object({
                  label: z.string(),
                  description: z.string().optional(),
                }),
              )
              .min(2)
              .max(8),
            multi: z.boolean().optional(),
            allowFreeText: z
              .boolean()
              .optional()
              .describe(
                "Also show a free-text box so the user can answer outside the options.",
              ),
          }),
          execute: async ({ question, options, multi, allowFreeText }) => {
            writer.write({
              type: "data-ask-choice",
              data: {
                id: `choice-${crypto.randomUUID()}`,
                question,
                options,
                multi: multi ?? false,
                allowFreeText: allowFreeText ?? false,
              },
            });
            return { shown: true };
          },
        }),
      };

      const result = streamText({
        model: resolveModel(builderModelId()),
        system: `${SYSTEM}\n\n${draftContext(currentDraft, editing)}`,
        temperature: 0.4,
        messages: await convertToModelMessages(messages),
        tools,
        // Allow proposals + a follow-up text turn within one reply, but end the
        // turn as soon as the assistant asks a multiple-choice question so the UI
        // can render the options and wait for the user's selection.
        stopWhen: [stepCountIs(5), hasToolCall("ask_choice")],
      });

      writer.merge(result.toUIMessageStream());
    },
    onError: (error) =>
      process.env.NODE_ENV === "production"
        ? "An error occurred."
        : `Builder error: ${error instanceof Error ? error.message : String(error)}`,
  });
}
