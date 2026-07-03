// Shared resilience primitives: bounded timeouts for every external dependency.
//
// Env vars in this package are read inline (process.env.X ?? default); this
// module centralizes only the timeout knobs so the same deadline isn't redefined
// at each call site. Most callers use AbortSignal.timeout() (fetch) or a native
// `timeout` option (AI SDK, Qdrant client); `withTimeout` covers the few APIs
// that expose neither (e.g. the MCP connect handshake).

const ms = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/** Timeouts for external dependencies. Milliseconds unless noted. */
export const TIMEOUTS = {
  /** Custom-tool HTTP endpoints (agent tools.ts). */
  toolFetchMs: ms(process.env.TOOL_FETCH_TIMEOUT_MS, 10_000),
  /** Embedding provider HTTP calls (OpenAI / Voyage). */
  embeddingMs: ms(process.env.EMBEDDING_TIMEOUT_MS, 30_000),
  /** MCP connect + tool discovery handshake. */
  mcpMs: ms(process.env.MCP_TIMEOUT_MS, 10_000),
  /** Streaming chat turn (bounds the whole multi-step call, incl. tool steps). */
  llmMs: ms(process.env.LLM_TIMEOUT_MS, 120_000),
  /** RAG pipeline LLM calls (query-rewrite / rerank): short, non-streaming. */
  ragLlmMs: ms(process.env.RAG_LLM_TIMEOUT_MS, 30_000),
  /** Qdrant timeout in seconds (multiplied by 1000 before passing to the JS client's setTimeout). */
  qdrantSec: ms(process.env.QDRANT_TIMEOUT_SEC, 30),
} as const;

/** Graceful-shutdown force-exit deadline (ms). */
export const SHUTDOWN_TIMEOUT_MS = ms(process.env.SHUTDOWN_TIMEOUT_MS, 10_000);

/**
 * Reject with a timeout error if `promise` doesn't settle within `timeoutMs`.
 * For APIs that accept neither an AbortSignal nor a native timeout option.
 * The timer is cleared once the promise settles so the process can exit.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
