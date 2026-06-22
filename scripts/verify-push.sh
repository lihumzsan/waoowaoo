#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  npm run test:services:stop || true
}

trap cleanup EXIT

npm run test:services:prepare

export TEST_SERVICES_EXTERNAL=1
export BILLING_TEST_KEEP_SERVICES=1

npm run lint:all
npm run typecheck
npm run test:all
npm run build:verify
