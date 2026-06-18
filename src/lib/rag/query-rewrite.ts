// Query rewriting: turn the user's latest message (in conversational context)
// into a standalone, keyword-rich search query. This resolves pronouns /
// follow-ups ("what about the deluxe one?") into a self-contained query and
// expands terms for both vector and keyword retrieval. Fail-soft: on any error
// we fall back to the raw query so retrieval still runs.
import { generateText } from "ai";
import { resolveModel } from "@/lib/agents/model";

export type RewrittenQuery = {
  /** Standalone search query used for embedding + full-text search. */
  query: string;
  /** Extra keywords/synonyms to widen keyword recall. */
  keywords: string[];
};

const SYSTEM =
  "You rewrite a user's latest message into a single standalone search query for a " +
  "knowledge base. Resolve references to earlier turns, drop chit-chat, and keep the " +
  "user's intent. Also list a few keywords/synonyms that would help keyword search. " +
  'Reply with ONLY JSON: {"query": string, "keywords": string[]}.';

export async function rewriteQuery(
  pipelineModel: string,
  latestUserText: string,
  context = "",
): Promise<RewrittenQuery> {
  const fallback: RewrittenQuery = { query: latestUserText.trim(), keywords: [] };
  if (!latestUserText.trim()) return fallback;

  try {
    const { text } = await generateText({
      model: resolveModel(pipelineModel),
      temperature: 0,
      system: SYSTEM,
      prompt:
        (context ? `CONVERSATION (most recent last):\n${context}\n\n` : "") +
        `LATEST USER MESSAGE:\n${latestUserText}\n\nRewrite it into a search query.`,
    });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const raw = JSON.parse(match[0]) as Partial<RewrittenQuery>;
    const query = typeof raw.query === "string" && raw.query.trim() ? raw.query.trim() : fallback.query;
    const keywords = Array.isArray(raw.keywords)
      ? raw.keywords.filter((k): k is string => typeof k === "string").slice(0, 8)
      : [];
    return { query, keywords };
  } catch (err) {
    console.error("[rag] query rewrite failed, using raw query:", err);
    return fallback;
  }
}
