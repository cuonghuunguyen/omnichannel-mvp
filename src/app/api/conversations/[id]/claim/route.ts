import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";

/**
 * A human operator claims an escalated conversation. Assigns the operator and
 * marks it "assigned"; broadcasts the status so other inbox views update.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { humanAgentId } = (await req.json()) as { humanAgentId?: string };

  if (!humanAgentId) {
    return NextResponse.json({ error: "humanAgentId is required" }, { status: 400 });
  }

  const conversation = await db.conversation.findUnique({ where: { id } });
  if (!conversation) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updated = await db.conversation.update({
    where: { id },
    data: { humanAgentId, assignmentType: "human", status: "assigned" },
  });

  publish(id, {
    kind: "status",
    status: updated.status,
    assignmentType: updated.assignmentType,
    humanAgentId: updated.humanAgentId,
  });

  return NextResponse.json({ conversation: updated });
}
