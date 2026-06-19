// Internal callback endpoint: the AI Config API runs the orchestration loop but
// can't touch this service's DB, so it POSTs conversation events here. This
// route is the chat side of the persistence "tool" — it applies each event to
// the conversation/message DB and broadcasts it on the in-process SSE bus so a
// watching human operator sees AI replies + status changes live.
//
// Internal-only: gated by a shared secret (INTERNAL_API_SECRET).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";
import { toUIMessage } from "@/lib/messages";

/** Mirror of the api service's ConversationEvent (lib/chat/callbacks.ts). */
type ConversationEvent =
  | {
      type: "assistant_message";
      text: string;
      authorAgentId: string;
      authorAgentName: string;
    }
  | { type: "set_agent"; agentId: string; agentName: string }
  | { type: "escalate"; humanAgentId: string | null; reason?: string }
  | { type: "close"; reason?: string };

function authorized(req: Request): boolean {
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  return secret.length > 0 && req.headers.get("x-internal-secret") === secret;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const event = (await req.json()) as ConversationEvent;

  const conversation = await db.conversation.findUnique({ where: { id } });
  if (!conversation) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  switch (event.type) {
    case "assistant_message": {
      const saved = await db.message.create({
        data: {
          tenantId: conversation.tenantId,
          conversationId: id,
          role: "assistant",
          content: event.text,
          parts: JSON.stringify([{ type: "text", text: event.text }]),
          authorAgentId: event.authorAgentId,
          authorAgentName: event.authorAgentName,
        },
      });
      publish(id, {
        kind: "message",
        origin: "ai",
        message: toUIMessage(saved),
      });
      break;
    }

    case "set_agent": {
      await db.conversation.update({
        where: { id },
        data: { currentAgentId: event.agentId, currentAgentName: event.agentName },
      });
      break;
    }

    case "escalate": {
      const updated = await db.conversation.update({
        where: { id },
        data: {
          assignmentType: "human",
          status: "escalated",
          humanAgentId: event.humanAgentId,
        },
      });
      publish(id, {
        kind: "status",
        status: updated.status,
        assignmentType: updated.assignmentType,
        humanAgentId: updated.humanAgentId,
      });
      break;
    }

    case "close": {
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
      break;
    }
  }

  // Any successful event implies activity — bump the conversation's timestamp.
  await db.conversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
