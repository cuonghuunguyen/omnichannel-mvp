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
