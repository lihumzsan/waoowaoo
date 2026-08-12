#!/bin/sh
set -eu

: "${TEMPORAL_ADDRESS:?TEMPORAL_ADDRESS is required}"
: "${TEMPORAL_NAMESPACE:?TEMPORAL_NAMESPACE is required}"
: "${TEMPORAL_TASK_QUEUE:?TEMPORAL_TASK_QUEUE is required}"
: "${TEMPORAL_WORKER_DEPLOYMENT_NAME:?TEMPORAL_WORKER_DEPLOYMENT_NAME is required}"
: "${TEMPORAL_WORKER_BUILD_ID:?TEMPORAL_WORKER_BUILD_ID is required}"

max_attempts=${TEMPORAL_DEV_ROUTE_MAX_ATTEMPTS:-60}
sleep_seconds=${TEMPORAL_DEV_ROUTE_SLEEP_SECONDS:-2}

if [ "$TEMPORAL_WORKER_BUILD_ID" != local ]; then
  echo "Source development requires TEMPORAL_WORKER_BUILD_ID=local" >&2
  exit 1
fi

case "$max_attempts" in
  ''|*[!0-9]*|0)
    echo "TEMPORAL_DEV_ROUTE_MAX_ATTEMPTS must be a positive integer" >&2
    exit 1
    ;;
esac
case "$sleep_seconds" in
  ''|*[!0-9]*)
    echo "TEMPORAL_DEV_ROUTE_SLEEP_SECONDS must be a non-negative integer" >&2
    exit 1
    ;;
esac

temporal_cli() {
  temporal "$@" \
    --namespace "$TEMPORAL_NAMESPACE" \
    --address "$TEMPORAL_ADDRESS"
}

current_build_id() {
  deployment_json=$(
    temporal_cli worker deployment describe \
      --name "$TEMPORAL_WORKER_DEPLOYMENT_NAME" \
      --output json 2>/dev/null || true
  )
  printf '%s\n' "$deployment_json" \
    | sed -n 's/.*"currentVersionBuildID"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

deployment_build_ids() {
  deployment_json=$(
    temporal_cli worker deployment describe \
      --name "$TEMPORAL_WORKER_DEPLOYMENT_NAME" \
      --output json 2>/dev/null || true
  )
  printf '%s\n' "$deployment_json" \
    | sed -n 's/.*"BuildID"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

version_has_task_queue_type() {
  expected_type=$1
  version_json=$(
    temporal_cli worker deployment describe-version \
      --deployment-name "$TEMPORAL_WORKER_DEPLOYMENT_NAME" \
      --build-id "$TEMPORAL_WORKER_BUILD_ID" \
      --output json 2>/dev/null || true
  )
  printf '%s\n' "$version_json" | awk \
    -v expected_name="$TEMPORAL_TASK_QUEUE" \
    -v expected_type="$expected_type" '
      /"name"[[:space:]]*:/ {
        line = $0
        sub(/^[^:]+:[[:space:]]*"/, "", line)
        sub(/".*$/, "", line)
        queue_name = line
      }
      /"type"[[:space:]]*:/ {
        line = $0
        sub(/^[^:]+:[[:space:]]*"/, "", line)
        sub(/".*$/, "", line)
        if (queue_name == expected_name && line == expected_type) found = 1
      }
      END { exit found ? 0 : 1 }
    '
}

existing_build=$(current_build_id)
case "$existing_build" in
  ''|"$TEMPORAL_WORKER_BUILD_ID") ;;
  *)
    echo "Refusing to replace non-development Temporal Current Version '$existing_build'" >&2
    echo "Use a separate TEMPORAL_NAMESPACE for source development." >&2
    exit 1
    ;;
esac
for known_build in $(deployment_build_ids); do
  if [ "$known_build" != "$TEMPORAL_WORKER_BUILD_ID" ]; then
    echo "Refusing development initialization in a namespace containing Worker Build ID '$known_build'" >&2
    echo "Use a separate TEMPORAL_NAMESPACE for source development." >&2
    exit 1
  fi
done

attempt=1
while [ "$attempt" -le "$max_attempts" ]; do
  if version_has_task_queue_type workflow && version_has_task_queue_type activity; then
    break
  fi
  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "Temporal development Worker did not register workflow and activity task queues" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep "$sleep_seconds"
done

attempt=1
while ! temporal_cli worker deployment set-current-version \
  --deployment-name "$TEMPORAL_WORKER_DEPLOYMENT_NAME" \
  --build-id "$TEMPORAL_WORKER_BUILD_ID" \
  --yes >/dev/null; do
  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "Temporal development route could not be assigned to Worker Build ID '$TEMPORAL_WORKER_BUILD_ID'" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep "$sleep_seconds"
done

activated_build=$(current_build_id)
if [ "$activated_build" != "$TEMPORAL_WORKER_BUILD_ID" ]; then
  echo "Temporal did not retain Worker Build ID '$TEMPORAL_WORKER_BUILD_ID' as Current Version" >&2
  exit 1
fi

echo "Temporal development route is ready on Worker Build ID '$TEMPORAL_WORKER_BUILD_ID'."
