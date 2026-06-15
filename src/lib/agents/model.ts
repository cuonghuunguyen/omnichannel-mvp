import { anthropic } from "@ai-sdk/anthropic";
import { deepseek } from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";

/**
 * Resolve a provider language model from an Agent's `model` string.
 * Provider is chosen by id prefix:
 *   - "deepseek-*"  -> DeepSeek (needs DEEPSEEK_API_KEY)
 *   - "claude-*"    -> Anthropic (needs ANTHROPIC_API_KEY)
 */
export function resolveModel(modelId: string): LanguageModel {
  if (modelId.startsWith("deepseek")) return deepseek(modelId);
  return anthropic(modelId);
}

/** Steps a single agent turn may take (tool calls + final text). */
export const MAX_STEPS_PER_AGENT = 6;

/** Max number of agent-to-agent handoffs within one HTTP turn. */
export const MAX_HOPS = 4;
