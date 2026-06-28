import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { McpServerDef } from "@/lib/types";
import { TIMEOUTS, withTimeout } from "@/lib/resilience";

export type McpConnection = {
  /** Tools discovered across all reachable servers, merged. */
  tools: ToolSet;
  /** Close every opened client. Safe to call once after the turn finishes. */
  close: () => Promise<void>;
};

/**
 * Open an MCP client per configured server (HTTP transport) and merge their
 * advertised tools. A server that fails to connect is skipped — one bad server
 * must not break the agent's turn. Always pair with `close()` in a `finally`.
 */
export async function connectMcpServers(
  servers: McpServerDef[],
): Promise<McpConnection> {
  const clients: MCPClient[] = [];
  let tools: ToolSet = {};

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
      console.error(
        `MCP connect failed for ${server.name || server.url}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}
