import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toAgentDTO, toAgentData, type AgentInput } from "@/lib/agents/agent-io";

/** Fetch a single agent. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agent = await db.agent.findUnique({ where: { id } });
  if (!agent) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ agent: toAgentDTO(agent) });
}

/** Update an agent (partial). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const input = (await req.json()) as AgentInput;

  if (input.name !== undefined && !input.name.trim()) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
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
    return NextResponse.json({ agent: toAgentDTO(agent) });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

/** Delete an agent. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await db.agent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
