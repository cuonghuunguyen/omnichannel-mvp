// Multi-tenancy: this deployment serves every tenant (the TENANT_ID env was
// removed). A visitor signs in to / signs up a tenant by name at the door (see
// POST /api/tenants), which sets an httpOnly cookie. Every server route resolves
// the request's tenant from that cookie, and the tenantId is forwarded to the AI
// Config API (via the X-Tenant-Id header / the /chat body). The Tenant registry
// is duplicated in the API's DB; new tenants are pushed there on sign-up.
import { cookies } from "next/headers";

/** httpOnly cookie holding the signed-in tenant id (server-read only). */
export const TENANT_COOKIE = "agent-routing.tenant";

/** Cookie lifetime: ~1 year (dev convenience; re-issued on every sign-in). */
export const TENANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The signed-in tenant id from the request cookie, or null if not signed in. */
export async function getTenantId(): Promise<string | null> {
  const value = (await cookies()).get(TENANT_COOKIE)?.value?.trim();
  return value ? value : null;
}
