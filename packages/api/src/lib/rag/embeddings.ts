// Pluggable embeddings layer. A bucket pins one provider + model + dimension at
// creation; ingestion and query-time embedding both go through the same config
// so vectors are always comparable. Keys come from the config (BYOK) and fall
// back to env, so this is ready for per-tenant keys later.
import type { EmbeddingProviderId } from "@/lib/rag/types";
import { TIMEOUTS } from "@/lib/resilience";

export type EmbeddingKind = "query" | "document";

/** One item for multimodal embedding: a piece of text or an image (base64). */
export type MultimodalItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mediaType: string };

export type EmbeddingProvider = {
  provider: EmbeddingProviderId;
  model: string;
  dimensions: number;
  /** Embed a batch of texts; `kind` lets a provider use query/doc-specific modes. */
  embed(texts: string[], kind?: EmbeddingKind): Promise<number[][]>;
  /**
   * Embed multimodal items (text and/or images) into the same space as `embed`.
   * Only multimodal providers implement this; see `isMultimodalProvider`.
   */
  embedMultimodal?(items: MultimodalItem[], kind?: EmbeddingKind): Promise<number[][]>;
};

/** True when the provider embeds images + text into one shared space. */
export function isMultimodalProvider(provider: EmbeddingProviderId): boolean {
  return provider === "voyage-multimodal";
}

export type EmbeddingConfig = {
  provider: EmbeddingProviderId;
  model: string;
  /** Optional override; falls back to the provider's env key. */
  apiKey?: string;
};

/** Default model + dimension for each provider. */
export const PROVIDER_DEFAULTS: Record<
  EmbeddingProviderId,
  { model: string; dimensions: number; label: string }
> = {
  local: { model: "Xenova/bge-small-en-v1.5", dimensions: 384, label: "Local (bge-small)" },
  openai: { model: "text-embedding-3-small", dimensions: 1536, label: "OpenAI" },
  voyage: { model: "voyage-3", dimensions: 1024, label: "Voyage AI" },
  "voyage-multimodal": {
    model: "voyage-multimodal-3.5",
    dimensions: 1024,
    label: "Voyage AI (multimodal)",
  },
};

/** Known dimensions for non-default models so a bucket records the right size. */
const MODEL_DIMENSIONS: Record<string, number> = {
  "Xenova/bge-small-en-v1.5": 384,
  "Xenova/all-MiniLM-L6-v2": 384,
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "voyage-3": 1024,
  "voyage-3-lite": 512,
  "voyage-multimodal-3.5": 1024,
  "voyage-multimodal-3": 1024,
};

export function dimensionsFor(provider: EmbeddingProviderId, model: string): number {
  return MODEL_DIMENSIONS[model] ?? PROVIDER_DEFAULTS[provider].dimensions;
}

/** The system default config, from EMBEDDING_PROVIDER (used when a bucket omits one). */
export function defaultEmbeddingConfig(): EmbeddingConfig {
  const provider = (process.env.EMBEDDING_PROVIDER || "local") as EmbeddingProviderId;
  const known = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.local;
  return { provider: provider in PROVIDER_DEFAULTS ? provider : "local", model: known.model };
}

/** Resolve a concrete provider implementation for a config. */
export function getEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case "openai":
      return openaiProvider(config);
    case "voyage":
      return voyageProvider(config);
    case "voyage-multimodal":
      return voyageMultimodalProvider(config);
    case "local":
    default:
      return localProvider(config);
  }
}

// ── Local (transformers.js) ──────────────────────────────────────────────────
// Lazy-loaded so the heavy onnxruntime dependency is only pulled in when the
// local provider is actually used. The pipeline is cached per model.
const localPipelines = new Map<string, Promise<unknown>>();

function localPipeline(model: string): Promise<unknown> {
  let p = localPipelines.get(model);
  if (!p) {
    p = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline("feature-extraction", model);
    })();
    localPipelines.set(model, p);
  }
  return p;
}

function localProvider(config: EmbeddingConfig): EmbeddingProvider {
  const model = config.model || PROVIDER_DEFAULTS.local.model;
  return {
    provider: "local",
    model,
    dimensions: dimensionsFor("local", model),
    async embed(texts) {
      if (texts.length === 0) return [];
      const extractor = (await localPipeline(model)) as (
        input: string[],
        opts: { pooling: "mean"; normalize: boolean },
      ) => Promise<{ tolist(): number[][] }>;
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      return output.tolist();
    },
  };
}

// ── OpenAI ───────────────────────────────────────────────────────────────────
function openaiProvider(config: EmbeddingConfig): EmbeddingProvider {
  const model = config.model || PROVIDER_DEFAULTS.openai.model;
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  return {
    provider: "openai",
    model,
    dimensions: dimensionsFor("openai", model),
    async embed(texts) {
      if (texts.length === 0) return [];
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set for the OpenAI embedding provider.");
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(TIMEOUTS.embeddingMs),
      });
      if (!res.ok) throw new Error(`OpenAI embeddings failed (${res.status}): ${await res.text()}`);
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    },
  };
}

// ── Voyage AI ──────────────────────────────────────────────────────────────--
function voyageProvider(config: EmbeddingConfig): EmbeddingProvider {
  const model = config.model || PROVIDER_DEFAULTS.voyage.model;
  const apiKey = config.apiKey || process.env.VOYAGE_API_KEY;
  return {
    provider: "voyage",
    model,
    dimensions: dimensionsFor("voyage", model),
    async embed(texts, kind = "document") {
      if (texts.length === 0) return [];
      if (!apiKey) throw new Error("VOYAGE_API_KEY is not set for the Voyage embedding provider.");
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts, input_type: kind }),
        signal: AbortSignal.timeout(TIMEOUTS.embeddingMs),
      });
      if (!res.ok) throw new Error(`Voyage embeddings failed (${res.status}): ${await res.text()}`);
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    },
  };
}

// ── Voyage AI (multimodal) ─────────────────────────────────────────────────--
// One transformer encodes text and images into the same space, so a bucket pinned
// to this provider stores/queries both. Text and image inputs go through the same
// /multimodalembeddings endpoint; `embed` is the text-only path used for chunks
// and queries, `embedMultimodal` carries images.
function voyageMultimodalProvider(config: EmbeddingConfig): EmbeddingProvider {
  const model = config.model || PROVIDER_DEFAULTS["voyage-multimodal"].model;
  const apiKey = config.apiKey || process.env.VOYAGE_API_KEY;

  async function call(
    inputs: { content: unknown[] }[],
    kind: EmbeddingKind,
  ): Promise<number[][]> {
    if (inputs.length === 0) return [];
    if (!apiKey) throw new Error("VOYAGE_API_KEY is not set for the Voyage embedding provider.");
    const res = await fetch("https://api.voyageai.com/v1/multimodalembeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, inputs, input_type: kind }),
      signal: AbortSignal.timeout(TIMEOUTS.embeddingMs),
    });
    if (!res.ok) {
      throw new Error(`Voyage multimodal embeddings failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  return {
    provider: "voyage-multimodal",
    model,
    dimensions: dimensionsFor("voyage-multimodal", model),
    embed(texts, kind = "document") {
      return call(
        texts.map((text) => ({ content: [{ type: "text", text }] })),
        kind,
      );
    },
    embedMultimodal(items, kind = "document") {
      return call(
        items.map((item) => ({
          content: [
            item.type === "text"
              ? { type: "text", text: item.text }
              : { type: "image_base64", image_base64: `data:${item.mediaType};base64,${item.data}` },
          ],
        })),
        kind,
      );
    },
  };
}
