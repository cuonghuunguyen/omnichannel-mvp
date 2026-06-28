// "Auto-detect the embedding algorithm": pick the best embedding provider for a
// bucket from what's actually configured. Resolved once at bucket creation and
// pinned, so the bucket keeps one consistent (provider, model, dimension).
//
//   - VOYAGE_API_KEY set  → voyage-multimodal (text + images share one space)
//   - OPENAI_API_KEY set  → openai (strong text embeddings)
//   - otherwise           → local (free, on-device, text only)
//
// A multimodal default means an "auto" bucket can ingest images natively when a
// Voyage key is present; without one, images fall back to text (OCR/caption).
import { PROVIDER_DEFAULTS } from "@/lib/rag/embeddings";
import type { EmbeddingProviderId } from "@/lib/rag/types";

export type ResolvedEmbedding = { provider: EmbeddingProviderId; model: string };

/** Resolve the best available embedding provider+model from configured keys. */
export function resolveAutoEmbedding(): ResolvedEmbedding {
  if (process.env.VOYAGE_API_KEY) {
    return { provider: "voyage-multimodal", model: PROVIDER_DEFAULTS["voyage-multimodal"].model };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", model: PROVIDER_DEFAULTS.openai.model };
  }
  return { provider: "local", model: PROVIDER_DEFAULTS.local.model };
}
