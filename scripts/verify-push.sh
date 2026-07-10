#!/usr/bin/env bash
set -uo pipefail

FAILED_STEPS=()

cleanup() {
  npm run test:services:stop || true
}

abort_verify() {
  local signal="$1"
  echo
  echo "verify:push interrupted by ${signal}"
  exit 130
}

trap cleanup EXIT
trap 'abort_verify INT' INT
trap 'abort_verify TERM' TERM

run_step() {
  local name="$1"
  shift

  echo
  echo "==> ${name}"
  if "$@"; then
    echo "[ok] ${name}"
    return 0
  else
    local status=$?
    if [[ "${status}" -eq 130 || "${status}" -eq 143 ]]; then
      echo "[abort] ${name} interrupted with exit code ${status}"
      exit "${status}"
    fi

    echo "[fail] ${name} failed with exit code ${status}"
    FAILED_STEPS+=("${name} (${status})")
    return "${status}"
  fi
}

run_npm_script() {
  local name="$1"
  run_step "${name}" npm run "${name}"
}

if ! run_npm_script test:services:prepare; then
  echo
  echo "verify:push cannot continue because required test services are unavailable."
  exit 1
fi

export TEST_SERVICES_EXTERNAL=1
export BILLING_TEST_KEEP_SERVICES=1
export GOOGLE_CLIENT_ID=test-google-client-id
export GOOGLE_CLIENT_SECRET=test-google-client-secret

run_npm_script lint:all
run_npm_script typecheck

run_npm_script test:guards

run_npm_script test:unit:all
run_npm_script test:integration:provider
run_npm_script test:billing:integration
run_npm_script test:billing:concurrency
run_npm_script test:integration:api
run_npm_script test:integration:chain
run_npm_script test:integration:task
run_npm_script test:system
run_npm_script test:regression:cases
run_npm_script test:mutation:incremental

run_npm_script build:verify

if [[ "${#FAILED_STEPS[@]}" -gt 0 ]]; then
  echo "verify:push failed. Failed steps:"
  for step in "${FAILED_STEPS[@]}"; do
    echo "  - ${step}"
  done
  exit 1
fi

echo "verify:push passed."
