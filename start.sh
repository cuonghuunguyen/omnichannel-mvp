#!/usr/bin/env bash
#
# start.sh — bring up the whole agent-routing stack.
#
# Steps (each is idempotent and can be skipped via flags):
#   1. install pnpm deps
#   2. seed packages/{api,chat}/.env from .env.example if missing
#   3. start the backing services — Qdrant + MySQL (docker compose) — and wait
#   4. apply Prisma migrations for both MySQL DBs (agents + chat)
#   5. verify Qdrant + bootstrap any existing bucket collections (rag:setup)
#   6. seed agents + (optionally) the demo knowledge base
#   7. run both dev servers — chat :3000, api :4000
#
# Usage:
#   ./start.sh                 # full setup, then `pnpm dev`
#   ./start.sh --skip-setup    # just run the dev servers
#   ./start.sh --skip-seed     # setup without seeding data
#   ./start.sh --rag-seed      # also load the demo hotel knowledge base
#   ./start.sh --no-dev        # run setup only, don't start the servers

set -euo pipefail

cd "$(dirname "$0")"

# ── flags ────────────────────────────────────────────────────────────────────
SKIP_SETUP=false
SKIP_SEED=false
RAG_SEED=false
RUN_DEV=true

for arg in "$@"; do
  case "$arg" in
    --skip-setup) SKIP_SETUP=true ;;
    --skip-seed)  SKIP_SEED=true ;;
    --rag-seed)   RAG_SEED=true ;;
    --no-dev)     RUN_DEV=false ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown option: $arg (see --help)" >&2; exit 1 ;;
  esac
done

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── prerequisites ──────────────────────────────────────────────────────────--
command -v pnpm >/dev/null   || die "pnpm not found — install it: https://pnpm.io/installation"
command -v docker >/dev/null || die "docker not found — needed for Qdrant + MySQL"
docker info >/dev/null 2>&1   || die "docker daemon not running — start Docker and retry"

docker_compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@";
  else docker-compose "$@"; fi
}

if [ "$SKIP_SETUP" = false ]; then
  log "Installing dependencies (pnpm install)"
  pnpm install

  log "Checking .env files"
  for pkg in api chat; do
    if [ ! -f "packages/$pkg/.env" ]; then
      cp "packages/$pkg/.env.example" "packages/$pkg/.env"
      echo "  created packages/$pkg/.env from .env.example — review its keys"
    else
      echo "  packages/$pkg/.env exists — leaving it"
    fi
  done

  log "Starting backing services — Qdrant + MySQL (docker compose up -d)"
  docker_compose -f docker-compose.dev.yml up -d

  log "Waiting for MySQL to be healthy"
  for i in $(seq 1 45); do
    if docker exec agent-routing-mysql mysqladmin ping -uroot -proot --silent >/dev/null 2>&1; then
      echo "  MySQL ready"; break
    fi
    [ "$i" = 45 ] && die "MySQL did not become ready in time"
    sleep 2
  done

  log "Waiting for Qdrant to be healthy"
  for i in $(seq 1 30); do
    if curl -sf http://localhost:6333/healthz >/dev/null 2>&1; then
      echo "  Qdrant ready"; break
    fi
    [ "$i" = 30 ] && die "Qdrant did not become ready in time"
    sleep 2
  done

  log "Applying Prisma migrations"
  pnpm --filter @agent-routing/api  exec prisma migrate deploy
  pnpm --filter @agent-routing/chat exec prisma migrate deploy

  log "Verifying Qdrant + bootstrapping bucket collections (rag:setup)"
  pnpm rag:setup

  if [ "$SKIP_SEED" = false ]; then
    log "Seeding agents + human operator (db:seed)"
    pnpm db:seed

    if [ "$RAG_SEED" = true ]; then
      log "Seeding demo knowledge base (rag:seed)"
      pnpm rag:seed
    fi
  fi
else
  log "Skipping setup (--skip-setup)"
fi

if [ "$RUN_DEV" = true ]; then
  log "Starting dev servers — chat http://localhost:3000 · api http://localhost:4000 (docs: /docs)"
  exec pnpm dev
else
  log "Setup complete. Run 'pnpm dev' to start the servers (or omit --no-dev)."
fi
