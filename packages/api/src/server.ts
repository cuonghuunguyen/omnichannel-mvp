import "dotenv/config";
import { randomUUID } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import { agentsRouter } from "@/routes/agents";
import { knowledgeRouter } from "@/routes/knowledge";
import { chatRouter } from "@/routes/chat";
import { agentBuilderRouter } from "@/routes/agent-builder";
import { internalRouter } from "@/routes/internal";
import { openaiRouter } from "@/routes/openai";
import { catalogRouter } from "@/routes/catalog";
import { buildOpenApiDocument } from "@/openapi/document";
import { db } from "@/lib/db";
import { SHUTDOWN_TIMEOUT_MS } from "@/lib/resilience";
import { stripProviderKey } from "@/middleware/strip-provider-key";
import { stripEmbeddingKey } from "@/middleware/strip-embedding-key";
import { pinoHttp } from "pino-http";
import { validateEnv } from "@/lib/env";
import { checkMysql, checkQdrant } from "@/lib/health";
import { logger } from "@/lib/logger";

// Fail fast on a misconfigured environment before binding the port.
validateEnv();

const VERSION = process.env.npm_package_version ?? "0.1.0";

const app = express();

// Strip X-Provider-Key BEFORE any logger or body-parser so the raw BYOK key
// is never captured in access logs or request dumps (D-12 / T-35-03).
app.use(stripProviderKey);
// Strip X-Embedding-Key BEFORE any logger or body-parser so the raw BYOK
// embedding key is never captured in access logs or request dumps (D-02 / T-37-02-01).
app.use(stripEmbeddingKey);

// Access-log every request. Registered AFTER both key-strip middlewares
// above so pino-http never observes a raw X-Provider-Key/X-Embedding-Key
// header (T-kxl-01); the shared `logger`'s `redact` config is also inherited
// as defense-in-depth. No request/response body logging is enabled.
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
  }),
);

// The chat service's browser admin UI calls this API cross-origin; allow it.
// WR-02: fail closed. CORS_ORIGIN is an explicit allowlist of origins; when unset we
// default to an EMPTY list (no cross-origin browser access) rather than reflecting any
// Origin. This service proxies BYOK provider keys, so a default-open policy is a needless
// exposure. Operators must opt into broader origins explicitly via CORS_ORIGIN.
const corsOrigins =
  process.env.CORS_ORIGIN?.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0) ?? [];
app.use(
  cors({
    origin: corsOrigins,
  }),
);
app.use(express.json({ limit: "8mb" }));

// Liveness: the process is up and serving. No dependency probes — a transient
// DB/Qdrant blip must NOT make the orchestrator kill an otherwise-healthy pod.
app.get("/health/live", (_req, res) => {
  res.json({ ok: true, status: "live", version: VERSION });
});

// Readiness: can this instance serve real traffic? Probes MySQL + Qdrant.
app.get("/health/ready", async (_req, res) => {
  const [mysql, qdrant] = await Promise.all([checkMysql(), checkQdrant()]);
  // "not configured" Qdrant is tolerated (boot validation requires QDRANT_URL,
  // so this only guards against an explicit unset); only "error" blocks traffic.
  const ok = mysql === "ok" && qdrant !== "error";
  res.status(ok ? 200 : 503).json({ ok, version: VERSION, mysql, qdrant });
});

// Back-compat combined check: same shape/semantics as before (200/503 keyed on
// MySQL), but Qdrant is now a real probe rather than a hardcoded string.
app.get("/health", async (_req, res) => {
  const [mysqlStatus, qdrant] = await Promise.all([checkMysql(), checkQdrant()]);
  const mysql = mysqlStatus === "ok" ? "connected" : "error";
  res.status(mysqlStatus === "ok" ? 200 : 503).json({
    ok: mysqlStatus === "ok",
    version: VERSION,
    mysql,
    qdrant,
  });
});

// Live OpenAPI spec + a zero-build Redoc docs page.
const openapiDoc = buildOpenApiDocument();
app.get("/openapi.json", (_req, res) => {
  res.json(openapiDoc);
});
app.get("/docs", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html>
  <head>
    <title>Agent Routing — AI Config API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <redoc spec-url="/openapi.json"></redoc>
    <script src="https://cdn.redocly.com/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`);
});

app.use("/agents", agentsRouter);
app.use("/knowledge", knowledgeRouter);
app.use("/chat", chatRouter);
app.use("/agent-builder", agentBuilderRouter);
// Service-to-service (chat → API) tenant registry sync; secret-gated.
app.use("/internal", internalRouter);
// OpenAI-compatible facade (Bearer key → tenant). Lets any OpenAI-protocol
// client integrate without the AI-SDK/UIMessage + callback contract.
app.use("/v1", openaiRouter);
// Provider and model catalog — static metadata, no auth required.
app.use("/catalog", catalogRouter);

// Last-resort error handler (Express 5 forwards async rejections here).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "[api] unhandled error");
  if (!res.headersSent) res.status(500).json({ error: "internal error" });
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const server = app.listen(port, () => {
  logger.info(
    { port, docsUrl: `http://localhost:${port}/docs`, openapiUrl: `http://localhost:${port}/openapi.json` },
    `AI Config API listening on http://localhost:${port}`,
  );
});

// Graceful shutdown: on deploy/evict, stop accepting connections, let in-flight
// turns drain, and release the Prisma/MariaDB pool. A force-exit timer guards
// against a stuck drain.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return; // ignore a second signal mid-drain
  shuttingDown = true;
  logger.info(`[api] ${signal} received — shutting down`);

  const force = setTimeout(() => {
    logger.error(`[api] drain exceeded ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  server.close(async () => {
    try {
      await db.$disconnect();
    } catch (err) {
      logger.error({ err }, "[api] error disconnecting db");
    }
    clearTimeout(force);
    logger.info("[api] shutdown complete");
    process.exit(0);
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
