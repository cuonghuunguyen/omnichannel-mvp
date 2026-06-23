// The config-builder endpoint. The chat service's admin UI POSTs the builder
// conversation here; this service runs the (stateless) builder assistant and
// streams a UIMessage response — text plus config/knowledge proposal parts the
// UI folds into an editable draft. No persistence: the user saves the resulting
// config via the normal /agents endpoint.
import { Router } from "express";
import { pipeUIMessageStreamToResponse } from "ai";
import { buildConfig, type BuilderUIMessage } from "@/lib/agents/builder";
import { AgentBuilderInput } from "@/schemas";
import type { AgentInput } from "@/lib/agent-io";

export const agentBuilderRouter: Router = Router();

/** Run one builder turn and stream the UIMessage response. */
agentBuilderRouter.post("/", async (req, res) => {
  const parsed = AgentBuilderInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }

  const stream = buildConfig({
    messages: parsed.data.messages as never as BuilderUIMessage[],
    currentDraft: (parsed.data.currentDraft ?? null) as AgentInput | null,
    editing: parsed.data.editing ?? false,
  });

  pipeUIMessageStreamToResponse({ response: res, stream });
});
