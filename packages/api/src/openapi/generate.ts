// Emits openapi.json at the package root. Run via `pnpm --filter @agent-routing/api openapi`.
// The api-client package then generates its TypeScript types from this file.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildOpenApiDocument } from "@/openapi/document";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../../openapi.json");

const doc = buildOpenApiDocument();
writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
