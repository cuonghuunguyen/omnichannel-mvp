// Multi-tenancy: this service holds every tenant's data in one DB; there is no
// single "active" tenant anymore (the TENANT_ID env was removed). Each request
// carries its own tenant, resolved per call from one of three sources:
//   - admin routes (agents, knowledge): the `X-Tenant-Id` header sent by the
//     chat app's browser/admin UI and its server-side API-client calls;
//   - the /chat route: the `tenantId` in the request body (the chat proxy sends
//     the conversation's tenant);
//   - the OpenAI-compatible facade (/v1): the Bearer key → Tenant.apiKeyHash
//     (see lib/auth/api-key.ts).
// The Tenant registry is duplicated in the chat service's DB; new tenants are
// pushed here via the secret-gated POST /internal/tenants endpoint.
import type { Request } from "express";

export const TENANT_HEADER = "x-tenant-id";

/** Read the `X-Tenant-Id` header, or null if absent/blank. */
export function tenantFromHeader(req: Request): string | null {
  const value = req.header(TENANT_HEADER)?.trim();
  return value ? value : null;
}
