#!/bin/sh
set -eu

output=${1:-.env}
template=${WAO_ENV_TEMPLATE:-.env.example}

if [ ! -f "$template" ]; then
  echo "Environment template does not exist: $template" >&2
  exit 1
fi
if [ -e "$output" ]; then
  echo "Refusing to overwrite existing environment file: $output" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate deployment secrets" >&2
  exit 1
fi

umask 077
mysql_password=$(openssl rand -hex 24)
mysql_root_password=$(openssl rand -hex 24)
redis_password=$(openssl rand -hex 24)
temporal_mysql_password=$(openssl rand -hex 24)
nextauth_secret=$(openssl rand -hex 32)
cron_secret=$(openssl rand -hex 32)
api_encryption_key=$(openssl rand -hex 32)
runtime_root=$(pwd)/data/codex-runtime
database_scheme='mysql://'
host_database_url="${database_scheme}waoowaoo:${mysql_password}@127.0.0.1:13306/waoowaoo"
compose_database_url="${database_scheme}waoowaoo:${mysql_password}@mysql:3306/waoowaoo"
temporary_output="${output}.tmp.$$"
trap 'rm -f "$temporary_output"' EXIT HUP INT TERM

mkdir -p "$runtime_root"

while IFS= read -r line || [ -n "$line" ]; do
  key=${line%%=*}
  case "$key" in
    DATABASE_URL)
      printf '%s=%s\n' "$key" "$host_database_url"
      ;;
    COMPOSE_DATABASE_URL)
      printf '%s=%s\n' "$key" "$compose_database_url"
      ;;
    MYSQL_PASSWORD) printf '%s=%s\n' "$key" "$mysql_password" ;;
    MYSQL_ROOT_PASSWORD) printf '%s=%s\n' "$key" "$mysql_root_password" ;;
    REDIS_PASSWORD) printf '%s=%s\n' "$key" "$redis_password" ;;
    TEMPORAL_MYSQL_PASSWORD) printf '%s=%s\n' "$key" "$temporal_mysql_password" ;;
    NEXTAUTH_SECRET) printf '%s=%s\n' "$key" "$nextauth_secret" ;;
    CRON_SECRET) printf '%s=%s\n' "$key" "$cron_secret" ;;
    API_ENCRYPTION_KEY) printf '%s=%s\n' "$key" "$api_encryption_key" ;;
    CODEX_RUNTIME_HOST_ROOT) printf '%s=%s\n' "$key" "$runtime_root" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$template" > "$temporary_output"

mv "$temporary_output" "$output"
trap - EXIT HUP INT TERM

echo "Created $output with generated local secrets."
echo "Next: configure S3_* values and, for production, immutable image digests."
