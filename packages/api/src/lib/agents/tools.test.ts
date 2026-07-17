import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildCustomTools } from "@/lib/agents/tools";
import type { CustomToolDef } from "@/lib/types";

function def(overrides: Partial<CustomToolDef> = {}): CustomToolDef {
  return {
    name: "lookup_order",
    description: "Look up an order by id.",
    schema: { type: "object", properties: { orderId: { type: "string" } } },
    endpoint: "https://example.test/tools/lookup",
    ...overrides,
  };
}

async function callTool(tools: ReturnType<typeof buildCustomTools>, name: string, input: unknown) {
  const t = tools[name];
  // AI SDK `tool()` execute signature: (input, options) — options unused here.
  return (t.execute as (i: unknown, o: unknown) => Promise<unknown>)(input, {});
}

describe("buildCustomTools", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("(i) POST default: sends input as JSON body with Content-Type application/json", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue({
      text: async () => JSON.stringify({ ok: true }),
      status: 200,
    } as Response);

    const tools = buildCustomTools([def()]);
    const result = await callTool(tools, "lookup_order", { orderId: "abc123" });

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/tools/lookup");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(options.body).toBe(JSON.stringify({ orderId: "abc123" }));
  });

  it("(ii) GET: maps tool input to query-string params instead of a JSON body", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue({
      text: async () => JSON.stringify({ ok: true }),
      status: 200,
    } as Response);

    const tools = buildCustomTools([def({ method: "GET" })]);
    await callTool(tools, "lookup_order", { orderId: "abc123", limit: 5 });

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/tools/lookup?orderId=abc123&limit=5");
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
    expect(options.headers).not.toHaveProperty("Content-Type");
  });

  it("(ii-b) GET: appends query string honoring an existing '?' in the endpoint", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue({ text: async () => "{}", status: 200 } as Response);

    const tools = buildCustomTools([
      def({ method: "GET", endpoint: "https://example.test/tools/lookup?tenant=abc" }),
    ]);
    await callTool(tools, "lookup_order", { orderId: "abc123" });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/tools/lookup?tenant=abc&orderId=abc123");
  });

  it("(iii) forwards configured headers on both GET and POST requests", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue({ text: async () => "{}", status: 200 } as Response);

    const headers = { Authorization: "Bearer secret-token" };

    const postTools = buildCustomTools([def({ headers })]);
    await callTool(postTools, "lookup_order", { orderId: "1" });
    const [, postOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(postOptions.headers).toMatchObject(headers);

    mockFetch.mockClear();

    const getTools = buildCustomTools([def({ headers, method: "GET" })]);
    await callTool(getTools, "lookup_order", { orderId: "1" });
    const [, getOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(getOptions.headers).toMatchObject(headers);
  });

  it("(iv) never throws: fetch rejection resolves to {error}", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockRejectedValue(new Error("network down"));

    const tools = buildCustomTools([def()]);
    const result = await callTool(tools, "lookup_order", { orderId: "1" });

    expect(result).toEqual({
      error: expect.stringContaining('Tool "lookup_order" request failed: network down'),
    });
  });

  it("(v) never throws: a timeout abort resolves to {error} mentioning the timeout", async () => {
    const mockFetch = vi.mocked(global.fetch);
    const timeoutErr = new Error("The operation was aborted");
    timeoutErr.name = "TimeoutError";
    mockFetch.mockRejectedValue(timeoutErr);

    const tools = buildCustomTools([def()]);
    const result = await callTool(tools, "lookup_order", { orderId: "1" });

    expect(result).toEqual({
      error: expect.stringContaining("timed out after"),
    });
  });

  it("(vi) non-JSON response body returns {status, body} verbatim", async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValue({
      text: async () => "not json",
      status: 502,
    } as Response);

    const tools = buildCustomTools([def()]);
    const result = await callTool(tools, "lookup_order", { orderId: "1" });

    expect(result).toEqual({ status: 502, body: "not json" });
  });

  it("(vii) skips defs missing name or endpoint", () => {
    const tools = buildCustomTools([
      def({ name: "" }),
      def({ endpoint: "" }),
      def({ name: "valid_tool" }),
    ]);
    expect(Object.keys(tools)).toEqual(["valid_tool"]);
  });
});
