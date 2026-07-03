// The AI chat completion endpoint. The chat service grabs a conversation's
// context (history + current agent + routing flag) and POSTs it here; this
// service runs the multi-agent orchestration loop and streams the UIMessage
// response back. Persistence + conversation-state changes flow back to chat via
// the callback "tool" (see lib/chat/callbacks.ts), since chat owns that DB.
import { Router } from "express";
import { pipeUIMessageStreamToResponse } from "ai";
import { db } from "@/lib/db";
import { toAgentDTO } from "@/lib/agent-io";
import { orchestrate } from "@/lib/chat/orchestrate";
import { loadWebhookTarget } from "@/lib/webhooks/dispatch";
import { ChatTurnInput } from "@/schemas";

export const chatRouter: Router = Router();

/** Run one AI turn for a conversation and stream the UIMessage response. */
chatRouter.post("/", async (req, res) => {
  const parsed = ChatTurnInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  // Scope to the tenant the chat service declares (the conversation's tenant).
  // The agent must belong to that tenant. No env fallback — see lib/tenant.ts.
  const { tenantId, conversationId, agentId, routingFlag, messages } = parsed.data;

  const agent = await db.agent.findFirst({ where: { id: agentId, tenantId } });
  if (!agent) {
    res.status(409).json({ error: "no agent assigned" });
    return;
  }

  const webhook = await loadWebhookTarget(tenantId);

  // stripProviderKey / stripEmbeddingKey middleware read X-Provider-Key /
  // X-Embedding-Key before logging and store them here.
  const providerApiKey =
    typeof res.locals.providerApiKey === "string" ? res.locals.providerApiKey : undefined;
  const embeddingApiKey =
    typeof res.locals.embeddingApiKey === "string" ? res.locals.embeddingApiKey : undefined;

  const stream = orchestrate({
    tenantId,
    conversationId,
    entryAgent: toAgentDTO(agent),
    routingFlag: routingFlag ?? null,
    webhook,
    messages: messages as never,
    providerApiKey,
    embeddingApiKey,
  });

  pipeUIMessageStreamToResponse({ response: res, stream });
});
