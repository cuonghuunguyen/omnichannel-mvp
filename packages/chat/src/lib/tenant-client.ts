// Client-side tenant helpers. Kept separate from lib/tenant.ts (which imports
// the server-only `next/headers`) so this can be imported from browser code.
//
// The signed-in tenant is mirrored into localStorage so the browser admin UI can
// stamp X-Tenant-Id on its direct API calls; the authoritative copy is the
// httpOnly sign-in cookie the chat server routes read.

export type Tenant = { id: string; name: string };

/** localStorage key holding the signed-in tenant as JSON ({ id, name }). */
export const TENANT_STORAGE_KEY = "agent-routing.tenant";

/** Read the signed-in tenant from localStorage, or null. */
export function readStoredTenant(): Tenant | null {
  try {
    const raw = localStorage.getItem(TENANT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Tenant>;
    return parsed.id && parsed.name ? { id: parsed.id, name: parsed.name } : null;
  } catch {
    return null;
  }
}

/** Persist (or clear) the signed-in tenant in localStorage. */
export function writeStoredTenant(tenant: Tenant | null): void {
  if (tenant) localStorage.setItem(TENANT_STORAGE_KEY, JSON.stringify(tenant));
  else localStorage.removeItem(TENANT_STORAGE_KEY);
}
