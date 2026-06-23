// OpenAI-compatible facade. Lets any chat app that speaks the OpenAI Chat
// Completions protocol drive this service's multi-agent orchestration by simply
// pointing its baseURL here. Auth is `Authorization: Bearer <key>` → tenant; the
// `model` field selects the entry agent (by id); `stream` toggles SSE vs JSON.
//
// This runs stateless: the client sends the full message history each call and
// gets the final assistant text back. Routing/escalation/persistence side-
// effects are delivered out-of-band via the tenant's webhook (lib/webhooks),
// keeping the response 100% OpenAI-spec-clean.
import { Router, type Response } from "express";
import { z } from "zod";
import { db } from "@/lib/db";
import { toAgentDTO } from "@/lib/agent-io";
import { orchestrate } from "@/lib/chat/orchestrate";
import { loadWebhookTarget } from "@/lib/webhooks/dispatch";
import { authenticateTenant } from "@/lib/auth/api-key";
import { toUiMessages, drainText, type OpenAiMessage } from "@/lib/openai/adapt";

export const openaiRouter: Router = Router();

const ChatCompletionInput = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z
        .union([z.string(), z.array(z.record(z.string(), z.unknown()))])
        .nullable()
        .optional(),
    }),
  ),
  stream: z.boolean().optional(),
  /** OpenAI's end-user id; reused as the conversation correlation id. */
  user: z.string().optional(),
  /** Extension: explicit conversation id echoed on webhook events. */
  conversation_id: z.string().optional(),
});

/** Emit an OpenAI-style error envelope. */
function oaError(
  res: Response,
  status: number,
  message: string,
  type = "invalid_request_error",
  code: string | null = null,
): void {
  res.status(status).json({ error: { message, type, code, param: null } });
}

/** GET /v1/models — list the tenant's agents as selectable "models". */
openaiRouter.get("/models", async (req, res) => {
  const tenantId = await authenticateTenant(req);
  if (!tenantId) {
    oaError(res, 401, "Invalid API key.", "invalid_request_error", "invalid_api_key");
    return;
  }
  const agents = await db.agent.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
    select: { id: true, createdAt: true },
  });
  res.json({
    object: "list",
    data: agents.map((a) => ({
      id: a.id,
      object: "model",
      created: Math.floor(a.createdAt.getTime() / 1000),
      owned_by: tenantId,
    })),
  });
});

/** POST /v1/chat/completions — run one orchestration turn, OpenAI-shaped. */
openaiRouter.post("/chat/completions", async (req, res) => {
  const tenantId = await authenticateTenant(req);
  if (!tenantId) {
    oaError(res, 401, "Invalid API key.", "invalid_request_error", "invalid_api_key");
    return;
  }

  const parsed = ChatCompletionInput.safeParse(req.body);
  if (!parsed.success) {
    oaError(res, 400, "Invalid request body.");
    return;
  }
  const { model, messages, stream, user, conversation_id } = parsed.data;

  // `model` selects the entry agent (by id) within the tenant.
  const agent = await db.agent.findFirst({ where: { id: model, tenantId } });
  if (!agent) {
    oaError(res, 404, `Model '${model}' not found.`, "invalid_request_error", "model_not_found");
    return;
  }

  const uiMessages = toUiMessages(messages as OpenAiMessage[]);
  if (uiMessages.length === 0) {
    oaError(res, 400, "'messages' must not be empty.");
    return;
  }

  const conversationId = conversation_id ?? user ?? `oai-${crypto.randomUUID()}`;
  const webhook = await loadWebhookTarget(tenantId);

  const uiStream = orchestrate({
    tenantId,
    conversationId,
    entryAgent: toAgentDTO(agent),
    routingFlag: null,
    webhook,
    messages: uiMessages,
  });

  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const send = (chunk: unknown) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    const chunk = (delta: Record<string, unknown>, finish: string | null) => ({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    });

    send(chunk({ role: "assistant" }, null));
    try {
      await drainText(uiStream, (delta) => send(chunk({ content: delta }, null)));
      send(chunk({}, "stop"));
    } catch (err) {
      console.error("[openai] stream error:", err);
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  let text: string;
  try {
    text = await drainText(uiStream);
  } catch (err) {
    console.error("[openai] completion error:", err);
    oaError(res, 500, "Error generating completion.", "server_error");
    return;
  }

  res.json({
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
});
