import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Scoped narrow (Wave 0): only the rag hardening unit tests run today.
// `@` mirrors the tsconfig `@/*` -> `./src/*` path alias so tests can
// `import { ... } from "@/lib/rag/..."` exactly like production code.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/rag/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
