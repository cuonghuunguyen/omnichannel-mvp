import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { McpServerDef } from "@/lib/types";
import { TIMEOUTS, withTimeout } from "@/lib/resilience";
import { logger } from "@/lib/logger";

export type McpConnection = {
  /** Tools discovered across all reachable servers, merged. */
  tools: ToolSet;
  /** Close every opened client. Safe to call once after the turn finishes. */
  close: () => Promise<void>;
  /**
   * One entry per server that failed to connect (or timed out). Internal
   * TS-only signal — never part of the OpenAPI-documented contract (a bad
   * server must not break the turn, but callers that need to report the
   * failure, e.g. the test-connection endpoint, can read this instead of the
   * server-side-only log line).
   */
  failures: { server: string; error: string }[];
};

/**
 * Open an MCP client per configured server (HTTP transport) and merge their
 * advertised tools. A server that fails to connect is skipped — one bad server
 * must not break the agent's turn — but its failure is recorded in
 * `failures[]` instead of only being logged. Always pair with `close()` in a
 * `finally`.
 */
export async function connectMcpServers(
  servers: McpServerDef[],
): Promise<McpConnection> {
  const clients: MCPClient[] = [];
  let tools: ToolSet = {};
  const failures: { server: string; error: string }[] = [];

  for (const server of servers) {
    if (!server.url) continue;
    const label = `MCP ${server.name || server.url}`;
    try {
      // Bound the connect + tool-discovery handshake so an unresponsive server
      // can't stall turn setup; a timeout falls through to the skip path below.
      const client = await withTimeout(
        createMCPClient({
          transport: { type: "http", url: server.url, headers: server.headers },
        }),
        TIMEOUTS.mcpMs,
        label,
      );
      clients.push(client);
      tools = { ...tools, ...(await withTimeout(client.tools(), TIMEOUTS.mcpMs, label)) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, `MCP connect failed for ${server.name || server.url}`);
      failures.push({ server: server.name || server.url, error: message });
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
    failures,
  };
}
