import { anthropic } from "@ai-sdk/anthropic";
import { deepseek } from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";

/**
 * Resolve a provider language model from a model id string. Provider is chosen
 * by id prefix: "deepseek-*" -> DeepSeek, everything else -> Anthropic.
 * (Duplicated from the chat service by design — the two services don't share a
 * package; this is ~10 lines.)
 */
export function resolveModel(modelId: string): LanguageModel {
  if (modelId.startsWith("deepseek")) return deepseek(modelId);
  return anthropic(modelId);
}

export const DEFAULT_MODEL_ID = "deepseek-chat";
