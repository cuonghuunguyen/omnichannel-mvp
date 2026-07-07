import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { deepseek, createDeepSeek } from "@ai-sdk/deepseek";
import { google, createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai, createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Resolve a provider language model from a model id string. Provider is chosen
 * by id prefix: "deepseek-*" -> DeepSeek, "gemini-*" -> Google, "gpt-*" ->
 * OpenAI, everything else -> Anthropic.
 * (Duplicated from the chat service by design — the two services don't share a
 * package; this is ~10 lines.)
 *
 * When `apiKey` is provided the provider is instantiated with that key (BYOK
 * per-request key delivered via X-Provider-Key header). When absent the default
 * env-backed provider instances are used.
 *
 * Keep the prefix rule in sync with Laravel's ProviderResolver::fromModel()
 * (app/Support/ProviderResolver.php) — the two must agree (D-02).
 */
export function resolveModel(modelId: string, apiKey?: string): LanguageModel {
  if (modelId.startsWith("deepseek")) {
    return apiKey ? createDeepSeek({ apiKey })(modelId) : deepseek(modelId);
  }
  if (modelId.startsWith("gemini")) {
    return apiKey ? createGoogleGenerativeAI({ apiKey })(modelId) : google(modelId);
  }
  if (modelId.startsWith("gpt")) {
    return apiKey ? createOpenAI({ apiKey })(modelId) : openai(modelId);
  }
  return apiKey ? createAnthropic({ apiKey })(modelId) : anthropic(modelId);
}

export const DEFAULT_MODEL_ID = "deepseek-chat";

/** Steps a single agent turn may take (tool calls + final text). */
export const MAX_STEPS_PER_AGENT = 6;

/** Max number of agent-to-agent handoffs within one HTTP turn. */
export const MAX_HOPS = 4;
