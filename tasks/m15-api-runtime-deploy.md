# M15 — API production runtime & deployment ✅

Give the API a real production build, image, and boot-time validation. From the production-readiness audit (2026-06-28).

Legend: ✅ done · 🚧 in progress · ⬜ todo

---

- ✅ 🔴 **Production runtime.** Added a multi-stage [packages/api/Dockerfile](../packages/api/Dockerfile) (build stage: install + native rebuild + `prisma generate` + `tsc` typecheck gate over [tsconfig.build.json](../packages/api/tsconfig.build.json); runtime stage: production env, runs via `tsx`), a root [.dockerignore](../.dockerignore), and an `api` service in [docker-compose.yml](../docker-compose.yml) (depends on healthy mysql + qdrant; reaches them by service name). Deps are left untouched (no recategorization → no lockfile churn); the image ships the full install since `tsx`/`prisma` are devDeps.
- ✅ 🟠 **Startup config validation.** [src/lib/env.ts](../packages/api/src/lib/env.ts) validates required env at boot with zod and fails fast (exit 1): `DATABASE_URL` (mysql), `QDRANT_URL` (http/https), the embedding key required by `EMBEDDING_PROVIDER`, and — in production — a non-default `INTERNAL_API_SECRET`. Wired into [src/server.ts](../packages/api/src/server.ts) before the port binds.
- ✅ 🟠 **Real Qdrant health check.** [src/lib/health.ts](../packages/api/src/lib/health.ts) probes Qdrant via its `/readyz` endpoint (short, dedicated timeout). [src/server.ts](../packages/api/src/server.ts) now splits `/health/live` (liveness, no deps) vs `/health/ready` (readiness, mysql + qdrant → 503 when degraded); `/health` kept for back-compat with a real Qdrant probe. OpenAPI spec ([openapi.json](../packages/api/openapi.json)) regenerated.

---

## Follow-ups (pre-existing, outside this task's scope)

- **Dev `.env` needs `QDRANT_URL`.** Boot validation now requires it; the dev `.env` predates the line that `.env.example` already documents. Add `QDRANT_URL=http://localhost:6333` (and optionally `EMBEDDING_PROVIDER=local`) to `packages/api/.env`.
- **`pnpm-workspace.yaml` build-approval is unfinished.** It has a placeholder `allowBuilds: 'set this to true or false'` block and an incomplete `onlyBuiltDependencies`, so a fresh `pnpm install` trips `ERR_PNPM_IGNORED_BUILDS`. The Dockerfile works around this (`--ignore-scripts` + explicit `pnpm rebuild`), but local fresh installs should resolve it via `pnpm approve-builds`.
- **Migrations** are intentionally not run by the `api` container — apply with `prisma migrate deploy` against the `agents` DB out-of-band.
