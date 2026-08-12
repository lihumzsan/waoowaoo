#!/bin/sh
set -eu

mode=${1:---check}
case "$mode" in --check|--apply) ;; *) echo "Usage: mysql-backup-maintenance.sh [--check|--apply]" >&2; exit 2 ;; esac
deploy_root=${WAO_DEPLOY_ROOT:-}
case "$deploy_root" in /*) ;; *) echo "WAO_DEPLOY_ROOT must be absolute" >&2; exit 1 ;; esac
deploy_root=${deploy_root%/}
if [ -z "$deploy_root" ] || [ "$deploy_root" = / ] || [ ! -d "$deploy_root" ]; then
  echo "WAO_DEPLOY_ROOT is unsafe or missing" >&2
  exit 1
fi

backup_root="$deploy_root/backups/mysql"
marker="$backup_root/latest-verified"
retention_days=${WAO_MYSQL_BACKUP_RETENTION_DAYS:-7}
binlog_retention_days=${WAO_MYSQL_BINLOG_RETENTION_DAYS:-7}
case "$retention_days" in ''|*[!0-9]*|0) echo "WAO_MYSQL_BACKUP_RETENTION_DAYS must be positive" >&2; exit 1 ;; esac
case "$binlog_retention_days" in ''|*[!0-9]*|0) echo "WAO_MYSQL_BINLOG_RETENTION_DAYS must be positive" >&2; exit 1 ;; esac

if [ "$mode" = --check ]; then
  if [ ! -f "$marker" ] || [ -L "$marker" ]; then
    echo "MYSQL_BACKUP_MISSING"
    exit 1
  fi
  backup_file=$(sed -n '1p' "$marker")
  case "$backup_file" in "$backup_root"/*.sql.gz) ;; *) echo "MYSQL_BACKUP_MARKER_INVALID" >&2; exit 1 ;; esac
  [ -f "$backup_file" ] || { echo "MYSQL_BACKUP_FILE_MISSING" >&2; exit 1; }
  echo "MYSQL_BACKUP_OK file=$(basename "$backup_file") bytes=$(wc -c < "$backup_file" | tr -d ' ')"
  exit 0
fi

mkdir -p "$backup_root"
chmod 0700 "$backup_root"
exec 9>"$backup_root/.backup.lock"
flock -n 9 || { echo "MySQL backup is already running" >&2; exit 1; }

env_file="$deploy_root/.env.production"
compose_file="$deploy_root/docker-compose.yml"
cloud_file="$deploy_root/docker-compose.cloud.yml"
export COMPOSE_ENV_FILES="$env_file"
export COMPOSE_FILE="$compose_file:$cloud_file"
export COMPOSE_PROJECT_NAME=${WAO_COMPOSE_PROJECT_NAME:-waoowaoo-prod}

timestamp=$(date -u +%Y%m%d%H%M%S)
backup_file="$backup_root/all-databases-$timestamp.sql.gz"
temporary_file="$backup_file.partial"
fifo="$backup_root/.dump-$timestamp.fifo"
mkfifo "$fifo"
gzip_pid=''
cleanup() {
  if [ -n "$gzip_pid" ]; then
    kill "$gzip_pid" >/dev/null 2>&1 || true
    wait "$gzip_pid" >/dev/null 2>&1 || true
  fi
  rm -f "$fifo" "$temporary_file" "$temporary_file.sha256"
}
trap cleanup EXIT HUP INT TERM
gzip -9 < "$fifo" > "$temporary_file" &
gzip_pid=$!
if docker compose exec -T mysql sh -ec '
  MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump \
    --user=root \
    --all-databases \
    --single-transaction \
    --quick \
    --routines \
    --events \
    --triggers \
    --hex-blob \
    --set-gtid-purged=OFF
' > "$fifo"; then
  wait "$gzip_pid"
  gzip_pid=''
else
  wait "$gzip_pid" || true
  gzip_pid=''
  echo "MySQL dump failed" >&2
  exit 1
fi
rm -f "$fifo"
test -s "$temporary_file"
gzip -t "$temporary_file"
sha256sum "$temporary_file" > "$temporary_file.sha256"
mv "$temporary_file" "$backup_file"
mv "$temporary_file.sha256" "$backup_file.sha256"
chmod 0600 "$backup_file" "$backup_file.sha256"
printf '%s\n%s\n' "$backup_file" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$marker"
chmod 0600 "$marker"

find "$backup_root" -mindepth 1 -maxdepth 1 -type f \
  \( -name 'all-databases-*.sql.gz' -o -name 'all-databases-*.sql.gz.sha256' \) \
  -mtime "+$retention_days" -delete

WAO_DEPLOY_ROOT="$deploy_root" \
WAO_MYSQL_BACKUP_MARKER="$marker" \
WAO_MYSQL_BINLOG_RETENTION_DAYS="$binlog_retention_days" \
  sh "$(dirname "$0")/mysql-binlog-maintenance.sh" --apply

trap - EXIT HUP INT TERM
echo "MYSQL_BACKUP_COMPLETE file=$backup_file"
