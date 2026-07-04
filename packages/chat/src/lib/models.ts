// Selectable models for the agent builder. `id` must match what resolveModel()
// understands (deepseek-* -> DeepSeek, gemini-* -> Google, everything else ->
// Anthropic).
export type ModelOption = {
  id: string;
  label: string;
  provider: "deepseek" | "anthropic" | "google";
};

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "deepseek-chat", label: "DeepSeek Chat", provider: "deepseek" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
  },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro", provider: "google" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", provider: "google" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
];

export const DEFAULT_MODEL_ID = "deepseek-chat";
