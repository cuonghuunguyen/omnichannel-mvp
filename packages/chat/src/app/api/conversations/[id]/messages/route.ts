import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toUIMessage } from "@/lib/messages";
import { publish } from "@/lib/events";

/**
 * A human operator posts a reply into a conversation. Persisted as an assistant
 * message authored by the operator (a human_agent User) and broadcast to the
 * guest via SSE (origin "human").
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { text, humanAgentId } = (await req.json()) as {
    text?: string;
    humanAgentId?: string;
  };

  const trimmed = text?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (!humanAgentId) {
    return NextResponse.json({ error: "humanAgentId is required" }, { status: 400 });
  }

  const conversation = await db.conversation.findUnique({ where: { id } });
  if (!conversation) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const saved = await db.message.create({
    data: {
      tenantId: conversation.tenantId,
      conversationId: id,
      role: "assistant",
      content: trimmed,
      parts: JSON.stringify([{ type: "text", text: trimmed }]),
      authorUserId: humanAgentId,
    },
    include: { authorUser: { select: { name: true, kind: true } } },
  });
  await db.conversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  const message = toUIMessage(saved);
  publish(id, { kind: "message", origin: "human", message });

  return NextResponse.json({ message });
}
