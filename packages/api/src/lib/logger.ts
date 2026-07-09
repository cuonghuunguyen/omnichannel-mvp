// Shared structured logger for the sidecar (@agent-routing/api).
//
// A single configured pino instance, imported wherever we used to reach for
// console.*. Reads process.env directly (no dependency on validateEnv()) so
// importing this module is side-effect-safe at any point during boot.
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  // Defense-in-depth: BYOK secrets are already stripped from req.headers by
  // stripProviderKey/stripEmbeddingKey before pino-http ever sees a request
  // (see server.ts), but redact these paths on every child logger anyway so
  // no code path can accidentally leak them (T-kxl-01).
  redact: {
    paths: [
      "req.headers.authorization",
      'req.headers["x-provider-key"]',
      'req.headers["x-embedding-key"]',
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  // Pretty-print only outside production. In production `transport` stays
  // undefined so pino never attempts to load pino-pretty (a devDependency
  // only) and output is pure single-line JSON.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
          },
        },
      }),
});
