// Adapters between the OpenAI Chat Completions wire format and this service's
// internal UIMessage orchestration. The OpenAI facade (routes/openai.ts) is a
// thin shell over orchestrate(): it maps the request in, drains the UIMessage
// stream's text, and shapes the response out — streaming or buffered.
import type { UIMessageChunk } from "ai";
import type { ChatUIMessage } from "@/lib/agents/ui-messages";

/** One message as an OpenAI client sends it. */
export type OpenAiMessage = {
  role: string;
  /** String, or the multimodal part array; we keep only the text. */
  content?: string | Array<Record<string, unknown>>;
};

/** Flatten OpenAI message content (string or part array) to plain text. */
export function contentToText(content: OpenAiMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

/**
 * Convert OpenAI messages to the internal UIMessage shape that orchestrate()
 * consumes. Roles collapse to system/user/assistant (anything that isn't system
 * or assistant — e.g. `tool` — is treated as user input for the loop's purposes).
 */
export function toUiMessages(messages: OpenAiMessage[]): ChatUIMessage[] {
  return messages.map((m, i) => {
    const role: ChatUIMessage["role"] =
      m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user";
    return {
      id: `msg-${i}`,
      role,
      parts: [{ type: "text", text: contentToText(m.content) }],
    } as ChatUIMessage;
  });
}

/**
 * Drain a UIMessage stream, concatenating every text delta into the final
 * assistant text and invoking onDelta for each (used to fan out SSE chunks).
 * Routing/guardrail/knowledge data parts are intentionally ignored here — those
 * are side-channel events delivered via the webhook, not part of the answer.
 */
export async function drainText(
  stream: ReadableStream<UIMessageChunk>,
  onDelta?: (delta: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  let full = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.type === "text-delta") {
        const delta = (value as { delta?: string }).delta ?? "";
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}
