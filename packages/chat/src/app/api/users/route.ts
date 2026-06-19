import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ACTIVE_TENANT_ID } from "@/lib/tenant";

/** List users, optionally filtered by kind (e.g. `?kind=human_agent` for the inbox). */
export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind");
  const users = await db.user.findMany({
    where: { tenantId: ACTIVE_TENANT_ID, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, kind: true },
  });
  return NextResponse.json({ users });
}

/**
 * Identify a guest by name. Guests are upserted by name (case-insensitive-ish):
 * returning the same user lets their info persist across sessions.
 */
export async function POST(req: Request) {
  const { name, info } = (await req.json()) as {
    name?: string;
    info?: Record<string, unknown>;
  };

  const trimmed = name?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const existing = await db.user.findFirst({
    where: { tenantId: ACTIVE_TENANT_ID, name: trimmed, kind: "guest" },
  });

  const user = existing
    ? await db.user.update({
        where: { id: existing.id },
        data: info ? { info: JSON.stringify(info) } : {},
      })
    : await db.user.create({
        data: {
          tenantId: ACTIVE_TENANT_ID,
          name: trimmed,
          kind: "guest",
          info: info ? JSON.stringify(info) : null,
        },
      });

  return NextResponse.json({ user });
}
