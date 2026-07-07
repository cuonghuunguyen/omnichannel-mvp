import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  createBucket,
  deleteBucket,
  ingestDocument,
  listDocumentVersions,
  updateDocument,
} from "@/lib/rag/buckets";
import { contentHash } from "@/lib/rag/dedup";
import { VERSION_HISTORY_CAP } from "@/lib/rag/document-versioning";
import { DuplicateDocumentError } from "@/lib/rag/errors";
import { collectionName, qdrantClient } from "@/lib/rag/store";

// First-ever direct test file for this module (RESEARCH.md Wave 0 gap). No
// mocking convention exists anywhere in this codebase for `db`/`qdrantClient`
// — every existing RAG test file tests only dependency-free pure functions, so
// this exercises the real dev MySQL + Qdrant services, same as the running
// application does.
const TENANT_ID = "test-tenant-46";

function markdownDoc(sections: [string, string][]): string {
  return sections.map(([heading, body]) => `## ${heading}\n\n${body}`).join("\n\n");
}

describe("updateDocument", () => {
  let bucketId: string;

  beforeAll(async () => {
    // Bucket.tenantId is FK-constrained to Tenant.id — ensure the test tenant
    // row exists before creating a bucket under it.
    await db.tenant.upsert({
      where: { id: TENANT_ID },
      create: { id: TENANT_ID, name: "Phase 46 Test Tenant" },
      update: {},
    });
    const bucket = await createBucket({
      tenantId: TENANT_ID,
      name: "update-doc-test",
      provider: "local", // no embedding key, no external network call needed
    });
    bucketId = bucket.id;
  }, 30000);

  afterAll(async () => {
    await deleteBucket(bucketId, TENANT_ID);
    await db.tenant.delete({ where: { id: TENANT_ID } }).catch(() => {});
  }, 30000);

  it(
    "keeps the same document id across an update (D-01)",
    async () => {
      const doc = await ingestDocument(bucketId, TENANT_ID, {
        title: "D-01 doc",
        content: markdownDoc([["Only Section", "Initial body content for D-01 test. ".repeat(10)]]),
      });
      const countBefore = await db.document.count({ where: { bucketId } });

      const updated = await updateDocument(doc.id, TENANT_ID, {
        content: markdownDoc([["Only Section", "Updated body content for D-01 test. ".repeat(10)]]),
      });

      expect(updated).not.toBeNull();
      expect(updated!.id).toBe(doc.id);

      const countAfter = await db.document.count({ where: { bucketId } });
      expect(countAfter).toBe(countBefore); // no new Document row was created
    },
    30000,
  );

  it(
    "re-embeds only added/changed chunks and deletes removed ones on a real content edit",
    async () => {
      const sectionOne = "Alpha section content unchanged across the update. ".repeat(8);
      const sectionTwoOld = "Bravo section original content before editing. ".repeat(8);
      const sectionTwoNew = "Bravo section EDITED content after the update. ".repeat(8);
      const sectionThree = "Charlie section will be dropped entirely. ".repeat(8);

      const doc = await ingestDocument(bucketId, TENANT_ID, {
        title: "Diff test doc",
        content: markdownDoc([
          ["Section One", sectionOne],
          ["Section Two", sectionTwoOld],
          ["Section Three", sectionThree],
        ]),
        chunkStrategy: "markdown",
      });

      const collection = collectionName(TENANT_ID, bucketId);
      const scrollFor = async (documentId: string) =>
        qdrantClient().scroll(collection, {
          filter: { must: [{ key: "document_id", match: { value: documentId } }] },
          limit: 100,
          with_payload: true,
          with_vector: false,
        });

      const before = await scrollFor(doc.id);
      const beforeHashes = new Set(before.points.map((p) => String(p.payload?.chunk_content_hash ?? "")));
      expect(beforeHashes.size).toBe(3);

      const updated = await updateDocument(doc.id, TENANT_ID, {
        content: markdownDoc([
          ["Section One", sectionOne],
          ["Section Two", sectionTwoNew],
        ]),
        chunkStrategy: "markdown",
      });
      expect(updated).not.toBeNull();

      const row = await db.document.findUnique({ where: { id: doc.id } });
      expect(row?.chunkCount).toBe(2);

      const after = await scrollFor(doc.id);
      expect(after.points.length).toBe(2);
      const afterHashes = new Set(after.points.map((p) => String(p.payload?.chunk_content_hash ?? "")));

      const hashOne = contentHash(sectionOne.trim());
      const hashTwoOld = contentHash(sectionTwoOld.trim());
      const hashTwoNew = contentHash(sectionTwoNew.trim());
      const hashThree = contentHash(sectionThree.trim());

      // Unchanged Section One's chunk survives untouched -- never re-embedded.
      expect(beforeHashes.has(hashOne)).toBe(true);
      expect(afterHashes.has(hashOne)).toBe(true);
      // Edited Section Two is treated as removed+added (D-10 exact-hash-only).
      expect(beforeHashes.has(hashTwoOld)).toBe(true);
      expect(afterHashes.has(hashTwoOld)).toBe(false);
      expect(afterHashes.has(hashTwoNew)).toBe(true);
      // Dropped Section Three's point is gone.
      expect(beforeHashes.has(hashThree)).toBe(true);
      expect(afterHashes.has(hashThree)).toBe(false);
    },
    30000,
  );

  it(
    "rejects an update whose content collides with a DIFFERENT existing document in the bucket, but allows the same document to keep its own content hash",
    async () => {
      const contentA = markdownDoc([["A", "Document A unique content for collision test. ".repeat(8)]]);
      const contentB = markdownDoc([["B", "Document B unique content for collision test. ".repeat(8)]]);
      const docA = await ingestDocument(bucketId, TENANT_ID, { title: "Doc A", content: contentA });
      const docB = await ingestDocument(bucketId, TENANT_ID, { title: "Doc B", content: contentB });

      let caught: unknown;
      try {
        await updateDocument(docB.id, TENANT_ID, { content: contentA });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(DuplicateDocumentError);
      expect((caught as DuplicateDocumentError).existingId).toBe(docA.id);

      // A no-op re-save of A's own unchanged content must NOT self-collide (Pitfall 5).
      await expect(updateDocument(docA.id, TENANT_ID, { content: contentA })).resolves.not.toBeNull();
    },
    30000,
  );

  it(
    "prunes version history beyond VERSION_HISTORY_CAP",
    async () => {
      const doc = await ingestDocument(bucketId, TENANT_ID, {
        title: "Prune test doc",
        content: markdownDoc([["Only", "Prune test initial content. ".repeat(8)]]),
      });

      const total = VERSION_HISTORY_CAP + 2;
      for (let i = 0; i < total; i++) {
        await updateDocument(doc.id, TENANT_ID, {
          content: markdownDoc([["Only", `Prune test revision ${i} content. `.repeat(8)]]),
        });
      }

      const count = await db.documentVersion.count({ where: { documentId: doc.id } });
      expect(count).toBe(VERSION_HISTORY_CAP);

      const remaining = await db.documentVersion.findMany({
        where: { documentId: doc.id },
        select: { content: true },
      });
      const remainingContents = remaining.map((v) => v.content);
      // The two oldest revisions (0 and 1) must be pruned.
      expect(remainingContents.some((c) => c.includes("revision 0 "))).toBe(false);
      expect(remainingContents.some((c) => c.includes("revision 1 "))).toBe(false);
      // The newest revision must still be present.
      expect(remainingContents.some((c) => c.includes(`revision ${total - 1} `))).toBe(true);
    },
    60000,
  );

  it(
    "forces a full re-embed when chunk_strategy changes",
    async () => {
      // Markdown chunking strips the "## Heading" line out of chunk.content
      // (only the body is stored, heading becomes `context`); paragraph
      // chunking keeps the raw "## Heading\n\nBody" text verbatim in the
      // chunk -- these two strategies are guaranteed to disagree on this
      // content even though the underlying text never changes.
      const content = "## Only Section\n\n" + "Strategy change test content unique text. ".repeat(10);
      const doc = await ingestDocument(bucketId, TENANT_ID, {
        title: "Strategy change doc",
        content,
        chunkStrategy: "markdown",
      });

      const collection = collectionName(TENANT_ID, bucketId);
      const scrollFor = async (documentId: string) =>
        qdrantClient().scroll(collection, {
          filter: { must: [{ key: "document_id", match: { value: documentId } }] },
          limit: 100,
          with_payload: true,
          with_vector: false,
        });

      const before = await scrollFor(doc.id);
      const beforeHashes = new Set(before.points.map((p) => String(p.payload?.chunk_content_hash ?? "")));

      // Same content, but chunk_strategy changes -- must force a full
      // re-embed (D-12), even though the underlying text didn't change.
      await updateDocument(doc.id, TENANT_ID, { content, chunkStrategy: "paragraph" });

      const after = await scrollFor(doc.id);
      const afterHashes = new Set(after.points.map((p) => String(p.payload?.chunk_content_hash ?? "")));

      expect(afterHashes.size).toBeGreaterThan(0);
      for (const hash of afterHashes) {
        expect(beforeHashes.has(hash)).toBe(false);
      }
    },
    30000,
  );

  it(
    "falls back to a full re-embed when no prior DocumentVersion exists (OQ-1)",
    async () => {
      const doc = await ingestDocument(bucketId, TENANT_ID, {
        title: "OQ-1 doc",
        content: markdownDoc([["Only", "OQ-1 initial content. ".repeat(8)]]),
      });

      const versionCountBefore = await db.documentVersion.count({ where: { documentId: doc.id } });
      expect(versionCountBefore).toBe(0);

      await expect(
        updateDocument(doc.id, TENANT_ID, {
          content: markdownDoc([["Only", "OQ-1 updated content. ".repeat(8)]]),
        }),
      ).resolves.not.toBeNull();

      const versionCountAfter = await db.documentVersion.count({ where: { documentId: doc.id } });
      expect(versionCountAfter).toBe(1);
    },
    30000,
  );

  it(
    "listDocumentVersions returns tenant-scoped, content-free rows",
    async () => {
      const doc = await ingestDocument(bucketId, TENANT_ID, {
        title: "Versions list doc",
        content: markdownDoc([["Only", "Versions list initial content. ".repeat(8)]]),
      });
      await updateDocument(doc.id, TENANT_ID, {
        content: markdownDoc([["Only", "Versions list updated content. ".repeat(8)]]),
      });

      const versions = await listDocumentVersions(doc.id, TENANT_ID);
      expect(versions).not.toBeNull();
      expect(versions!.length).toBeGreaterThan(0);
      for (const v of versions!) {
        expect(v).toHaveProperty("id");
        expect(v).toHaveProperty("createdAt");
        expect(v).toHaveProperty("chunkCount");
        expect(v).not.toHaveProperty("content");
        expect(v).not.toHaveProperty("contentHash");
      }

      const foreign = await listDocumentVersions(doc.id, "test-tenant-46-other");
      expect(foreign).toBeNull();
    },
    30000,
  );
});
