import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMCPClient } from "@ai-sdk/mcp";
import { connectMcpServers } from "@/lib/agents/mcp";
import type { McpServerDef } from "@/lib/types";

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn(),
}));

function def(overrides: Partial<McpServerDef> = {}): McpServerDef {
  return {
    name: "orders-mcp",
    url: "https://mcp.example.test/mcp",
    ...overrides,
  };
}

describe("connectMcpServers", () => {
  const mockCreateMCPClient = vi.mocked(createMCPClient);

  beforeEach(() => {
    mockCreateMCPClient.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(i) forwards server.headers into the transport config", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const tools = vi.fn().mockResolvedValue({});
    mockCreateMCPClient.mockResolvedValue({ close, tools } as never);

    const headers = { Authorization: "Bearer secret-token" };
    const conn = await connectMcpServers([def({ headers })]);
    await conn.close();

    expect(mockCreateMCPClient).toHaveBeenCalledWith({
      transport: { type: "http", url: "https://mcp.example.test/mcp", headers },
    });
    expect(conn.failures).toEqual([]);
  });

  it("(ii) a connect throw is recorded in failures[] instead of being thrown", async () => {
    mockCreateMCPClient.mockRejectedValue(new Error("ECONNREFUSED"));

    const conn = await connectMcpServers([def()]);

    expect(conn.failures).toEqual([{ server: "orders-mcp", error: "ECONNREFUSED" }]);
    expect(conn.tools).toEqual({});
    await expect(conn.close()).resolves.toBeUndefined();
  });

  it("(ii-b) falls back to the server url when name is absent", async () => {
    mockCreateMCPClient.mockRejectedValue(new Error("timed out"));

    const conn = await connectMcpServers([def({ name: "" })]);

    expect(conn.failures).toEqual([
      { server: "https://mcp.example.test/mcp", error: "timed out" },
    ]);
  });

  it("(iii) a successful connect returns discovered tools and an empty failures[]", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const discovered = { lookup_order: { description: "Look up an order." } };
    const tools = vi.fn().mockResolvedValue(discovered);
    mockCreateMCPClient.mockResolvedValue({ close, tools } as never);

    const conn = await connectMcpServers([def()]);

    expect(conn.tools).toEqual(discovered);
    expect(conn.failures).toEqual([]);
    await conn.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("(iv) one bad server doesn't block a good one — merges tools, records only the bad server's failure", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const goodTools = { search_docs: { description: "Search docs." } };
    mockCreateMCPClient
      .mockRejectedValueOnce(new Error("bad server down"))
      .mockResolvedValueOnce({ close, tools: vi.fn().mockResolvedValue(goodTools) } as never);

    const conn = await connectMcpServers([
      def({ name: "bad-server", url: "https://bad.example.test/mcp" }),
      def({ name: "good-server", url: "https://good.example.test/mcp" }),
    ]);

    expect(conn.tools).toEqual(goodTools);
    expect(conn.failures).toEqual([{ server: "bad-server", error: "bad server down" }]);
  });

  it("(v) skips defs with no url", async () => {
    const conn = await connectMcpServers([def({ url: "" })]);

    expect(mockCreateMCPClient).not.toHaveBeenCalled();
    expect(conn.tools).toEqual({});
    expect(conn.failures).toEqual([]);
  });
});
