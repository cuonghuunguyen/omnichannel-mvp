import { describe, expect, it } from "vitest";
import { isToolCallFailed } from "@/lib/chat/orchestrate";

// D-09 (Task 1): unit coverage for the three genuinely-different AI SDK v6
// tool failure shapes (Pitfall 4). All cases exercise plain mock step
// objects — no live model call.

function toolCall(toolCallId = "call-1") {
  return { toolCallId };
}

function emptyStep() {
  return { content: [] as { type: string; toolCallId?: string }[] };
}

describe("isToolCallFailed", () => {
  it("flags a custom-tool call whose output is {error: string} (network/timeout catch-return)", () => {
    const failed = isToolCallFailed(
      toolCall(),
      emptyStep(),
      { output: { error: "Tool \"check_order\" request timed out after 5000ms: fetch failed" } },
    );
    expect(failed).toBe(true);
  });

  it("flags a custom-tool call whose output is {status, body} with a non-2xx status", () => {
    const failed = isToolCallFailed(
      toolCall(),
      emptyStep(),
      { output: { status: 500, body: "Internal Server Error" } },
    );
    expect(failed).toBe(true);
  });

  it("does not flag a custom-tool call whose output is {status, body} with a 2xx status", () => {
    const failed = isToolCallFailed(
      toolCall(),
      emptyStep(),
      { output: { status: 200, body: "ok" } },
    );
    expect(failed).toBe(false);
  });

  it("flags an MCP tool call whose CallToolResult has isError: true", () => {
    const failed = isToolCallFailed(
      toolCall(),
      emptyStep(),
      { output: { isError: true, content: [{ type: "text", text: "remote tool failed" }] } },
    );
    expect(failed).toBe(true);
  });

  it("flags a tool-error content-part (SDK threw before/at dispatch) matching the toolCallId, even with no toolResult", () => {
    const step = {
      content: [{ type: "tool-error", toolCallId: "call-1" }],
    };
    const failed = isToolCallFailed(toolCall("call-1"), step, undefined);
    expect(failed).toBe(true);
  });

  it("does not flag a tool-error content-part for a different toolCallId", () => {
    const step = {
      content: [{ type: "tool-error", toolCallId: "call-other" }],
    };
    const failed = isToolCallFailed(
      toolCall("call-1"),
      step,
      { output: { ok: true } },
    );
    expect(failed).toBe(false);
  });

  it("does not flag a clean successful call", () => {
    const failed = isToolCallFailed(
      toolCall(),
      emptyStep(),
      { output: { results: [{ id: 1 }] } },
    );
    expect(failed).toBe(false);
  });

  it("does not flag a call with no toolResult and no matching tool-error content-part", () => {
    const failed = isToolCallFailed(toolCall(), emptyStep(), undefined);
    expect(failed).toBe(false);
  });
});
