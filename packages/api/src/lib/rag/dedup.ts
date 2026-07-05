import { createHash } from "node:crypto";

/**
 * SHA-256 fingerprint of normalized document text, used for exact-match
 * content dedup within a bucket (D-01/D-02/D-04).
 *
 * Normalization is trim + collapse-internal-whitespace-runs only — case is
 * preserved. This is deliberately narrow: an exact-match hash should not
 * treat differently-cased content as identical, and over-normalizing risks
 * false-positive "duplicate" rejections (RESEARCH Assumption A2).
 *
 * SHA-256 via node:crypto stdlib — no hand-rolled hashing (RESEARCH V6): this
 * is an exact-match fingerprint, not a secrecy boundary, so no keyed/HMAC
 * variant is needed.
 */
export function contentHash(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
