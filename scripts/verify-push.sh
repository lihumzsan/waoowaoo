#!/usr/bin/env bash
set -euo pipefail

# Bounded static verification shared by GitHub CI and the local pre-push hook.
# Product/infrastructure test scheduling remains a separate verification phase.
node scripts/check-workspace-resource-writer.mjs
npm run architecture:failure-governance
npm run lint:all
npm run typecheck
