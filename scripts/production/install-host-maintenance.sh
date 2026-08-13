#!/bin/sh
set -eu

deploy_root=${1:-}
case "$deploy_root" in /*) ;; *) echo "Usage: install-host-maintenance.sh <absolute deploy root>" >&2; exit 2 ;; esac
deploy_root=${deploy_root%/}
if [ -z "$deploy_root" ] || [ "$deploy_root" = / ] || [ ! -d "$deploy_root" ]; then
  echo "Deploy root is unsafe or missing" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Install must run as root" >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
if ! sh "$repo_root/scripts/production/install-local-registry.sh" --check; then
  echo "Reconcile the local Registry before enabling automatic maintenance" >&2
  exit 1
fi
timer_was_installed=false
if systemctl is-enabled waoowaoo-host-maintenance.timer >/dev/null 2>&1; then
  timer_was_installed=true
fi
install -d -m 0755 /usr/local/lib/waoowaoo /etc/waoowaoo
install -m 0755 "$repo_root/scripts/production/host-maintenance.sh" \
  /usr/local/lib/waoowaoo/host-maintenance.sh
install -m 0755 "$repo_root/scripts/production/registry-maintenance.sh" \
  /usr/local/lib/waoowaoo/registry-maintenance.sh
install -m 0755 "$repo_root/scripts/production/mysql-binlog-maintenance.sh" \
  /usr/local/lib/waoowaoo/mysql-binlog-maintenance.sh
install -m 0755 "$repo_root/scripts/production/mysql-backup-maintenance.sh" \
  /usr/local/lib/waoowaoo/mysql-backup-maintenance.sh
install -m 0644 "$repo_root/ops/systemd/waoowaoo-host-maintenance.service" \
  /etc/systemd/system/waoowaoo-host-maintenance.service
install -m 0644 "$repo_root/ops/systemd/waoowaoo-host-maintenance.timer" \
  /etc/systemd/system/waoowaoo-host-maintenance.timer
printf 'WAO_DEPLOY_ROOT=%s\n' "$deploy_root" > /etc/waoowaoo/maintenance.env
chmod 0600 /etc/waoowaoo/maintenance.env
systemctl daemon-reload
systemctl enable --now waoowaoo-host-maintenance.timer
if [ "$timer_was_installed" = false ]; then
  systemctl start waoowaoo-host-maintenance.service
fi
systemctl status --no-pager waoowaoo-host-maintenance.timer
