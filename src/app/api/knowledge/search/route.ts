import { NextResponse } from "next/server";
import { retrieve } from "@/lib/rag/retrieve";
import { ragError } from "@/lib/rag/errors";
import { DEFAULT_MODEL_ID } from "@/lib/models";

/** Run the full retrieval pipeline against one or more buckets (test harness). */
export async function POST(req: Request) {
  const input = (await req.json()) as {
    bucketIds?: string[];
    query?: string;
    topK?: number;
    model?: string;
  };
  if (!input.query?.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (!input.bucketIds?.length) {
    return NextResponse.json({ error: "bucketIds is required" }, { status: 400 });
  }
  try {
    const results = await retrieve({
      bucketIds: input.bucketIds,
      query: input.query,
      topK: input.topK ?? 5,
      pipelineModel:
        input.model || process.env.RAG_PIPELINE_MODEL?.trim() || DEFAULT_MODEL_ID,
    });
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: ragError(err) }, { status: 503 });
  }
}
