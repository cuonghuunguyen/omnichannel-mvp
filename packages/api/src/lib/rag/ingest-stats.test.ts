import { describe, expect, it } from "vitest";
import { nextAvgChunkLength } from "@/lib/rag/ingest-stats";

describe("nextAvgChunkLength", () => {
  it("is the mean of the new chunk lengths when the bucket has no prior average (prevCount = 0)", () => {
    expect(nextAvgChunkLength(0, 0, [10, 20, 30])).toBe(20);
  });

  it("computes a correctly weighted running average when the bucket already has chunks", () => {
    // prior: avg 100 over 4 chunks (total 400); new: [50, 50] (total 100)
    // combined: (400 + 100) / 6 = 83.33...
    expect(nextAvgChunkLength(100, 4, [50, 50])).toBeCloseTo(500 / 6, 10);
  });

  it("leaves the average unchanged when ingesting zero new chunks", () => {
    expect(nextAvgChunkLength(42, 7, [])).toBe(42);
  });
});
