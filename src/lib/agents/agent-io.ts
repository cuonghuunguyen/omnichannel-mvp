// Translate between the agent builder's structured shape and the SQLite row,
// whose config columns are JSON-encoded strings.
import type { Agent } from "@/generated/prisma/client";
import {
  parseAgentConfig,
  type BuiltinToolFlags,
  type CustomToolDef,
  type GuardrailsConfig,
  type HandoffRule,
  type McpServerDef,
} from "@/lib/types";

/** An agent as the builder UI / API consumers see it (JSON columns parsed). */
export type AgentDTO = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  isRoutable: boolean;
  isDefault: boolean;
  builtinTools: BuiltinToolFlags;
  customTools: CustomToolDef[];
  mcpServers: McpServerDef[];
  handoffRules: HandoffRule[];
  guardrails: GuardrailsConfig;
  createdAt: string;
  updatedAt: string;
};

export function toAgentDTO(agent: Agent): AgentDTO {
  const config = parseAgentConfig(agent);
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    temperature: agent.temperature,
    isRoutable: agent.isRoutable,
    isDefault: agent.isDefault,
    ...config,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

/** Shape accepted by POST/PATCH; every field optional so PATCH can be partial. */
export type AgentInput = Partial<{
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  isRoutable: boolean;
  isDefault: boolean;
  builtinTools: BuiltinToolFlags;
  customTools: CustomToolDef[];
  mcpServers: McpServerDef[];
  handoffRules: HandoffRule[];
  guardrails: GuardrailsConfig;
}>;

/**
 * Map a (partial) AgentInput onto Prisma column data. Only keys present on the
 * input are emitted, so PATCH leaves untouched fields alone. JSON-typed columns
 * are stringified.
 */
export function toAgentData(input: AgentInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.systemPrompt !== undefined) data.systemPrompt = input.systemPrompt;
  if (input.model !== undefined) data.model = input.model;
  if (input.temperature !== undefined) data.temperature = input.temperature;
  if (input.isRoutable !== undefined) data.isRoutable = input.isRoutable;
  if (input.isDefault !== undefined) data.isDefault = input.isDefault;
  if (input.builtinTools !== undefined)
    data.builtinTools = JSON.stringify(input.builtinTools);
  if (input.customTools !== undefined)
    data.customTools = JSON.stringify(input.customTools);
  if (input.mcpServers !== undefined)
    data.mcpServers = JSON.stringify(input.mcpServers);
  if (input.handoffRules !== undefined)
    data.handoffRules = JSON.stringify(input.handoffRules);
  if (input.guardrails !== undefined)
    data.guardrails = JSON.stringify(input.guardrails);
  return data;
}
