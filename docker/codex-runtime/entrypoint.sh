#!/bin/sh
set -eu

: "${CODEX_HOME:=/runtime/codex-home}"
export CODEX_HOME
export HOME="$CODEX_HOME"
export XDG_CACHE_HOME=/tmp/cache
export NPM_CONFIG_CACHE=/tmp/npm-cache
export PYTHONPYCACHEPREFIX=/tmp/pycache

test -d /workspace
test -w /workspace
test -d "$CODEX_HOME"
test -w "$CODEX_HOME"

umask 077
exec codex --dangerously-bypass-hook-trust app-server --listen stdio:// --enable code_mode_host "$@"
