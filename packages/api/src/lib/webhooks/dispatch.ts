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
      /** Present only when the hop's knowledge-tool retrieval found results (KB-05). */
      usedKnowledge?: { resultCount: number; sources: string[]; buckets?: string[] };
      /**
       * Present only when the hop had tool calls or reasoning (D-01/D-03). Tool-call
       * entries are intent-level summaries — never raw args/results or secrets (OBS-01).
       */
      aiDetail?: { toolCalls: { name: string; summary: string }[]; reasoning?: string };
    }
  | { type: "set_agent"; agentId: string; agentName: string }
  | { type: "escalate"; humanAgentId: string | null; reason?: string }
  | { type: "close"; reason?: string }
  | {
      type: "guardrail";
      blocked: boolean;
      category: string;
      reason: string;
      offerHuman: boolean;
    };

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
    // WR-03: an empty/absent webhookSecret is a CONFIGURATION ERROR, not a valid signing
    // key. Signing with "" produces a valid-looking sha256= header that a subscriber which
    // also defaults to an empty secret would accept — an auth bypass. Treat it as
    // misconfiguration: skip delivery and log, rather than silently signing with "".
    const secret = tenant.webhookSecret?.trim();
    if (!secret) {
      console.error(
        "[webhook] tenant has a webhookUrl but no webhookSecret configured — refusing to sign with an empty secret; dropping delivery",
      );
      return null;
    }
    return { mode: "signed", url: tenant.webhookUrl, secret };
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * WR-03: bounded retry-with-backoff for transient failures (network error or 5xx).
 * 4xx responses are NOT retried — they are permanent (bad signature, 4xx contract
 * mismatch) and retrying only amplifies load. Returns true on a delivered (2xx) POST.
 */
async function postWithRetry(
  url: string,
  init: { headers: Record<string, string>; body: string },
  eventType: string,
  attempts: number,
): Promise<boolean> {
  // Backoff schedule (ms) — index by (attempt - 1); clamp to the last entry.
  const backoff = [250, 1000, 3000];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: init.headers, body: init.body });
      if (res.ok) return true;
      const transient = res.status >= 500;
      console.error(
        `[webhook] ${eventType} failed (${res.status}) attempt ${attempt}/${attempts}:`,
        await res.text().catch(() => ""),
      );
      if (!transient) return false; // 4xx: permanent — do not retry
    } catch (err) {
      console.error(`[webhook] ${eventType} request failed attempt ${attempt}/${attempts}:`, err);
    }
    if (attempt < attempts) {
      await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)]);
    }
  }
  return false;
}

/**
 * Deliver one event. Best-effort relative to the live stream: a failed POST is
 * logged but never throws, so a missing/broken webhook can't abort the agent's
 * turn (the caller still gets its reply).
 *
 * WR-03: assistant_message is the customer-facing reply — losing it on a transient
 * 5xx/network blip silently drops the AI's answer after the provider key was already
 * spent. Such events get a bounded retry-with-backoff; non-customer-facing state events
 * (set_agent/escalate/close) keep the single-attempt best-effort behaviour.
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
    // The eventId in the signed body makes retries idempotent on the subscriber side
    // (Laravel dedups via messages.dedup_id), so re-POSTing the same body is safe.
    const attempts = event.type === "assistant_message" ? 4 : 1;
    const delivered = await postWithRetry(url, { headers, body }, event.type, attempts);
    if (!delivered && event.type === "assistant_message") {
      console.error(
        `[webhook] assistant_message permanently undelivered after ${attempts} attempts for conversation ${conversationId} — the customer's reply was lost`,
      );
    }
  } catch (err) {
    console.error(`[webhook] ${event.type} request failed:`, err);
  }
}
