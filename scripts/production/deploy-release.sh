#!/bin/sh
set -eu

usage() {
  echo "Usage: WAO_DEPLOY_ROOT_B64=<base64 absolute path> sh deploy-release.sh <40-char commit> <release.tar.gz>" >&2
  exit 2
}

release_commit=${1:-}
archive_path=${2:-}
if [ "${#release_commit}" -ne 40 ]; then usage; fi
case "$release_commit" in *[!0-9a-f]*) usage ;; esac
if [ -z "${WAO_DEPLOY_ROOT_B64:-}" ]; then usage; fi

deploy_root=$(printf '%s' "$WAO_DEPLOY_ROOT_B64" | base64 -d)
case "$deploy_root" in
  /*) ;;
  *) echo "WAO_DEPLOY_ROOT must be absolute" >&2; exit 1 ;;
esac
deploy_root=${deploy_root%/}
if [ -z "$deploy_root" ] || [ "$deploy_root" = / ] || [ ! -d "$deploy_root" ]; then
  echo "WAO_DEPLOY_ROOT is not a safe existing directory" >&2
  exit 1
fi
case "$archive_path" in
  "$deploy_root"/.incoming/*) ;;
  *) echo "Release archive must be inside WAO_DEPLOY_ROOT/.incoming" >&2; exit 1 ;;
esac
if [ ! -f "$archive_path" ] || [ -L "$archive_path" ]; then
  echo "Release archive is missing or unsafe" >&2
  exit 1
fi

for command_name in awk base64 curl docker flock gzip mktemp sed sha256sum sudo tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command is missing: $command_name" >&2
    exit 1
  }
done

exec 9>"$deploy_root/.production-deploy.lock"
if ! flock -n 9; then
  echo "Another production deployment is already running" >&2
  exit 1
fi

short_commit=$(printf '%s' "$release_commit" | cut -c1-10)
release_timestamp=$(date -u +%Y%m%d%H%M%S)
release_dir=$(mktemp -d "$deploy_root/.release-$short_commit-XXXXXX")
candidate_name="waoowaoo-release-candidate-$short_commit"
env_file="$deploy_root/.env.production"
compose_file="$deploy_root/docker-compose.yml"
cloud_compose_file="$deploy_root/docker-compose.cloud.yml"
rollout_script="$deploy_root/scripts/temporal/worker-rollout.sh"
env_backup="$deploy_root/.env.production.pre-$short_commit"
compose_backup="$deploy_root/.docker-compose.yml.pre-$short_commit"
rollout_backup="$deploy_root/.worker-rollout.pre-$short_commit"
worker_promoted=false
web_stopped=false

cleanup() {
  docker rm -f "$candidate_name" >/dev/null 2>&1 || true
  rm -f "$archive_path"
  if [ "$web_stopped" = true ]; then
    compose up -d --no-deps app >/dev/null 2>&1 || true
  fi
  if [ "$worker_promoted" = false ]; then
    [ ! -f "$env_backup" ] || cp -p "$env_backup" "$env_file"
    [ ! -f "$compose_backup" ] || cp -p "$compose_backup" "$compose_file"
    [ ! -f "$rollout_backup" ] || cp -p "$rollout_backup" "$rollout_script"
  fi
}
trap cleanup EXIT HUP INT TERM

if tar -tzf "$archive_path" | awk '
  /^\// { bad=1 }
  /(^|\/)\.\.($|\/)/ { bad=1 }
  END { exit bad ? 0 : 1 }
'; then
  echo "Release archive contains an unsafe path" >&2
  exit 1
fi
tar -xzf "$archive_path" -C "$release_dir"
if [ ! -f "$release_dir/Dockerfile" ] \
  || [ ! -f "$release_dir/Dockerfile.codex-runtime" ] \
  || [ ! -f "$release_dir/docker-compose.yml" ] \
  || [ ! -f "$release_dir/scripts/temporal/worker-rollout.sh" ] \
  || [ ! -f "$release_dir/scripts/production/host-maintenance.sh" ] \
  || [ ! -f "$release_dir/scripts/production/registry-maintenance.sh" ] \
  || [ ! -f "$release_dir/scripts/production/install-local-registry.sh" ] \
  || [ ! -f "$release_dir/scripts/production/install-host-maintenance.sh" ] \
  || [ ! -f "$release_dir/scripts/reconcile-assistant-runtime-rollout.ts" ]; then
  echo "Release archive is incomplete" >&2
  exit 1
fi

# The first automated release also upgrades the existing local Registry in
# place. The installer preserves its named data volume, proves the exact
# loopback binding, and makes deletion/GC plus log rotation enforceable.
WAO_REGISTRY_RECREATE=1 \
  sh "$release_dir/scripts/production/install-local-registry.sh" --apply
sudo -n true

archive_digest=$(sha256sum "$archive_path" | awk '{print $1}')
echo "Building release $release_commit archive=$archive_digest"
app_repository=${WAO_APP_IMAGE_REPOSITORY:-127.0.0.1:5000/waoowaoo}
runtime_repository=${WAO_RUNTIME_IMAGE_REPOSITORY:-127.0.0.1:5000/waoowaoo-codex-runtime}
app_tag="$app_repository:release-$release_timestamp-$release_commit"
runtime_tag="$runtime_repository:release-$release_timestamp-$release_commit"

docker build \
  --label "com.waoowaoo.release.commit=$release_commit" \
  --tag "$app_tag" \
  "$release_dir"
docker build \
  --file "$release_dir/Dockerfile.codex-runtime" \
  --label "com.waoowaoo.release.commit=$release_commit" \
  --tag "$runtime_tag" \
  "$release_dir"
docker push "$app_tag"
docker push "$runtime_tag"

resolve_repo_digest() {
  tagged_image=$1
  repository=$2
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$tagged_image" \
    | awk -v prefix="$repository@sha256:" 'index($0, prefix) == 1 { print; exit }'
}

app_image=$(resolve_repo_digest "$app_tag" "$app_repository")
runtime_image=$(resolve_repo_digest "$runtime_tag" "$runtime_repository")
case "$app_image" in "$app_repository"@sha256:????????????????????????????????????????????????????????????????) ;; *) echo "App digest resolution failed" >&2; exit 1 ;; esac
case "$runtime_image" in "$runtime_repository"@sha256:????????????????????????????????????????????????????????????????) ;; *) echo "Runtime digest resolution failed" >&2; exit 1 ;; esac

if [ ! -f "$env_file" ] || [ ! -f "$compose_file" ] || [ ! -f "$cloud_compose_file" ]; then
  echo "Production Compose or environment file is missing" >&2
  exit 1
fi
release_history="$deploy_root/.release-history"
if [ ! -e "$release_history" ]; then
  previous_app_image=$(sed -n 's/^APP_IMAGE=//p' "$env_file" | tail -n 1)
  previous_runtime_image=$(sed -n 's/^CODEX_RUNTIME_IMAGE=//p' "$env_file" | tail -n 1)
  case "$previous_app_image" in *@sha256:????????????????????????????????????????????????????????????????) ;; *) previous_app_image='' ;; esac
  case "$previous_runtime_image" in *@sha256:????????????????????????????????????????????????????????????????) ;; *) previous_runtime_image='' ;; esac
  if [ -n "$previous_app_image" ] && [ -n "$previous_runtime_image" ]; then
    printf '%s %s %s %s\n' \
      "$release_timestamp" bootstrap "$previous_app_image" "$previous_runtime_image" \
      > "$release_history"
    chmod 0600 "$release_history"
  fi
elif [ -L "$release_history" ] || [ ! -f "$release_history" ]; then
  echo "Release history path is unsafe" >&2
  exit 1
fi
mkdir -p "$deploy_root/scripts/temporal"
cp -p "$env_file" "$env_backup"
cp -p "$compose_file" "$compose_backup"
[ ! -f "$rollout_script" ] || cp -p "$rollout_script" "$rollout_backup"
cp "$release_dir/docker-compose.yml" "$compose_file"
cp "$release_dir/scripts/temporal/worker-rollout.sh" "$rollout_script"
chmod 0755 "$rollout_script"

export COMPOSE_ENV_FILES="$env_file"
export COMPOSE_FILE="$compose_file:$cloud_compose_file"
export COMPOSE_PROJECT_NAME=${WAO_COMPOSE_PROJECT_NAME:-waoowaoo-prod}

compose() {
  docker compose --profile temporal-worker-rollout "$@"
}

set_env_value() {
  env_key=$1
  env_value=$2
  temp_env=$(mktemp "$deploy_root/.env.production.edit-XXXXXX")
  awk -v key="$env_key" -v value="$env_value" '
    BEGIN { written=0 }
    index($0, key "=") == 1 {
      if (!written) print key "=" value
      written=1
      next
    }
    { print }
    END { if (!written) print key "=" value }
  ' "$env_file" > "$temp_env"
  chmod 0600 "$temp_env"
  mv "$temp_env" "$env_file"
}

container_env() {
  container_id=$1
  env_key=$2
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
    | sed -n "s/^$env_key=//p" | head -n 1
}

rollout_status=$(sh "$rollout_script" status)
printf '%s\n' "$rollout_status"
current_build=$(printf '%s\n' "$rollout_status" \
  | sed -n 's/.*"currentVersionBuildID"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -n 1)
if [ -z "$current_build" ]; then
  echo "Temporal Current Version is missing" >&2
  exit 1
fi

current_slot=''
for slot_name in blue green; do
  slot_container=$(compose ps --status running -q "temporal-worker-$slot_name" | head -n 1)
  if [ -n "$slot_container" ] \
    && [ "$(container_env "$slot_container" TEMPORAL_WORKER_BUILD_ID)" = "$current_build" ]; then
    current_slot=$slot_name
  fi
done
case "$current_slot" in
  blue) candidate_slot=green ;;
  green) candidate_slot=blue ;;
  *) echo "Current Temporal build has no unique running slot" >&2; exit 1 ;;
esac

app_digest=${app_image#*@sha256:}
build_id="release-$short_commit-$(printf '%s' "$app_digest" | cut -c1-12)-$(date -u +%Y%m%d%H%M%S)"
candidate_upper=$(printf '%s' "$candidate_slot" | tr '[:lower:]' '[:upper:]')
current_upper=$(printf '%s' "$current_slot" | tr '[:lower:]' '[:upper:]')

# Prove the exact image can boot against production dependencies without
# changing the stable app service or accepting traffic.
APP_IMAGE="$app_image" CODEX_RUNTIME_IMAGE="$runtime_image" \
  compose run -d --no-deps --name "$candidate_name" app >/dev/null
canary_attempt=1
until docker exec "${COMPOSE_PROJECT_NAME}-caddy-1" \
  wget -qO- "http://$candidate_name:3000/api/deployment" >/dev/null 2>&1; do
  if [ "$canary_attempt" -ge 60 ]; then
    docker logs --tail 200 "$candidate_name" >&2 || true
    echo "Candidate Web did not become healthy" >&2
    exit 1
  fi
  canary_attempt=$((canary_attempt + 1))
  sleep 2
done
docker rm -f "$candidate_name" >/dev/null

set_env_value APP_IMAGE "$app_image"
set_env_value CODEX_RUNTIME_IMAGE "$runtime_image"
set_env_value "TEMPORAL_WORKER_${candidate_upper}_IMAGE" "$app_image"
set_env_value "TEMPORAL_WORKER_${candidate_upper}_BUILD_ID" "$build_id"
set_env_value "TEMPORAL_WORKER_${candidate_upper}_REPLICAS" 1
set_env_value "TEMPORAL_WORKER_${current_upper}_REPLICAS" 1

# Schema validation/migration is a deployment gate. It completes before the
# candidate Worker is allowed to poll the production queue.
compose run --rm --no-deps app-schema

sh "$rollout_script" promote "$candidate_slot"
worker_promoted=true

# Web owns native Runtime requests and their projector in memory. Stop the old
# owner first, remove only containers carrying the managed Runtime label, then
# invoke the existing persistence recovery writer before the new Web accepts
# traffic. This gives even a permanently waiting approval an explicit terminal
# handoff instead of blocking the release or leaving a phantom busy Turn.
compose stop --timeout 60 app
web_stopped=true
managed_runtime_ids=$(docker ps -aq --filter label=wao.codex-runtime.managed=true)
if [ -n "$managed_runtime_ids" ]; then
  # shellcheck disable=SC2086 -- ids come only from Docker's validated output.
  docker rm --force $managed_runtime_ids >/dev/null
fi
compose run --rm --no-deps app \
  ./node_modules/.bin/tsx scripts/reconcile-assistant-runtime-rollout.ts
if [ -n "$(docker ps -aq --filter label=wao.codex-runtime.managed=true)" ]; then
  echo "Managed Runtime container survived the Web cutover" >&2
  exit 1
fi

compose up -d --no-deps app
web_attempt=1
until docker exec "${COMPOSE_PROJECT_NAME}-caddy-1" \
  wget -qO- http://app:3000/api/deployment >/dev/null 2>&1; do
  if [ "$web_attempt" -ge 60 ]; then
    compose logs --tail 200 app >&2 || true
    echo "Production Web did not become healthy" >&2
    exit 1
  fi
  web_attempt=$((web_attempt + 1))
  sleep 2
done
web_stopped=false

running_app_id=$(compose ps --status running -q app | head -n 1)
running_app_image=$(docker inspect --format '{{.Config.Image}}' "$running_app_id")
if [ "$running_app_image" != "$app_image" ]; then
  echo "Production Web is not running the requested digest" >&2
  exit 1
fi

# Reconcile the reverse proxy from the canonical Compose definition as part
# of the same release. This also applies bounded json-file log rotation to an
# older Caddy container that predates the current Compose contract.
compose up -d --no-deps caddy
caddy_attempt=1
until docker exec "${COMPOSE_PROJECT_NAME}-caddy-1" \
  wget -qO- http://app:3000/api/deployment >/dev/null 2>&1; do
  if [ "$caddy_attempt" -ge 30 ]; then
    compose logs --tail 200 caddy >&2 || true
    echo "Production proxy did not become healthy" >&2
    exit 1
  fi
  caddy_attempt=$((caddy_attempt + 1))
  sleep 2
done

set_env_value "TEMPORAL_WORKER_${current_upper}_REPLICAS" 0
worker_drain_timeout=${WAO_WORKER_DRAIN_TIMEOUT_SECONDS:-3600}
case "$worker_drain_timeout" in ''|*[!0-9]*|0) echo "WAO_WORKER_DRAIN_TIMEOUT_SECONDS must be positive" >&2; exit 1 ;; esac
worker_drain_started=$(date +%s)
until sh "$rollout_script" retire "$current_slot"; do
  if [ $(( $(date +%s) - worker_drain_started )) -ge "$worker_drain_timeout" ]; then
    echo "Previous Worker is not drained; deployment remains safe but incomplete" >&2
    exit 1
  fi
  sleep 15
done

final_status=$(sh "$rollout_script" status)
printf '%s\n' "$final_status"
running_worker_count=$(compose ps --status running -q temporal-worker-blue temporal-worker-green | wc -l | tr -d ' ')
if [ "$running_worker_count" -ne 1 ]; then
  echo "Deployment finished with more than one running business Worker" >&2
  exit 1
fi

printf '%s %s %s %s\n' \
  "$release_timestamp" "$release_commit" "$app_image" "$runtime_image" \
  >> "$release_history"
chmod 0600 "$release_history"

WAO_DEPLOY_ROOT="$deploy_root" \
  sh "$release_dir/scripts/production/host-maintenance.sh" --apply
WAO_DEPLOY_ROOT="$deploy_root" \
  sh "$release_dir/scripts/production/registry-maintenance.sh" --apply
sudo -n sh "$release_dir/scripts/production/install-host-maintenance.sh" "$deploy_root"
rm -rf "$release_dir"
trap - EXIT HUP INT TERM
rm -f "$archive_path"
echo "PRODUCTION_DEPLOYMENT_COMPLETE commit=$release_commit app=$app_image runtime=$runtime_image worker=$build_id"
