#!/usr/bin/env bash
# Operator-only migration of an ALREADY installed immutable root Broker.
# --check and --verify are strictly read-only. --apply never enables updates.
set -Eeuo pipefail
umask 077
ROOT=/opt/linux-panel
WORKER=/usr/local/libexec/linux-panel-update-worker
UNIT=/etc/systemd/system/linux-panel-update.service
SOURCE_WORKER="$ROOT/scripts/update-worker.sh"
SOURCE_UNIT="$ROOT/deployment/systemd/linux-panel-update.service"
PIN=/etc/linux-panel/update-source
ENV_FILE=/etc/linux-panel/panel.env
BACKUP_ROOT=/var/lib/linux-panel-update-root
RESULT_DIR=/var/lib/linux-panel-update-status
TRIGGER=/var/lib/linux-panel/update-trigger
PROCESSING=/var/lib/linux-panel/update-processing
MODE=''
BLOCK=0
WARN=0
say(){ printf '[%-5s] %s\n' "$1" "$2"; }
pass(){ say PASS "$1"; }
warn(){ WARN=$((WARN+1)); say WARN "$1"; }
block(){ BLOCK=$((BLOCK+1)); say BLOCK "$1"; }
die(){ say BLOCK "$1" >&2; exit 1; }
help(){
  cat <<'EOF'
Upgrade an EXISTING installed Linux Panel root Broker (root/sudo only):
  sudo bash scripts/upgrade-update-broker.sh --check    # read-only
  sudo bash scripts/upgrade-update-broker.sh --apply    # explicit migration
  sudo bash scripts/upgrade-update-broker.sh --verify   # read-only
Requires disabled Web updater, inactive watcher, clean trusted main checkout,
and a healthy existing panel. Never enables Broker, runs updates, restarts the
panel, modifies Nginx, changes TLS or touches unrelated systemd units.
EOF
}
while (($#));do
  case "$1" in
    --check|--apply|--verify)
      [[ -z "$MODE" ]] || die 'Specify one mode only'
      MODE="${1#--}";;
    --help|-h) help;exit 0;;
    *) die "Unexpected argument: $1";;
  esac
  shift
done
[[ -n "$MODE" ]] || { help; die 'Mode required'; }
((EUID == 0)) || die 'Requires root; read-only modes still need root-owned pin'
exists(){ [[ -e "$1" || -L "$1" ]]; }
file(){ [[ -f "$1" && ! -L "$1" ]]; }
directory(){ [[ -d "$1" && ! -L "$1" ]]; }
owner_mode(){
  file "$1" && [[ "$(stat -c %U:%G:%a -- "$1")" == "$2" ]]
}
summary(){
  printf 'Broker upgrade %s: %s BLOCK(s), %s WARN(s)\n' "$MODE" "$BLOCK" "$WARN"
  ((BLOCK == 0))
}
need(){ command -v "$1" >/dev/null 2>&1 || block "Command missing: $1"; }
# Fail closed on any preexisting marker, including symlinks/dangling symlinks.
preflight(){
  BLOCK=0; WARN=0
  local cmd
  for cmd in systemctl systemd-analyze git runuser grep stat cmp sha256sum \
    install mktemp mv flock date hostname;do need "$cmd";done
  [[ "$( . /etc/os-release; printf '%s %s' "$ID" "$VERSION_ID" )" =~ ^(ubuntu\ (24|25|26)\.|debian\ (1[2-9]|[2-9][0-9])) ]] &&
    pass 'Supported Ubuntu/Debian version' || block 'Unsupported OS'
  local systemd_ver=''
  systemd_ver="$(systemctl --version 2>/dev/null | awk 'NR==1 {print $2}')" || true
  [[ "$systemd_ver" =~ ^[0-9]+$ ]] && ((systemd_ver>=240)) &&
    pass "systemd version $systemd_ver" || block 'systemd >=240 required'
  directory "$ROOT" && directory "$ROOT/.git" &&
    [[ "$(stat -c %U "$ROOT")" == linuxpanel-updater ]] &&
    pass 'Existing updater-owned real Git checkout' || block 'Unexpected checkout ownership or type'
  directory "$BACKUP_ROOT" && [[ "$(stat -c %U:%G:%a "$BACKUP_ROOT")" == root:root:700 ]] &&
    pass 'Trusted root-only backup directory' || block 'Unsafe/missing backup directory'
  directory "$RESULT_DIR" && pass 'Existing Broker status directory' || block 'Missing status directory'
  owner_mode "$PIN" root:root:600 &&
    pass 'Root-only Git source pin' || block 'Unsafe Git source pin'
  owner_mode "$ENV_FILE" root:root:600 &&
    pass 'Root-only panel environment' || block 'Unsafe panel environment'
  owner_mode "$WORKER" root:root:755 &&
    pass 'Installed root-owned worker (0755)' || block 'Missing or unsafe installed worker'
  owner_mode "$UNIT" root:root:644 &&
    pass 'Installed root-owned systemd unit (0644)' || block 'Missing or unsafe update unit'
  file "$SOURCE_WORKER" && file "$SOURCE_UNIT" &&
    pass 'Audited source worker and unit available' || block 'Missing or unsafe source'
  [[ -f /etc/systemd/system/linux-panel.service &&
     ! -L /etc/systemd/system/linux-panel.service ]] &&
    pass 'Main panel unit exists' || block 'Main panel unit missing'
  if systemctl is-active --quiet linux-panel.service;then
    pass 'Production panel service still active'
  else block 'Panel service not active';fi
  if systemctl is-enabled --quiet linux-panel-update.path ||
     systemctl is-active --quiet linux-panel-update.path;then
    block 'Update watcher active/enabled; disable via reviewed operator plan first'
  else pass 'Update watcher disabled and inactive';fi
  if systemctl is-active --quiet linux-panel-update.service;then
    block 'Broker worker currently active'
  else pass 'Broker worker inactive';fi
  if exists "$TRIGGER" || exists "$PROCESSING";then
    block 'Pending/processing update marker exists'
  else pass 'No pending or processing update marker';fi
  if file "$ENV_FILE" && grep -Eq '^PANEL_UPDATER_ENABLED=1$' "$ENV_FILE";then
    block 'Web updater enabled'
  elif file "$ENV_FILE" &&
       [[ "$(grep -c '^PANEL_UPDATER_ENABLED=' "$ENV_FILE" || true)" -le 1 ]];then
    pass 'Web updater gate disabled'
  else block 'Ambiguous Web updater flag';fi
  # Never run Git as root and bypass Git's ownership trust check.
  local current='' remote='' pinned='' upstream='' branch='' dirty=''
  if current="$(runuser -u linuxpanel-updater -- git -C "$ROOT" rev-parse HEAD 2>/dev/null)" &&
     branch="$(runuser -u linuxpanel-updater -- git -C "$ROOT" branch --show-current 2>/dev/null)" &&
     dirty="$(runuser -u linuxpanel-updater -- git -C "$ROOT" status --porcelain 2>/dev/null)" &&
     upstream="$(runuser -u linuxpanel-updater -- git -C "$ROOT" rev-parse refs/remotes/origin/main 2>/dev/null)" &&
     remote="$(runuser -u linuxpanel-updater -- git -C "$ROOT" remote get-url origin 2>/dev/null)" &&
     file "$PIN";then
    pinned="$(cat "$PIN")"
    if [[ "$branch" == main && "$current" =~ ^[a-f0-9]{40}$ &&
          "$upstream" == "$current" && -z "$dirty" ]];then
      pass "Clean main checkout at ${current:0:12} matching cached origin/main"
    else block 'Git HEAD/branch/cleanliness differs from cached origin/main';fi
    if [[ "$remote" == "$pinned" &&
          "$remote" =~ ^(https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+([.]git)?|git@github[.]com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+([.]git)?)$ ]];then
      pass 'Exact pinned GitHub remote matches checkout'
    else block 'Git pin or remote differs/unsafe';fi
  else block 'Unable to validate updater-owned Git and pinned source';fi
  if file "$WORKER" && file "$SOURCE_WORKER";then
    if cmp -s "$WORKER" "$SOURCE_WORKER";then pass 'Worker already current'
    else warn 'Installed worker differs from checked-out source: upgrade needed';fi
    say INFO "Installed worker SHA256: $(sha256sum "$WORKER" | cut -d' ' -f1)"
    say INFO "Source worker SHA256:    $(sha256sum "$SOURCE_WORKER" | cut -d' ' -f1)"
  fi
  if file "$UNIT" && file "$SOURCE_UNIT";then
    if cmp -s "$UNIT" "$SOURCE_UNIT";then pass 'Systemd unit already current'
    else warn 'Installed systemd unit differs: upgrade needed';fi
    say INFO "Installed unit SHA256: $(sha256sum "$UNIT" | cut -d' ' -f1)"
    say INFO "Source unit SHA256:    $(sha256sum "$SOURCE_UNIT" | cut -d' ' -f1)"
  fi
  if systemctl cat linux-panel-update.service >/dev/null 2>&1 &&
     [[ "$(systemctl show linux-panel-update.service -p ProtectSystem --value)" == strict &&
        "$(systemctl show linux-panel-update.service -p NoNewPrivileges --value)" == yes ]];then
     pass 'Effective existing systemd sandbox'
  else block 'Existing effective systemd sandbox not trusted';fi
}
installed_verify(){
  preflight
  if file "$WORKER" && file "$SOURCE_WORKER" && cmp -s "$WORKER" "$SOURCE_WORKER" &&
     file "$UNIT" && file "$SOURCE_UNIT" && cmp -s "$UNIT" "$SOURCE_UNIT";then
    pass 'Both installed privileged artifacts exactly match source'
  else block 'Root worker/unit still differ from current checked-out source';fi
  if [[ "$(systemctl show linux-panel-update.service -p ExecStart --value)" == *"$WORKER"* ]] &&
     [[ "$(systemctl show linux-panel-update.service -p ReadWritePaths --value)" == *"/opt/linux-panel"* ]];then
    pass 'Effective Broker unit points to fixed worker, with restricted writable roots'
  else block 'Unexpected effective Broker execution path or sandbox';fi
}
if [[ "$MODE" == check ]];then
  say INFO 'READ ONLY: existing root Broker migration preflight'
  preflight
  summary
  exit $?
fi
if [[ "$MODE" == verify ]];then
  say INFO 'READ ONLY: post-migration verification'
  installed_verify
  summary
  exit $?
fi

# Only --apply may create lock, backups or temporary files.
[[ "$MODE" == apply ]] || die 'Unknown mode'
exec 9> "$BACKUP_ROOT/.broker-migrate.lock"
flock -n 9 || die 'Concurrent Broker migration refused'
say INFO 'Revalidating before privileged replacement'
preflight
summary || die 'Migration BLOCKED; no privileged files changed'
if cmp -s "$WORKER" "$SOURCE_WORKER" && cmp -s "$UNIT" "$SOURCE_UNIT";then
  pass 'Already current: no backup, reload or restart necessary'
  exit 0
fi

# One unique root-only backup per attempt, never overwrite an older backup.
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$(mktemp -d "$BACKUP_ROOT/.broker-migration-$stamp-XXXXXXXX")"
chmod 0700 "$backup"
install -o root -g root -m 0755 "$WORKER" "$backup/worker.before"
install -o root -g root -m 0644 "$UNIT" "$backup/unit.before"
# stage new artifacts in each destination filesystem before swapping.
worker_tmp="$(mktemp /usr/local/libexec/.linux-panel-worker.XXXXXXXX)"
unit_tmp="$(mktemp /etc/systemd/system/.linux-panel-unit.XXXXXXXX)"
chmod 0600 "$worker_tmp" "$unit_tmp"
install -o root -g root -m 0755 "$SOURCE_WORKER" "$worker_tmp"
install -o root -g root -m 0644 "$SOURCE_UNIT" "$unit_tmp"
changed=0
success=0
cleanup(){
  local ec=$?
  trap - EXIT
  rm -f -- "$worker_tmp" "$unit_tmp"
  if ((changed && !success));then
    say WARN 'Migration interrupted or failed; restoring prior fixed worker/unit'
    local restore_worker restore_unit
    restore_worker="$(mktemp /usr/local/libexec/.linux-panel-restore.XXXXXXXX)"
    restore_unit="$(mktemp /etc/systemd/system/.linux-panel-restore.XXXXXXXX)"
    if install -o root -g root -m 0755 "$backup/worker.before" "$restore_worker" &&
       install -o root -g root -m 0644 "$backup/unit.before" "$restore_unit" &&
       mv -fT -- "$restore_worker" "$WORKER" &&
       mv -fT -- "$restore_unit" "$UNIT" &&
       systemctl daemon-reload;then
      say WARN 'Old Broker artifacts restored; Web/Watcher gates remained OFF'
    else
      say BLOCK "Rollback incomplete; inspect root-only backup $backup and keep Broker disabled"
    fi
    rm -f -- "$restore_worker" "$restore_unit"
  fi
  exit "$ec"
}
trap cleanup EXIT
changed=1
mv -fT -- "$worker_tmp" "$WORKER"
mv -fT -- "$unit_tmp" "$UNIT"
systemctl daemon-reload
# Do not invoke any Broker service or restart the Web service.
if ! cmp -s "$WORKER" "$SOURCE_WORKER" ||
   ! cmp -s "$UNIT" "$SOURCE_UNIT" ||
   [[ "$(systemctl show linux-panel-update.service -p ProtectSystem --value)" != strict ]] ||
   [[ "$(systemctl show linux-panel-update.service -p NoNewPrivileges --value)" != yes ]] ||
   [[ "$(systemctl show linux-panel-update.service -p ExecStart --value)" != *"$WORKER"* ]] ||
   systemctl is-active --quiet linux-panel-update.path ||
   systemctl is-enabled --quiet linux-panel-update.path ||
   systemctl is-active --quiet linux-panel-update.service ||
   ! systemctl is-active --quiet linux-panel.service;then
  die 'Post-replacement verification failed; automatic rollback requested'
fi
success=1
pass 'Root worker and update unit migrated; existing service unchanged'
say INFO "Old files backed up in root-only directory $backup"
say INFO 'Updater remains disabled: neither Web gate nor watcher activated'
