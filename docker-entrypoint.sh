#!/bin/sh
set -eu

mkdir -p /app/data /app/logs
chown -R node:node /app/data /app/logs

if [ "${CODEX_RUNTIME_DRIVER:-}" = "docker" ]; then
  runtime_image=${CODEX_RUNTIME_IMAGE:-}
  case "$runtime_image" in
    *@sha256:*) ;;
    *) echo "CODEX_RUNTIME_IMAGE must be an immutable repository@sha256 digest" >&2; exit 1 ;;
  esac
  runtime_digest=${runtime_image##*@sha256:}
  if [ "${#runtime_digest}" -ne 64 ] || [ "$runtime_digest" = "0000000000000000000000000000000000000000000000000000000000000000" ]; then
    echo "CODEX_RUNTIME_IMAGE contains an invalid or placeholder digest" >&2
    exit 1
  fi
  case "$runtime_digest" in
    *[!0-9a-f]*) echo "CODEX_RUNTIME_IMAGE digest must be lowercase hexadecimal" >&2; exit 1 ;;
  esac

  runtime_root=${CODEX_RUNTIME_HOST_ROOT:-}
  case "$runtime_root" in
    /*) ;;
    *) echo "CODEX_RUNTIME_HOST_ROOT must be an absolute non-root path" >&2; exit 1 ;;
  esac
  case "$runtime_root" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/proc|/root|/run|/sbin|/sys|/usr|/var)
      echo "CODEX_RUNTIME_HOST_ROOT is too broad" >&2
      exit 1
      ;;
  esac
  case "$runtime_root" in
    /tmp|/tmp/*|/run/*|/dev/shm|/dev/shm/*)
      echo "CODEX_RUNTIME_HOST_ROOT must be backed by durable storage" >&2
      exit 1
      ;;
  esac
  mkdir -p "$runtime_root"
  chown node:node "$runtime_root"

  docker_socket=/var/run/docker.sock
  if [ ! -S "$docker_socket" ]; then
    echo "Docker runtime selected but $docker_socket is unavailable" >&2
    exit 1
  fi
  docker_socket_gid=$(stat -c '%g' "$docker_socket")
  docker_group=$(getent group "$docker_socket_gid" | cut -d: -f1 || true)
  if [ -z "$docker_group" ]; then
    docker_group=wao-docker
    groupadd --gid "$docker_socket_gid" "$docker_group"
  fi
  usermod --append --groups "$docker_group" node

  runtime_network=${CODEX_RUNTIME_NETWORK:-}
  if [ -z "$runtime_network" ]; then
    echo "CODEX_RUNTIME_NETWORK is required" >&2
    exit 1
  fi
  if ! gosu node docker version >/dev/null 2>&1; then
    echo "The Web process cannot reach its dedicated Docker daemon" >&2
    exit 1
  fi
  if ! gosu node docker network inspect "$runtime_network" >/dev/null 2>&1; then
    echo "CODEX_RUNTIME_NETWORK does not exist: $runtime_network" >&2
    exit 1
  fi
fi

exec gosu node "$@"
