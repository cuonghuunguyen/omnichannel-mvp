import { describe, expect, it } from "vitest";
import {
  VERSION_HISTORY_CAP,
  diffChunks,
  hashChunk,
  idsToPrune,
  shouldFullReembed,
} from "@/lib/rag/document-versioning";
import type { Chunk } from "@/lib/rag/chunk";

function chunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    content: "default content",
    ...overrides,
  };
}

describe("hashChunk", () => {
  it("hashes identical content identically regardless of the context field", () => {
    const a = chunk({ content: "same text", context: "Section A" });
    const b = chunk({ content: "same text", context: "Section B" });
    expect(hashChunk(a)).toBe(hashChunk(b));
  });

  it("hashes different content differently", () => {
    const a = chunk({ content: "text one" });
    const b = chunk({ content: "text two" });
    expect(hashChunk(a)).not.toBe(hashChunk(b));
  });

  it("normalizes whitespace the same way contentHash does (case-preserving)", () => {
    const a = chunk({ content: "The quick brown fox" });
    const b = chunk({ content: "  The   quick brown   fox  " });
    expect(hashChunk(a)).toBe(hashChunk(b));
  });
});

describe("diffChunks", () => {
  it("treats every new chunk as toEmbed when there are no old chunks (first-ever diff)", () => {
    const a = chunk({ content: "A" });
    const b = chunk({ content: "B" });
    const result = diffChunks([], [a, b]);
    expect(result.toEmbed).toEqual([a, b]);
    expect(result.toDeleteHashes).toEqual([]);
  });

  it("is position-independent — reordering identical content produces no diff", () => {
    const a = chunk({ content: "A" });
    const b = chunk({ content: "B" });
    const result = diffChunks([a, b], [b, a]);
    expect(result.toEmbed).toEqual([]);
    expect(result.toDeleteHashes).toEqual([]);
  });

  it("identifies added and removed chunks by exact-hash comparison", () => {
    const a = chunk({ content: "A" });
    const b = chunk({ content: "B" });
    const c = chunk({ content: "C" });
    const result = diffChunks([a, b], [a, c]);
    expect(result.toEmbed).toEqual([c]);
    expect(result.toDeleteHashes).toEqual([hashChunk(b)]);
  });

  it("treats an edited chunk (same context, different content) as removed+added, not unchanged", () => {
    const a = chunk({ content: "original", context: "Section A" });
    const aEdited = chunk({ content: "edited", context: "Section A" });
    const result = diffChunks([a], [aEdited]);
    expect(result.toEmbed).toEqual([aEdited]);
    expect(result.toDeleteHashes).toEqual([hashChunk(a)]);
  });

  it("deletes all old chunks when every chunk is removed and none added", () => {
    const a = chunk({ content: "A" });
    const b = chunk({ content: "B" });
    const result = diffChunks([a, b], []);
    expect(result.toEmbed).toEqual([]);
    expect(result.toDeleteHashes).toEqual([hashChunk(a), hashChunk(b)]);
  });
});

describe("shouldFullReembed", () => {
  it("is true when there is no prior version to diff against (OQ-1)", () => {
    expect(
      shouldFullReembed({
        newResolvedStrategy: "markdown",
        recordedStrategy: "markdown",
        hasLatestVersion: false,
      }),
    ).toBe(true);
  });

  it("is true when the resolved strategy differs from the recorded strategy (D-12)", () => {
    expect(
      shouldFullReembed({
        newResolvedStrategy: "recursive",
        recordedStrategy: "markdown",
        hasLatestVersion: true,
      }),
    ).toBe(true);
  });

  it("is false when a prior version exists and the strategy is unchanged (real diff path)", () => {
    expect(
      shouldFullReembed({
        newResolvedStrategy: "markdown",
        recordedStrategy: "markdown",
        hasLatestVersion: true,
      }),
    ).toBe(false);
  });
});

describe("idsToPrune", () => {
  it("returns the ids beyond the cap, in their original relative order", () => {
    const ids = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"];
    expect(idsToPrune(ids, 5)).toEqual(["v6", "v7"]);
  });

  it("returns [] when the id count is under the cap", () => {
    const ids = ["v1", "v2", "v3"];
    expect(idsToPrune(ids, 5)).toEqual([]);
  });

  it("returns [] when the id count is exactly at the cap (pruning is 'beyond', not 'at')", () => {
    const ids = ["v1", "v2", "v3", "v4", "v5"];
    expect(idsToPrune(ids, 5)).toEqual([]);
  });

  it("returns [] for an empty id list", () => {
    expect(idsToPrune([], 5)).toEqual([]);
  });
});

describe("VERSION_HISTORY_CAP", () => {
  it("defaults to 5 (D-05/D-06)", () => {
    expect(VERSION_HISTORY_CAP).toBe(5);
  });
});
