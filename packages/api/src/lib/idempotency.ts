// Per-turn idempotency for orchestration entrypoints (REPLY-DUP fix 1).
//
// The OpenAI facade is stateless: every POST /v1/chat/completions runs a full
// orchestration turn, which dispatches an assistant_message webhook as a side
// effect. When the caller (Laravel TriggerAiTurnJob) times out its HTTP request
// but the sidecar keeps generating, the job retries and — without dedup — each
// retry starts a *second* independent orchestration → a second webhook → a
// duplicate reply persisted by the client (the "triple reply" bug).
//
// This module gates identical calls by an idempotency key so a repeated call
// reuses the SAME in-flight (or just-completed) result instead of launching a
// new turn. In-flight callers await the original promise; the webhook is
// dispatched exactly once per key.
//
// Scope: single-process in-memory store. The agent-routing-api runs as one
// container, so an in-memory Map is sufficient. If this service is ever scaled
// horizontally, back this with Redis/DB keyed the same way.

const ms = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/**
 * How long a completed entry is retained so a late retry (Laravel backoff is
 * [10, 60, 300]s over 3 tries) still collapses onto the original turn. Default
 * 15 min comfortably covers the full retry window plus a slow generation.
 */
const IDEMPOTENCY_TTL_MS = ms(process.env.IDEMPOTENCY_TTL_MS, 15 * 60 * 1000);

type Entry<T> = { promise: Promise<T>; createdAt: number };

const store = new Map<string, Entry<unknown>>();

/** Drop entries older than the TTL so the map cannot grow unbounded. */
function prune(now: number): void {
  for (const [key, entry] of store) {
    if (now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
      store.delete(key);
    }
  }
}

/**
 * Run `fn` at most once per `key` within the TTL window.
 *
 * - First call for a key: invokes `fn()`, caches the promise, returns it.
 * - Repeat call while in-flight OR after success: returns the cached promise
 *   (no second `fn()` invocation → no duplicate webhook).
 * - On rejection: the entry is evicted so a genuine later retry can re-run
 *   (a failed turn should be retryable, not permanently poisoned).
 */
export function runIdempotent<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  prune(now);

  const existing = store.get(key) as Entry<T> | undefined;
  if (existing) {
    return existing.promise;
  }

  const promise = fn();
  store.set(key, { promise, createdAt: now });
  promise.catch(() => {
    // Evict only if this exact promise is still the stored one, so a retry that
    // already started a fresh turn isn't clobbered.
    const current = store.get(key);
    if (current && current.promise === promise) {
      store.delete(key);
    }
  });
  return promise;
}
