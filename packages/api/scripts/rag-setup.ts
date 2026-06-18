// Create the RAG store schema (extension + tables + indexes) in the Postgres
// pointed at by RAG_DATABASE_URL. Idempotent — safe to run repeatedly.
//   docker compose up -d && pnpm rag:setup
import "dotenv/config";
import { ensureRagSchema, ragPool } from "@/lib/rag/store";

async function main() {
  await ensureRagSchema();
  console.log("RAG schema ready (buckets, documents, chunks + indexes).");
  await ragPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
