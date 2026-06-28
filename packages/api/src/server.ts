import "dotenv/config";
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
import { buildOpenApiDocument } from "@/openapi/document";
import { db } from "@/lib/db";
import { stripProviderKey } from "@/middleware/strip-provider-key";

const app = express();

// Strip X-Provider-Key BEFORE any logger or body-parser so the raw BYOK key
// is never captured in access logs or request dumps (D-12 / T-35-03).
app.use(stripProviderKey);

// The chat service's browser admin UI calls this API cross-origin; allow it.
// CORS_ORIGIN can pin a single origin in production; defaults to reflecting any.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()) ?? true,
  }),
);
app.use(express.json({ limit: "8mb" }));

app.get("/health", async (_req, res) => {
  let mysql: "connected" | "error" = "connected";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    mysql = "error";
  }
  res
    .status(mysql === "connected" ? 200 : 503)
    .json({
      ok: mysql === "connected",
      version: process.env.npm_package_version ?? "0.1.0",
      mysql,
      qdrant: "not configured",
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

// Last-resort error handler (Express 5 forwards async rejections here).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api] unhandled error:", err);
  if (!res.headersSent) res.status(500).json({ error: "internal error" });
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`AI Config API listening on http://localhost:${port}`);
  console.log(`  docs:    http://localhost:${port}/docs`);
  console.log(`  openapi: http://localhost:${port}/openapi.json`);
});
