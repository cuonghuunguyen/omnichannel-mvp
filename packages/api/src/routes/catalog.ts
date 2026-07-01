// Static provider and model catalog. Returns the full set of providers and
// models this sidecar supports — chat (Anthropic, DeepSeek) and embedding
// (OpenAI, Voyage, Voyage-Multimodal, Local). No auth required; this is
// metadata only — no keys or tenant data is included.
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
          { id: "claude-3-5-sonnet-20241022", displayName: "Claude 3.5 Sonnet" },
          { id: "claude-3-5-haiku-20241022", displayName: "Claude 3.5 Haiku" },
          { id: "claude-opus-4-5-20251101", displayName: "Claude Opus 4.5" },
          { id: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5" },
          { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5" },
        ],
      },
      {
        id: "deepseek",
        name: "DeepSeek",
        kind: "chat",
        models: [
          { id: "deepseek-chat", displayName: "DeepSeek Chat" },
          { id: "deepseek-reasoner", displayName: "DeepSeek Reasoner" },
          { id: "deepseek-v3", displayName: "DeepSeek V3" },
          { id: "deepseek-r1", displayName: "DeepSeek R1" },
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
          { id: "voyage-3", displayName: "voyage-3" },
          { id: "voyage-3-lite", displayName: "voyage-3-lite" },
          { id: "voyage-multimodal-3", displayName: "voyage-multimodal-3" },
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
