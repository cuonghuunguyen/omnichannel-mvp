// Tenant sign-in / sign-up. The door to every surface: a visitor enters a tenant
// NAME; if a tenant with that name exists we sign in to it, otherwise we sign up
// (create it with a freshly generated numeric id). The resolved tenant id is
// written to an httpOnly cookie (read by every chat server route) and, on
// sign-up, pushed to the AI Config API so its duplicated Tenant registry has the
// row too (agents/knowledge can't be created for an unknown tenant).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { TENANT_COOKIE, TENANT_COOKIE_MAX_AGE, getTenantId } from "@/lib/tenant";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

/** Next numeric tenant id = max(existing numeric ids) + 1 (chat is the source). */
async function nextTenantId(): Promise<string> {
  const tenants = await db.tenant.findMany({ select: { id: true } });
  const maxNumeric = tenants.reduce((max, t) => {
    const n = Number(t.id);
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);
  return String(maxNumeric + 1);
}

/** Mirror the tenant into the AI Config API's registry (best-effort on sign-in,
 *  required on sign-up). Throws on failure so sign-up can surface it. */
async function syncTenantToApi(id: string, name: string): Promise<void> {
  const res = await fetch(`${API_URL}/internal/tenants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": INTERNAL_SECRET,
    },
    body: JSON.stringify({ id, name }),
  });
  if (!res.ok) {
    throw new Error(`tenant sync failed (${res.status})`);
  }
}

/** Current signed-in tenant (for the client to restore/validate its session). */
export async function GET() {
  const id = await getTenantId();
  if (!id) return NextResponse.json({ tenant: null });
  const tenant = await db.tenant.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  return NextResponse.json({ tenant });
}

/** Sign in to (or sign up) a tenant by name. */
export async function POST(req: Request) {
  const { name } = (await req.json()) as { name?: string };
  const trimmed = name?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const existing = await db.tenant.findFirst({ where: { name: trimmed } });

  let tenant: { id: string; name: string };
  let isNew = false;
  if (existing) {
    tenant = { id: existing.id, name: existing.name };
  } else {
    const id = await nextTenantId();
    const created = await db.tenant.create({ data: { id, name: trimmed } });
    tenant = { id: created.id, name: created.name };
    isNew = true;
  }

  // The API's registry must know this tenant (FK target for agents). On sign-up
  // this is mandatory; on sign-in it's a cheap idempotent upsert that self-heals
  // a missing row.
  try {
    await syncTenantToApi(tenant.id, tenant.name);
  } catch (err) {
    if (isNew) {
      // Roll back so a half-created tenant doesn't linger without an API row.
      await db.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
      return NextResponse.json(
        { error: "could not register tenant with AI service" },
        { status: 502 },
      );
    }
    // Sign-in: log and continue; the row already exists from a prior sync.
    console.warn("[tenants] API sync failed on sign-in:", err);
  }

  (await cookies()).set(TENANT_COOKIE, tenant.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: TENANT_COOKIE_MAX_AGE,
  });

  return NextResponse.json({ tenant, isNew });
}

/** Sign out of the current tenant (clear the cookie). */
export async function DELETE() {
  (await cookies()).set(TENANT_COOKIE, "", { path: "/", maxAge: 0 });
  return NextResponse.json({ ok: true });
}
