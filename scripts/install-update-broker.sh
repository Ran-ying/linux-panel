#!/usr/bin/env bash
# Independent one-time root broker bootstrap: --check is read-only.
# --apply provisions DISABLED broker; --activate requires prior staging acceptance.
set -Eeuo pipefail
umask 077
ROOT=/opt/linux-panel
STATE=/var/lib/linux-panel/panel-state.json
CONF=/etc/linux-panel/panel.env
WORKER=/usr/local/libexec/linux-panel-update-worker
PIN=/etc/linux-panel/update-source
PATH_UNIT=/etc/systemd/system/linux-panel-update.path
SERVICE_UNIT=/etc/systemd/system/linux-panel-update.service
RECOVERY_UNIT=/etc/systemd/system/linux-panel-update-recover.service
GUARD_DIR=/etc/systemd/system/linux-panel.service.d
GUARD_UNIT=$GUARD_DIR/90-update-recovery-guard.conf
BACKUP_DIR=/var/lib/linux-panel-update-root
RESULT_DIR=/var/lib/linux-panel-update-status
MODE=''
ACK=0
BLOCK=0
WARN=0
help(){
  cat <<'HELP'
Usage (operator root/sudo only):
  sudo bash scripts/install-update-broker.sh --check
  sudo bash scripts/install-update-broker.sh --apply
  sudo bash scripts/install-update-broker.sh --verify
  sudo bash scripts/install-update-broker.sh --activate --ack-acceptance
--check    Read-only first-install preflight: PASS / WARN / BLOCK
--apply    One-time installation, leaving Web flag and watcher DISABLED
--verify   Read-only post-install filesystem / effective systemd verification
--activate Require separate staging/fault-injection acceptance before enabling
--ack-acceptance  Explicit operator attestation (only with --activate)
No nginx, proxy, TLS, firewall, DNS, update execution or repo fetch performed.
HELP
}
report(){ printf '[%-5s] %s\n' "$1" "$2"; }
pass(){ report PASS "$1"; }
warn(){ WARN=$((WARN+1));report WARN "$1"; }
block(){ BLOCK=$((BLOCK+1));report BLOCK "$1"; }
die(){ report BLOCK "$1" >&2;exit 1; }
while (($#));do
 case "$1" in
  --check) [[ -z "$MODE" ]] || die 'Only one mode';MODE=check;;
  --apply) [[ -z "$MODE" ]] || die 'Only one mode';MODE=apply;;
  --verify) [[ -z "$MODE" ]] || die 'Only one mode';MODE=verify;;
  --activate) [[ -z "$MODE" ]] || die 'Only one mode';MODE=activate;;
  --ack-acceptance) ACK=1;;
  -h|--help) help;exit 0;;
  *) die "Unknown option: $1";;
 esac;shift
done
[[ -n "$MODE" ]] || { help;die 'Missing explicit mode'; }
((ACK==0)) || [[ "$MODE" == activate ]] || die '--ack-acceptance applies only to --activate'
((EUID==0)) || die 'Run with sudo/root; --check and --verify do not modify the host'
exists(){ [[ -e "$1" || -L "$1" ]]; }
file(){ [[ -f "$1" && ! -L "$1" ]]; }
dir(){ [[ -d "$1" && ! -L "$1" ]]; }
owner(){ [[ "$(stat -c %U "$1" 2>/dev/null)" == "$2" ]]; }
# Run Git as the checkout owner after install; avoid root safe.directory bypass.
git_checked(){
 if owner "$ROOT" linuxpanel-updater;then
  runuser -u linuxpanel-updater -- git -C "$ROOT" "$@"
 else git -C "$ROOT" "$@";fi
}
commands(){
 local x
 for x in systemctl systemd-analyze git runuser setpriv id getent awk sed grep stat df \
  flock curl cmp install cp chmod chown useradd mktemp mv find;do
  if command -v "$x" >/dev/null 2>&1;then pass "Program: $x"
  else block "Missing program: $x";fi
 done
}
base_checks(){
 local os=''
 if [[ -r /etc/os-release ]];then
  # shellcheck disable=SC1091
  source /etc/os-release
  os="$ID $VERSION_ID"
  case "$ID" in
   ubuntu) [[ "$VERSION_ID" == 24.* || "$VERSION_ID" == 25.* || "$VERSION_ID" == 26.* ]] &&
       pass "Supported OS: $os" || block "Unsupported Ubuntu version: $os";;
   debian) [[ "$VERSION_ID" =~ ^[0-9]+$ ]] && ((VERSION_ID>=12)) &&
       pass "Supported OS: $os" || block "Unsupported Debian version: $os";;
   *) block "Unsupported OS: $os (requires Ubuntu 24.04+ or Debian 12+)";;
  esac
 else block 'Cannot read /etc/os-release';fi
 local version=''
 if command -v systemctl >/dev/null 2>&1;then
  version="$(systemctl --version 2>/dev/null | awk 'NR==1{print $2}')" || true
 fi
 if [[ "$version" =~ ^[0-9]+$ ]] && ((version>=240));then
  pass "systemd $version >= 240"
 else block "Unsupported systemd $version; do not bypass root sandbox requirements";fi
 if dir "$ROOT" && dir "$ROOT/.git";then pass 'Existing real Git checkout'
 else block 'Missing /opt/linux-panel Git checkout';return;fi
 if file /etc/systemd/system/linux-panel.service;then pass 'Main systemd service file exists'
 else block 'Missing main panel systemd service';fi
 if file "$STATE";then pass 'Private panel state file present'
 else block 'Missing private admin state';fi
 if file "$CONF" && owner "$CONF" root;then pass 'Root-owned panel.env present'
 else block 'Missing / unsafe panel.env';fi
 if systemctl is-active --quiet linux-panel.service;then pass 'Panel service active'
 else block 'Panel service not active';fi
 if getent group linuxpanel >/dev/null && id linuxpanel >/dev/null 2>&1;then
  pass 'Dedicated panel account and group present'
 else block 'Missing Linux Panel service account/group';fi
 if runuser -u linuxpanel -- test -r "$ROOT/apps/api/src/server.js";then pass 'Panel user can read code'
 else block 'Panel user cannot read code';fi
 if [[ -x /opt/node24/bin/node && -x /opt/node24/bin/npm ]];then
  pass 'Isolated Node24 and npm exist'
 else block 'Worker requires dedicated /opt/node24/bin/node and npm';fi
 local free=''
 free="$(df -Pk "$ROOT" 2>/dev/null | awk 'NR==2{print $4}')" || true
 if [[ "$free" =~ ^[0-9]+$ ]];then
  if ((free<1048576));then block 'Need >=1GiB free on /opt for updates/rollback'
  elif ((free<5242880));then warn 'Less than 5GiB free for builds and backups'
  else pass 'Disk headroom adequate';fi
 else block 'Could not inspect /opt free space';fi
 local mem_kb=0 swap_kb=0
 if [[ -r /proc/meminfo ]];then
  mem_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)"
  [[ "$mem_kb" =~ ^[0-9]+$ ]] || mem_kb=0
  [[ "$swap_kb" =~ ^[0-9]+$ ]] || swap_kb=0
  if ((mem_kb+swap_kb<786432));then
   block 'Insufficient available RAM + swap (<768 MiB) for build and rollback'
  elif ((mem_kb+swap_kb<1572864));then
   warn 'Available RAM + swap below recommended 1.5 GiB; OOM risk on shared VPS'
  else pass 'Memory + swap headroom adequate';fi
 fi
 if ! command -v git >/dev/null;then block 'Git missing';return;fi
 # Keep Git command output separately initialized: with nounset enabled,
 # a missing or failed Git result must be a BLOCK, never an unbound-variable
 # crash or accidental "clean worktree" PASS.
 local git_branch='' git_status_output='' git_remote=''
 if git_branch="$(git_checked branch --show-current 2>/dev/null)";then
  [[ "${git_branch-}" == main ]] && pass 'Git branch main' || block 'Git branch must be main'
 else
  block 'Git branch query failed';return
 fi
 if git_status_output="$(git_checked status --porcelain 2>/dev/null)";then
  if [[ -z "${git_status_output-}" ]];then
   pass 'Git checkout clean'
  else
   block 'Git checkout dirty; no reset permitted'
  fi
 else
  block 'Git status failed; checkout cleanliness unverified';return
 fi
 if ! git_remote="$(git_checked remote get-url origin 2>/dev/null)";then
  block 'Git remote unreadable'
  return
 fi
 if [[ "${git_remote-}" =~ ^https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+([.]git)?$ ||
       "${git_remote-}" =~ ^git@github[.]com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+([.]git)?$ ]];then
  pass 'Pinned GitHub remote URL has no embedded secrets'
 else block 'Git remote must be credential-free GitHub HTTPS/SSH';fi
 local f
 for f in scripts/update-worker.sh deployment/systemd/linux-panel-update.path \
   deployment/systemd/linux-panel-update.service \
   deployment/systemd/linux-panel-update-recover.service \
   deployment/systemd/linux-panel-update-guard.conf;do
  file "$ROOT/$f" && pass "Source file exists: $f" || block "Missing/unsafe source: $f"
 done
}
fresh_checks(){
 base_checks
 local path
 for path in "$WORKER" "$PIN" "$PATH_UNIT" "$SERVICE_UNIT" "$RECOVERY_UNIT" "$GUARD_UNIT" \
   "$BACKUP_DIR" "$RESULT_DIR" /var/lib/linux-panel/update-trigger \
   /var/lib/linux-panel/update-processing;do
  if exists "$path";then block "Broker artifact already exists: $path"
  else pass "Target free: $path";fi
 done
 if exists "$GUARD_DIR" && (! dir "$GUARD_DIR" || ! owner "$GUARD_DIR" root);then
  block 'Unsafe existing panel drop-in directory'
 fi
 if id linuxpanel-updater >/dev/null 2>&1;then
  block 'Updater account already exists; inspect partial installation'
 else pass 'Updater account is not yet present';fi
 if file "$CONF" && grep -q '^PANEL_UPDATER_ENABLED=1$' "$CONF";then
  block 'Web updater flag is already enabled: inspect existing state'
 fi
}
installed_checks(){
 base_checks
 if file "$WORKER" && owner "$WORKER" root && [[ -x "$WORKER" ]];then
  pass 'Root-owned executable worker'
 else block 'Worker missing or unsafe';fi
 if file "$WORKER" && file "$ROOT/scripts/update-worker.sh";then
  cmp -s "$WORKER" "$ROOT/scripts/update-worker.sh" &&
   pass 'Installed worker matches current source' ||
   warn 'Installed worker differs from checked-out source; review before worker upgrade'
 fi
 if file "$PIN" && owner "$PIN" root && [[ "$(stat -c %a "$PIN")" == 600 ]];then
  pass 'Remote pin root-owned mode 0600'
  [[ "$(cat "$PIN")" == "$(git_checked remote get-url origin)" ]] &&
   pass 'Trusted remote pin matches checkout' || block 'Trusted remote pin mismatch'
 else block 'Remote pin missing/unsafe';fi
 for path in "$PATH_UNIT" "$SERVICE_UNIT" "$RECOVERY_UNIT" "$GUARD_UNIT";do
  file "$path" && owner "$path" root && pass "Root-owned unit: $path" ||
   block "Unit missing/unsafe: $path"
 done
 id linuxpanel-updater >/dev/null 2>&1 && pass 'Updater account exists' ||
  block 'Updater account missing'
 owner "$ROOT" linuxpanel-updater && pass 'Checkout owned by isolated updater' ||
  block 'Checkout owner is not updater'
 if runuser -u linuxpanel -- test -r "$ROOT/apps/api/src/server.js" &&
    ! runuser -u linuxpanel -- test -w "$ROOT/apps/api/src/server.js";then
  pass 'Web user read-only access to source'
 else block 'Web user write access to source or read access lost';fi
 if dir "$BACKUP_DIR" && owner "$BACKUP_DIR" root;then pass 'Root backup directory exists'
 else block 'Root backup directory missing/unsafe';fi
 if dir "$RESULT_DIR" && owner "$RESULT_DIR" root;then pass 'Status directory exists'
 else block 'Status directory missing/unsafe';fi
 if [[ "$(systemctl show linux-panel.service -p ConditionResult --value)" == yes ]] ||
    systemctl cat linux-panel.service >/dev/null 2>&1;then
  # Effective unit must actually load the fixed root-only boot guard.
  if systemctl cat linux-panel.service | grep -Fq 'ConditionPathExists=|!/var/lib/linux-panel-update-root/active-transaction' &&
     systemctl cat linux-panel.service | grep -Fq 'ConditionPathExists=|/run/linux-panel-root-updater/allow-panel-start';then
    pass 'Effective panel boot recovery guard loaded'
  else block 'Panel boot recovery guard missing';fi
 fi
 if systemctl cat linux-panel-update.service >/dev/null 2>&1;then
  local effective
  effective="$(systemctl show linux-panel-update.service -p ProtectSystem --value)"
  [[ "$effective" == strict ]] && pass 'Effective ProtectSystem=strict' || block 'ProtectSystem not strict'
  effective="$(systemctl show linux-panel-update.service -p NoNewPrivileges --value)"
  [[ "$effective" == yes ]] && pass 'Effective NoNewPrivileges=yes' || block 'NoNewPrivileges not yes'
  effective="$(systemctl show linux-panel-update.service -p ReadWritePaths --value)"
  [[ "$effective" == *"/opt/linux-panel"* && "$effective" == *"/var/lib/linux-panel"* ]] &&
   pass 'Effective limited ReadWritePaths found' || block 'Expected ReadWritePaths missing'
  effective="$(systemctl show linux-panel-update.service -p User --value)"
  [[ "$effective" == root || -z "$effective" ]] && pass 'Root broker runs as root (systemd default or explicit User=root)' || block 'Root broker User mismatch'
 else block 'Updater service unit not loaded';fi
 if file "$CONF" && grep -q '^PANEL_UPDATER_ENABLED=1$' "$CONF";then
  warn 'Web updater gate ENABLED (only appropriate after staging sign-off)'
 else pass 'Web updater gate disabled';fi
 if systemctl is-enabled --quiet linux-panel-update-recover.service;then
  warn 'Boot recovery service enabled; check activation acceptance'
 else pass 'Boot recovery service disabled';fi
 if systemctl is-enabled --quiet linux-panel-update.path;then
  warn 'Update watcher ENABLED (only appropriate after staging sign-off)'
 else pass 'Update watcher disabled';fi
}
summary() {
  printf 'Broker %s summary: %s BLOCK(s), %s WARN(s)\n' "$MODE" "$BLOCK" "$WARN"
  ((BLOCK == 0))
}
if [[ "$MODE" == check ]];then
 report INFO 'READ ONLY: broker fresh-install preflight'
 fresh_checks
 summary || exit 1
 exit 0
fi
if [[ "$MODE" == verify ]];then
 report INFO 'READ ONLY: effective installed broker verification'
 installed_checks
 summary || exit 1
 exit 0
fi
if [[ "$MODE" == apply ]];then
 report INFO 'Preflight before explicit privileged installation'
 fresh_checks
 summary || die 'Installation blocked; no changes made'
 # Copies are root-only, made before any unit/account/ownership modifications.
 install -d -o root -g root -m 0700 "$BACKUP_DIR"
 install -o root -g root -m 0600 "$STATE" "$BACKUP_DIR/panel-state.before-broker.json"
 install -o root -g root -m 0600 "$CONF" "$BACKUP_DIR/panel.env.before-broker"
 install -o root -g root -m 0600 /etc/systemd/system/linux-panel.service \
   "$BACKUP_DIR/linux-panel.service.before-broker"
 useradd --system --home-dir /var/lib/linux-panel-updater --create-home \
   --shell /usr/sbin/nologin linuxpanel-updater
 install -d -o linuxpanel-updater -g linuxpanel-updater -m 0700 /var/lib/linux-panel-updater
 install -d -o root -g linuxpanel -m 0750 "$RESULT_DIR"
 install -d -o root -g root -m 0755 /usr/local/libexec
 install -o root -g root -m 0755 "$ROOT/scripts/update-worker.sh" "$WORKER"
 install -o root -g root -m 0600 /dev/null "$PIN"
 git_checked remote get-url origin > "$PIN"
 install -o root -g root -m 0644 "$ROOT/deployment/systemd/linux-panel-update.path" "$PATH_UNIT"
 install -o root -g root -m 0644 "$ROOT/deployment/systemd/linux-panel-update.service" "$SERVICE_UNIT"
 install -o root -g root -m 0644 "$ROOT/deployment/systemd/linux-panel-update-recover.service" "$RECOVERY_UNIT"
 install -d -o root -g root -m 0755 "$GUARD_DIR"
 install -o root -g root -m 0644 "$ROOT/deployment/systemd/linux-panel-update-guard.conf" "$GUARD_UNIT"
 chown -R linuxpanel-updater:linuxpanel "$ROOT"
 chmod -R g+rX,g-w,o-w "$ROOT"
 runuser -u linuxpanel -- test -r "$ROOT/apps/api/src/server.js" ||
   die 'Panel lost code access; manual ownership recovery required'
 systemctl daemon-reload
 # Deliberately do NOT start/enable the path watcher, Web gate or an update.
 report INFO 'Installed DISABLED: no automatic updater, broker trigger or panel restart'
 BLOCK=0;WARN=0
 installed_checks
 summary || die 'Post-install verification failed; keep updater disabled'
 exit 0
fi
# Explicit separate release gate: NEVER supplied automatically by --apply.
((ACK==1)) || die '--activate requires --ack-acceptance after external staging and rollback sign-off'
report INFO 'Read-only verification before activation'
installed_checks
summary || die 'Broker activation blocked'
[[ "$(grep -c '^PANEL_UPDATER_ENABLED=' "$CONF" || true)" -le 1 ]] ||
 die 'Duplicate Web updater flags; repair manually'
# Preserve private env content without printing it and restore on service error.
save="$BACKUP_DIR/panel.env.before-activation.$(date +%Y%m%d-%H%M%S)"
install -o root -g root -m 0600 "$CONF" "$save"
tmp="$(mktemp /etc/linux-panel/.panel.env.updater.XXXXXXXX)"
trap 'rm -f -- "$tmp"' EXIT
awk '!/^PANEL_UPDATER_ENABLED=/' "$CONF" > "$tmp"
printf 'PANEL_UPDATER_ENABLED=1\n' >> "$tmp"
chmod 0600 "$tmp";chown root:root "$tmp"
mv -fT -- "$tmp" "$CONF"
trap - EXIT
if ! systemctl enable linux-panel-update-recover.service ||
   ! systemctl enable --now linux-panel-update.path;then
 systemctl disable linux-panel-update-recover.service || true
 install -o root -g root -m 0600 "$save" "$CONF"
 die 'Watcher activation failed; previous Web config restored'
fi
if ! systemctl restart linux-panel.service ||
   ! systemctl is-active --quiet linux-panel.service;then
 systemctl disable --now linux-panel-update.path || true
 systemctl disable linux-panel-update-recover.service || true
 install -o root -g root -m 0600 "$save" "$CONF"
 systemctl restart linux-panel.service || true
 die 'Web restart failed; attempted to restore prior configuration and disable watcher'
fi
pass 'Watcher and Web gate enabled; no update requested/executed'
report INFO 'MCP OAuth update permission still requires separate operator opt-in'
