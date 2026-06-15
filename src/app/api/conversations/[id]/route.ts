import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toUIMessage } from "@/lib/messages";

/** Fetch a conversation, its current agent, and its message history (as UIMessages). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const conversation = await db.conversation.findUnique({
    where: { id },
    include: { currentAgent: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const messages = await db.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    include: {
      authorAgent: { select: { name: true } },
      authorUser: { select: { name: true, kind: true } },
    },
  });

  return NextResponse.json({
    conversation,
    messages: messages.map(toUIMessage),
  });
}
