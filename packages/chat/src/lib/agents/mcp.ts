// Remote MCP servers: connect per request, merge their tools into the agent's
// toolset, and expose a close() the orchestration loop runs in a finally block.
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { McpServerDef } from "@/lib/types";

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
    try {
      const client = await createMCPClient({
        transport: { type: "http", url: server.url, headers: server.headers },
      });
      clients.push(client);
      tools = { ...tools, ...(await client.tools()) };
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
