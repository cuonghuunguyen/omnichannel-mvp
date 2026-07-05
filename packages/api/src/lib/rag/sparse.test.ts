import { describe, expect, it } from "vitest";
import { sparseVector } from "@/lib/rag/sparse";

describe("sparseVector", () => {
  it("query mode returns raw integer term counts (no saturation, no length-norm)", () => {
    const result = sparseVector("cat cat cat dog", { mode: "query" });
    expect(result).not.toBeNull();
    const values = result!.values.slice().sort((a, b) => a - b);
    expect(values).toEqual([1, 3]);
  });

  it("zero-arg call still compiles and behaves as query-mode", () => {
    const withDefault = sparseVector("cat cat cat dog");
    const withExplicitQuery = sparseVector("cat cat cat dog", { mode: "query" });
    expect(withDefault).toEqual(withExplicitQuery);
  });

  it("document mode saturates repeated terms (doubling raw count is less than double the value)", () => {
    // "cat"'s hashed index is deterministic regardless of mode/document — derive
    // it independently so we can look up cat's specific value in each vector.
    const catIndex = sparseVector("cat")!.indices[0];

    // Compare "cat" appearing 2x vs 4x in same-length documents by using a
    // fixed avgDocLen so length-norm doesn't confound the saturation check.
    const twoX = sparseVector("cat cat filler filler filler filler", {
      mode: "document",
      avgDocLen: 6,
    });
    const fourX = sparseVector("cat cat cat cat filler filler", {
      mode: "document",
      avgDocLen: 6,
    });
    const twoXVal = twoX!.values[twoX!.indices.indexOf(catIndex)];
    const fourXVal = fourX!.values[fourX!.indices.indexOf(catIndex)];
    expect(twoXVal).toBeGreaterThan(0);
    expect(fourXVal).toBeGreaterThan(0);
    // BM25 saturation: value for count=4 must be less than 2x the value for count=2.
    expect(fourXVal).toBeLessThan(twoXVal * 2);
  });

  it("document mode length-normalizes: same term frequency in a longer-than-average doc yields a smaller value", () => {
    // "cat" appears once in both; the short doc's length equals avgDocLen (norm=1),
    // the long doc is padded with filler tokens well beyond avgDocLen (norm>1 denom).
    const shortDoc = sparseVector("cat filler filler", { mode: "document", avgDocLen: 3 });
    const longDoc = sparseVector(
      "cat filler filler filler filler filler filler filler filler filler filler filler",
      { mode: "document", avgDocLen: 3 },
    );

    // "cat" hashes identically in both — find its shared index.
    const idx = shortDoc!.indices.find((i) => longDoc!.indices.includes(i))!;
    const shortVal = shortDoc!.values[shortDoc!.indices.indexOf(idx)];
    const longVal = longDoc!.values[longDoc!.indices.indexOf(idx)];
    expect(longVal).toBeLessThan(shortVal);
  });

  it("bootstraps avgLen to the doc's own length when avgDocLen is missing or zero (no divide-by-zero, finite output)", () => {
    const noAvg = sparseVector("cat dog bird", { mode: "document" });
    const zeroAvg = sparseVector("cat dog bird", { mode: "document", avgDocLen: 0 });
    expect(noAvg).not.toBeNull();
    for (const v of noAvg!.values) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(zeroAvg).toEqual(noAvg);
  });

  it("returns null for empty or stopword-only text", () => {
    expect(sparseVector("")).toBeNull();
    expect(sparseVector("the a an of")).toBeNull();
    expect(sparseVector("the a an of", { mode: "document" })).toBeNull();
  });
});
