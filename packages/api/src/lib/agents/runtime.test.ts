import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildAgentRuntime } from "@/lib/agents/runtime";
import { buildCustomTools } from "@/lib/agents/tools";
import { connectMcpServers } from "@/lib/agents/mcp";
import type { AgentDTO } from "@/lib/agent-io";
import type { CustomToolDef } from "@/lib/types";
import type { ToolContext } from "@/lib/agents/tools";

vi.mock("@/lib/agents/mcp", () => ({
  connectMcpServers: vi.fn(),
}));

// Spy on the real buildCustomTools so we can assert exactly which defs make it
// through the D-10 filter, while still exercising the real tool-building
// behavior for spread-order assertions.
vi.mock("@/lib/agents/tools", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agents/tools")>("@/lib/agents/tools");
  return {
    ...actual,
    buildCustomTools: vi.fn(actual.buildCustomTools),
  };
});

function agentDto(overrides: Partial<AgentDTO> = {}): AgentDTO {
  return {
    id: "agent-1",
    name: "Support Bot",
    description: "",
    systemPrompt: "You help customers.",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 1024,
    isRoutable: false,
    isDefault: false,
    builtinTools: { deliverToAgent: true, deliverToHuman: true },
    customTools: [],
    mcpServers: [],
    handoffRules: [],
    guardrails: {},
    knowledge: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function tool(overrides: Partial<CustomToolDef> = {}): CustomToolDef {
  return {
    name: "tool_a",
    description: "A tool.",
    schema: { type: "object", properties: {} },
    endpoint: "https://example.test/a",
    ...overrides,
  };
}

const ctx = {
  writer: { write: vi.fn() },
  signalHandoff: vi.fn(),
  recordSent: vi.fn(),
} as unknown as ToolContext;

const mockedConnect = vi.mocked(connectMcpServers);
const mockedBuildCustomTools = vi.mocked(buildCustomTools);

beforeEach(() => {
  mockedConnect.mockReset();
  mockedConnect.mockResolvedValue({ tools: {}, close: vi.fn(), failures: [] });
  mockedBuildCustomTools.mockClear();
});

describe("buildAgentRuntime — D-10 enabled filter", () => {
  it("(i) excludes a custom tool with enabled:false", async () => {
    const agent = agentDto({ customTools: [tool({ name: "disabled_tool", enabled: false })] });
    const runtime = await buildAgentRuntime(agent, [], "tenant-1", "conv-1", "", ctx);

    expect(mockedBuildCustomTools).toHaveBeenCalledWith([]);
    expect(runtime.tools.disabled_tool).toBeUndefined();
  });

  it("(ii) includes a custom tool with enabled:true", async () => {
    const agent = agentDto({ customTools: [tool({ name: "enabled_tool", enabled: true })] });
    const runtime = await buildAgentRuntime(agent, [], "tenant-1", "conv-1", "", ctx);

    expect(mockedBuildCustomTools).toHaveBeenCalledWith([
      expect.objectContaining({ name: "enabled_tool" }),
    ]);
    expect(runtime.tools.enabled_tool).toBeDefined();
  });

  it("(iii) absent-enabled tool survives the filter (regression: pre-phase data has no `enabled` key)", async () => {
    const legacyTool = tool({ name: "legacy_tool" });
    delete (legacyTool as { enabled?: boolean }).enabled;
    const agent = agentDto({ customTools: [legacyTool] });
    const runtime = await buildAgentRuntime(agent, [], "tenant-1", "conv-1", "", ctx);

    expect(mockedBuildCustomTools).toHaveBeenCalledWith([
      expect.objectContaining({ name: "legacy_tool" }),
    ]);
    expect(runtime.tools.legacy_tool).toBeDefined();
  });

  it("(iv) built-in tools remain spread last — a disabled custom tool never affects deliver_to_agent/deliver_to_human presence", async () => {
    const agent = agentDto({
      customTools: [tool({ name: "disabled_tool", enabled: false })],
      builtinTools: { deliverToAgent: true, deliverToHuman: true },
    });
    const routable = [{ id: "agent-2", name: "Billing Bot", description: "Handles billing." }];
    const runtime = await buildAgentRuntime(agent, routable, "tenant-1", "conv-1", "", ctx);

    expect(runtime.tools.deliver_to_agent).toBeDefined();
    expect(runtime.tools.deliver_to_human).toBeDefined();
    expect(runtime.tools.disabled_tool).toBeUndefined();
  });

  it("(v) mixed enabled states: only the disabled tool is filtered out", async () => {
    const legacyTool = tool({ name: "legacy_tool" });
    delete (legacyTool as { enabled?: boolean }).enabled;
    const agent = agentDto({
      customTools: [
        tool({ name: "on_tool", enabled: true }),
        tool({ name: "off_tool", enabled: false }),
        legacyTool,
      ],
    });
    const runtime = await buildAgentRuntime(agent, [], "tenant-1", "conv-1", "", ctx);

    expect(runtime.tools.on_tool).toBeDefined();
    expect(runtime.tools.legacy_tool).toBeDefined();
    expect(runtime.tools.off_tool).toBeUndefined();
  });
});
