/** Surface a friendly message when the RAG store (Postgres/pgvector) is down. */
export function ragError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("RAG_DATABASE_URL") || msg.includes("ECONNREFUSED")
    ? "RAG store unavailable — run `docker compose up -d` and set RAG_DATABASE_URL."
    : msg;
}
