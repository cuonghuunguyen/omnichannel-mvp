import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publish } from "@/lib/events";
import { evaluateHandoffRules } from "@/lib/routing";
import { fetchAgent } from "@/lib/agents/agent-api";

/**
 * Guest-initiated escalation to a human (e.g. from the "connect me to a human"
 * offer after a guarded message). Picks a human via the current agent's handoff
 * rules, flips the conversation to human ownership, and broadcasts the status.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const conversation = await db.conversation.findUnique({ where: { id } });
  if (!conversation) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (conversation.status === "closed") {
    return NextResponse.json({ error: "conversation is closed" }, { status: 409 });
  }

  // Pick a human via the current agent's handoff rules (agent lives in the API).
  const agent = conversation.currentAgentId
    ? await fetchAgent(conversation.currentAgentId)
    : null;
  const rules = agent?.handoffRules ?? [];
  const { humanAgentId } = evaluateHandoffRules(rules, {
    flag: conversation.routingFlag,
  });

  const updated = await db.conversation.update({
    where: { id },
    data: { assignmentType: "human", status: "escalated", humanAgentId },
  });

  publish(id, {
    kind: "status",
    status: updated.status,
    assignmentType: updated.assignmentType,
    humanAgentId: updated.humanAgentId,
  });

  return NextResponse.json({ conversation: updated });
}
