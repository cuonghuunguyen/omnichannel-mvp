// Static provider and model catalog. Returns the full set of providers and
// models this sidecar supports — chat (Anthropic, DeepSeek, Google Gemini,
// OpenAI) and embedding (OpenAI, Voyage, Voyage-Multimodal, Local). No auth
// required; this is metadata only — no keys or tenant data is included.
//
// NOTE: OpenAI appears twice by design — once as a chat provider (gpt-* models)
// and once as an embedding provider (text-embedding-* models). Both share the
// slug "openai": OpenAI's API uses ONE key for chat and embeddings, and the
// workspace stores a single (workspace, "openai") key that serves both. The two
// entries carry different `kind`s so the UI buckets them into the correct tab.
import { Router } from "express";

export const catalogRouter: Router = Router();

catalogRouter.get("/", (_req, res) => {
  res.json({
    providers: [
      {
        id: "anthropic",
        name: "Anthropic",
        kind: "chat",
        models: [
          { id: "claude-fable-5", displayName: "Claude Fable 5" },
          { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
          { id: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
          { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5" },
          { id: "claude-opus-4-5-20251101", displayName: "Claude Opus 4.5 (legacy)" },
          { id: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5 (legacy)" },
        ],
      },
      {
        id: "deepseek",
        name: "DeepSeek",
        kind: "chat",
        models: [
          { id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" },
          { id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
        ],
      },
      {
        id: "google",
        name: "Google Gemini",
        kind: "chat",
        models: [
          { id: "gemini-3-pro-preview", displayName: "Gemini 3 Pro" },
          { id: "gemini-3-flash-preview", displayName: "Gemini 3 Flash" },
          { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
          { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
        ],
      },
      {
        id: "openai",
        name: "OpenAI",
        kind: "chat",
        models: [
          { id: "gpt-5", displayName: "GPT-5" },
          { id: "gpt-5-mini", displayName: "GPT-5 mini" },
          { id: "gpt-5-nano", displayName: "GPT-5 nano" },
          { id: "gpt-4o", displayName: "GPT-4o" },
          { id: "gpt-4o-mini", displayName: "GPT-4o mini" },
          { id: "gpt-4.1", displayName: "GPT-4.1" },
        ],
      },
      {
        id: "openai",
        name: "OpenAI",
        kind: "embedding",
        models: [
          { id: "text-embedding-3-small", displayName: "text-embedding-3-small" },
          { id: "text-embedding-3-large", displayName: "text-embedding-3-large" },
        ],
      },
      {
        id: "voyage",
        name: "Voyage",
        kind: "embedding",
        models: [
          { id: "voyage-4-large", displayName: "voyage-4-large" },
          { id: "voyage-4", displayName: "voyage-4" },
          { id: "voyage-4-lite", displayName: "voyage-4-lite" },
          { id: "voyage-multimodal-3.5", displayName: "voyage-multimodal-3.5" },
        ],
      },
      {
        id: "local",
        name: "Local (no key required)",
        kind: "embedding",
        models: [
          { id: "Xenova/bge-small-en-v1.5", displayName: "BGE-small (local)" },
        ],
      },
    ],
  });
});
