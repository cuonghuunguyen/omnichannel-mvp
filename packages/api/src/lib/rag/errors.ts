/** Surface a friendly message when the RAG vector store (Qdrant) is down. */
export function ragError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // QDRANT_URL unset, connection refused, or the client's fetch failing to reach
  // the server all mean the same thing operationally: the store isn't reachable.
  const unreachable =
    msg.includes("QDRANT_URL") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("fetch failed") ||
    msg.toLowerCase().includes("connect");
  return unreachable
    ? "RAG store unavailable — run `docker compose up -d` and set QDRANT_URL (e.g. http://localhost:6333)."
    : msg;
}

/**
 * Thrown when a document's content hash already exists in the target bucket
 * (D-02 dedup block-cleanly path). Carries the conflicting document's id and
 * title so callers (sidecar route -> Laravel job `failed()`) can surface a
 * clear "already ingested as ..." message without a second lookup.
 */
export class DuplicateDocumentError extends Error {
  constructor(
    public readonly existingId: string,
    public readonly existingTitle: string,
  ) {
    super(`Duplicate document content: matches existing document "${existingTitle}" (${existingId})`);
    this.name = "DuplicateDocumentError";
  }
}
