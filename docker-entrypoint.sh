#!/bin/sh
set -eu

mkdir -p /app/data /app/logs
chown -R node:node /app/data /app/logs

exec gosu node "$@"
