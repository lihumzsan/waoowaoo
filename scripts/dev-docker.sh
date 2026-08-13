#!/bin/sh
set -eu

dev_env_file=${WAO_DEV_ENV_FILE:-.env}
if [ ! -f "$dev_env_file" ]; then
  echo "Development environment file does not exist: $dev_env_file" >&2
  exit 1
fi
: "${COMPOSE_PROJECT_NAME:=waoowaoo}"
: "${WAO_DEV_CODEX_RUNTIME_ROOT:=$PWD/.runtime/codex}"
: "${WAO_DEV_FORCE_REBUILD:=0}"
WAO_DEV_DEPENDENCY_FINGERPRINT=$(
  git hash-object package.json package-lock.json |
    git hash-object --stdin |
    cut -c1-16
)
export COMPOSE_PROJECT_NAME WAO_DEV_CODEX_RUNTIME_ROOT WAO_DEV_ENV_FILE WAO_DEV_DEPENDENCY_FINGERPRINT
mkdir -p "$WAO_DEV_CODEX_RUNTIME_ROOT"

dev_build_state_dir=$PWD/.runtime/dev-docker
mkdir -p "$dev_build_state_dir"

fingerprint_files() {
  for input_path in "$@"; do
    git ls-files --cached --others --exclude-standard -- "$input_path"
  done |
    LC_ALL=C sort -u |
    while IFS= read -r file; do
      [ -f "$file" ] || continue
      printf '%s\t%s\n' "$file" "$(git hash-object "$file")"
    done |
    git hash-object --stdin |
    cut -c1-16
}

app_image=waoowaoo-development:local
runtime_image=waoowaoo-codex-runtime:development
app_fingerprint=$(fingerprint_files \
  package.json \
  package-lock.json \
  prisma \
  Dockerfile \
  docker-compose.dev.yml \
  docker/development/entrypoint.sh)
runtime_fingerprint=$(fingerprint_files \
  Dockerfile.codex-runtime \
  docker-compose.dev.yml \
  docker/codex-runtime/entrypoint.sh)

compose() {
  docker compose \
    --env-file "$dev_env_file" \
    -f docker-compose.yml \
    -f docker-compose.dev.yml \
    "$@"
}

image_needs_build() {
  image=$1
  state_file=$2
  expected_fingerprint=$3

  [ "$WAO_DEV_FORCE_REBUILD" = "1" ] && return 0
  docker image inspect "$image" >/dev/null 2>&1 || return 0
  [ -f "$state_file" ] || return 0
  [ "$(sed -n '1p' "$state_file")" = "$expected_fingerprint" ] || return 0
  return 1
}

app_state_file=$dev_build_state_dir/app.fingerprint
runtime_state_file=$dev_build_state_dir/codex-runtime.fingerprint
build_targets=
if image_needs_build "$app_image" "$app_state_file" "$app_fingerprint"; then
  build_targets="app-dev"
fi
if image_needs_build "$runtime_image" "$runtime_state_file" "$runtime_fingerprint"; then
  build_targets="${build_targets:+$build_targets }codex-runtime-dev"
fi

if [ -n "$build_targets" ]; then
  # Use Docker's selected long-lived builder so dependency and package layers
  # remain available across development runs. Only the explicit rebuild command
  # bypasses those caches.
  if [ "$WAO_DEV_FORCE_REBUILD" = "1" ]; then
    # shellcheck disable=SC2086
    compose build --no-cache $build_targets
  else
    # shellcheck disable=SC2086
    compose build $build_targets
  fi

  case " $build_targets " in
    *" app-dev "*) printf '%s\n' "$app_fingerprint" > "$app_state_file" ;;
  esac
  case " $build_targets " in
    *" codex-runtime-dev "*) printf '%s\n' "$runtime_fingerprint" > "$runtime_state_file" ;;
  esac
else
  echo "Development images unchanged; starting without a Docker build."
fi

compose up --no-build --remove-orphans app-dev temporal-worker-dev
