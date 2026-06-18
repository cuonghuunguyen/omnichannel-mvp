import { Router } from "express";
import { db } from "@/lib/db";
import { toAgentDTO, toAgentData } from "@/lib/agent-io";
import { AgentInput } from "@/schemas";

export const agentsRouter: Router = Router();

/** List all agents (newest first). */
agentsRouter.get("/", async (_req, res) => {
  const agents = await db.agent.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ agents: agents.map(toAgentDTO) });
});

/** Create a new agent. */
agentsRouter.post("/", async (req, res) => {
  const parsed = AgentInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const input = parsed.data;
  if (!input.name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const data = toAgentData(input);

  // Only one default entry agent: if this one claims it, clear the rest.
  const agent = await db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.agent.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.agent.create({ data: data as never });
  });

  res.status(201).json({ agent: toAgentDTO(agent) });
});

/** Fetch a single agent. */
agentsRouter.get("/:id", async (req, res) => {
  const agent = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ agent: toAgentDTO(agent) });
});

/** Update an agent (partial). */
agentsRouter.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const parsed = AgentInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const input = parsed.data;
  if (input.name !== undefined && !input.name.trim()) {
    res.status(400).json({ error: "name cannot be empty" });
    return;
  }

  const data = toAgentData(input);

  try {
    const agent = await db.$transaction(async (tx) => {
      // Only one default entry agent: if this one claims it, clear the others.
      if (input.isDefault) {
        await tx.agent.updateMany({
          where: { isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.agent.update({ where: { id }, data: data as never });
    });
    res.json({ agent: toAgentDTO(agent) });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

/** Delete an agent. */
agentsRouter.delete("/:id", async (req, res) => {
  try {
    await db.agent.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});
