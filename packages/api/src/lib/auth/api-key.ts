// Inbound API-key auth for the OpenAI-compatible facade. Clients send their key
// as `Authorization: Bearer <key>` (the standard OpenAI scheme); we hash it and
// resolve the owning tenant by matching Tenant.apiKeyHash. The raw key is never
// stored — only its sha256 — so a DB leak can't be replayed against the API.
//
// Note this is OUR-issued tenant key, distinct from any provider (BYOK) key the
// tenant might later store to run the models.
import crypto from "node:crypto";
import type { Request } from "express";
import { db } from "@/lib/db";

/** sha256(hex) of an API key — used both to store (seed) and to look up. */
export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw.trim()).digest("hex");
}

/** Pull the Bearer token out of the Authorization header, if present. */
export function extractBearer(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Resolve the tenant for the request's API key, or null if absent/unknown.
 * Routes turn null into a 401.
 */
export async function authenticateTenant(req: Request): Promise<string | null> {
  const key = extractBearer(req);
  if (!key) return null;
  const tenant = await db.tenant.findFirst({
    where: { apiKeyHash: hashApiKey(key) },
    select: { id: true },
  });
  return tenant?.id ?? null;
}
