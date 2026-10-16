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
ALLOW_START=/run/linux-panel-root-updater/allow-panel-start
USER=linuxpanel-updater
log(){ printf '[lp-update] %s\n' "$*"; }
# Explicit fsync for both file contents and directory metadata. Python runs
# isolated from PYTHONPATH/user site packages and loads no checkout modules.
# This helper is part of the immutable root worker, not a user-supplied script.
durable_sync(){
  local kind="$1" path="$2"
  [[ "$kind" == file || "$kind" == dir ]] || return 1
  /usr/bin/python3 -I -c '
import os, sys
flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
if sys.argv[1] == "dir":
    flags |= os.O_DIRECTORY
fd = os.open(sys.argv[2], flags)
try:
    os.fsync(fd)
finally:
    os.close(fd)
' "$kind" "$path"
}
# Clear the in-flight marker durably BEFORE removing the journal: after a crash
# a leftover processing marker without journal could otherwise overwrite an
# already-committed success result with a spurious failed recovery.
finish_transaction(){
  # Do not erase the root journal when processing-marker deletion or its
  # directory fsync fails. Otherwise a crash can lose the commit barrier.
  rm -f -- "$PROCESSING" || return 1
  durable_sync dir "$STATE" || return 1
  rm -f -- "$TXN" || return 1
  durable_sync dir "$ROOT_BACKUP"
}
## Prefer root-owned isolated Node24 if installed; preserve fallback for other supported hosts.
as_updater(){ /usr/bin/setpriv --reuid="$USER" --regid="$USER" --init-groups --inh-caps=-all --no-new-privs -- /usr/bin/env -i HOME=/var/lib/linux-panel-updater USER="$USER" LOGNAME="$USER" GIT_TERMINAL_PROMPT=0 PATH=/opt/node24/bin:/opt/linux-panel/runtime:/usr/local/bin:/usr/bin:/bin "$@"; }
record(){
  local status="$1" tmp result_dir
  result_dir="${RESULT%/*}"
  [[ -d "$result_dir" && ! -L "$result_dir" ]] || return 1
  # mktemp IN the result filesystem: mv across mounts is copy+delete, not
  # atomic. Flush the newly created file and the final parent directory.
  tmp="$(mktemp "$result_dir/.update-result.XXXXXXXX")" || return 1
  # A partial printf (ENOSPC, quota, EIO) must NEVER publish malformed JSON.
  # Do not depend on errexit inside a caller's if/! function invocation.
  if ! printf '{"id":"%s","sha":"%s","status":"%s","at":"%s"}\n' "$ID" "$TARGET" "$status" "$(date -u +%FT%TZ)" > "$tmp" ||
     ! chmod 0640 "$tmp" ||
     ! chown root:linuxpanel "$tmp" ||
     ! durable_sync file "$tmp";then
    rm -f -- "$tmp"
    return 1
  fi
  mv -fT -- "$tmp" "$RESULT" || { rm -f -- "$tmp"; return 1; }
  durable_sync dir "$result_dir"
}
# Fixed root-owned privileged package release management. This logic runs
# exclusively in the immutable installed Broker; NEVER execute a Shell script
# or JavaScript helper from the mutable Git checkout as root.
PRIV_ROOT=/usr/local/lib/linux-panel-privileged
PRIV_RELEASES="$PRIV_ROOT/releases"
PRIV_CURRENT="$PRIV_ROOT/current"
PRIV_FILES=(server.js handlers.js file-contracts.js file-operations.js cron-contracts.js cron-operations.js)
PRIV_DEPS=(ajv fast-deep-equal fast-uri json-schema-traverse require-from-string)
priv_present(){
  [[ -d "$PRIV_ROOT" && ! -L "$PRIV_ROOT" ]]
}
priv_release(){
  local sha="$1"
  [[ "$sha" =~ ^[a-f0-9]{40}$ && -d "$PRIV_RELEASES/$sha" &&
     ! -L "$PRIV_RELEASES/$sha" &&
     -f "$PRIV_RELEASES/$sha/.ready" &&
     ! -L "$PRIV_RELEASES/$sha/.ready" &&
     "$(cat "$PRIV_RELEASES/$sha/.ready")" == "$sha" ]]
}
priv_current_is(){
  [[ -L "$PRIV_CURRENT" && "$(readlink "$PRIV_CURRENT")" == "releases/$1" ]]
}
priv_preflight(){
  if ! priv_present;then
    [[ ! -e "$PRIV_ROOT" && ! -L "$PRIV_ROOT" ]]
    return
  fi
  [[ "$(stat -c %u "$PRIV_ROOT")" -eq 0 &&
     -d "$PRIV_RELEASES" && ! -L "$PRIV_RELEASES" &&
     "$(stat -c %u "$PRIV_RELEASES")" -eq 0 &&
     -L "$PRIV_CURRENT" ]] || return 1
  priv_current_is "$OLD" && priv_release "$OLD"
}
priv_stage(){
  local sha="$1" pkg file source target
  priv_present || return 0
  [[ "$sha" =~ ^[a-f0-9]{40}$ ]] || return 1
  pkg="$PRIV_RELEASES/$sha"
  [[ ! -L "$pkg" ]] || return 1
  if [[ -d "$pkg" ]];then
    [[ "$(stat -c %u "$pkg")" -eq 0 ]] || return 1
    rm -rf -- "$pkg" || return 1
  fi
  (umask 077; mkdir -- "$pkg" && mkdir -- "$pkg/node_modules") || return 1
  for file in "${PRIV_FILES[@]}";do
    # Read bytes from the pinned Git object, not potentially mutated
    # files in the working tree after npm install/test lifecycle hooks.
    as_updater git -C "$ROOT" show "$sha:platform/privileged/$file" > "$pkg/$file" || return 1
    chmod 0600 "$pkg/$file" || return 1
  done
  printf '{"type":"module"}\n' > "$pkg/package.json" || return 1
  for file in "${PRIV_DEPS[@]}";do
    source="$ROOT/node_modules/$file"
    target="$pkg/node_modules/$file"
    [[ -d "$source" && ! -L "$source" &&
       "$(stat -c %U "$source")" == "$USER" ]] || return 1
    # Never dereference symlinked npm package trees as root.
    [[ -z "$(find "$source" -type l -print -quit)" ]] || return 1
    cp -R -- "$source" "$target" || return 1
  done
  chown -R root:root "$pkg" || return 1
  chmod -R go-rwx "$pkg" || return 1
  /opt/node24/bin/node --input-type=module -e '
    const h=await import(process.argv[1]);
    const map=h.createPrivilegedHandlers();
    if(!(map instanceof Map) || map.size<1) process.exit(1);
  ' "file://$pkg/handlers.js" || return 1
  printf '%s\n' "$sha" > "$pkg/.ready" || return 1
  chmod 0600 "$pkg/.ready" || return 1
  # Persist the complete release BEFORE publishing its symlink.
  sync -f "$pkg" || return 1
  durable_sync dir "$PRIV_RELEASES"
}
priv_switch(){
  local sha="$1" tmp
  priv_present || return 0
  priv_release "$sha" || return 1
  if ! priv_current_is "$sha";then
    systemctl stop linux-panel-privileged.service || return 1
    tmp="$PRIV_ROOT/.current.$sha"
    [[ ! -e "$tmp" && ! -L "$tmp" ]] || return 1
    ln -s "releases/$sha" "$tmp" || return 1
    mv -fT -- "$tmp" "$PRIV_CURRENT" || return 1
    durable_sync dir "$PRIV_ROOT" || return 1
  fi
  systemctl restart linux-panel-privileged.service &&
    systemctl is-active --quiet linux-panel-privileged.service &&
    [[ -S /run/linux-panel-privileged/executor.sock ]]
}
priv_recover_old(){
  priv_present || return 0
  priv_switch "$OLD"
}
priv_verify_target(){
  priv_present || return 0
  priv_current_is "$TARGET" && priv_release "$TARGET" &&
    systemctl is-active --quiet linux-panel-privileged.service &&
    [[ -S /run/linux-panel-privileged/executor.sock ]]
}

MODE=normal
if [[ "$#" -eq 1 && "$1" == --recover-only ]];then MODE=recover
elif [[ "$#" -ne 0 ]];then exit 2;fi
[[ "$EUID" -eq 0 ]] || exit 2
exec 9> /run/linux-panel-root-updater/update.lock
flock -n 9 || exit 2
# Do not erase crash evidence on failure.
# A live Broker alone may bypass the systemd fail-closed recovery guard.
# The volatile permit disappears on ordinary exit AND after SIGKILL when
# systemd tears down the service's private RuntimeDirectory.
trap 'rm -f -- "$ALLOW_START"; if [[ ! -e "$TXN" ]];then rm -f -- "$PROCESSING";fi' EXIT
start_panel(){
  if [[ -e "$TXN" ]];then
    [[ -d /run/linux-panel-root-updater ]] || return 1
    (umask 077; : > "$ALLOW_START") || return 1
  fi
  systemctl start linux-panel.service
}
web_can_read(){
  /usr/bin/setpriv --reuid=linuxpanel --regid=linuxpanel --init-groups --inh-caps=-all --no-new-privs -- /usr/bin/test -r "$1"
}
# Git checkout/reset also run under umask 077. Any changed tracked source,
# including ROOT/package.json and apps/api/src/*.js, may be replaced as 0600.
# Re-grant read/traverse to the different Web UID AFTER both forward checkout
# and rollback. Only the Git index's tracked public files and their ancestors
# are eligible: never recursively alter .git, private panel state, or untracked
# user-controlled files. The immutable worker performs every permission change;
# it does not execute an updater-controlled helper script as root.
ensure_tracked_web_read_access(){
  local manifest rel path parent
  local -a files=() dirs=()
  local -A seen=()
  [[ -d "$ROOT" && ! -L "$ROOT" && "$(stat -c %U "$ROOT")" == "$USER" ]] || {
    log 'Unexpected checkout root while restoring Web source permissions'
    return 1
  }
  manifest="$(mktemp "${ALLOW_START%/*}/.tracked-web.XXXXXXXX")" || return 1
  if ! as_updater git -C "$ROOT" ls-files --cached -z > "$manifest";then
    rm -f -- "$manifest"
    log 'Could not list tracked checkout files'
    return 1
  fi
  while IFS= read -r -d '' rel;do
    # Refuse paths that could escape the pinned checkout, including .git.
    if [[ -z "$rel" || "$rel" == /* || "$rel" == .. ||
          "$rel" == ../* || "$rel" == */../* || "$rel" == */.. ||
          "$rel" == .git || "$rel" == .git/* ]];then
      log 'Unsafe tracked checkout path; refusing Web permission change'
      rm -f -- "$manifest"
      return 1
    fi
    path="$ROOT/$rel"
    if [[ ! -f "$path" || -L "$path" || "$(stat -c %U "$path")" != "$USER" ]];then
      log 'Unexpected tracked checkout file type/owner'
      rm -f -- "$manifest"
      return 1
    fi
    files+=("$path")
    parent="${path%/*}"
    while [[ "$parent" != "$ROOT" ]];do
      if [[ ! -d "$parent" || -L "$parent" ||
            "$(stat -c %U "$parent")" != "$USER" ]];then
        log 'Unexpected tracked checkout parent type/owner'
        rm -f -- "$manifest"
        return 1
      fi
      if [[ -z "${seen[$parent]+x}" ]];then
        seen["$parent"]=1
        dirs+=("$parent")
      fi
      parent="${parent%/*}"
    done
  done < "$manifest"
  rm -f -- "$manifest"
  (("${#files[@]}" > 0)) || { log 'Empty Git tracked checkout'; return 1; }
  # Root Broker holds CAP_CHOWN; owner updater performs chmod with its own UID.
  chgrp -- linuxpanel "$ROOT" "${dirs[@]}" "${files[@]}" || return 1
  as_updater chmod -- g+rX,g-w,o-rwx "$ROOT" "${dirs[@]}" "${files[@]}" || return 1
  # Verify the actual Web UID, not root's ability to read its own checkout.
  web_can_read "$ROOT/package.json" ||
    { log 'Web account cannot read root package.json'; return 1; }
  web_can_read "$ROOT/apps/api/src/server.js" ||
    { log 'Web account cannot read API entrypoint'; return 1; }
}
# npm ci and Vite run as linuxpanel-updater under umask 077. Freshly
# regenerated runtime trees can therefore be updater-only (0700/0600),
# even though the Web service uses a different UID (linuxpanel).
# Normalize ONLY generated public code/dependency trees; never private state,
# the whole checkout, or the root-owned recovery journal. Root has CAP_CHOWN.
ensure_web_read_access(){
  local d
  for d in "$ROOT/node_modules" "$ROOT/apps/web/node_modules" \
           "$ROOT/extensions/mcp/node_modules" "$ROOT/apps/web/dist";do
    [[ -e "$d" || -L "$d" ]] || continue
    if [[ ! -d "$d" || -L "$d" ]];then
      log 'Unsafe generated artifact path; refusing Web start'
      return 1
    fi
    chgrp -R -- linuxpanel "$d" || return 1
    # The root Broker has CAP_CHOWN but intentionally NOT CAP_FOWNER.
    # chmod must run as the updater, which owns the newly installed files.
    as_updater chmod -R -- g+rX,g-w,o-w "$d" || return 1
  done
  if [[ ! -f "$ROOT/node_modules/fastify/package.json" ]];then
    log 'Required Fastify runtime manifest not found after build'
    return 1
  fi
  ensure_tracked_web_read_access
}
# Reusable health gate for normal deployments AND interrupted-boot recovery.
# A systemctl start or active PID alone never proves Fastify is serving.
panel_healthy(){
  local PANEL_ENV DEFAULT_PORT OVERRIDE_PORT PROBE_PORT ORIGIN HOST ready attempt
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
    return 1
  ORIGIN="$(sed -n 's/^PANEL_PUBLIC_ORIGIN=//p' "$PANEL_ENV" | tail -n 1)"
  [[ -n "$ORIGIN" ]] || ORIGIN="http://127.0.0.1:$PROBE_PORT"
  HOST="${ORIGIN#http://}"
  HOST="${HOST#https://}"
  if [[ -z "$HOST" || "$HOST" == "$ORIGIN" ]];then
    return 1
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
  if ((ready==0));then return 1;fi
  return 0
}
journal(){
  local tmp
  [[ ! -e "$TXN" && ! -L "$TXN" ]] || return 1
  tmp="$(mktemp "$ROOT_BACKUP/.pending-transaction.XXXXXXXX")" || return 1
  # Check every step explicitly: an ENOSPC-short write can leave a file
  # that chmod/chown/fsync can still successfully publish if unchecked.
  if ! printf 'id=%s\nsha=%s\nold=%s\n' "$ID" "$TARGET" "$OLD" > "$tmp" ||
     ! chmod 0600 "$tmp" ||
     ! chown root:root "$tmp" ||
     ! durable_sync file "$tmp";then
    rm -f -- "$tmp"
    return 1
  fi
  mv -nT -- "$tmp" "$TXN" || { rm -f -- "$tmp"; return 1; }
  durable_sync dir "$ROOT_BACKUP"
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
        durable_sync dir "$STATE"
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
    # A durable success result is not proof Web can start after reboot.
    # The recovery unit has no Before=Web ordering; the journal guard blocks
    # untrusted starts, and only this root worker grants a temporary permit.
    if priv_switch "$TARGET" && priv_verify_target &&
       ensure_web_read_access && start_panel &&
       systemctl is-active --quiet linux-panel.service && panel_healthy;then
      finish_transaction || return 1
      log "Previously committed healthy deployment $ID cleaned up"
      return 0
    fi
    systemctl stop linux-panel.service || true
    record failed
    log "Committed update $ID is unhealthy after restart; preserving journal"
    return 1
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
      # Never publish a truncated or partially copied private-state snapshot.
      if ! cp -- "$backup" "$restore_tmp" ||
         ! chmod 0600 "$restore_tmp" ||
         ! chown linuxpanel:linuxpanel "$restore_tmp" ||
         ! durable_sync file "$restore_tmp" ||
         ! mv -fT -- "$restore_tmp" "$STATE/panel-state.json" ||
         ! durable_sync dir "$STATE";then
        restored=0
        rm -f -- "$restore_tmp"
      fi
    fi
  elif [[ "$current" != "$OLD" ]];then
    restored=0
  fi
  # Never request a start if Git, dependencies or private state failed
  # recovery: serving a partially restored app would hide a failed rollback.
  if ((restored==1));then
    if ! priv_recover_old;then restored=0;fi
  fi
  if ((restored==1));then
    # No ordering edge to Web: the root journal ConditionPathExists guard
    # denies ordinary boot and this worker alone grants the volatile permit.
    # Both normal rollback and boot recovery must observe HTTP readiness.
    if ! ensure_web_read_access || ! start_panel ||
       ! systemctl is-active --quiet linux-panel.service || ! panel_healthy;then
      systemctl stop linux-panel.service || true
      restored=0
    fi
  fi
  if ((restored==1));then
    record rolled_back
    finish_transaction || return 1
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
# The approval marker was written by the Web process, not fsync'd by root.
# Commit its processing identity before entering a potentially destructive job.
durable_sync file "$PROCESSING"
durable_sync dir "$STATE"
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
if ! priv_preflight;then
  log "Installed root package is not versioned at old SHA; explicit operator bootstrap required"
  record failed
  exit 2
fi
log "Fetch pinned origin/main commit $TARGET"
as_updater git -C "$ROOT" fetch --no-tags origin main || { record failed;exit 2; }
REMOTE="$(as_updater git -C "$ROOT" rev-parse refs/remotes/origin/main)"
[[ "$REMOTE" == "$TARGET" ]] || { record failed; exit 2; }
if [[ "$OLD" == "$TARGET" ]];then
  record no_change
  rm -f -- "$PROCESSING"
  durable_sync dir "$STATE"
  exit 0
fi
as_updater git -C "$ROOT" merge-base --is-ancestor "$OLD" "$TARGET" || { record failed; exit 2; }
# Stop BEFORE service interruption if the shared VPS cannot safely build.
# These are fixed, root-owned safety thresholds, not MCP-controlled parameters.
# 1 GiB on the code filesystem; 256 MiB for root-only backups, and
# 768 MiB MemAvailable + SwapFree for npm/test/build, with a soft warning
# under 1.5 GiB. A 3.8 GiB free disk is therefore not blocked. This is a
# minimum, not a guarantee against transient OOM / disk usage spikes.
resource_headroom(){
  local opt_kib backup_kib mem_kib swap_kib
  opt_kib="$(df -Pk "$ROOT" 2>/dev/null | awk 'NR==2 {print $4}')" || return 1
  backup_kib="$(df -Pk "$ROOT_BACKUP" 2>/dev/null | awk 'NR==2 {print $4}')" || return 1
  mem_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)" || return 1
  swap_kib="$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)" || return 1
  if [[ ! "$opt_kib" =~ ^[0-9]+$ || ! "$backup_kib" =~ ^[0-9]+$ ||
        ! "$mem_kib" =~ ^[0-9]+$ || ! "$swap_kib" =~ ^[0-9]+$ ]];then
    log 'Cannot reliably read disk/memory headroom; rejecting update'
    return 1
  fi
  if ((opt_kib < 1048576 || backup_kib < 262144));then
    log 'Insufficient free storage for update (min code 1 GiB, backup 256 MiB)'
    return 1
  fi
  if ((mem_kib + swap_kib < 786432));then
    log 'Memory + swap below 768 MiB: insufficient for reliable npm execution'
    return 1
  fi
  if ((mem_kib + swap_kib < 1572864));then
    log 'WARN: memory + swap below recommended 1.5 GiB; review build peak'
  fi
  log "Resource gate: code=${opt_kib}KiB backup=${backup_kib}KiB memory+swap=$((mem_kib+swap_kib))KiB"
}
if ! resource_headroom;then record failed; exit 2;fi
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
  start_panel || true
  record failed
  exit 2
fi
# Do not preserve the Web user's owner/mode with cp -a: the root Broker
# deliberately lacks CAP_FOWNER and cannot chmod a linuxpanel-owned copy.
# Create a new root-owned 0600 snapshot instead.
# Build the backup under a temporary name; it becomes visible to recover()
# only once complete and fsync'd on its own filesystem. The root journal is
# already durable, so an interrupted snapshot cannot become a trusted backup.
backup_tmp=''
if ! backup_tmp="$(mktemp "$ROOT_BACKUP/.state-snapshot.XXXXXXXX")" ||
   ! install -o root -g root -m 0600 -- "$STATE/panel-state.json" "$backup_tmp" ||
   ! durable_sync file "$backup_tmp" ||
   ! mv -nT -- "$backup_tmp" "$BACKUP" ||
   ! durable_sync dir "$ROOT_BACKUP";then
  [[ -z "$backup_tmp" ]] || rm -f -- "$backup_tmp"
  start_panel || true
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
if ! ensure_web_read_access;then rollback;exit 1;fi
# Only the immutable root worker copies the pinned/reviewed handler set. A
# failed privileged package swap must roll back the app and package together.
if ! priv_stage "$TARGET" || ! priv_switch "$TARGET";then
  rollback;exit 1
fi
if ! start_panel || ! systemctl is-active --quiet linux-panel.service;then
  rollback
  exit 1
fi
if ! panel_healthy || ! priv_verify_target;then
  rollback
  exit 1
fi
record success
finish_transaction || exit 1
log "Updated to $TARGET"
