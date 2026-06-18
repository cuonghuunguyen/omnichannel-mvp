// Server-side helpers for reading agent config + searching knowledge from the
// AI Config API. The chat orchestration loop calls these instead of touching a
// shared DB — agents live in the API service (true service split).
import { api, type AgentDTO, type RetrievedChunk } from "@/lib/api";
import type { RoutableAgent } from "@/lib/agents/tools";

/** Fetch a single agent's full config, or null if it doesn't exist. */
export async function fetchAgent(id: string): Promise<AgentDTO | null> {
  const { data, error } = await api.GET("/agents/{id}", {
    params: { path: { id } },
  });
  if (error || !data) return null;
  return data.agent;
}

/** All agents, newest first (as the API orders them). */
export async function fetchAgents(): Promise<AgentDTO[]> {
  const { data } = await api.GET("/agents");
  return data?.agents ?? [];
}

/** The agents a given agent may hand off to (routable, excluding itself). */
export async function fetchRoutableAgents(
  excludeAgentId: string,
): Promise<RoutableAgent[]> {
  const agents = await fetchAgents();
  return agents
    .filter((a) => a.isRoutable && a.id !== excludeAgentId)
    .map((a) => ({ id: a.id, name: a.name, description: a.description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Run the API's retrieval pipeline over the given buckets. */
export async function searchKnowledge(input: {
  bucketIds: string[];
  query: string;
  topK?: number;
  model?: string;
}): Promise<RetrievedChunk[]> {
  const { data, error } = await api.POST("/knowledge/search", { body: input });
  if (error || !data) {
    throw new Error(
      typeof error === "object" && error && "error" in error
        ? String((error as { error: unknown }).error)
        : "knowledge search failed",
    );
  }
  return data.results;
}
