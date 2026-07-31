#!/bin/sh
set -eu

TEMPORAL_ADDRESS=${TEMPORAL_ADDRESS:-temporal:7233}
TEMPORAL_NAMESPACE=${TEMPORAL_NAMESPACE:-waoowaoo}
TEMPORAL_NAMESPACE_RETENTION=${TEMPORAL_NAMESPACE_RETENTION:-30d}
MAX_ATTEMPTS=${TEMPORAL_HEALTH_CHECK_MAX_ATTEMPTS:-30}
SLEEP_SECONDS=${TEMPORAL_HEALTH_CHECK_SLEEP_SECONDS:-5}

case "$MAX_ATTEMPTS" in
  ''|*[!0-9]*|0)
    echo "TEMPORAL_HEALTH_CHECK_MAX_ATTEMPTS must be a positive integer" >&2
    exit 1
    ;;
esac

case "$SLEEP_SECONDS" in
  ''|*[!0-9]*)
    echo "TEMPORAL_HEALTH_CHECK_SLEEP_SECONDS must be a non-negative integer" >&2
    exit 1
    ;;
esac

attempt=1
while ! temporal operator cluster health --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1; do
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "Temporal server did not become healthy after ${MAX_ATTEMPTS} attempts" >&2
    exit 1
  fi

  echo "Temporal server is not healthy yet (${attempt}/${MAX_ATTEMPTS})."
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done

if temporal operator namespace describe \
  --namespace "$TEMPORAL_NAMESPACE" \
  --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1
then
  echo "Temporal namespace '${TEMPORAL_NAMESPACE}' already exists."
  exit 0
fi

attempt=1
while :; do
  if temporal operator namespace create \
    --namespace "$TEMPORAL_NAMESPACE" \
    --retention "$TEMPORAL_NAMESPACE_RETENTION" \
    --address "$TEMPORAL_ADDRESS"
  then
    echo "Temporal namespace '${TEMPORAL_NAMESPACE}' created."
    exit 0
  fi

  if temporal operator namespace describe \
    --namespace "$TEMPORAL_NAMESPACE" \
    --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1
  then
    echo "Temporal namespace '${TEMPORAL_NAMESPACE}' already exists."
    exit 0
  fi

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "Failed to create namespace '${TEMPORAL_NAMESPACE}' after ${MAX_ATTEMPTS} attempts" >&2
    exit 1
  fi

  echo "Temporal namespace creation is not ready yet (${attempt}/${MAX_ATTEMPTS})."
  attempt=$((attempt + 1))
  sleep "$SLEEP_SECONDS"
done
