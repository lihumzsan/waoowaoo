#!/usr/bin/env bash
set -euo pipefail

# This command intentionally contains no product-test schedule. Commit/push hooks
# remain limited to secret scanning; test execution policy is a separate phase.
node scripts/check-workspace-resource-writer.mjs
npm run lint:all
npm run typecheck
