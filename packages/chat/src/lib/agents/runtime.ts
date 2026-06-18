// Per-agent runtime assembly: the system prompt and the toolset handed to
// streamText for a single hop of the orchestration loop. Agents come from the
// AI Config API (via the generated client), not a local DB.
import type { AgentDTO, GuardrailsConfig } from "@/lib/api";
import { fetchRoutableAgents } from "@/lib/agents/agent-api";
import { guardHardening } from "@/lib/agents/guard";
import {
  buildBuiltinTools,
  buildCustomTools,
  buildKnowledgeTool,
  type RoutableAgent,
  type ToolContext,
} from "@/lib/agents/tools";
import { connectMcpServers } from "@/lib/agents/mcp";

/** Load the agents this agent may hand off to (routable, excluding itself). */
export async function loadRoutableAgents(
  excludeAgentId: string,
): Promise<RoutableAgent[]> {
  return fetchRoutableAgents(excludeAgentId);
}

/**
 * Compose the system prompt: the agent's master prompt plus a short note about
 * its place in the multi-agent system. Tool-specific guidance (the routable
 * roster) lives in the tool descriptions themselves, generated from live data.
 */
export function buildSystemPrompt(agent: AgentDTO, guardrails: GuardrailsConfig): string {
  return [
    agent.systemPrompt.trim(),
    "",
    `You are "${agent.name}", one agent in a multi-agent support system. ` +
      "Use your tools to message the user or route the conversation when another " +
      "agent or a human is better suited. Do not mention tool names to the user.",
    guardHardening(guardrails),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the system prompt + full toolset for one hop: built-in routing tools,
 * the agent's custom HTTP tools, and any remote MCP server tools. Returns a
 * `closeMcp` the caller must run in a `finally` once the hop's stream finishes.
 *
 * Built-in tools are merged last so a misconfigured custom/MCP tool can never
 * shadow `deliver_to_agent`/`deliver_to_human` and break routing.
 */
export async function buildAgentRuntime(
  agent: AgentDTO,
  routable: RoutableAgent[],
  ctx: ToolContext,
) {
  const { builtinTools, customTools, mcpServers, guardrails, knowledge } = agent;
  const mcp = await connectMcpServers(mcpServers);
  // Query rewrite + reranking run on a dedicated model if configured, else the
  // agent's own model.
  const pipelineModel = process.env.RAG_PIPELINE_MODEL?.trim() || agent.model;
  return {
    system: buildSystemPrompt(agent, guardrails),
    tools: {
      ...mcp.tools,
      ...buildCustomTools(customTools),
      ...buildKnowledgeTool(knowledge, pipelineModel, ctx),
      ...buildBuiltinTools(builtinTools, routable, ctx),
    },
    closeMcp: mcp.close,
  };
}
