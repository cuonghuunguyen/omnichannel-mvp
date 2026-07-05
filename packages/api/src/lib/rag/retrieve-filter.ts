// Pure, DB/Qdrant-free helpers factored out of retrieve.ts for the read-path
// halves of the relevance-floor (D-05/D-06) and metadata-filter (D-13/D-14/D-15)
// gaps. Kept pure + unit-tested because both are security/quality-critical:
// buildRetrievalFilter must never drop tenant scoping, and applyRelevanceFloor
// is the sole gate on result quality.
import type { RetrievedChunk } from "@/lib/rag/types";

type QdrantFilterClause =
  | { key: string; match: { value: string } }
  | { key: string; match: { any: string[] } }
  | { key: string; range: { gte?: string; lte?: string } };

export type QdrantFilter = { must: QdrantFilterClause[] };

export type BuildRetrievalFilterOptions = {
  /** Tenant that owns the buckets — always the first, mandatory must-clause. */
  tenantId: string;
  /** OR-matched tags (D-15) — omitted from the filter when empty/undefined. */
  tags?: string[];
  /** Exact source-type match — omitted when absent. */
  sourceType?: string;
  /** Inclusive ingested_at range lower bound (ISO date/datetime string). */
  dateFrom?: string;
  /** Inclusive ingested_at range upper bound (ISO date/datetime string). */
  dateTo?: string;
};

/**
 * Compose the Qdrant `filter` passed to `client.query`. The tenant clause is
 * always present and always first — every other clause is appended into the
 * same `must` array (never a separate/replacing filter object), so a caller
 * can only ever narrow results within their own tenant, never escape it
 * (security-critical, V4 Access Control / T-45-02).
 */
export function buildRetrievalFilter(opts: BuildRetrievalFilterOptions): QdrantFilter {
  const must: QdrantFilterClause[] = [{ key: "tenant_id", match: { value: opts.tenantId } }];
  if (opts.tags?.length) {
    must.push({ key: "tags", match: { any: opts.tags } });
  }
  if (opts.sourceType) {
    must.push({ key: "source_type", match: { value: opts.sourceType } });
  }
  if (opts.dateFrom || opts.dateTo) {
    must.push({ key: "ingested_at", range: { gte: opts.dateFrom, lte: opts.dateTo } });
  }
  return { must };
}

/**
 * Drop chunks scoring below their bucket's effective relevance floor
 * (D-05: enforced post-rerank; D-06: per-bucket override takes precedence
 * over the workspace-wide default). Resolved per chunk's own `bucketId` —
 * never a single value applied to the whole merged/reranked set, since a
 * single `retrieve()` call can span buckets with different overrides.
 *
 * @param floorByBucket - bucketId -> override floor (null/undefined/missing
 *   all fall back to `defaultFloor`).
 * @param defaultFloor - the workspace-wide default (env-configurable).
 */
export function applyRelevanceFloor(
  chunks: RetrievedChunk[],
  floorByBucket: Map<string, number | null | undefined>,
  defaultFloor: number,
): RetrievedChunk[] {
  return chunks.filter((chunk) => {
    const override = floorByBucket.get(chunk.bucketId);
    const effectiveFloor = override ?? defaultFloor;
    return chunk.score >= effectiveFloor;
  });
}
