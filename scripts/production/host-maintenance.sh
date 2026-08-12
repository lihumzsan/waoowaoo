#!/bin/sh
set -eu

mode=${1:---check}
case "$mode" in --check|--apply) ;; *) echo "Usage: host-maintenance.sh [--check|--apply]" >&2; exit 2 ;; esac
deploy_root=${WAO_DEPLOY_ROOT:-}
case "$deploy_root" in /*) ;; *) echo "WAO_DEPLOY_ROOT must be an absolute directory" >&2; exit 1 ;; esac
deploy_root=${deploy_root%/}
if [ -z "$deploy_root" ] || [ "$deploy_root" = / ] || [ ! -d "$deploy_root" ]; then
  echo "WAO_DEPLOY_ROOT is unsafe or missing" >&2
  exit 1
fi

exec 9>"$deploy_root/.host-maintenance.lock"
flock -n 9 || { echo "Host maintenance is already running" >&2; exit 1; }

disk_percent=$(df -P "$deploy_root" | awk 'NR==2 { gsub(/%/, "", $5); print $5 }')
case "$disk_percent" in ''|*[!0-9]*) echo "Unable to read disk usage" >&2; exit 1 ;; esac
echo "HOST_STORAGE disk_used_percent=$disk_percent"
docker system df

rotation_invalid=0
for container_id in $(docker ps -q); do
  log_type=$(docker inspect --format '{{.HostConfig.LogConfig.Type}}' "$container_id")
  max_size=$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-size"}}' "$container_id")
  max_file=$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-file"}}' "$container_id")
  if [ "$log_type" = json-file ] && { [ -z "$max_size" ] || [ -z "$max_file" ]; }; then
    echo "LOG_ROTATION_MISSING container=$(docker inspect --format '{{.Name}}' "$container_id")" >&2
    rotation_invalid=1
  fi
done

if [ "$mode" = --apply ]; then
  # These operations never remove named volumes or an image referenced by a
  # container. Release images remain available for rollback; only dangling
  # images and build cache older than the retention window are reclaimed.
  retention_hours=${WAO_DOCKER_CACHE_RETENTION_HOURS:-168}
  case "$retention_hours" in ''|*[!0-9]*|0) echo "WAO_DOCKER_CACHE_RETENTION_HOURS must be positive" >&2; exit 1 ;; esac
  docker builder prune --force --filter "until=${retention_hours}h"
  docker image prune --force --filter "until=${retention_hours}h"
  docker container prune --force --filter "until=${retention_hours}h"

  release_retention_days=${WAO_RELEASE_SOURCE_RETENTION_DAYS:-7}
  case "$release_retention_days" in ''|*[!0-9]*|0) echo "WAO_RELEASE_SOURCE_RETENTION_DAYS must be positive" >&2; exit 1 ;; esac
  find "$deploy_root" -mindepth 1 -maxdepth 1 -type d \
    \( -name '.release-*' -o -name '.build-*' \) \
    -mtime "+$release_retention_days" -print | while IFS= read -r stale_dir; do
      case "$stale_dir" in
        "$deploy_root"/.release-*|"$deploy_root"/.build-*) rm -rf "$stale_dir" ;;
        *) echo "Refusing unsafe release directory: $stale_dir" >&2; exit 1 ;;
      esac
    done

  disk_percent=$(df -P "$deploy_root" | awk 'NR==2 { gsub(/%/, "", $5); print $5 }')
  case "$disk_percent" in ''|*[!0-9]*) echo "Unable to reread disk usage" >&2; exit 1 ;; esac
  echo "HOST_STORAGE_AFTER_CLEANUP disk_used_percent=$disk_percent"
fi

if [ "$disk_percent" -ge "${WAO_DISK_CRITICAL_PERCENT:-85}" ]; then
  echo "ALERT_HOST_DISK_CRITICAL used_percent=$disk_percent" >&2
  exit 1
fi
if [ "$rotation_invalid" -ne 0 ]; then
  exit 1
fi
echo "HOST_MAINTENANCE_OK mode=$mode"
