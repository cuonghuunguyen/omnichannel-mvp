import { Router } from "express";
import {
  createBucket,
  deleteBucket,
  deleteDocument,
  getBucket,
  ingestDocument,
  listBuckets,
  listDocuments,
} from "@/lib/rag/buckets";
import { retrieve } from "@/lib/rag/retrieve";
import { ragError } from "@/lib/rag/errors";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { ACTIVE_TENANT_ID } from "@/lib/tenant";
import {
  CreateBucketInput,
  IngestDocumentInput,
  SearchInput,
} from "@/schemas";

export const knowledgeRouter: Router = Router();

// All knowledge reads/writes are scoped to the active tenant.
const tenantId = ACTIVE_TENANT_ID;

/** List knowledge buckets (with document/chunk counts). */
knowledgeRouter.get("/buckets", async (_req, res) => {
  try {
    res.json({ buckets: await listBuckets(tenantId) });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** Create a knowledge bucket, pinning its embedding provider + model. */
knowledgeRouter.post("/buckets", async (req, res) => {
  const parsed = CreateBucketInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const input = parsed.data;
  if (!input.name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const bucket = await createBucket({
      tenantId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
    });
    res.status(201).json({ bucket });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** Fetch a bucket plus its documents. */
knowledgeRouter.get("/buckets/:id", async (req, res) => {
  try {
    const bucket = await getBucket(req.params.id, tenantId);
    if (!bucket) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const documents = await listDocuments(req.params.id, tenantId);
    res.json({ bucket, documents });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** Delete a bucket (cascades to its documents + chunks). */
knowledgeRouter.delete("/buckets/:id", async (req, res) => {
  try {
    const ok = await deleteBucket(req.params.id, tenantId);
    if (!ok) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** List a bucket's documents. */
knowledgeRouter.get("/buckets/:id/documents", async (req, res) => {
  try {
    res.json({ documents: await listDocuments(req.params.id, tenantId) });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** Ingest a document into the bucket (chunk → embed → store). */
knowledgeRouter.post("/buckets/:id/documents", async (req, res) => {
  const parsed = IngestDocumentInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const input = parsed.data;
  if (!input.title?.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!input.content?.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  try {
    const document = await ingestDocument(req.params.id, tenantId, {
      title: input.title,
      source: input.source,
      content: input.content,
      metadata: input.metadata,
    });
    res.status(201).json({ document });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "bucket not found") {
      res.status(404).json({ error: "bucket not found" });
      return;
    }
    res.status(503).json({ error: ragError(err) });
  }
});

/** Delete a document (cascades to its chunks). */
knowledgeRouter.delete("/documents/:id", async (req, res) => {
  try {
    const ok = await deleteDocument(req.params.id, tenantId);
    if (!ok) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** Run the full retrieval pipeline against one or more buckets. */
knowledgeRouter.post("/search", async (req, res) => {
  const parsed = SearchInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const input = parsed.data;
  if (!input.query?.trim()) {
    res.status(400).json({ error: "query is required" });
    return;
  }
  if (!input.bucketIds?.length) {
    res.status(400).json({ error: "bucketIds is required" });
    return;
  }
  try {
    const results = await retrieve({
      tenantId,
      bucketIds: input.bucketIds,
      query: input.query,
      topK: input.topK ?? 5,
      pipelineModel:
        input.model || process.env.RAG_PIPELINE_MODEL?.trim() || DEFAULT_MODEL_ID,
    });
    res.json({ results });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});
