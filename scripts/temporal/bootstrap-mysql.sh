#!/bin/sh
set -eu

: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
: "${TEMPORAL_MYSQL_PASSWORD:?TEMPORAL_MYSQL_PASSWORD is required}"

MYSQL_HOST=${MYSQL_HOST:-127.0.0.1}
MYSQL_PORT=${MYSQL_PORT:-3306}
TEMPORAL_MYSQL_USER=${TEMPORAL_MYSQL_USER:-temporal}

case "$TEMPORAL_MYSQL_USER" in
  ''|*[!A-Za-z0-9_]*)
    echo "TEMPORAL_MYSQL_USER must contain only letters, digits, and underscores" >&2
    exit 1
    ;;
esac

if [ "${#TEMPORAL_MYSQL_USER}" -gt 32 ]; then
  echo "TEMPORAL_MYSQL_USER must not exceed 32 characters" >&2
  exit 1
fi

temporal_password_base64=$(
  printf '%s' "$TEMPORAL_MYSQL_PASSWORD" | base64 | tr -d '\n'
)

echo "Creating Temporal MySQL schemas and dedicated user if needed..."

MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql \
  --protocol=TCP \
  --host="$MYSQL_HOST" \
  --port="$MYSQL_PORT" \
  --user=root <<SQL
CREATE DATABASE IF NOT EXISTS \`temporal\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE DATABASE IF NOT EXISTS \`temporal_visibility\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

SET @temporal_password =
  CONVERT(FROM_BASE64('${temporal_password_base64}') USING utf8mb4);
SET @create_user_statement = CONCAT(
  'CREATE USER IF NOT EXISTS ''${TEMPORAL_MYSQL_USER}''@''%'' IDENTIFIED BY ',
  QUOTE(@temporal_password)
);
PREPARE create_temporal_user FROM @create_user_statement;
EXECUTE create_temporal_user;
DEALLOCATE PREPARE create_temporal_user;

SET @alter_user_statement = CONCAT(
  'ALTER USER ''${TEMPORAL_MYSQL_USER}''@''%'' IDENTIFIED BY ',
  QUOTE(@temporal_password)
);
PREPARE alter_temporal_user FROM @alter_user_statement;
EXECUTE alter_temporal_user;
DEALLOCATE PREPARE alter_temporal_user;

GRANT ALL PRIVILEGES ON \`temporal\`.* TO '${TEMPORAL_MYSQL_USER}'@'%';
GRANT ALL PRIVILEGES ON \`temporal_visibility\`.* TO '${TEMPORAL_MYSQL_USER}'@'%';
SQL

echo "Temporal MySQL schemas and dedicated user are ready."
