// Shared RAG domain types, mirroring the Postgres rows (see src/lib/rag/store.ts).

export type EmbeddingProviderId = "local" | "openai" | "voyage";

export type Bucket = {
  id: string;
  name: string;
  description: string;
  embeddingProvider: EmbeddingProviderId;
  embeddingModel: string;
  embeddingDim: number;
  createdAt: string;
  /** Optional counts, populated by list/detail endpoints. */
  documentCount?: number;
  chunkCount?: number;
};

export type RagDocument = {
  id: string;
  bucketId: string;
  title: string;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  chunkCount?: number;
};

/** A chunk returned from retrieval, with provenance + scoring for citations. */
export type RetrievedChunk = {
  id: string;
  documentId: string;
  bucketId: string;
  content: string;
  metadata: Record<string, unknown>;
  documentTitle: string;
  documentSource: string;
  /** Final relevance score after fusion + rerank (higher is better). */
  score: number;
};
