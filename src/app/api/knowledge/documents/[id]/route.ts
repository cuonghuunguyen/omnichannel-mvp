import { NextResponse } from "next/server";
import { deleteDocument } from "@/lib/rag/buckets";
import { ragError } from "@/lib/rag/errors";

/** Delete a document (cascades to its chunks). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const ok = await deleteDocument(id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: ragError(err) }, { status: 503 });
  }
}
