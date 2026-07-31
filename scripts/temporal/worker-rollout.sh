#!/bin/sh
set -eu

usage() {
  cat >&2 <<'EOF'
Usage:
  npm run temporal:worker:rollout -- status
  npm run temporal:worker:rollout -- promote blue|green
  npm run temporal:worker:rollout -- retire blue|green

promote first proves that the selected slot is not the Current Version, then
starts only that candidate, waits until Temporal sees its pollers, and makes its
immutable build the Current Version. It never stops the previous slot.

retire refuses the Current Version and refuses a version whose Temporal
drainage status is not "drained". Set the selected slot's *_REPLICAS value to 0
in .env before retiring it, so a later docker compose up cannot resurrect it.
EOF
  exit 2
}

command_name=${1:-}
slot=${2:-}

case "$command_name" in
  status) ;;
  promote|retire)
    case "$slot" in
      blue|green) ;;
      *) usage ;;
    esac
    ;;
  *) usage ;;
esac

compose() {
  docker compose "$@"
}

temporal_cli() {
  compose --profile temporal-ops run --rm --no-deps temporal-admin \
    "$@" \
    --namespace "$namespace" \
    --address temporal:7233
}

container_env() {
  container_id=$1
  key=$2
  docker inspect \
    --format '{{range .Config.Env}}{{println .}}{{end}}' \
    "$container_id" \
    | sed -n "s/^$key=//p" \
    | head -n 1
}

service_container_ids() {
  compose ps --status running -q "$1"
}

first_service_container() {
  service_container_ids "$1" | head -n 1
}

worker_identity() {
  identity_target_service=$1
  identity_container_id=$(first_service_container "$identity_target_service")
  if [ -z "$identity_container_id" ]; then
    return 1
  fi
  worker_namespace=$(container_env "$identity_container_id" TEMPORAL_NAMESPACE)
  worker_deployment=$(container_env "$identity_container_id" TEMPORAL_WORKER_DEPLOYMENT_NAME)
  worker_build_id=$(container_env "$identity_container_id" TEMPORAL_WORKER_BUILD_ID)
  worker_versioning=$(container_env "$identity_container_id" TEMPORAL_WORKER_VERSIONING_ENABLED)
  if [ -z "$worker_namespace" ] \
    || [ -z "$worker_deployment" ] \
    || [ -z "$worker_build_id" ] \
    || [ "$worker_build_id" = local ] \
    || [ "$worker_build_id" = LOCAL ] \
    || [ "$worker_versioning" != true ]; then
    echo "Worker '$identity_target_service' does not expose a production version identity" >&2
    return 1
  fi
  namespace=$worker_namespace
  deployment=$worker_deployment
  build_id=$worker_build_id
}

require_image_digest() {
  image_reference=$1
  image_owner=$2
  case "$image_reference" in
    *@sha256:*) ;;
    *)
      echo "$image_owner must use an immutable repository@sha256 digest" >&2
      return 1
      ;;
  esac
  image_digest=${image_reference#*@sha256:}
  if [ "${#image_digest}" -ne 64 ]; then
    echo "$image_owner sha256 digest must contain exactly 64 hexadecimal characters" >&2
    return 1
  fi
  if [ "$image_digest" = "0000000000000000000000000000000000000000000000000000000000000000" ]; then
    echo "$image_owner still contains the local-development placeholder digest" >&2
    return 1
  fi
  case "$image_digest" in
    *[!0-9a-fA-F]*)
      echo "$image_owner sha256 digest contains non-hexadecimal characters" >&2
      return 1
      ;;
  esac
}

configured_environment_value() {
  target_service=$1
  target_key=$2
  compose config | awk -v target="$target_service:" -v key="$target_key:" '
    $0 == "  " target { in_service = 1; next }
    in_service && $0 ~ /^  [A-Za-z0-9_-]+:$/ { exit }
    in_service && $0 == "    environment:" { in_environment = 1; next }
    in_environment && $1 == key {
      line = $0
      sub(/^[^:]+:[[:space:]]*/, "", line)
      sub(/^"/, "", line)
      sub(/"$/, "", line)
      print line
      exit
    }
  '
}

load_running_deployment_identity() {
  for identity_service in temporal-worker-blue temporal-worker-green; do
    if worker_identity "$identity_service"; then
      return 0
    fi
  done
  echo "No running production Worker identity is available for rollout preflight" >&2
  return 1
}

deployment_json() {
  temporal_cli worker deployment describe \
    --name "$deployment" \
    --output json
}

current_build_id() {
  deployment_json \
    | sed -n 's/.*"currentVersionBuildID"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

has_running_build() {
  expected_build=$1
  for candidate_service in temporal-worker-blue temporal-worker-green; do
    for candidate_id in $(service_container_ids "$candidate_service"); do
      candidate_build=$(container_env "$candidate_id" TEMPORAL_WORKER_BUILD_ID)
      if [ "$candidate_build" = "$expected_build" ]; then
        return 0
      fi
    done
  done
  return 1
}

configured_replicas() {
  target_service=$1
  compose config | awk -v target="$target_service:" '
    $0 == "  " target { in_service = 1; next }
    in_service && $0 ~ /^  [A-Za-z0-9_-]+:$/ { exit }
    in_service && $1 == "replicas:" { print $2; exit }
  '
}

show_status() {
  identity_found=false
  for candidate_service in temporal-worker-blue temporal-worker-green; do
    candidate_id=$(first_service_container "$candidate_service")
    if [ -z "$candidate_id" ]; then
      echo "$candidate_service: stopped"
      continue
    fi
    identity_found=true
    candidate_build=$(container_env "$candidate_id" TEMPORAL_WORKER_BUILD_ID)
    echo "$candidate_service: running build=$candidate_build"
    if [ -z "${namespace:-}" ]; then
      namespace=$(container_env "$candidate_id" TEMPORAL_NAMESPACE)
      deployment=$(container_env "$candidate_id" TEMPORAL_WORKER_DEPLOYMENT_NAME)
    fi
  done
  if [ "$identity_found" = false ]; then
    echo "No running Temporal Worker slot was found." >&2
    exit 1
  fi
  deployment_json
}

if [ "$command_name" = status ]; then
  show_status
  exit 0
fi

service="temporal-worker-$slot"

if [ "$command_name" = promote ]; then
  configured_build_id=$(configured_environment_value "$service" TEMPORAL_WORKER_BUILD_ID)
  configured_image=$(configured_environment_value "$service" TEMPORAL_WORKER_IMAGE)
  if [ -z "$configured_build_id" ] || [ "$configured_build_id" = local ] || [ "$configured_build_id" = LOCAL ]; then
    echo "Candidate Worker '$service' requires a unique non-local build ID" >&2
    exit 1
  fi
  require_image_digest "$configured_image" "Candidate Worker '$service' image"

  load_running_deployment_identity
  existing_namespace=$namespace
  existing_deployment=$deployment
  previous_build=$(current_build_id)
  if [ -z "$previous_build" ]; then
    echo "Worker Deployment '$existing_deployment' has no Current Version; use the initial Compose bootstrap" >&2
    exit 1
  fi
  if [ -n "$previous_build" ] && [ "$configured_build_id" = "$previous_build" ]; then
    echo "Refusing to replace selected slot '$service': its configured build is Current Version '$previous_build'" >&2
    exit 1
  fi

  selected_container=$(first_service_container "$service")
  if [ -n "$selected_container" ]; then
    selected_running_build=$(container_env "$selected_container" TEMPORAL_WORKER_BUILD_ID)
    if [ -n "$previous_build" ] && [ "$selected_running_build" = "$previous_build" ]; then
      echo "Refusing to replace selected slot '$service': its running build is Current Version '$previous_build'" >&2
      exit 1
    fi
  fi
  if [ -n "$previous_build" ] && ! has_running_build "$previous_build"; then
    echo "Current build '$previous_build' has no running blue/green Worker; refusing promotion" >&2
    exit 1
  fi

  compose up -d --no-deps "$service"
  attempt=1
  while ! worker_identity "$service"; do
    if [ "$attempt" -ge 30 ]; then
      echo "Candidate Worker '$service' did not become running" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  if [ "$namespace" != "$existing_namespace" ] || [ "$deployment" != "$existing_deployment" ]; then
    echo "Candidate Worker changed the namespace or Deployment identity; refusing promotion" >&2
    exit 1
  fi
  if [ "$build_id" != "$configured_build_id" ]; then
    echo "Candidate Worker identity changed while starting; refusing promotion" >&2
    exit 1
  fi
  running_image=$(container_env "$(first_service_container "$service")" TEMPORAL_WORKER_IMAGE)
  require_image_digest "$running_image" "Running candidate Worker '$service' image"
  if [ "$running_image" != "$configured_image" ]; then
    echo "Candidate Worker image changed while starting; refusing promotion" >&2
    exit 1
  fi
  if [ -n "$previous_build" ] \
    && [ "$previous_build" != "$build_id" ] \
    && ! has_running_build "$previous_build"; then
    echo "Current build '$previous_build' has no running blue/green Worker; refusing promotion" >&2
    exit 1
  fi

  attempt=1
  while ! temporal_cli worker deployment set-current-version \
    --deployment-name "$deployment" \
    --build-id "$build_id" \
    --yes; do
    if [ "$attempt" -ge 30 ]; then
      echo "Candidate '$build_id' did not register every required task queue" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  activated_build=$(current_build_id)
  if [ "$activated_build" != "$build_id" ]; then
    echo "Temporal did not retain '$build_id' as Current Version" >&2
    exit 1
  fi
  if [ -n "$previous_build" ] \
    && [ "$previous_build" != "$build_id" ] \
    && ! has_running_build "$previous_build"; then
    echo "Previous pinned Worker '$previous_build' disappeared during promotion" >&2
    exit 1
  fi
  echo "Promoted '$build_id'. Keep '$previous_build' running until Temporal reports it drained."
  exit 0
fi

worker_identity "$service" || {
  echo "Worker '$service' is not running" >&2
  exit 1
}

current_build=$(current_build_id)
if [ "$current_build" = "$build_id" ]; then
  echo "Refusing to retire Current Version '$build_id'" >&2
  exit 1
fi

version_json=$(
  temporal_cli worker deployment describe-version \
    --deployment-name "$deployment" \
    --build-id "$build_id" \
    --output json
)
if ! printf '%s\n' "$version_json" \
  | grep -Eq '"drainageStatus"[[:space:]]*:[[:space:]]*"drained"'; then
  printf '%s\n' "$version_json"
  echo "Worker '$build_id' is not drained; keep '$service' running" >&2
  exit 1
fi

replicas=$(configured_replicas "$service")
if [ "$replicas" != 0 ]; then
  echo "Set this slot's *_REPLICAS value to 0 in .env before retirement" >&2
  exit 1
fi

compose stop "$service"
compose rm -f "$service"
echo "Retired drained Worker '$build_id'. Temporal may garbage-collect its version metadata."
