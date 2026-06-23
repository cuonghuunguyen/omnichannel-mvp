"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type Bucket, type RagDocument, type RetrievedChunk } from "@/lib/api";

/** Embedding providers offered in the builder (mirrors lib/rag/embeddings). */
const PROVIDERS = [
  { id: "local", label: "Local (bge-small, 384d) — no key", defaultModel: "Xenova/bge-small-en-v1.5" },
  { id: "openai", label: "OpenAI (text-embedding-3-small, 1536d)", defaultModel: "text-embedding-3-small" },
  { id: "voyage", label: "Voyage AI (voyage-3, 1024d)", defaultModel: "voyage-3" },
] as const;

export function KnowledgeAdmin() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await api.GET("/knowledge/buckets");
    if (error) {
      setError(error.error ?? "Failed to load buckets.");
      setBuckets([]);
    } else {
      setError(null);
      setBuckets(data?.buckets ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    // Preselect a bucket when deep-linked (e.g. the builder's "View knowledge
    // base" link, /knowledge?bucket=<id>). Read from the URL on the client to
    // avoid the Suspense boundary useSearchParams requires.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().then(() => {
      const id = new URLSearchParams(window.location.search).get("bucket");
      if (id) setSelectedId(id);
    });
  }, []);

  const selected =
    selectedId && selectedId !== "new"
      ? buckets.find((b) => b.id === selectedId) ?? null
      : null;

  return (
    <div className="grid h-full grid-cols-[18rem_1fr] divide-x divide-border overflow-hidden">
      <aside className="flex flex-col overflow-hidden bg-canvas-soft">
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <span className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
            Knowledge bases
          </span>
          <Button size="sm" variant="outline" onClick={() => setSelectedId("new")}>
            <Plus className="size-4" /> New
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {loading && <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>}
          {!loading && error && (
            <p className="px-2 py-4 text-sm text-destructive">{error}</p>
          )}
          {!loading && !error && buckets.length === 0 && (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              No knowledge bases yet. Create one.
            </p>
          )}
          {buckets.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelectedId(b.id)}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-strong ${
                selectedId === b.id ? "bg-surface-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-ink">{b.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {b.embeddingProvider}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {b.documentCount ?? 0} docs · {b.chunkCount ?? 0} chunks
              </p>
            </button>
          ))}
        </div>
      </aside>

      <section className="overflow-y-auto">
        {selectedId === "new" ? (
          <CreateBucket
            onCreated={async (id) => {
              await load();
              setSelectedId(id);
            }}
            onCancel={() => setSelectedId(null)}
          />
        ) : selected ? (
          <BucketDetail
            key={selected.id}
            bucket={selected}
            onChanged={load}
            onDeleted={async () => {
              await load();
              setSelectedId(null);
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            Select a knowledge base, or create one. Buckets store embeddings in the
            pgvector RAG store.
          </div>
        )}
      </section>
    </div>
  );
}

function CreateBucket({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]["id"]>("local");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim()) return toast.error("Name is required.");
    setSaving(true);
    const { data, error } = await api.POST("/knowledge/buckets", {
      body: { name, description, provider, model: model.trim() || undefined },
    });
    setSaving(false);
    if (error || !data) return toast.error(error?.error ?? "Failed to create bucket.");
    toast.success("Knowledge base created.");
    await onCreated(data.bucket.id);
  }

  const placeholderModel = PROVIDERS.find((p) => p.id === provider)!.defaultModel;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light tracking-tight text-ink">New knowledge base</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={create} disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="kb-name">Name</Label>
        <Input id="kb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hotel Policies" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="kb-desc">Description</Label>
        <Textarea
          id="kb-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's in this knowledge base."
          rows={2}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="kb-provider">Embedding provider</Label>
          <select
            id="kb-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
            className="h-11 w-full rounded-md border border-hairline-strong bg-surface-card px-4 text-sm text-ink outline-none transition-colors focus-visible:border-2 focus-visible:border-ink"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="kb-model">Model (optional)</Label>
          <Input
            id="kb-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={placeholderModel}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The provider + model are pinned at creation — every document and query in this
        bucket is embedded the same way, so the dimension stays consistent.
      </p>
    </div>
  );
}

function BucketDetail({
  bucket,
  onChanged,
  onDeleted,
}: {
  bucket: Bucket;
  onChanged: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}) {
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const [ingesting, setIngesting] = useState(false);

  async function loadDocs() {
    const { data } = await api.GET("/knowledge/buckets/{id}/documents", {
      params: { path: { id: bucket.id } },
    });
    if (data) setDocuments(data.documents ?? []);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDocs();
  }, [bucket.id]);

  async function ingest() {
    if (!title.trim()) return toast.error("Title is required.");
    if (!content.trim()) return toast.error("Content is required.");
    setIngesting(true);
    const { data, error } = await api.POST("/knowledge/buckets/{id}/documents", {
      params: { path: { id: bucket.id } },
      body: { title, source, content },
    });
    setIngesting(false);
    if (error || !data) return toast.error(error?.error ?? "Failed to ingest document.");
    toast.success(`Ingested "${data.document.title}" (${data.document.chunkCount} chunks).`);
    setTitle("");
    setSource("");
    setContent("");
    await loadDocs();
    await onChanged();
  }

  async function removeDoc(id: string) {
    const { error } = await api.DELETE("/knowledge/documents/{id}", {
      params: { path: { id } },
    });
    if (error) return toast.error("Failed to delete document.");
    await loadDocs();
    await onChanged();
  }

  async function removeBucket() {
    if (!confirm(`Delete "${bucket.name}" and all its documents? This cannot be undone.`)) return;
    const { error } = await api.DELETE("/knowledge/buckets/{id}", {
      params: { path: { id: bucket.id } },
    });
    if (error) return toast.error("Failed to delete bucket.");
    toast.success("Knowledge base deleted.");
    await onDeleted();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-light tracking-tight text-ink">{bucket.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {bucket.embeddingProvider} · {bucket.embeddingModel} · {bucket.embeddingDim}d ·{" "}
            {bucket.documentCount ?? documents.length} docs · {bucket.chunkCount ?? 0} chunks
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">id: {bucket.id}</p>
          {bucket.description && (
            <p className="mt-2 text-sm text-body">{bucket.description}</p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={removeBucket}>
          <Trash2 className="size-4" /> Delete
        </Button>
      </div>

      {/* Add document */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
          Add document
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder="Source (optional, e.g. URL)" value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
        <Textarea
          placeholder="Paste the document text. It's chunked, embedded, and indexed on save."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={ingest} disabled={ingesting}>
            {ingesting ? "Ingesting…" : "Ingest"}
          </Button>
        </div>
      </section>

      {/* Documents */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
          Documents ({documents.length})
        </h3>
        {documents.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet.</p>
        ) : (
          <div className="space-y-2">
            {documents.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{d.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.chunkCount ?? 0} chunks{d.source ? ` · ${d.source}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => removeDoc(d.id)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label="Delete document"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <TestSearch bucketId={bucket.id} />
    </div>
  );
}

function TestSearch({ bucketId }: { bucketId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RetrievedChunk[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function run() {
    if (!query.trim()) return;
    setSearching(true);
    const { data, error } = await api.POST("/knowledge/search", {
      body: { bucketIds: [bucketId], query, topK: 5 },
    });
    setSearching(false);
    if (error || !data) return toast.error(error?.error ?? "Search failed.");
    setResults(data.results ?? []);
  }

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
        Test retrieval
      </h3>
      <div className="flex gap-2">
        <Input
          placeholder="Ask something this knowledge base should answer…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <Button size="sm" variant="outline" onClick={run} disabled={searching}>
          <Search className="size-4" /> {searching ? "…" : "Search"}
        </Button>
      </div>
      {results && results.length === 0 && (
        <p className="text-xs text-muted-foreground">No results.</p>
      )}
      {results && results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div key={r.id} className="rounded-xl border border-border bg-surface-card p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink">
                  [{i + 1}] {r.documentTitle || "Untitled"}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  score {r.score.toFixed(3)}
                </span>
              </div>
              <p className="line-clamp-4 text-xs leading-relaxed text-body">{r.content}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
