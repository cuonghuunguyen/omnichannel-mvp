import { NextResponse } from "next/server";
import { deleteBucket, getBucket, listDocuments } from "@/lib/rag/buckets";
import { ragError } from "@/lib/rag/errors";

/** Fetch a bucket plus its documents. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const bucket = await getBucket(id);
    if (!bucket) return NextResponse.json({ error: "not found" }, { status: 404 });
    const documents = await listDocuments(id);
    return NextResponse.json({ bucket, documents });
  } catch (err) {
    return NextResponse.json({ error: ragError(err) }, { status: 503 });
  }
}

/** Delete a bucket (cascades to its documents + chunks). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const ok = await deleteBucket(id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: ragError(err) }, { status: 503 });
  }
}
