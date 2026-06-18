import { NextResponse } from "next/server";
import { createBucket, listBuckets } from "@/lib/rag/buckets";
import { ragError } from "@/lib/rag/errors";
import type { EmbeddingProviderId } from "@/lib/rag/types";

/** List knowledge buckets (with document/chunk counts). */
export async function GET() {
  try {
    const buckets = await listBuckets();
    return NextResponse.json({ buckets });
  } catch (err) {
    return NextResponse.json({ error: ragError(err) }, { status: 503 });
  }
}

/** Create a knowledge bucket, pinning its embedding provider + model. */
export async function POST(req: Request) {
  const input = (await req.json()) as {
    name?: string;
    description?: string;
    provider?: EmbeddingProviderId;
    model?: string;
  };
  if (!input.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    const bucket = await createBucket({
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
    });
    return NextResponse.json({ bucket }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: ragError(err) }, { status: 503 });
  }
}
