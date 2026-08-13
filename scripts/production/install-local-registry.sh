#!/bin/sh
set -eu

mode=${1:---check}
case "$mode" in --check|--apply) ;; *) echo "Usage: install-local-registry.sh [--check|--apply]" >&2; exit 2 ;; esac
registry_name=${WAO_REGISTRY_CONTAINER_NAME:-waoowaoo-registry}
registry_endpoint=${WAO_REGISTRY_ENDPOINT:-127.0.0.1:5000}
case "$registry_endpoint" in 127.0.0.1:[0-9]*) ;; *) echo "Registry endpoint must use loopback" >&2; exit 1 ;; esac

for command_name in curl docker jq; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Required command is missing: $command_name" >&2; exit 1; }
done
registry_id=$(docker ps -aq --filter "name=^/${registry_name}$" | head -n 1)
if [ -z "$registry_id" ]; then
  echo "Existing Registry container was not found: $registry_name" >&2
  exit 1
fi
registry_image=$(docker inspect --format '{{.Config.Image}}' "$registry_id")
case "$registry_image" in registry:2|registry:2.*|registry@sha256:*) ;; *) echo "Unexpected Registry image: $registry_image" >&2; exit 1 ;; esac
registry_volume=$(docker inspect "$registry_id" \
  | jq -r '.[0].Mounts | map(select(.Type == "volume" and .Destination == "/var/lib/registry" and .RW == true)) | if length == 1 then .[0].Name else empty end')
if [ -z "$registry_volume" ]; then
  echo "Registry must have exactly one writable named volume at /var/lib/registry" >&2
  exit 1
fi
port_binding=$(docker inspect "$registry_id" \
  | jq -r '.[0].HostConfig.PortBindings["5000/tcp"] | if length == 1 then .[0].HostIp + ":" + .[0].HostPort else empty end')
if [ "$port_binding" != "$registry_endpoint" ]; then
  echo "Registry port binding is not the expected loopback endpoint: $port_binding" >&2
  exit 1
fi
restart_policy=$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$registry_id")
case "$restart_policy" in always|unless-stopped) ;; *) restart_policy=unless-stopped ;; esac
delete_enabled=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$registry_id" \
  | sed -n 's/^REGISTRY_STORAGE_DELETE_ENABLED=//p' | head -n 1)
max_size=$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-size"}}' "$registry_id")
max_file=$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-file"}}' "$registry_id")

if [ "$delete_enabled" = true ] && [ -n "$max_size" ] && [ -n "$max_file" ]; then
  echo "LOCAL_REGISTRY_OK delete_enabled=true max_size=$max_size max_file=$max_file"
  exit 0
fi
if [ "$mode" = --check ]; then
  echo "LOCAL_REGISTRY_RECONCILIATION_REQUIRED delete_enabled=${delete_enabled:-false} max_size=${max_size:-missing} max_file=${max_file:-missing}" >&2
  exit 1
fi
if [ "${WAO_REGISTRY_RECREATE:-}" != 1 ]; then
  echo "Set WAO_REGISTRY_RECREATE=1 to authorize container recreation; the named data volume is preserved" >&2
  exit 1
fi

candidate_name="$registry_name-reconciled-$$"
candidate_started=false
cleanup() {
  if [ "$candidate_started" = true ]; then
    docker rm --force "$candidate_name" >/dev/null 2>&1 || true
  fi
  if docker ps -aq --filter "name=^/${registry_name}$" | grep -q .; then
    docker start "$registry_name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT HUP INT TERM
docker stop "$registry_name" >/dev/null
docker run -d \
  --name "$candidate_name" \
  --restart "$restart_policy" \
  --publish "$registry_endpoint:5000" \
  --env REGISTRY_STORAGE_DELETE_ENABLED=true \
  --log-driver json-file \
  --log-opt max-size=50m \
  --log-opt max-file=5 \
  --volume "$registry_volume:/var/lib/registry" \
  "$registry_image" >/dev/null
candidate_started=true
attempt=1
until curl -fsS "http://$registry_endpoint/v2/" >/dev/null; do
  if [ "$attempt" -ge 30 ]; then
    docker logs --tail 200 "$candidate_name" >&2 || true
    echo "Reconciled Registry did not become healthy; data remains in volume $registry_volume" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done
docker rm "$registry_name" >/dev/null
docker rename "$candidate_name" "$registry_name"
candidate_started=false
trap - EXIT HUP INT TERM
echo "LOCAL_REGISTRY_RECONCILED volume=$registry_volume endpoint=$registry_endpoint"
