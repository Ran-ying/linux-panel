#!/usr/bin/env bash
# Installed as /usr/local/libexec/linux-panel-update-worker, root-owned 0755.
# This fixed broker intentionally accepts NO command-line arguments.
set -Eeuo pipefail
# Root commands must NEVER resolve executables from the updater-owned checkout.
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
ROOT=/opt/linux-panel
STATE=/var/lib/linux-panel
ROOT_BACKUP=/var/lib/linux-panel-update-root
MARKER="$STATE/update-trigger"
PROCESSING="$STATE/update-processing"
RESULT=/var/lib/linux-panel-update-status/result.json
EXPECTED_REMOTE=/etc/linux-panel/update-source
TXN="$ROOT_BACKUP/active-transaction"
USER=linuxpanel-updater
log(){ printf '[lp-update] %s\n' "$*"; }
## Prefer root-owned isolated Node24 if installed; preserve fallback for other supported hosts.
as_updater(){ /usr/bin/setpriv --reuid="$USER" --regid="$USER" --init-groups --inh-caps=-all --no-new-privs -- /usr/bin/env -i HOME=/var/lib/linux-panel-updater USER="$USER" LOGNAME="$USER" GIT_TERMINAL_PROMPT=0 PATH=/opt/node24/bin:/opt/linux-panel/runtime:/usr/local/bin:/usr/bin:/bin "$@"; }
record(){
  local status="$1" tmp
  tmp="$(mktemp "$ROOT_BACKUP/.update-result.XXXXXXXX")"
  printf '{"id":"%s","sha":"%s","status":"%s","at":"%s"}\n' "$ID" "$TARGET" "$status" "$(date -u +%FT%TZ)" > "$tmp"
  chmod 0640 "$tmp"
  chown root:linuxpanel "$tmp"
  mv -fT -- "$tmp" "$RESULT"
}
MODE=normal
if [[ "$#" -eq 1 && "$1" == --recover-only ]];then MODE=recover
elif [[ "$#" -ne 0 ]];then exit 2;fi
[[ "$EUID" -eq 0 ]] || exit 2
exec 9> /run/linux-panel-root-updater/update.lock
flock -n 9 || exit 2
# Do not erase crash evidence on failure.
trap 'if [[ ! -e "$TXN" ]];then rm -f -- "$PROCESSING";fi' EXIT
journal(){
  local tmp
  [[ ! -e "$TXN" && ! -L "$TXN" ]] || return 1
  tmp="$(mktemp "$ROOT_BACKUP/.pending-transaction.XXXXXXXX")" || return 1
  printf 'id=%s\nsha=%s\nold=%s\n' "$ID" "$TARGET" "$OLD" > "$tmp"
  chmod 0600 "$tmp"
  chown root:root "$tmp"
  mv -nT -- "$tmp" "$TXN" || { rm -f -- "$tmp"; return 1; }
}
recover(){
  local idline shaline oldline current='' backup='' restored=1
  if [[ ! -e "$TXN" && ! -L "$TXN" ]];then
    if [[ -f "$PROCESSING" && ! -L "$PROCESSING" ]];then
      idline="$(sed -n '1p' "$PROCESSING")"
      shaline="$(sed -n '2p' "$PROCESSING")"
      ID="${idline#id=}";TARGET="${shaline#sha=}"
      if [[ "$idline" == "id=$ID" && "$shaline" == "sha=$TARGET" &&
            "$ID" =~ ^[a-f0-9]{32}$ && "$TARGET" =~ ^[a-f0-9]{40}$ ]];then
        record failed
        rm -f -- "$PROCESSING"
      else
        log 'Invalid abandoned processing marker; manual review required'
        return 1
      fi
    fi
    return 0
  fi
  [[ -f "$TXN" && ! -L "$TXN" && "$(stat -c %u:%a "$TXN")" == 0:600 &&
     "$(wc -l < "$TXN")" -eq 3 ]] || { log 'Unsafe recovery journal';return 1; }
  idline="$(sed -n '1p' "$TXN")";shaline="$(sed -n '2p' "$TXN")"
  oldline="$(sed -n '3p' "$TXN")"
  ID="${idline#id=}";TARGET="${shaline#sha=}";OLD="${oldline#old=}"
  [[ "$idline" == "id=$ID" && "$shaline" == "sha=$TARGET" &&
     "$oldline" == "old=$OLD" && "$ID" =~ ^[a-f0-9]{32}$ &&
     "$TARGET" =~ ^[a-f0-9]{40}$ && "$OLD" =~ ^[a-f0-9]{40}$ ]] ||
      { log 'Corrupt recovery journal';return 1; }
  backup="$ROOT_BACKUP/panel-state.json.before-$OLD-$ID"
  current="$(as_updater git -C "$ROOT" rev-parse HEAD 2>/dev/null)" || return 1
  # Success is durable only after authenticated root result and matching HEAD.
  if [[ -f "$RESULT" && ! -L "$RESULT" ]] &&
     grep -Fq "\"id\":\"$ID\"" "$RESULT" &&
     grep -Fq "\"sha\":\"$TARGET\"" "$RESULT" &&
     grep -Fq '"status":"success"' "$RESULT" &&
     [[ "$current" == "$TARGET" ]];then
    rm -f -- "$TXN" "$PROCESSING"
    log "Previously committed deployment $ID cleaned up"
    return 0
  fi
  log "Recovering unfinished Broker transaction $ID"
  if [[ "$current" != "$OLD" && ! -f "$backup" ]];then
    log 'No usable backup after checkout change: manual intervention required'
    record failed
    return 1
  fi
  systemctl stop linux-panel.service || restored=0
  as_updater git -C "$ROOT" reset --hard "$OLD" || restored=0
  if [[ -f "$backup" && ! -L "$backup" &&
        "$(stat -c %u:%a "$backup")" == 0:600 ]];then
    (cd "$ROOT" && as_updater npm ci --no-audit --no-fund &&
     as_updater npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock &&
     as_updater npm run build:web) || restored=0
    local restore_tmp=''
    restore_tmp="$(mktemp "$STATE/.restore-state.XXXXXXXX")" || restored=0
    if [[ -n "$restore_tmp" ]];then
      cp -- "$backup" "$restore_tmp" || restored=0
      chmod 0600 "$restore_tmp" || restored=0
      chown linuxpanel:linuxpanel "$restore_tmp" || restored=0
      mv -fT -- "$restore_tmp" "$STATE/panel-state.json" || restored=0
    fi
  elif [[ "$current" != "$OLD" ]];then
    restored=0
  fi
  systemctl start linux-panel.service || restored=0
  systemctl is-active --quiet linux-panel.service || restored=0
  if ((restored==1));then
    record rolled_back
    rm -f -- "$TXN" "$PROCESSING"
    log "Recovered $ID and restored old version"
    return 0
  fi
  record failed
  log "Recovery FAILED for $ID; retaining journal for operator review/retry"
  return 1
}
if [[ "$MODE" == recover ]];then
  recover
  exit $?
fi
if [[ -e "$TXN" || -L "$TXN" || -e "$PROCESSING" || -L "$PROCESSING" ]];then
  log 'Recovery required; denying new deployment'
  exit 2
fi
[[ -f "$MARKER" && ! -L "$MARKER" ]] || exit 0
mv -T -- "$MARKER" "$PROCESSING"
[[ -f "$PROCESSING" && ! -L "$PROCESSING" ]] || exit 2
# The marker is untrusted input. Read only a small fixed format; reject
# oversized, symlinked, or non-regular files instead of parsing arbitrary data.
[[ "$(stat -c %s "$PROCESSING")" -le 1024 ]] || exit 2
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
[[ "$REMOTE" == "$TARGET" ]] || { record failed; exit 2; }
if [[ "$OLD" == "$TARGET" ]];then record no_change;exit 0;fi
as_updater git -C "$ROOT" merge-base --is-ancestor "$OLD" "$TARGET" || { record failed; exit 2; }
# Refuse a high-risk in-place npm rebuild if the disk is nearly full.
[[ "$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')" -ge 1048576 ]] ||
  { log 'Less than 1 GiB free; no update attempted'; record failed; exit 2; }
# Non-root updater executes all potentially untrusted Git and npm code.
# The root broker only stops/starts the fixed systemd unit and backs up state.
[[ -f "$STATE/panel-state.json" && ! -L "$STATE/panel-state.json" ]] || { record failed;exit 2; }
[[ -d "$ROOT_BACKUP" && ! -L "$ROOT_BACKUP" && "$(stat -c %u "$ROOT_BACKUP")" -eq 0 ]] || { record failed;exit 2; }
# Each request gets an independent backup to support retry from one SHA.
# Stop first to guarantee a consistent private state snapshot; on any snapshot
# failure restart the old service instead of leaving it down.
BACKUP="$ROOT_BACKUP/panel-state.json.before-$OLD-$ID"
[[ ! -e "$BACKUP" && ! -L "$BACKUP" ]] || { record failed; exit 2; }
# Write root-only transaction before potentially stopping the panel.
if ! journal;then
  record failed
  exit 2
fi
if ! systemctl stop linux-panel.service;then
  systemctl start linux-panel.service || true
  record failed
  exit 2
fi
# Do not preserve the Web user's owner/mode with cp -a: the root Broker
# deliberately lacks CAP_FOWNER and cannot chmod a linuxpanel-owned copy.
# Create a new root-owned 0600 snapshot instead.
if ! install -o root -g root -m 0600 -- "$STATE/panel-state.json" "$BACKUP";then
  systemctl start linux-panel.service || true
  record failed
  exit 2
fi
build(){
  as_updater git -C "$ROOT" merge --ff-only "$TARGET" || return 1
  (cd "$ROOT" && as_updater npm ci --no-audit --no-fund &&
    as_updater npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock &&
    as_updater npm run check &&
    as_updater /usr/bin/env PANEL_UPDATE_RESULT=/var/lib/linux-panel-updater/.isolated-test-broker-result npm test &&
    as_updater npm run build:web)
}
rollback(){ recover; }
if ! build;then rollback;exit 1;fi
if ! systemctl start linux-panel.service || ! systemctl is-active --quiet linux-panel.service;then
  rollback
  exit 1
fi
# Probe the configured listener, not a hard-coded 4188.
# The state is untrusted for executable purposes; only validated numeric port
# and exact configured HTTP Host are ever used with curl.
PANEL_ENV=/etc/linux-panel/panel.env
DEFAULT_PORT="$(sed -n 's/^PANEL_LISTEN_PORT=//p' "$PANEL_ENV" | tail -n 1)"
[[ "$DEFAULT_PORT" =~ ^[0-9]{4,5}$ ]] || DEFAULT_PORT=4188
# StateStore serializes top-level listener with the host and port on adjacent
# pretty-printed JSON lines. Refuse malformed overrides rather than using them.
OVERRIDE_PORT="$(awk '
  /^[[:space:]]*"listener":[[:space:]]*\{/ { in_listener=1; next }
  in_listener && /^[[:space:]]*\}/ { exit }
  in_listener && /^[[:space:]]*"port":[[:space:]]*[0-9]+[,[:space:]]*$/ {
    gsub(/[^0-9]/,"",$2); print $2; exit
  }
' "$STATE/panel-state.json")"
PROBE_PORT="${OVERRIDE_PORT:-$DEFAULT_PORT}"
[[ "$PROBE_PORT" =~ ^[0-9]{4,5}$ ]] && ((PROBE_PORT>=1024 && PROBE_PORT<=65535)) ||
  { rollback; exit 1; }
ORIGIN="$(sed -n 's/^PANEL_PUBLIC_ORIGIN=//p' "$PANEL_ENV" | tail -n 1)"
[[ -n "$ORIGIN" ]] || ORIGIN="http://127.0.0.1:$PROBE_PORT"
HOST="${ORIGIN#http://}"
HOST="${HOST#https://}"
if [[ -z "$HOST" || "$HOST" == "$ORIGIN" ]];then
  rollback
  exit 1
fi
# systemctl start only means the process was spawned, not that Fastify
# finished binding its listener. Give the application a bounded readiness
# window before declaring an otherwise successful deployment broken.
ready=0
for attempt in $(seq 1 20);do
  if curl --silent --show-error --fail --max-time 4 -H "Host: $HOST" \
      "http://127.0.0.1:$PROBE_PORT/api/auth/status" >/dev/null;then
    ready=1
    break
  fi
  sleep 1
done
if ((ready==0));then
  rollback
  exit 1
fi
record success
rm -f -- "$TXN"
log "Updated to $TARGET"
