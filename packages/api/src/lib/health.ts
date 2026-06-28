// Dependency health probes for the /health endpoints (M15).
//
// Liveness ("is the process up?") needs no probes — only readiness does. These
// helpers each return a normalized status and never throw, so a probe failure
// is reported as "error" rather than crashing the handler.
import { db } from "@/lib/db";

export type DepStatus = "ok" | "error" | "not configured";

/** Short, independent deadline for readiness probes (kept well under any LB timeout). */
const HEALTH_PROBE_TIMEOUT_MS = Number(process.env.HEALTH_PROBE_TIMEOUT_MS) || 3000;

/** Probe MySQL with a trivial query. */
export async function checkMysql(): Promise<"ok" | "error"> {
  try {
    await db.$queryRaw`SELECT 1`;
    return "ok";
  } catch {
    return "error";
  }
}

/**
 * Probe Qdrant via its native /readyz endpoint with a short, dedicated timeout
 * (independent of the 30s client/query timeout, so /health stays snappy). Uses
 * raw fetch rather than the QdrantClient to avoid its compatibility handshake.
 */
export async function checkQdrant(): Promise<DepStatus> {
  const base = process.env.QDRANT_URL;
  if (!base) {
    return "not configured";
  }
  try {
    const res = await fetch(new URL("/readyz", base), {
      headers: process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : undefined,
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
    });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}
