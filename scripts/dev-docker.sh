#!/bin/sh
set -eu

dev_overlay=${WAO_DEV_ENV_OVERLAY:-.env}
: "${COMPOSE_PROJECT_NAME:=waoowaoo}"
: "${WAO_DEV_CODEX_RUNTIME_ROOT:=$PWD/.runtime/codex}"
export COMPOSE_PROJECT_NAME WAO_DEV_CODEX_RUNTIME_ROOT
mkdir -p "$WAO_DEV_CODEX_RUNTIME_ROOT"

compose() {
  if [ "$dev_overlay" = ".env" ]; then
    docker compose \
      --env-file .env \
      -f docker-compose.yml \
      -f docker-compose.dev.yml \
      "$@"
    return
  fi
  docker compose \
    --env-file .env \
    --env-file "$dev_overlay" \
    -f docker-compose.yml \
    -f docker-compose.dev.yml \
    "$@"
}

compose build app-dev codex-runtime-dev
compose up --remove-orphans app-dev temporal-worker-dev
