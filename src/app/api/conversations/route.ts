import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveEntryRouting } from "@/lib/routing";

/**
 * List conversations (most recent first). Either:
 *  - `?userId=` — a guest's own conversations, or
 *  - `?status=escalated,assigned` — the admin inbox view (comma-separated).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const status = url.searchParams.get("status");

  if (!userId && !status) {
    return NextResponse.json(
      { error: "userId or status is required" },
      { status: 400 },
    );
  }

  const conversations = await db.conversation.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(status ? { status: { in: status.split(",") } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      user: { select: { name: true } },
      currentAgent: { select: { name: true } },
    },
  });
  return NextResponse.json({ conversations });
}

/** Start a new conversation (== new session). Initial routing is by flag. */
export async function POST(req: Request) {
  const { userId, routingFlag, title } = (await req.json()) as {
    userId?: string;
    routingFlag?: string;
    title?: string;
  };
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const routing = await resolveEntryRouting(routingFlag);

  const conversation = await db.conversation.create({
    data: {
      userId,
      title: title ?? null,
      routingFlag: routingFlag ?? null,
      assignmentType: routing.assignmentType,
      currentAgentId: routing.agentId,
    },
  });

  return NextResponse.json({ conversation });
}
