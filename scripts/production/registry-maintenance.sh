#!/bin/sh
set -eu

mode=${1:---check}
case "$mode" in --check|--apply) ;; *) echo "Usage: registry-maintenance.sh [--check|--apply]" >&2; exit 2 ;; esac
deploy_root=${WAO_DEPLOY_ROOT:-}
case "$deploy_root" in /*) ;; *) echo "WAO_DEPLOY_ROOT must be absolute" >&2; exit 1 ;; esac
deploy_root=${deploy_root%/}
if [ -z "$deploy_root" ] || [ "$deploy_root" = / ] || [ ! -d "$deploy_root" ]; then
  echo "WAO_DEPLOY_ROOT is unsafe or missing" >&2
  exit 1
fi

for command_name in curl docker flock jq mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command is missing: $command_name" >&2
    exit 1
  }
done

registry_name=${WAO_REGISTRY_CONTAINER_NAME:-waoowaoo-registry}
registry_endpoint=${WAO_REGISTRY_ENDPOINT:-127.0.0.1:5000}
case "$registry_endpoint" in 127.0.0.1:[0-9]*) ;; *) echo "Registry endpoint must use loopback" >&2; exit 1 ;; esac
keep_releases=${WAO_REGISTRY_KEEP_RELEASES:-3}
case "$keep_releases" in ''|*[!0-9]*|0) echo "WAO_REGISTRY_KEEP_RELEASES must be positive" >&2; exit 1 ;; esac

exec 9>"$deploy_root/.registry-maintenance.lock"
flock -n 9 || { echo "Registry maintenance is already running" >&2; exit 1; }

registry_id=$(docker ps -q --filter "name=^/${registry_name}$" | head -n 1)
if [ -z "$registry_id" ]; then
  echo "Local Registry is not running: $registry_name" >&2
  exit 1
fi
registry_image=$(docker inspect --format '{{.Config.Image}}' "$registry_id")
delete_enabled=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$registry_id" \
  | sed -n 's/^REGISTRY_STORAGE_DELETE_ENABLED=//p' | head -n 1)
log_type=$(docker inspect --format '{{.HostConfig.LogConfig.Type}}' "$registry_id")
log_max_size=$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-size"}}' "$registry_id")
log_max_file=$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-file"}}' "$registry_id")
echo "REGISTRY_CONFIG delete_enabled=${delete_enabled:-false} log_type=$log_type max_size=${log_max_size:-missing} max_file=${log_max_file:-missing}"

if [ "$mode" = --apply ] && {
  [ "$delete_enabled" != true ] || [ -z "$log_max_size" ] || [ -z "$log_max_file" ];
}; then
  echo "Registry must first be reconciled with install-local-registry.sh --apply" >&2
  exit 1
fi

work_dir=$(mktemp -d "$deploy_root/.registry-maintenance-XXXXXX")
registry_stopped=false
cleanup() {
  if [ "$registry_stopped" = true ]; then
    docker start "$registry_name" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT HUP INT TERM
protected="$work_dir/protected-digests"
planned="$work_dir/planned-deletions"
deleted="$work_dir/deleted-digests"
: > "$protected"
: > "$planned"
: > "$deleted"

record_reference() {
  reference=$1
  case "$reference" in
    "$registry_endpoint"/waoowaoo@sha256:*|"$registry_endpoint"/waoowaoo-codex-runtime@sha256:*)
      digest=${reference##*@}
      case "$digest" in sha256:????????????????????????????????????????????????????????????????) printf '%s\n' "$digest" >> "$protected" ;; esac
      ;;
  esac
}

# The bounded release history is the rollback contract. Container and Compose
# references are added independently so no in-use manifest can be deleted even
# if the history file is missing or damaged.
history_file="$deploy_root/.release-history"
if [ -f "$history_file" ] && [ ! -L "$history_file" ]; then
  tail -n "$keep_releases" "$history_file" | while IFS=' ' read -r _timestamp _commit app_ref runtime_ref; do
    record_reference "$app_ref"
    record_reference "$runtime_ref"
  done
fi
env_file="$deploy_root/.env.production"
if [ -f "$env_file" ] && [ ! -L "$env_file" ]; then
  sed -n -E 's/^(APP_IMAGE|CODEX_RUNTIME_IMAGE|TEMPORAL_WORKER_(BLUE|GREEN)_IMAGE)=//p' "$env_file" \
    | while IFS= read -r reference; do record_reference "$reference"; done
fi
for container_id in $(docker ps -aq); do
  image_id=$(docker inspect --format '{{.Image}}' "$container_id")
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image_id" 2>/dev/null \
    | while IFS= read -r reference; do record_reference "$reference"; done
done
sort -u "$protected" -o "$protected"

manifest_digest() {
  repository=$1
  tag=$2
  curl -fsSI \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
    "http://$registry_endpoint/v2/$repository/manifests/$tag" \
    | tr -d '\r' \
    | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest:[[:space:]]*//p' \
    | head -n 1
}

catalog=$(curl -fsS "http://$registry_endpoint/v2/_catalog?n=100")
unexpected=$(printf '%s' "$catalog" | jq -r '.repositories[]?' \
  | awk '$0 != "waoowaoo" && $0 != "waoowaoo-codex-runtime" { print }')
if [ -n "$unexpected" ]; then
  echo "Registry contains repositories outside the maintenance allowlist: $unexpected" >&2
  exit 1
fi

for repository in waoowaoo waoowaoo-codex-runtime; do
  tags=$(curl -fsS "http://$registry_endpoint/v2/$repository/tags/list?n=10000" | jq -r '.tags[]?')
  for tag in $tags; do
    digest=$(manifest_digest "$repository" "$tag")
    case "$digest" in sha256:????????????????????????????????????????????????????????????????) ;; *) echo "Invalid manifest digest for $repository:$tag" >&2; exit 1 ;; esac
    if grep -Fxq "$digest" "$protected"; then
      echo "REGISTRY_TAG keep repository=$repository tag=$tag digest=$digest"
    else
      echo "REGISTRY_TAG delete repository=$repository tag=$tag digest=$digest"
      printf '%s %s %s\n' "$repository" "$tag" "$digest" >> "$planned"
    fi
  done
done

if [ "$mode" = --apply ]; then
  while IFS=' ' read -r repository tag digest; do
    [ -n "$repository" ] || continue
    if ! grep -Fxq "$digest" "$deleted"; then
      curl -fsS -X DELETE "http://$registry_endpoint/v2/$repository/manifests/$digest" >/dev/null
      printf '%s\n' "$digest" >> "$deleted"
    fi
    docker image rm "$registry_endpoint/$repository:$tag" >/dev/null 2>&1 || true
  done < "$planned"

  if [ -s "$deleted" ]; then
    docker stop "$registry_name" >/dev/null
    registry_stopped=true
    docker run --rm --volumes-from "$registry_name" "$registry_image" \
      garbage-collect --delete-untagged /etc/docker/registry/config.yml
    docker start "$registry_name" >/dev/null
    registry_stopped=false
    registry_attempt=1
    until curl -fsS "http://$registry_endpoint/v2/" >/dev/null; do
      if [ "$registry_attempt" -ge 30 ]; then
        echo "Registry did not recover after garbage collection" >&2
        exit 1
      fi
      registry_attempt=$((registry_attempt + 1))
      sleep 1
    done
  fi
  docker image prune --force
fi

delete_count=$(wc -l < "$planned" | tr -d ' ')
protected_count=$(wc -l < "$protected" | tr -d ' ')
echo "REGISTRY_MAINTENANCE_OK mode=$mode protected_digests=$protected_count delete_tags=$delete_count"
