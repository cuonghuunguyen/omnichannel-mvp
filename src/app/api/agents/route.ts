import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toAgentDTO, toAgentData, type AgentInput } from "@/lib/agents/agent-io";

/** List all agents (newest first). */
export async function GET() {
  const agents = await db.agent.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ agents: agents.map(toAgentDTO) });
}

/** Create a new agent. */
export async function POST(req: Request) {
  const input = (await req.json()) as AgentInput;

  if (!input.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const data = toAgentData(input);

  // Only one default entry agent: if this one claims it, clear the rest.
  const agent = await db.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.agent.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.agent.create({ data: data as never });
  });

  return NextResponse.json({ agent: toAgentDTO(agent) }, { status: 201 });
}
