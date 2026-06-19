// Chat-only: this route no longer runs the AI. It owns the conversation/message
// DB and the SSE bus; the AI orchestration lives in the AI Config API. Per turn
// it gates the conversation, persists + broadcasts the user message, then grabs
// the context (history + current agent + routing flag) and forwards it to the
// API's /chat endpoint, streaming the UIMessage response straight back to the
// browser. The API persists its replies via the internal callback endpoint.
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { db } from "@/lib/db";
import { textFromParts, toUIMessage } from "@/lib/messages";
import { publish } from "@/lib/events";
import { ACTIVE_TENANT_ID } from "@/lib/tenant";
import type { ChatUIMessage } from "@/lib/agents/ui-messages";

export const maxDuration = 60;

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

/** An empty assistant turn — used by the gates so `useChat` completes cleanly. */
function emptyStream() {
  const stream = createUIMessageStream<ChatUIMessage>({ execute: () => {} });
  return createUIMessageStreamResponse({ stream });
}

export async function POST(req: Request) {
  const { messages, conversationId } = (await req.json()) as {
    messages: ChatUIMessage[];
    conversationId: string;
  };

  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) {
    return new Response(JSON.stringify({ error: "conversation not found" }), {
      status: 404,
    });
  }

  // Gate: a closed conversation is terminal — don't persist or answer.
  if (conversation.status === "closed") return emptyStream();

  // Persist the latest user message, and broadcast it so a watching human
  // operator sees it live (origin "guest" — the guest ignores its own echo).
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser) {
    const saved = await db.message.create({
      data: {
        tenantId: conversation.tenantId,
        conversationId,
        role: "user",
        content: textFromParts(lastUser.parts),
        parts: JSON.stringify(lastUser.parts),
        authorUserId: conversation.userId,
      },
      include: { authorUser: { select: { name: true, kind: true } } },
    });
    publish(conversationId, {
      kind: "message",
      origin: "guest",
      message: toUIMessage(saved),
    });
  }

  // Gate: once a conversation is owned by a human, the AI stays out of it. The
  // guest message above is already in the human inbox via SSE.
  if (conversation.assignmentType === "human") return emptyStream();

  if (!conversation.currentAgentId) {
    return new Response(JSON.stringify({ error: "no agent assigned" }), {
      status: 409,
    });
  }

  // Grab the context and hand the turn to the AI Config API. It runs the
  // orchestration loop and streams the UIMessage response back, persisting its
  // replies + state changes via the internal callback endpoint.
  const upstream = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": INTERNAL_SECRET,
    },
    body: JSON.stringify({
      tenantId: ACTIVE_TENANT_ID,
      conversationId,
      agentId: conversation.currentAgentId,
      routingFlag: conversation.routingFlag,
      messages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: "AI service error", detail }),
      { status: 502 },
    );
  }

  // Stream the API's UIMessage response straight through to the browser,
  // preserving the AI SDK's stream headers so `useChat` parses it correctly.
  const headers = new Headers();
  for (const key of ["content-type", "cache-control", "x-vercel-ai-ui-message-stream"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
