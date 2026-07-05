// Manual operator-triggered migration (D-12/D-16): scroll-based, in-place
// reindex of an existing bucket's Qdrant collection. Raw source text is never
// persisted outside Qdrant (RESEARCH key finding), so this can never re-run
// ingestDocument/ingestFile from scratch — it must scroll the collection's
// existing points and update them in place from their own stored `content`/
// `metadata` payload fields:
//
// - Pass 1: scroll all points (payload only, no vectors), tokenize each
//   point's stored content, and recompute the bucket's corpus-wide
//   avgChunkLength (D-10/D-12), persisting it to Bucket.avgChunkLength.
// - Pass 2: for each point, recompute its sparse vector with the new BM25
//   document-mode TF (D-11) against the freshly-computed avgChunkLength, and
//   promote metadata.tags/metadata.sourceType to top-level tags/source_type
//   payload keys — dense vectors and every other payload key are left alone.
//
// Never uses the payload-replacing Qdrant call (D-16 security): that call
// replaces a point's ENTIRE payload, which would silently delete
// content/document_id/etc. Only the merge-semantics setPayload call is used.
import { db } from "@/lib/db";
import { collectionName, qdrantClient, SPARSE } from "@/lib/rag/store";
import { sparseVector, tokenize } from "@/lib/rag/sparse";

type ScrolledPoint = {
  id: string | number;
  content: string;
  metadata: Record<string, unknown>;
};

/**
 * Reindex a single bucket's collection in place: re-encode sparse vectors
 * with the current BM25 document-mode TF and promote buried metadata to
 * indexed top-level payload keys. Scoped strictly to the given tenant/bucket
 * collection — never touches another collection.
 */
export async function reindexBucket(
  tenantId: string,
  bucketId: string,
): Promise<{ pointsUpdated: number }> {
  const name = collectionName(tenantId, bucketId);
  const client = qdrantClient();

  // Pass 1: scroll every point (payload only) and recompute the bucket's
  // corpus-wide avgChunkLength BEFORE any sparse re-encoding, so pass 2
  // encodes every point against the same, up-to-date corpus stat.
  const points: ScrolledPoint[] = [];
  let offset: string | number | Record<string, unknown> | null | undefined = undefined;
  let totalTokens = 0;
  do {
    const res = await client.scroll(name, {
      limit: 200,
      offset,
      with_payload: true,
      with_vector: false,
    });
    for (const p of res.points) {
      const content = String(p.payload?.content ?? "");
      const metadata = (p.payload?.metadata as Record<string, unknown>) ?? {};
      points.push({ id: p.id, content, metadata });
      totalTokens += tokenize(content).length;
    }
    offset = res.next_page_offset ?? undefined;
  } while (offset != null);

  const avgLen = points.length > 0 ? totalTokens / points.length : 0;
  await db.bucket.update({ where: { id: bucketId }, data: { avgChunkLength: avgLen } });

  // Pass 2: re-encode sparse vectors (document mode, new avgLen) and promote
  // metadata.tags/metadata.sourceType to top-level payload keys. Batched to
  // match the scroll page size; setPayload always MERGES — the entire-payload
  // -replacing call is never used, so content/document_id/etc. survive.
  const BATCH_SIZE = 200;
  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);

    const vectorUpdates = batch
      .map((p) => ({ id: p.id, sparse: sparseVector(p.content, { mode: "document", avgDocLen: avgLen }) }))
      .filter((p): p is { id: string | number; sparse: NonNullable<ReturnType<typeof sparseVector>> } => p.sparse != null);
    if (vectorUpdates.length > 0) {
      await client.updateVectors(name, {
        points: vectorUpdates.map((p) => ({ id: p.id, vector: { [SPARSE]: p.sparse } })),
      });
    }

    await Promise.all(
      batch.map((p) =>
        client.setPayload(name, {
          points: [p.id],
          payload: {
            tags: (p.metadata.tags as string[] | undefined) ?? [],
            source_type: (p.metadata.sourceType as string | undefined) ?? null,
          },
        }),
      ),
    );
  }

  // Ensure the payload indexes exist (idempotent — re-creating is a no-op).
  for (const field of ["tags", "source_type"]) {
    await client
      .createPayloadIndex(name, { field_name: field, field_schema: "keyword", wait: true })
      .catch(() => {
        /* index already exists — ignore */
      });
  }
  await client
    .createPayloadIndex(name, { field_name: "ingested_at", field_schema: "datetime", wait: true })
    .catch(() => {
      /* index already exists — ignore */
    });

  return { pointsUpdated: points.length };
}
