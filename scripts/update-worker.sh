#!/usr/bin/env bash
# Installed as /usr/local/libexec/linux-panel-update-worker, root-owned 0755.
# This fixed broker intentionally accepts NO command-line arguments.
set -Eeuo pipefail
# Root commands must NEVER resolve executables from the updater-owned checkout.
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
ROOT=/opt/linux-panel
STATE=/var/lib/linux-panel
MARKER="$STATE/update-trigger"
PROCESSING="$STATE/update-processing"
RESULT="$STATE/update-result"
EXPECTED_REMOTE=/etc/linux-panel/update-source
USER=linuxpanel-updater
log(){ printf '[lp-update] %s\n' "$*"; }
as_updater(){ /usr/sbin/runuser -u "$USER" -- /usr/bin/env PATH=/opt/linux-panel/runtime:/usr/local/bin:/usr/bin:/bin "$@"; }
record(){
  local status="$1"
  printf '{"id":"%s","sha":"%s","status":"%s","at":"%s"}\n' "$ID" "$TARGET" "$status" "$(date -u +%FT%TZ)" > "$RESULT"
  chmod 0600 "$RESULT"
  chown linuxpanel:linuxpanel "$RESULT"
}
[[ "$#" -eq 0 && "$EUID" -eq 0 ]] || exit 2
exec 9> "$STATE/update-worker.lock"
flock -n 9 || exit 0
[[ -f "$MARKER" && ! -L "$MARKER" && ! -e "$PROCESSING" ]] || exit 0
mv -- "$MARKER" "$PROCESSING"
trap 'rm -f -- "$PROCESSING"' EXIT
[[ -f "$PROCESSING" && ! -L "$PROCESSING" ]] || exit 2
[[ "$(wc -l < "$PROCESSING")" -eq 2 ]] || exit 2
IFS= read -r idline < "$PROCESSING"
IFS= read -r shaline < <(sed -n '2p' "$PROCESSING")
ID="${idline#id=}"
TARGET="${shaline#sha=}"
[[ "$idline" == "id=$ID" && "$shaline" == "sha=$TARGET" &&
   "$ID" =~ ^[0-9a-f]{32}$ && "$TARGET" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ -f "$EXPECTED_REMOTE" && ! -L "$EXPECTED_REMOTE" ]] || { record failed;exit 2; }
EXPECTED="$(cat "$EXPECTED_REMOTE")"
[[ "$EXPECTED" =~ ^(https://github\.com/[^[:space:]]+\.git|git@github\.com:[^[:space:]]+\.git)$ ]] || { record failed;exit 2; }
[[ "$(as_updater git -C "$ROOT" remote get-url origin)" == "$EXPECTED" ]] || { record failed;exit 2; }
[[ "$(as_updater git -C "$ROOT" branch --show-current)" == main ]] || { record failed;exit 2; }
[[ -z "$(as_updater git -C "$ROOT" status --porcelain)" ]] || { record failed;exit 2; }
OLD="$(as_updater git -C "$ROOT" rev-parse HEAD)"
[[ "$OLD" =~ ^[a-f0-9]{40}$ ]] || { record failed;exit 2; }
log "Fetch pinned origin/main commit $TARGET"
as_updater git -C "$ROOT" fetch --no-tags origin main || { record failed;exit 2; }
REMOTE="$(as_updater git -C "$ROOT" rev-parse refs/remotes/origin/main)"
[[ "$REMOTE" == "$TARGET" ]] || {record failed;exit 2;}
if [[ "$OLD" == "$TARGET" ]];then record no_change;exit 0;fi
as_updater git -C "$ROOT" merge-base --is-ancestor "$OLD" "$TARGET" || {record failed;exit 2;}
# Non-root updater executes all potentially untrusted Git and npm code.
# The root broker only stops/starts the fixed systemd unit and backs up state.
systemctl stop linux-panel.service
cp -a "$STATE/panel-state.json" "$STATE/panel-state.json.before-$OLD"
chmod 0600 "$STATE/panel-state.json.before-$OLD"
build(){
  as_updater git -C "$ROOT" merge --ff-only "$TARGET" || return 1
  (cd "$ROOT" && as_updater npm ci --no-audit --no-fund &&
    as_updater npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock &&
    as_updater npm run check && as_updater npm test && as_updater npm run build:web)
}
rollback(){
  log "Update failed; stopping the new version, restoring state and rebuilding old code"
  local restored=1
  systemctl stop linux-panel.service || restored=0
  as_updater git -C "$ROOT" reset --hard "$OLD" || restored=0
  (cd "$ROOT" && as_updater npm ci --no-audit --no-fund &&
    as_updater npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock &&
    as_updater npm run build:web) || restored=0
  cp -a "$STATE/panel-state.json.before-$OLD" "$STATE/panel-state.json" || restored=0
  systemctl start linux-panel.service || restored=0
  systemctl is-active --quiet linux-panel.service || restored=0
  if [[ "$restored" -eq 1 ]]; then record rolled_back;else record failed;fi
}
if ! build;then rollback;exit 1;fi
if ! systemctl start linux-panel.service || ! systemctl is-active --quiet linux-panel.service;then
  rollback
  exit 1
fi
# Probe a protected-host-compatible public status endpoint after restart.
ORIGIN="$(sed -n 's/^PANEL_PUBLIC_ORIGIN=//p' /etc/linux-panel/panel.env | tail -n 1)"
HOST="${ORIGIN#https://}"
if [[ -z "$HOST" || "$HOST" == "$ORIGIN" ]] ||
   ! curl --silent --show-error --fail --max-time 8 -H "Host: $HOST" \
    http://127.0.0.1:4188/api/auth/status >/dev/null;then
  rollback
  exit 1
fi
record success
log "Updated to $TARGET"
