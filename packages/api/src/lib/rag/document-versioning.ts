// Pure, dependency-free decision/diff helpers for document re-ingestion and
// versioning (Phase 46). No DB, no Qdrant — mirrors the ingest-stats.ts /
// retrieve-filter.ts convention so these functions are trivially unit-testable
// without a live database or Qdrant instance. Orchestration (DocumentVersion
// row I/O, Qdrant point upsert/delete) belongs in buckets.ts (Plan 46-03),
// which calls these functions and does I/O around them.
import { contentHash } from "@/lib/rag/dedup";
import type { Chunk, ChunkStrategy } from "@/lib/rag/chunk";

/** Version-history cap (D-05/D-06): fixed system default, no per-bucket override. */
export const VERSION_HISTORY_CAP = 5;

/**
 * SHA-256 fingerprint of a chunk's `content`, reusing the same normalizer as
 * the document-level `contentHash` (D-10/V6). The `context` field (e.g.
 * heading path) is deliberately excluded — two chunks with identical content
 * hash identically regardless of where they sit structurally.
 */
export function hashChunk(chunk: Chunk): string {
  return contentHash(chunk.content);
}

export type ChunkDiff = {
  /** Chunks present in `newChunks` with no exact-hash match in `oldChunks`, in `newChunks` order. */
  toEmbed: Chunk[];
  /** Content hashes of `oldChunks` with no exact-hash match in `newChunks`. */
  toDeleteHashes: string[];
};

/**
 * Exact-hash, position-independent diff between an old and new chunk set
 * (D-09/D-10). A chunk is "unchanged" only if its exact content hash appears
 * in both sets — no fuzzy/semantic matching, so an edited chunk (same
 * structural position, different content) is treated as removed+added, never
 * as an in-place update.
 */
export function diffChunks(oldChunks: Chunk[], newChunks: Chunk[]): ChunkDiff {
  const oldHashes = new Set(oldChunks.map((c) => hashChunk(c)));
  const newHashes = new Set(newChunks.map((c) => hashChunk(c)));

  const toEmbed = newChunks.filter((c) => !oldHashes.has(hashChunk(c)));
  const toDeleteHashes = oldChunks
    .filter((c) => !newHashes.has(hashChunk(c)))
    .map((c) => hashChunk(c));

  return { toEmbed, toDeleteHashes };
}

export type ShouldFullReembedInput = {
  /** The chunk strategy resolved for this update call (post "auto" resolution). */
  newResolvedStrategy: Exclude<ChunkStrategy, "auto">;
  /** The strategy recorded on the document from its last ingest/update. */
  recordedStrategy: Exclude<ChunkStrategy, "auto">;
  /** Whether a prior DocumentVersion exists to diff against. */
  hasLatestVersion: boolean;
};

/**
 * Decide between the full re-embed path and the real per-chunk diff path,
 * purely from strategy/version-existence inputs (D-12/OQ-1) — no DB or
 * Qdrant call needed to make this decision.
 */
export function shouldFullReembed(input: ShouldFullReembedInput): boolean {
  if (!input.hasLatestVersion) return true; // OQ-1: no diff baseline exists yet
  if (input.newResolvedStrategy !== input.recordedStrategy) return true; // D-12
  return false;
}

/**
 * Given version ids ordered newest-first, return the ids beyond `cap`
 * (D-05/D-06) — i.e. the oldest ones to prune — preserving their relative
 * order. Pruning is strictly "beyond" the cap: exactly `cap` ids prunes none.
 */
export function idsToPrune(versionIdsNewestFirst: string[], cap: number): string[] {
  return versionIdsNewestFirst.slice(cap);
}
