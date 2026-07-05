import { describe, expect, it } from "vitest";
import { contentHash } from "@/lib/rag/dedup";
import { DuplicateDocumentError } from "@/lib/rag/errors";

describe("contentHash", () => {
  it("hashes identical text identically", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    expect(contentHash(text)).toBe(contentHash(text));
  });

  it("normalizes whitespace-only differences to the same hash", () => {
    const a = "The quick brown fox";
    const b = "  The   quick brown   fox  ";
    const c = "\nThe quick\tbrown fox\n";
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).toBe(contentHash(c));
  });

  it("is case-preserving — different case produces a different hash", () => {
    const lower = "the quick brown fox";
    const upper = "THE QUICK BROWN FOX";
    expect(contentHash(lower)).not.toBe(contentHash(upper));
  });

  it("returns a 64-char lowercase hex string (SHA-256)", () => {
    const hash = contentHash("some content");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("DuplicateDocumentError", () => {
  it("carries the conflicting document's id and title", () => {
    const err = new DuplicateDocumentError("doc-123", "Existing Title");
    expect(err).toBeInstanceOf(Error);
    expect(err.existingId).toBe("doc-123");
    expect(err.existingTitle).toBe("Existing Title");
  });
});
