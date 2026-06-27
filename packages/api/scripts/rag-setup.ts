// Verify the Qdrant RAG store is reachable and bootstrap collections for any
// buckets that already exist in the registry. Collections are otherwise created
// lazily on bucket creation / first ingest, so for a fresh DB this just confirms
// connectivity.
//   docker compose up -d && pnpm rag:setup
import "dotenv/config";
import { db } from "@/lib/db";
import { ensureBucketCollection, qdrantClient } from "@/lib/rag/store";

async function main() {
  // Touch the server so a missing/unreachable QDRANT_URL fails loudly here.
  await qdrantClient().getCollections();

  const buckets = await db.bucket.findMany();
  for (const b of buckets) {
    await ensureBucketCollection(b.tenantId, b.id, b.embeddingDim);
  }
  console.log(
    `Qdrant reachable. Ensured ${buckets.length} bucket collection(s). ` +
      "New buckets create their collection on demand.",
  );
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
