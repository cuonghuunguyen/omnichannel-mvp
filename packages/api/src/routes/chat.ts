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
import { ACTIVE_TENANT_ID } from "@/lib/tenant";

export const chatRouter: Router = Router();

/** Run one AI turn for a conversation and stream the UIMessage response. */
chatRouter.post("/", async (req, res) => {
  const parsed = ChatTurnInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const { conversationId, agentId, routingFlag, messages } = parsed.data;
  // Scope to the tenant the chat service declares (defaults to this
  // deployment's tenant). The agent must belong to that tenant.
  const tenantId = parsed.data.tenantId ?? ACTIVE_TENANT_ID;

  const agent = await db.agent.findFirst({ where: { id: agentId, tenantId } });
  if (!agent) {
    res.status(409).json({ error: "no agent assigned" });
    return;
  }

  const webhook = await loadWebhookTarget(tenantId);

  const stream = orchestrate({
    tenantId,
    conversationId,
    entryAgent: toAgentDTO(agent),
    routingFlag: routingFlag ?? null,
    webhook,
    messages: messages as never,
  });

  pipeUIMessageStreamToResponse({ response: res, stream });
});
