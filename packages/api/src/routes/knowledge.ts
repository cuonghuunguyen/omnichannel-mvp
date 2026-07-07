import { Router } from "express";
import multer from "multer";
import {
  createBucket,
  deleteBucket,
  deleteDocument,
  getBucket,
  ingestDocument,
  ingestFile,
  listBuckets,
  listDocuments,
  listDocumentVersions,
  updateBucket,
  updateDocument,
} from "@/lib/rag/buckets";
import { retrieve } from "@/lib/rag/retrieve";
import { reindexBucket } from "@/lib/rag/reindex";
import { DuplicateDocumentError, ragError } from "@/lib/rag/errors";
import { getEmbeddingProvider, PROVIDER_DEFAULTS } from "@/lib/rag/embeddings";
import type { EmbeddingProviderId } from "@/lib/rag/types";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { tenantFromHeader } from "@/lib/tenant";
import {
  CreateBucketInput,
  IngestDocumentInput,
  IngestFileInput,
  SearchInput,
  UpdateBucketInput,
  UpdateDocumentInput,
} from "@/schemas";

export const knowledgeRouter: Router = Router();

/** In-memory upload for the file-ingest route; extraction works on the buffer. */
const MAX_FILE_BYTES = Number(process.env.RAG_MAX_FILE_BYTES) || 25 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

/** Run multer for one field, translating its errors into clean HTTP responses. */
function uploadSingle(field: string): import("express").RequestHandler {
  const mw = upload.single(field);
  return (req, res, next) => {
    mw(req, res, (err: unknown) => {
      if (!err) return next();
      const code = (err as { code?: string }).code;
      if (code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: `file exceeds the ${MAX_FILE_BYTES}-byte limit` });
        return;
      }
      res.status(400).json({ error: "file upload failed" });
    });
  };
}

// All knowledge reads/writes are scoped to the request's tenant (X-Tenant-Id).
knowledgeRouter.use((req, res, next) => {
  const tenantId = tenantFromHeader(req);
  if (!tenantId) {
    res.status(400).json({ error: "X-Tenant-Id header is required" });
    return;
  }
  res.locals.tenantId = tenantId;
  next();
});

/** List knowledge buckets (with document/chunk counts). */
knowledgeRouter.get("/buckets", async (_req, res) => {
  const tenantId = String(res.locals.tenantId);
  try {
    res.json({ buckets: await listBuckets(tenantId) });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** Create a knowledge bucket, pinning its embedding provider + model. */
knowledgeRouter.post("/buckets", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
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
  const embeddingApiKey = res.locals.embeddingApiKey as string | undefined;
  try {
    const bucket = await createBucket({
      tenantId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      embeddingApiKey,
    });
    res.status(201).json({ bucket });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** Fetch a bucket plus its documents. */
knowledgeRouter.get("/buckets/:id", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
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
  const tenantId = String(res.locals.tenantId);
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

/** Update mutable bucket settings — currently just the relevance-floor override (D-06). */
knowledgeRouter.patch("/buckets/:id", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
  const parsed = UpdateBucketInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  try {
    const bucket = await updateBucket(req.params.id, tenantId, parsed.data);
    if (!bucket) {
      res.status(404).json({ error: "bucket not found" });
      return;
    }
    res.json({ bucket });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** Re-encode BM25 sparse vectors + promote metadata payload keys in place (D-12). */
knowledgeRouter.post("/buckets/:id/reindex", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
  try {
    const bucket = await getBucket(req.params.id, tenantId);
    if (!bucket) {
      res.status(404).json({ error: "bucket not found" });
      return;
    }
    const result = await reindexBucket(tenantId, req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** List a bucket's documents. */
knowledgeRouter.get("/buckets/:id/documents", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
  try {
    res.json({ documents: await listDocuments(req.params.id, tenantId) });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** Ingest a document into the bucket (chunk → embed → store). */
knowledgeRouter.post("/buckets/:id/documents", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
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
  const embeddingApiKey = res.locals.embeddingApiKey as string | undefined;
  try {
    const document = await ingestDocument(req.params.id, tenantId, {
      title: input.title,
      source: input.source,
      content: input.content,
      metadata: input.metadata,
      chunkStrategy: input.chunkStrategy,
      embeddingApiKey,
    });
    res.status(201).json({ document });
  } catch (err) {
    if (err instanceof DuplicateDocumentError) {
      res.status(409).json({
        error: `duplicate content: matches existing document '${err.existingTitle}' (${err.existingId})`,
      });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "bucket not found") {
      res.status(404).json({ error: "bucket not found" });
      return;
    }
    res.status(503).json({ error: ragError(err) });
  }
});

/**
 * Ingest an uploaded file into the bucket (extract → chunk → embed → store).
 * multipart/form-data: `file` is the document; `title`, `source`, and
 * `chunkStrategy` are optional text fields.
 */
knowledgeRouter.post("/buckets/:id/files", uploadSingle("file"), async (req, res) => {
  const tenantId = String(res.locals.tenantId);
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "file is required (multipart field 'file')" });
    return;
  }
  const parsed = IngestFileInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid fields" });
    return;
  }
  const embeddingApiKey = res.locals.embeddingApiKey as string | undefined;
  try {
    const document = await ingestFile(String(req.params.id), tenantId, {
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      title: parsed.data.title,
      source: parsed.data.source,
      chunkStrategy: parsed.data.chunkStrategy,
      embeddingApiKey,
    });
    res.status(201).json({ document });
  } catch (err) {
    if (err instanceof DuplicateDocumentError) {
      res.status(409).json({
        error: `duplicate content: matches existing document '${err.existingTitle}' (${err.existingId})`,
      });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "bucket not found") {
      res.status(404).json({ error: "bucket not found" });
      return;
    }
    if (msg.startsWith("no extractable text")) {
      res.status(422).json({ error: msg });
      return;
    }
    res.status(503).json({ error: ragError(err) });
  }
});

/** Delete a document (cascades to its chunks). */
knowledgeRouter.delete("/documents/:id", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
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

/**
 * Update a document's content in place (Phase 46 D-01/D-09): re-chunks and
 * re-embeds only what changed, deletes only removed chunk points. The same
 * document id is used and returned throughout.
 */
knowledgeRouter.patch("/documents/:id", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
  const parsed = UpdateDocumentInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const embeddingApiKey = res.locals.embeddingApiKey as string | undefined;
  try {
    const document = await updateDocument(req.params.id, tenantId, {
      content: parsed.data.content,
      chunkStrategy: parsed.data.chunkStrategy,
      embeddingApiKey,
    });
    if (!document) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ document });
  } catch (err) {
    if (err instanceof DuplicateDocumentError) {
      res.status(409).json({
        error: `duplicate content: matches existing document '${err.existingTitle}' (${err.existingId})`,
      });
      return;
    }
    res.status(503).json({ error: ragError(err) });
  }
});

/** List a document's version history (D-07) — read-only, no rollback. */
knowledgeRouter.get("/documents/:id/versions", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
  try {
    const versions = await listDocumentVersions(req.params.id, tenantId);
    if (!versions) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ versions });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/** Run the full retrieval pipeline against one or more buckets. */
knowledgeRouter.post("/search", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
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
  const embeddingApiKey = res.locals.embeddingApiKey as string | undefined;
  try {
    const results = await retrieve({
      tenantId,
      bucketIds: input.bucketIds,
      query: input.query,
      topK: input.topK ?? 5,
      pipelineModel:
        input.model || process.env.RAG_PIPELINE_MODEL?.trim() || DEFAULT_MODEL_ID,
      embeddingApiKey,
      tags: input.tags,
      sourceType: input.sourceType,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
    });
    res.json({ results });
  } catch (err) {
    res.status(503).json({ error: ragError(err) });
  }
});

/**
 * Validate a BYOK embedding key without persisting anything (IN-04).
 *
 * POST /knowledge/test-key   body: { provider }   header: X-Embedding-Key
 *
 * Runs one tiny embedding call against the named provider using the inline key, so
 * the AI Config "Test" button can verify an embedding key before it is relied on.
 * Returns 200 {ok:true} when the provider accepts the key, 400 for a missing key or
 * a provider that needs no key, and 502 {ok:false} when the provider rejects the key
 * or is unreachable. Nothing is stored; the key lives only for the request
 * (stripEmbeddingKey middleware) and is never logged (D-02 / T-37-02-01).
 */
knowledgeRouter.post("/test-key", async (req, res) => {
  const provider = String(req.body?.provider ?? "") as EmbeddingProviderId;

  // 'local' needs no key, and unknown providers cannot be tested.
  if (!(provider in PROVIDER_DEFAULTS) || provider === "local") {
    res.status(400).json({ ok: false, error: "unsupported provider for key test" });
    return;
  }

  const embeddingApiKey = res.locals.embeddingApiKey as string | undefined;
  if (!embeddingApiKey) {
    res.status(400).json({ ok: false, error: "X-Embedding-Key header is required" });
    return;
  }

  try {
    const impl = getEmbeddingProvider({
      provider,
      model: PROVIDER_DEFAULTS[provider].model,
      apiKey: embeddingApiKey,
    });
    // One minimal embedding round-trip exercises the key against the provider.
    await impl.embed(["ping"], "document");
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: ragError(err) });
  }
});
