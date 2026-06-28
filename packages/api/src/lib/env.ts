// Boot-time environment validation (M15).
//
// Required config is otherwise discovered lazily — DATABASE_URL falls back to a
// dev DSN in db.ts, QDRANT_URL only throws on the first RAG call, and an
// embedding provider's API key only fails when a document is first ingested. In
// production those lazy failures surface as confusing 500s long after deploy.
// `validateEnv()` runs once at startup, validates everything we depend on with
// zod, and FAILS FAST with a single readable report so a misconfigured deploy
// never reaches "listening".
import { z } from "zod";

/** A DSN that parses as a URL with the expected protocol(s). */
const urlWithProtocol = (protocols: string[], label: string) =>
  z.string().min(1).refine(
    (value) => {
      try {
        return protocols.includes(new URL(value).protocol.replace(/:$/, ""));
      } catch {
        return false;
      }
    },
    { message: `must be a valid ${label} URL (${protocols.map((p) => `${p}://`).join(" or ")})` },
  );

/** Optional numeric port string. */
const port = z
  .string()
  .optional()
  .refine((v) => v === undefined || (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 65536), {
    message: "must be a port number between 1 and 65535",
  });

const DEV_INTERNAL_SECRET = "dev-internal-secret";

const envSchema = z
  .object({
    NODE_ENV: z.string().default("development"),
    // Relational DB (agents). The MySQL driver adapter parses this DSN.
    DATABASE_URL: urlWithProtocol(["mysql"], "MySQL"),
    // RAG vector store.
    QDRANT_URL: urlWithProtocol(["http", "https"], "Qdrant"),
    QDRANT_API_KEY: z.string().optional(),
    // System default embedding provider; a bucket may pin its own.
    EMBEDDING_PROVIDER: z.enum(["local", "openai", "voyage", "voyage-multimodal"]).default("local"),
    OPENAI_API_KEY: z.string().optional(),
    VOYAGE_API_KEY: z.string().optional(),
    // Shared secret for service-to-service (/internal) and the in-repo webhook.
    INTERNAL_API_SECRET: z.string().optional(),
    API_PORT: port,
    PORT: port,
  })
  .superRefine((env, ctx) => {
    const isProd = env.NODE_ENV === "production";

    // The default embedding provider must have its key, or every ingest 500s.
    if (env.EMBEDDING_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENAI_API_KEY"],
        message: "required when EMBEDDING_PROVIDER=openai",
      });
    }
    if (
      (env.EMBEDDING_PROVIDER === "voyage" || env.EMBEDDING_PROVIDER === "voyage-multimodal") &&
      !env.VOYAGE_API_KEY
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["VOYAGE_API_KEY"],
        message: `required when EMBEDDING_PROVIDER=${env.EMBEDDING_PROVIDER}`,
      });
    }

    // In production the /internal secret must be set and not the dev placeholder,
    // or the tenant-registry sync + webhook auth are effectively unguarded.
    if (isProd && (!env.INTERNAL_API_SECRET || env.INTERNAL_API_SECRET === DEV_INTERNAL_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["INTERNAL_API_SECRET"],
        message: `must be set to a non-default value in production (not "${DEV_INTERNAL_SECRET}")`,
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Validate process.env once at boot. On success returns the parsed config and
 * logs a one-line summary. On failure prints every issue and exits the process
 * (code 1) so an orchestrator restarts/halts the deploy instead of serving a
 * half-configured instance.
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.error(`[api] invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  const { NODE_ENV, EMBEDDING_PROVIDER } = result.data;
  console.log(`[api] env validated (NODE_ENV=${NODE_ENV}, embeddings=${EMBEDDING_PROVIDER})`);
  return result.data;
}
