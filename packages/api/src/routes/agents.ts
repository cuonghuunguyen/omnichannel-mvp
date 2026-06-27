import { Router } from "express";
import { db } from "@/lib/db";
import { toAgentDTO, toAgentData } from "@/lib/agent-io";
import { AgentInput } from "@/schemas";
import { tenantFromHeader } from "@/lib/tenant";

export const agentsRouter: Router = Router();

// Create-time defaults for the TEXT columns that lost their DB default in the
// MySQL migration (MySQL forbids literal defaults on TEXT). Applied only on
// create; updates still patch just the provided fields.
const AGENT_CREATE_DEFAULTS = {
  description: "",
  systemPrompt: "",
  builtinTools: "{}",
  customTools: "[]",
  mcpServers: "[]",
  handoffRules: "[]",
  guardrails: "{}",
  knowledge: "{}",
} as const;

// All agent reads/writes are scoped to the request's tenant (X-Tenant-Id) —
// agents from other tenants are invisible (and uneditable) through this service.
agentsRouter.use((req, res, next) => {
  const tenantId = tenantFromHeader(req);
  if (!tenantId) {
    res.status(400).json({ error: "X-Tenant-Id header is required" });
    return;
  }
  res.locals.tenantId = tenantId;
  next();
});

/** List all agents for the tenant (newest first). */
agentsRouter.get("/", async (_req, res) => {
  const tenantId = String(res.locals.tenantId);
  const agents = await db.agent.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ agents: agents.map(toAgentDTO) });
});

/** Create a new agent. */
agentsRouter.post("/", async (req, res) => {
  const tenantId = String(res.locals.tenantId);
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

  const data = { ...AGENT_CREATE_DEFAULTS, ...toAgentData(input), tenantId };

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
  const tenantId = String(res.locals.tenantId);
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
  const tenantId = String(res.locals.tenantId);
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
  const tenantId = String(res.locals.tenantId);
  const result = await db.agent.deleteMany({
    where: { id: req.params.id, tenantId },
  });
  if (result.count === 0) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ok: true });
});
