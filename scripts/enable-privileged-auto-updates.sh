#!/usr/bin/env bash
# One-time operator migration from fixed root packages to automatic versioned
# privileged releases. NEVER run through the ordinary Web/MCP terminal.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
ROOT=/opt/linux-panel
WORKER=/usr/local/libexec/linux-panel-update-worker
STATE=/var/lib/linux-panel-update-root
WATCHER=linux-panel-update.path
MODE="__unset__"
usage(){ cat <<'EOF'
Usage: sudo bash scripts/enable-privileged-auto-updates.sh --check
       sudo bash scripts/enable-privileged-auto-updates.sh --enable
--check: read-only compatibility check
--enable: one-time migration of installed root package + fixed Broker worker
         (preserves existing state, remote pin, approval and policy gates).
Do not run during an update/recovery transaction. Requires reviewed clean main.
EOF
}
for arg in "$@";do
  case "$arg" in
    --check|--enable) [[ "$MODE" == __unset__ ]] || exit 2;MODE="$arg";;
    --help|-h)usage;exit 0;;
    *)usage;exit 2;;
  esac
done
[[ "$MODE" != __unset__ ]] || { usage;exit 2; }
((EUID==0)) || { echo 'Requires root/sudo' >&2;exit 1; }
[[ -f "$WORKER" && ! -L "$WORKER" && "$(stat -c %u "$WORKER")" == 0 &&
   -f "$STATE/panel-state.before-broker.json" &&
   -f /etc/systemd/system/linux-panel-update.service &&
   -f /etc/systemd/system/linux-panel-update-recover.service &&
   -d /usr/local/lib/linux-panel-privileged &&
   ! -L /usr/local/lib/linux-panel-privileged ]] ||
 { echo 'Both root Broker and root Actions must already be installed' >&2;exit 1; }
[[ ! -e "$STATE/active-transaction" && ! -L "$STATE/active-transaction" &&
   ! -e /var/lib/linux-panel/update-processing &&
   ! -e /var/lib/linux-panel/update-trigger ]] ||
 { echo 'Outstanding update/recovery transaction; refusing migration' >&2;exit 1; }
SHA="$(runuser -u linuxpanel-updater -- git -C "$ROOT" rev-parse HEAD)"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
[[ "$(runuser -u linuxpanel-updater -- git -C "$ROOT" branch --show-current)" == main &&
   -z "$(runuser -u linuxpanel-updater -- git -C "$ROOT" status --porcelain)" ]] ||
 { echo 'Requires clean main checkout' >&2;exit 1; }
[[ "$(runuser -u linuxpanel-updater -- git -C "$ROOT" remote get-url origin)" == \
   "$(cat /etc/linux-panel/update-source)" ]] ||
 { echo 'Configured immutable origin pin mismatch' >&2;exit 1; }
for source in scripts/update-worker.sh scripts/install-privileged-executor.sh \
  deployment/systemd/linux-panel-privileged.service \
  deployment/systemd/linux-panel-update.service \
  deployment/systemd/linux-panel-update-recover.service;do
  [[ -f "$ROOT/$source" && ! -L "$ROOT/$source" ]] || exit 1
done
if [[ "$MODE" == --check ]];then
  echo "PASS installed root components + clean main at $SHA; no host changes"
  exit 0
fi
# This operator action is intentionally outside the immutable Broker.
# No Web/MCP API can supply a script, target path, command or package.
BACKUP="$(mktemp -d "$STATE/.privileged-bootstrap.XXXXXXXX")"
install -o root -g root -m 0755 "$WORKER" "$BACKUP/worker"
for name in linux-panel-update.service linux-panel-update-recover.service;do
  install -o root -g root -m 0644 "/etc/systemd/system/$name" "$BACKUP/$name"
done
WAS_WATCHING=0
if systemctl is-active --quiet "$WATCHER";then WAS_WATCHING=1;fi
systemctl stop "$WATCHER"
restore_broker(){
  local code=$?
  if ((code!=0));then
    install -o root -g root -m 0755 "$BACKUP/worker" "$WORKER" || true
    for name in linux-panel-update.service linux-panel-update-recover.service;do
      install -o root -g root -m 0644 "$BACKUP/$name" "/etc/systemd/system/$name" || true
    done
    systemctl daemon-reload || true
    echo 'Root Broker files restored after failed bootstrap; inspect root Actions service' >&2
  fi
  if ((WAS_WATCHING));then systemctl start "$WATCHER" || true;fi
}
trap restore_broker EXIT
# Install only the fixed reviewed root package; it cannot write arbitrary
# systemd services and doesn't touch any existing cron jobs.
bash "$ROOT/scripts/install-privileged-executor.sh" --enable
install -o root -g root -m 0755 "$ROOT/scripts/update-worker.sh" "$WORKER"
for name in linux-panel-update.service linux-panel-update-recover.service;do
  install -o root -g root -m 0644 "$ROOT/deployment/systemd/$name" "/etc/systemd/system/$name"
done
systemctl daemon-reload
[[ "$(systemctl show -P ProtectSystem linux-panel-update.service)" == strict ]] || exit 1
[[ "$(systemctl show -P ReadWritePaths linux-panel-update.service)" == *"/usr/local/lib/linux-panel-privileged"* ]] || exit 1
[[ "$(readlink /usr/local/lib/linux-panel-privileged/current)" == "releases/$SHA" ]] || exit 1
systemctl is-active --quiet linux-panel.service
systemctl is-active --quiet linux-panel-privileged.service
echo "PASS operator bootstrap: current root package + immutable Broker at $SHA"
