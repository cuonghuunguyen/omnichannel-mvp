// Internal, service-to-service endpoints — gated by the shared INTERNAL_API_SECRET
// (X-Internal-Secret), the same secret the chat service's callback endpoint uses.
// Not part of the public OpenAPI surface.
//
// The Tenant registry is duplicated in both services' DBs (no cross-service FK).
// When a tenant signs up in the chat service, chat POSTs it here so this service
// has the row too — agents/knowledge can't be created for an unknown tenant
// (Agent.tenantId → Tenant FK).
import { Router } from "express";
import { db } from "@/lib/db";

export const internalRouter: Router = Router();

internalRouter.use((req, res, next) => {
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  if (!secret || req.header("x-internal-secret") !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
});

/** Upsert a tenant into this service's registry (D-09 full payload). */
internalRouter.post("/tenants", async (req, res) => {
  const { id, name, apiKeyHash, webhookUrl, webhookSecret, guardModel } = (req.body ?? {}) as {
    id?: string;
    name?: string;
    apiKeyHash?: string;
    webhookUrl?: string;
    webhookSecret?: string;
    guardModel?: string;
  };
  const tenantId = id?.trim();
  const tenantName = name?.trim();
  if (!tenantId || !tenantName) {
    res.status(400).json({ error: "id and name are required" });
    return;
  }
  const tenant = await db.tenant.upsert({
    where: { id: tenantId },
    update: {
      name: tenantName,
      apiKeyHash,
      webhookUrl,
      webhookSecret,
      // Only update guardModel when it was explicitly sent in the request body.
      ...(guardModel !== undefined && { guardModel }),
    },
    create: { id: tenantId, name: tenantName, apiKeyHash, webhookUrl, webhookSecret, guardModel: guardModel ?? null },
  });
  res.status(201).json({ tenant: { id: tenant.id, name: tenant.name } });
});
