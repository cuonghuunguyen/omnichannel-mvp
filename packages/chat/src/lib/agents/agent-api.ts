// Server-side helpers for reading agent config from the AI Config API. The AI
// orchestration moved into that service, so chat only needs agent config for
// two chat-owned decisions: entry routing (which agent answers a new
// conversation) and guest-initiated escalation (the current agent's handoff
// rules). Everything AI-facing now lives in the API service.
import { api, type AgentDTO } from "@/lib/api";

// These run server-side (entry routing + escalation), where the api-client's
// browser header-injection middleware doesn't apply, so the tenant is passed
// explicitly as the X-Tenant-Id header the API requires.

/** Fetch a single agent's full config (within the tenant), or null if absent. */
export async function fetchAgent(
  tenantId: string,
  id: string,
): Promise<AgentDTO | null> {
  const { data, error } = await api.GET("/agents/{id}", {
    params: { path: { id } },
    headers: { "X-Tenant-Id": tenantId },
  });
  if (error || !data) return null;
  return data.agent;
}

/** All agents for the tenant, newest first (as the API orders them). */
export async function fetchAgents(tenantId: string): Promise<AgentDTO[]> {
  const { data } = await api.GET("/agents", {
    headers: { "X-Tenant-Id": tenantId },
  });
  return data?.agents ?? [];
}
