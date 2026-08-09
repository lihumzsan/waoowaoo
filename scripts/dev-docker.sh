#!/bin/sh
set -eu

dev_env_file=${WAO_DEV_ENV_FILE:-.env}
if [ ! -f "$dev_env_file" ]; then
  echo "Development environment file does not exist: $dev_env_file" >&2
  exit 1
fi
: "${COMPOSE_PROJECT_NAME:=waoowaoo}"
: "${WAO_DEV_CODEX_RUNTIME_ROOT:=$PWD/.runtime/codex}"
WAO_DEV_DEPENDENCY_FINGERPRINT=$(
  git hash-object package.json package-lock.json |
    git hash-object --stdin |
    cut -c1-16
)
export COMPOSE_PROJECT_NAME WAO_DEV_CODEX_RUNTIME_ROOT WAO_DEV_ENV_FILE WAO_DEV_DEPENDENCY_FINGERPRINT
mkdir -p "$WAO_DEV_CODEX_RUNTIME_ROOT"

compose() {
  docker compose \
    --env-file "$dev_env_file" \
    -f docker-compose.yml \
    -f docker-compose.dev.yml \
    "$@"
}

compose build app-dev codex-runtime-dev
compose up --remove-orphans app-dev temporal-worker-dev
