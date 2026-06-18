import { NextResponse } from "next/server";
import { ingestDocument, listDocuments } from "@/lib/rag/buckets";
import { ragError } from "@/lib/rag/errors";

/** List a bucket's documents. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return NextResponse.json({ documents: await listDocuments(id) });
  } catch (err) {
    return NextResponse.json({ error: ragError(err) }, { status: 503 });
  }
}

/** Ingest a document into the bucket (chunk → embed → store). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const input = (await req.json()) as {
    title?: string;
    source?: string;
    content?: string;
    metadata?: Record<string, unknown>;
  };
  if (!input.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!input.content?.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  try {
    const document = await ingestDocument(id, {
      title: input.title,
      source: input.source,
      content: input.content,
      metadata: input.metadata,
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "bucket not found") {
      return NextResponse.json({ error: "bucket not found" }, { status: 404 });
    }
    return NextResponse.json({ error: ragError(err) }, { status: 503 });
  }
}
