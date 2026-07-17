import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Scoped narrow (Wave 0): only the rag + agents unit tests run today.
// Phase 47-03 (D-09) adds the first `src/lib/chat/` unit test — extended here
// so it's actually discovered by `pnpm vitest run` (a bare filter arg only
// narrows within `include`, it doesn't add new paths to it).
// `@` mirrors the tsconfig `@/*` -> `./src/*` path alias so tests can
// `import { ... } from "@/lib/rag/..."` exactly like production code.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/lib/rag/**/*.test.ts",
      "src/lib/agents/**/*.test.ts",
      "src/lib/chat/**/*.test.ts",
    ],
    // Load .env the same way src/server.ts does (`import "dotenv/config"`),
    // so DB_URL/QDRANT_URL are set before any test that touches the real dev
    // MySQL/Qdrant services (buckets.test.ts, Phase 46) runs. Without this,
    // Prisma silently falls back to its hardcoded localhost:3307 default.
    setupFiles: ["dotenv/config"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
