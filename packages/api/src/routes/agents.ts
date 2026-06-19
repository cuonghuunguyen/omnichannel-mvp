import { Router } from "express";
import { db } from "@/lib/db";
import { toAgentDTO, toAgentData } from "@/lib/agent-io";
import { AgentInput } from "@/schemas";
import { ACTIVE_TENANT_ID } from "@/lib/tenant";

export const agentsRouter: Router = Router();

// All agent reads/writes are scoped to the active tenant — agents from other
// tenants are invisible (and uneditable) through this service.
const tenantId = ACTIVE_TENANT_ID;

/** List all agents for the active tenant (newest first). */
agentsRouter.get("/", async (_req, res) => {
  const agents = await db.agent.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
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

  const data = { ...toAgentData(input), tenantId };

  // Only one default entry agent per tenant: if this one claims it, clear rest.
  const agent = await db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.agent.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.agent.create({ data: data as never });
  });

  res.status(201).json({ agent: toAgentDTO(agent) });
});

/** Fetch a single agent (within the active tenant). */
agentsRouter.get("/:id", async (req, res) => {
  const agent = await db.agent.findFirst({
    where: { id: req.params.id, tenantId },
  });
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

  // Confirm the agent belongs to this tenant before mutating.
  const existing = await db.agent.findFirst({ where: { id, tenantId } });
  if (!existing) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const data = toAgentData(input);

  const agent = await db.$transaction(async (tx) => {
    // Only one default entry agent per tenant: if this one claims it, clear rest.
    if (input.isDefault) {
      await tx.agent.updateMany({
        where: { tenantId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.agent.update({ where: { id }, data: data as never });
  });
  res.json({ agent: toAgentDTO(agent) });
});

/** Delete an agent (within the active tenant). */
agentsRouter.delete("/:id", async (req, res) => {
  const result = await db.agent.deleteMany({
    where: { id: req.params.id, tenantId },
  });
  if (result.count === 0) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ok: true });
});
