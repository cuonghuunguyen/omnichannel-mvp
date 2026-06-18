import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";

/**
 * A human operator closes a conversation. Marks it "closed" and broadcasts the
 * status so the guest's chat disables input and other inbox views update.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const conversation = await db.conversation.findUnique({ where: { id } });
  if (!conversation) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updated = await db.conversation.update({
    where: { id },
    data: { status: "closed" },
  });

  publish(id, {
    kind: "status",
    status: updated.status,
    assignmentType: updated.assignmentType,
    humanAgentId: updated.humanAgentId,
  });

  return NextResponse.json({ conversation: updated });
}
