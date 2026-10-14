#!/usr/bin/env bash
# Installed as /usr/local/libexec/linux-panel-update-worker, root-owned 0755.
# This fixed broker intentionally accepts NO command-line arguments.
set -Eeuo pipefail
umask 077
ROOT=/opt/linux-panel
STATE=/var/lib/linux-panel
MARKER="$STATE/update-trigger"
PROCESSING="$STATE/update-processing"
RESULT="$STATE/update-result"
EXPECTED_REMOTE=/etc/linux-panel/update-source
USER=linuxpanel-updater
log(){ printf '[lp-update] %s\n' "$*"; }
as_updater(){ runuser -u "$USER" -- "$@"; }
record(){
  local status="$1"
  printf '{"id":"%s","sha":"%s","status":"%s","at":"%s"}\n' "$ID" "$TARGET" "$status" "$(date -u +%FT%TZ)" > "$RESULT"
  chmod 0600 "$RESULT"
}
[[ "$#" -eq 0 && "$EUID" -eq 0 ]] || exit 2
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
  log "Update failed; restoring previous code and rebuilding"
  as_updater git -C "$ROOT" reset --hard "$OLD" || true
  (cd "$ROOT" && as_updater npm ci --no-audit --no-fund &&
    as_updater npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock &&
    as_updater npm run build:web) || true
  systemctl start linux-panel.service || true
  record rolled_back
}
if ! build;then rollback;exit 1;fi
if ! systemctl start linux-panel.service || ! systemctl is-active --quiet linux-panel.service;then
  rollback
  exit 1
fi
record success
log "Updated to $TARGET"
