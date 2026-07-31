#!/bin/sh
set -eu

: "${MYSQL_SEEDS:?MYSQL_SEEDS is required}"
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${SQL_PASSWORD:?SQL_PASSWORD is required}"

DB_PORT=${DB_PORT:-3306}

setup_database() {
  database_name=$1
  schema_directory=$2

  echo "Ensuring Temporal base schema exists in '${database_name}'..."
  if temporal-sql-tool \
    --plugin mysql8 \
    --ep "$MYSQL_SEEDS" \
    -u "$MYSQL_USER" \
    -p "$DB_PORT" \
    --db "$database_name" \
    setup-schema -v 0.0
  then
    echo "Initialized base schema in '${database_name}'."
  else
    echo "Base schema in '${database_name}' was already initialized; validating and upgrading it."
  fi

  temporal-sql-tool \
    --plugin mysql8 \
    --ep "$MYSQL_SEEDS" \
    -u "$MYSQL_USER" \
    -p "$DB_PORT" \
    --db "$database_name" \
    update-schema -d "$schema_directory"
}

setup_database \
  temporal \
  /etc/temporal/schema/mysql/v8/temporal/versioned
setup_database \
  temporal_visibility \
  /etc/temporal/schema/mysql/v8/visibility/versioned

echo "Temporal MySQL schemas are at the version required by this Admin Tools image."
