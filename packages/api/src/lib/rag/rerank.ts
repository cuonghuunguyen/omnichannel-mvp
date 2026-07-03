// Reranking: a second-stage relevance pass over the fused candidate set. The
// default is an LLM listwise reranker (provider-agnostic, no extra service); the
// Reranker type leaves room to drop in a hosted cross-encoder (Voyage/Cohere) or
// a local cross-encoder later. Fail-soft: on error we keep the fusion order.
import { generateText } from "ai";
import { resolveModel } from "@/lib/models";
import { TIMEOUTS } from "@/lib/resilience";
import type { RetrievedChunk } from "@/lib/rag/types";

export type Reranker = (
  query: string,
  candidates: RetrievedChunk[],
  topK: number,
) => Promise<RetrievedChunk[]>;

/** Build the default LLM reranker bound to a model id. */
export function llmReranker(pipelineModel: string, providerApiKey?: string): Reranker {
  return async (query, candidates, topK) => {
    if (candidates.length <= 1) return candidates.slice(0, topK);

    const list = candidates
      .map((c, i) => `[${i}] ${truncate(c.content, 400)}`)
      .join("\n\n");
    const system =
      "You are a search reranker. Given a query and numbered passages, score each " +
      "passage's relevance to the query from 0 (irrelevant) to 1 (directly answers it). " +
      'Reply with ONLY JSON: {"scores": [{"i": number, "score": number}, ...]} covering every passage.';

    try {
      const { text } = await generateText({
        model: resolveModel(pipelineModel, providerApiKey),
        temperature: 0,
        system,
        prompt: `QUERY:\n${query}\n\nPASSAGES:\n${list}`,
        timeout: TIMEOUTS.ragLlmMs,
      });
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return candidates.slice(0, topK);
      const raw = JSON.parse(match[0]) as { scores?: { i: number; score: number }[] };
      if (!Array.isArray(raw.scores)) return candidates.slice(0, topK);

      const byIndex = new Map<number, number>();
      for (const s of raw.scores) {
        if (typeof s.i === "number" && typeof s.score === "number") byIndex.set(s.i, s.score);
      }
      return candidates
        .map((c, i) => ({ ...c, score: byIndex.get(i) ?? 0 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    } catch (err) {
      console.error("[rag] rerank failed, keeping fusion order:", err);
      return candidates.slice(0, topK);
    }
  };
}

function truncate(text: string, n: number): string {
  return text.length > n ? text.slice(0, n) + "…" : text;
}
