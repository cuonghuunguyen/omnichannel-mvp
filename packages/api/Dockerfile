# syntax=docker/dockerfile:1
#
# Production image for the AI Config API (@agent-routing/api).
#
# The service is a TypeScript ESM app run with tsx (esbuild under the hood),
# which resolves the project's "@/*" path aliases natively. We therefore ship
# the typechecked source + the generated Prisma client and run it with tsx,
# rather than bundling — bundling the heavy native deps (onnxruntime/transformers,
# Prisma engines, sharp) is brittle and buys little for a long-lived server.
#
# Build context is the MONOREPO ROOT so the pnpm workspace + lockfile resolve
# (see docker-compose.yml: build.context = "." / dockerfile = this file).
#
#   docker build -f packages/api/Dockerfile -t agent-routing-api .
#
# Layout: a `build` stage does the install (native deps + `prisma generate` + the
# tsc typecheck gate); the `runtime` stage extends it and sets prod env. Extending
# `build` guarantees the typecheck gate actually runs on a plain `docker build` (a
# sibling stage the final image didn't consume would be pruned by BuildKit,
# silently skipping the gate). The runtime ships the full install — `tsx` (the
# runtime) and `prisma` (for `prisma generate`/`migrate deploy`) are devDeps, so a
# `--prod` prune would remove them; keeping them avoids recategorizing deps.

ARG NODE_VERSION=22-bookworm-slim

# ── build: install deps, build native modules, generate client, typecheck ─────
FROM node:${NODE_VERSION} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
# Manifests first so the install layer caches across source-only edits.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/api/package.json packages/api/
COPY packages/api-client/package.json packages/api-client/
COPY packages/chat/package.json packages/chat/
# Install with --ignore-scripts (avoids pnpm's interactive ignored-builds gate in
# CI), then explicitly rebuild the project-sanctioned native modules — the same
# set as pnpm-workspace.yaml's onlyBuiltDependencies. prisma generate is run
# below once the schema is present.
RUN pnpm install --frozen-lockfile --filter @agent-routing/api... --ignore-scripts \
 && pnpm rebuild --filter @agent-routing/api... \
      @prisma/engines prisma esbuild onnxruntime-node protobufjs
# Bake the default LOCAL embedding model into the image so the runtime NEVER
# downloads it inside an ingest request. On a memory-constrained host the cold
# in-request download+decompress+load OOM-kills the process (exit 137), which
# surfaces to callers as cURL 52 "empty reply" and silently drops ingests. The
# transformers .cache written here lives under /app/node_modules and is inherited
# by the runtime stage, so cold start only LOADS the model from disk (safe). Kept
# before the app-source COPY so this ~130 MB layer caches across source edits.
# Must match PROVIDER_DEFAULTS.local in src/lib/rag/embeddings.ts.
RUN cd packages/api && node -e "import('@huggingface/transformers').then(async (m) => { const p = await m.pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5'); await p(['warm'], { pooling: 'mean', normalize: true }); console.log('[build] baked local embedding model Xenova/bge-small-en-v1.5'); }).catch((e) => { console.error('[build] failed to bake embedding model:', e); process.exit(1); })"
# App source, then generate the Prisma client + typecheck the shipping source.
COPY packages/api/ packages/api/
WORKDIR /app/packages/api
RUN pnpm exec prisma generate \
 && pnpm exec tsc --noEmit -p tsconfig.build.json

# ── runtime: set production env, run with tsx ────────────────────────────────
FROM build AS runtime
ENV NODE_ENV=production API_PORT=4000
WORKDIR /app/packages/api
EXPOSE 4000
# Image-level liveness probe (compose/k8s may override). Uses Node's global fetch.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run tsx directly (present from the full install) rather than via `pnpm start`,
# so pnpm's pre-run dependency check can't intervene at container start.
CMD ["node", "--import", "tsx", "src/server.ts"]
