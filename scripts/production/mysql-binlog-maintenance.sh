#!/bin/sh
set -eu

mode=${1:---check}
case "$mode" in --check|--apply) ;; *) echo "Usage: mysql-binlog-maintenance.sh [--check|--apply]" >&2; exit 2 ;; esac
deploy_root=${WAO_DEPLOY_ROOT:-}
case "$deploy_root" in /*) ;; *) echo "WAO_DEPLOY_ROOT must be absolute" >&2; exit 1 ;; esac
deploy_root=${deploy_root%/}
if [ -z "$deploy_root" ] || [ "$deploy_root" = / ] || [ ! -d "$deploy_root" ]; then
  echo "WAO_DEPLOY_ROOT is unsafe or missing" >&2
  exit 1
fi

env_file="$deploy_root/.env.production"
compose_file="$deploy_root/docker-compose.yml"
cloud_file="$deploy_root/docker-compose.cloud.yml"
export COMPOSE_ENV_FILES="$env_file"
export COMPOSE_FILE="$compose_file:$cloud_file"
export COMPOSE_PROJECT_NAME=${WAO_COMPOSE_PROJECT_NAME:-waoowaoo-prod}

mysql_exec() {
  docker compose exec -T mysql sh -ec \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --batch --skip-column-names --user=root "$MYSQL_DATABASE" -e "$1"' \
    sh "$1"
}

# MySQL exposes the authoritative binary-log inventory through SHOW BINARY
# LOGS. The command output remains inside this substitution and only the
# aggregate is printed; credentials are set inside the database container.
summary=$(mysql_exec "SHOW BINARY LOGS" \
  | awk '{count += 1; bytes += $2} END {print count, bytes}')
echo "MYSQL_BINLOG count_bytes=$summary"

if [ "$mode" = --apply ]; then
  retention_days=${WAO_MYSQL_BINLOG_RETENTION_DAYS:-}
  backup_marker=${WAO_MYSQL_BACKUP_MARKER:-}
  case "$retention_days" in ''|*[!0-9]*|0) echo "WAO_MYSQL_BINLOG_RETENTION_DAYS is required and must be positive" >&2; exit 1 ;; esac
  case "$backup_marker" in "$deploy_root"/*) ;; *) echo "WAO_MYSQL_BACKUP_MARKER must be inside WAO_DEPLOY_ROOT" >&2; exit 1 ;; esac
  if [ ! -f "$backup_marker" ] || [ -L "$backup_marker" ]; then
    echo "A verified backup marker is required before purging binlogs" >&2
    exit 1
  fi
  max_backup_age_hours=${WAO_MYSQL_BACKUP_MAX_AGE_HOURS:-30}
  marker_age_seconds=$(( $(date +%s) - $(stat -c %Y "$backup_marker") ))
  if [ "$marker_age_seconds" -gt $((max_backup_age_hours * 3600)) ]; then
    echo "Verified backup marker is too old" >&2
    exit 1
  fi
  mysql_exec "PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL $retention_days DAY);"
  echo "MYSQL_BINLOG_PURGE_COMPLETE retention_days=$retention_days"
fi
