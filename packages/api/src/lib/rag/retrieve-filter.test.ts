import { describe, expect, it } from "vitest";
import { applyRelevanceFloor, buildRetrievalFilter } from "@/lib/rag/retrieve-filter";
import type { RetrievedChunk } from "@/lib/rag/types";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "chunk-1",
    documentId: "doc-1",
    bucketId: "bucket-1",
    content: "some content",
    metadata: {},
    documentTitle: "Title",
    documentSource: "source",
    score: 0.5,
    ...overrides,
  };
}

describe("buildRetrievalFilter", () => {
  it("always includes tenant_id as the first must clause", () => {
    const filter = buildRetrievalFilter({ tenantId: "ws_1" });
    expect(filter.must[0]).toEqual({ key: "tenant_id", match: { value: "ws_1" } });
  });

  it("never drops or replaces the tenant_id clause when other filters are present", () => {
    const filter = buildRetrievalFilter({
      tenantId: "ws_1",
      tags: ["a", "b"],
      sourceType: "file",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
    });
    expect(filter.must[0]).toEqual({ key: "tenant_id", match: { value: "ws_1" } });
    expect(filter.must.some((c) => c.key === "tenant_id")).toBe(true);
  });

  it("appends a tags clause with OR (match.any) semantics when tags is non-empty", () => {
    const filter = buildRetrievalFilter({ tenantId: "ws_1", tags: ["foo", "bar"] });
    expect(filter.must).toContainEqual({ key: "tags", match: { any: ["foo", "bar"] } });
  });

  it("omits the tags clause when tags is empty or undefined", () => {
    const empty = buildRetrievalFilter({ tenantId: "ws_1", tags: [] });
    const undef = buildRetrievalFilter({ tenantId: "ws_1" });
    expect(empty.must.some((c) => c.key === "tags")).toBe(false);
    expect(undef.must.some((c) => c.key === "tags")).toBe(false);
  });

  it("appends a source_type clause when sourceType is given", () => {
    const filter = buildRetrievalFilter({ tenantId: "ws_1", sourceType: "file" });
    expect(filter.must).toContainEqual({ key: "source_type", match: { value: "file" } });
  });

  it("omits the source_type clause when sourceType is absent", () => {
    const filter = buildRetrievalFilter({ tenantId: "ws_1" });
    expect(filter.must.some((c) => c.key === "source_type")).toBe(false);
  });

  it("appends an ingested_at range clause when dateFrom and/or dateTo are given", () => {
    const both = buildRetrievalFilter({ tenantId: "ws_1", dateFrom: "2026-01-01", dateTo: "2026-02-01" });
    expect(both.must).toContainEqual({
      key: "ingested_at",
      range: { gte: "2026-01-01", lte: "2026-02-01" },
    });

    const fromOnly = buildRetrievalFilter({ tenantId: "ws_1", dateFrom: "2026-01-01" });
    expect(fromOnly.must).toContainEqual({
      key: "ingested_at",
      range: { gte: "2026-01-01", lte: undefined },
    });
  });

  it("omits the ingested_at clause when both dateFrom and dateTo are absent", () => {
    const filter = buildRetrievalFilter({ tenantId: "ws_1" });
    expect(filter.must.some((c) => c.key === "ingested_at")).toBe(false);
  });
});

describe("applyRelevanceFloor", () => {
  it("drops chunks scoring below the default floor when no bucket override exists", () => {
    const chunks = [chunk({ id: "a", bucketId: "b1", score: 0.5 }), chunk({ id: "b", bucketId: "b1", score: 0.1 })];
    const result = applyRelevanceFloor(chunks, new Map(), 0.3);
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });

  it("uses a bucket's override floor over the default when present", () => {
    const chunks = [chunk({ id: "a", bucketId: "b1", score: 0.4 }), chunk({ id: "b", bucketId: "b2", score: 0.4 })];
    const floorByBucket = new Map<string, number | null | undefined>([["b1", 0.5]]);
    const result = applyRelevanceFloor(chunks, floorByBucket, 0.3);
    // b1 has an override of 0.5 -> 0.4 dropped; b2 falls back to default 0.3 -> kept
    expect(result.map((c) => c.id)).toEqual(["b"]);
  });

  it("falls back to the default floor when a bucket's override is null or undefined", () => {
    const chunks = [chunk({ id: "a", bucketId: "b1", score: 0.35 })];
    const nullOverride = new Map<string, number | null | undefined>([["b1", null]]);
    const undefinedOverride = new Map<string, number | null | undefined>([["b1", undefined]]);
    expect(applyRelevanceFloor(chunks, nullOverride, 0.3).map((c) => c.id)).toEqual(["a"]);
    expect(applyRelevanceFloor(chunks, undefinedOverride, 0.3).map((c) => c.id)).toEqual(["a"]);
  });

  it("returns [] when all chunks are below their effective floor", () => {
    const chunks = [chunk({ id: "a", bucketId: "b1", score: 0.1 }), chunk({ id: "b", bucketId: "b2", score: 0.05 })];
    const result = applyRelevanceFloor(chunks, new Map(), 0.3);
    expect(result).toEqual([]);
  });

  it("keeps chunks whose bucketId has no map entry, using the default floor", () => {
    const chunks = [chunk({ id: "a", bucketId: "unknown-bucket", score: 0.9 })];
    const result = applyRelevanceFloor(chunks, new Map(), 0.3);
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });
});
