// Per-tenant conversation-event webhook. The orchestration loop runs in this
// service, but the conversation/message store + live SSE bus live elsewhere
// (the chat service, or any third-party integrator). So instead of writing rows
// directly, the loop emits ConversationEvents; this dispatcher POSTs them to the
// tenant's configured endpoint, where the subscriber persists + broadcasts them.
//
// Two transports, chosen per tenant:
//   • signed — POST to the tenant's webhookUrl with an HMAC X-Signature header,
//     body = { conversationId, ...event }. The general "any chat app" contract.
//   • legacy — POST to CHAT_URL/api/internal/conversations/:id/events with the
//     shared X-Internal-Secret header, body = event. Preserves the original
//     in-repo chat-service integration with no change on its side.
import crypto from "node:crypto";
import { db } from "@/lib/db";

/** A conversation mutation the loop asks the subscriber to apply + broadcast. */
export type ConversationEvent =
  | {
      type: "assistant_message";
      text: string;
      authorAgentId: string;
      authorAgentName: string;
    }
  | { type: "set_agent"; agentId: string; agentName: string }
  | { type: "escalate"; humanAgentId: string | null; reason?: string }
  | { type: "close"; reason?: string };

/** Where (and how) a tenant's events are delivered. */
export type WebhookTarget =
  | { mode: "signed"; url: string; secret: string }
  | { mode: "legacy"; baseUrl: string; secret: string };

/**
 * Pick a tenant's delivery transport: its own signed webhook if configured,
 * else the legacy CHAT_URL callback (only when CHAT_URL is set), else none.
 * Returning null means "drop events" — correct for a stateless OpenAI caller
 * that hasn't registered a webhook.
 */
export function resolveWebhookTarget(
  tenant: { webhookUrl: string | null; webhookSecret: string | null } | null,
): WebhookTarget | null {
  if (tenant?.webhookUrl) {
    return { mode: "signed", url: tenant.webhookUrl, secret: tenant.webhookSecret ?? "" };
  }
  const chatUrl = process.env.CHAT_URL?.trim();
  if (chatUrl) {
    return {
      mode: "legacy",
      baseUrl: chatUrl.replace(/\/+$/, ""),
      secret: process.env.INTERNAL_API_SECRET ?? "",
    };
  }
  return null;
}

/** Load + resolve a tenant's webhook target in one call (used by the routes). */
export async function loadWebhookTarget(tenantId: string): Promise<WebhookTarget | null> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { webhookUrl: true, webhookSecret: true },
  });
  return resolveWebhookTarget(tenant);
}

function sign(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Deliver one event. Best-effort relative to the live stream: a failed POST is
 * logged but never throws, so a missing/broken webhook can't abort the agent's
 * turn (the caller still gets its reply).
 */
export async function dispatchEvent(
  target: WebhookTarget | null,
  conversationId: string,
  event: ConversationEvent,
): Promise<void> {
  if (!target) return;
  try {
    let url: string;
    let body: string;
    let headers: Record<string, string>;
    if (target.mode === "legacy") {
      url = `${target.baseUrl}/api/internal/conversations/${conversationId}/events`;
      body = JSON.stringify(event);
      headers = { "Content-Type": "application/json", "X-Internal-Secret": target.secret };
    } else {
      url = target.url;
      const eventId = crypto.randomUUID();
      body = JSON.stringify({ eventId, conversationId, ...event });
      headers = {
        "Content-Type": "application/json",
        "X-Webhook-Event": event.type,
        "X-Signature": sign(target.secret, body),
      };
    }
    const res = await fetch(url, { method: "POST", headers, body });
    if (!res.ok) {
      console.error(
        `[webhook] ${event.type} failed (${res.status}):`,
        await res.text().catch(() => ""),
      );
    }
  } catch (err) {
    console.error(`[webhook] ${event.type} request failed:`, err);
  }
}
