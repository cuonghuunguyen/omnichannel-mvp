// Server-side helpers for reading agent config from the AI Config API. The AI
// orchestration moved into that service, so chat only needs agent config for
// two chat-owned decisions: entry routing (which agent answers a new
// conversation) and guest-initiated escalation (the current agent's handoff
// rules). Everything AI-facing now lives in the API service.
import { api, type AgentDTO } from "@/lib/api";

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
