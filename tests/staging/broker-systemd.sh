#!/usr/bin/env bash
# DANGEROUS OUTSIDE EPHEMERAL CI. Do not run on VPS or self-hosted runners.
set -Eeuo pipefail
umask 077
fail(){ echo "::error::STAGING: $*" >&2; exit 1; }
note(){ echo "[broker-stage] $*"; }
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted &&
   "${RUNNER_OS:-}" == Linux && "$EUID" == 0 ]] ||
  fail 'Only a disposable GitHub-hosted Linux runner running as root is authorized'
[[ -f "${GITHUB_WORKSPACE:-}/scripts/update-worker.sh" ]] || fail 'Missing PR checkout'
[[ -x "${STAGE_NODE_BIN:-}" && -x "${STAGE_NPM_BIN:-}" ]] || fail 'Missing Node/npm'
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || fail 'Require Ubuntu 24.04'
[[ "$(ps -o comm= -p 1 | tr -d ' ')" == systemd ]] || fail 'Require actual systemd PID 1'
for path in /opt/linux-panel /etc/linux-panel /var/lib/linux-panel \
 /etc/systemd/system/linux-panel.service /etc/systemd/system/linux-panel-update.path \
 /etc/systemd/system/linux-panel-update.service \
 /usr/local/libexec/linux-panel-update-worker;do
 [[ ! -e "$path" && ! -L "$path" ]] || fail "Host already has $path"
done
ROOT=/opt/linux-panel
PORT=49377
RESULT=/var/lib/linux-panel-update-status/result.json
on_exit(){
 local rc=$?
 if ((rc));then
   systemctl status linux-panel.service linux-panel-update.service linux-panel-update.path \
     --no-pager --lines=15 || true
   journalctl -u linux-panel-update.service -u linux-panel.service -n 80 --no-pager || true
   if [[ -f "$RESULT" ]];then cat "$RESULT";fi
 fi
}
trap on_exit EXIT
note 'Install isolated Node 24 shim in disposable runner'
install -d -m 0755 /opt/node24/bin
ln -s "$(readlink -f "$STAGE_NODE_BIN")" /opt/node24/bin/node
readlink -f "$STAGE_NPM_BIN" >/opt/node24/bin/npm.realpath
chmod 0644 /opt/node24/bin/npm.realpath
cat >/opt/node24/bin/npm <<'WRAPPER'
#!/usr/bin/env bash
set -e
if [[ "$1" == ci && -f /var/lib/linux-panel-updater/STAGE_HANG_NPM_CI ]];then
 touch /var/lib/linux-panel-updater/STAGE_NPM_CI_REACHED
 echo '[broker-stage] Holding npm ci until worker is killed' >&2
 while [[ -f /var/lib/linux-panel-updater/STAGE_HANG_NPM_CI ]];do sleep 0.3;done
fi
# A cgroup MemoryMax fault is staged only on ephemeral CI; allocate far
# beyond the worker's temporary 96 MiB cap AFTER its durable journal exists.
if [[ "$1" == ci && -f /var/lib/linux-panel-updater/STAGE_FORCE_CGROUP_OOM ]];then
  touch /var/lib/linux-panel-updater/STAGE_CGROUP_OOM_REACHED
  /usr/bin/python3 -c 'data=bytearray(512*1024*1024); print(len(data))'
  exit 77  # Allocation should be OOM-killed, never succeed.
fi
if [[ ( "$1" == test || ( "$1" == run && "${2:-}" == test ) ) &&
      -f /var/lib/linux-panel-updater/STAGE_FAIL_NPM_TEST_ONCE ]];then
  rm /var/lib/linux-panel-updater/STAGE_FAIL_NPM_TEST_ONCE
  echo 'Injected one-shot staging npm test failure' >&2
  exit 73
fi
exec "$(cat /opt/node24/bin/npm.realpath)" "$@"
WRAPPER
chmod 0755 /opt/node24/bin/npm
export PATH=/opt/node24/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export GIT_TERMINAL_PROMPT=0
git clone -q --single-branch --branch main \
 https://github.com/Ran-ying/linux-panel.git "$ROOT"
TARGET="$(git -C "$ROOT" rev-parse refs/remotes/origin/main)"
OLD="$(git -C "$ROOT" rev-parse "$TARGET^")"
[[ "$TARGET" =~ ^[a-f0-9]{40}$ && "$OLD" =~ ^[a-f0-9]{40}$ ]] ||
 fail 'Invalid staging commit graph'
git -C "$ROOT" reset --hard "$OLD"
note "Old HEAD: $OLD"
note "Target HEAD: $TARGET"
useradd --system --user-group --home-dir /var/lib/linux-panel \
 --shell /usr/sbin/nologin linuxpanel
install -d -o linuxpanel -g linuxpanel -m 0700 /var/lib/linux-panel
install -d -o root -g root -m 0755 /etc/linux-panel
printf 'PANEL_LISTEN_HOST=127.0.0.1\nPANEL_LISTEN_PORT=%s\nPANEL_DATA_DIR=/var/lib/linux-panel\n' "$PORT" \
 > /etc/linux-panel/panel.env
chmod 0600 /etc/linux-panel/panel.env
(cd "$ROOT" && npm ci --no-audit --no-fund &&
 npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock &&
 npm run build:web)
chown -R root:linuxpanel "$ROOT"
chmod -R g+rX,g-w,o-w "$ROOT"
STAGE_PASSWORD="$(/opt/node24/bin/node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
runuser -u linuxpanel -- /usr/bin/env STAGE_PASSWORD="$STAGE_PASSWORD" \
 /opt/node24/bin/node --input-type=module -e '
import { AuthService } from "/opt/linux-panel/platform/auth/service.js";
import { StateStore } from "/opt/linux-panel/platform/state-store.js";
import { randomBytes } from "node:crypto";
await new AuthService(new StateStore("/var/lib/linux-panel/panel-state.json"))
 .bootstrap("staging",process.env.STAGE_PASSWORD);
'
sed 's|ExecStart=/usr/bin/node |ExecStart=/opt/node24/bin/node |' \
 "$ROOT/deployment/systemd/linux-panel.service.example" \
 > /etc/systemd/system/linux-panel.service
chmod 0644 /etc/systemd/system/linux-panel.service
systemctl daemon-reload
systemctl start linux-panel.service
healthy(){
 curl -fsS --max-time 5 -H "Host: 127.0.0.1:$PORT" \
  "http://127.0.0.1:$PORT/api/auth/status" | grep -q '"initialized":true'
}
for i in $(seq 1 30);do if healthy;then break;fi;sleep 1;done
healthy || fail 'Staging panel service unhealthy'
note 'Apply existing restricted broker in DISABLED state'
bash "$ROOT/scripts/install-update-broker.sh" --check
bash "$ROOT/scripts/install-update-broker.sh" --apply
bash "$ROOT/scripts/install-update-broker.sh" --verify
! systemctl is-enabled --quiet linux-panel-update.path || fail 'Premature Broker activation'
! grep -q '^PANEL_UPDATER_ENABLED=1$' /etc/linux-panel/panel.env ||
 fail 'Web update gate unexpectedly enabled'
# Under test: install proposed PR worker as immutable root binary in disposable
# systemd environment without dirtying trusted origin/main Git checkout.
install -o root -g root -m 0755 \
 "$GITHUB_WORKSPACE/scripts/update-worker.sh" \
 /usr/local/libexec/linux-panel-update-worker
install -o root -g root -m 0644 \
 "$GITHUB_WORKSPACE/deployment/systemd/linux-panel-update.service" \
 /etc/systemd/system/linux-panel-update.service
install -o root -g root -m 0644 \
 "$GITHUB_WORKSPACE/deployment/systemd/linux-panel-update-recover.service" \
 /etc/systemd/system/linux-panel-update-recover.service
install -d -o root -g root -m 0755 /etc/systemd/system/linux-panel.service.d
install -o root -g root -m 0644 \
 "$GITHUB_WORKSPACE/deployment/systemd/linux-panel-update-guard.conf" \
 /etc/systemd/system/linux-panel.service.d/90-update-recovery-guard.conf
systemctl daemon-reload
systemctl cat linux-panel.service | grep -Fq 'ConditionPathExists=|!/var/lib/linux-panel-update-root/active-transaction' ||
 fail 'Systemd did not load durable transaction guard'
systemctl cat linux-panel.service | grep -Fq 'ConditionPathExists=|/run/linux-panel-root-updater/allow-panel-start' ||
 fail 'Systemd did not load live-worker startup permit'
[[ "$(systemctl show linux-panel-update.service -p ProtectSystem --value)" == strict ]] ||
 fail 'ProtectSystem not strict'
[[ "$(systemctl show linux-panel-update.service -p NoNewPrivileges --value)" == yes ]] ||
 fail 'NoNewPrivileges not set'
systemctl start linux-panel-update.path
# Only this ephemeral root test driver creates fixed-format trigger markers.
queue(){
 [[ "$1" =~ ^[a-f0-9]{32}$ && "$2" =~ ^[a-f0-9]{40}$ ]] || fail 'Malformed SHA/ID'
 printf 'id=%s\nsha=%s\n' "$1" "$2" >/var/lib/linux-panel/update-trigger
}
wait_result(){
 local id="$1" status="$2"
 for i in $(seq 1 75);do
  if [[ -f "$RESULT" ]] && grep -Fq '"id":"'"$id"'"' "$RESULT";then
   grep -Fq '"status":"'"$status"'"' "$RESULT" ||
    fail "Unexpected result: $(cat "$RESULT")"
   return
  fi
  sleep 2
 done
 fail "Broker timeout for $id"
}
head_now(){ runuser -u linuxpanel-updater -- git -C "$ROOT" rev-parse HEAD; }
wait_healthy(){
 for i in $(seq 1 30);do
  if healthy;then return 0;fi
  sleep 1
 done
 return 1
}

note 'Case 1: reject a wrong Git SHA while Web stays healthy'
queue 11111111111111111111111111111111 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
wait_result 11111111111111111111111111111111 failed
[[ "$(head_now)" == "$OLD" ]] || fail 'Wrong SHA changed checkout'
healthy || fail 'Wrong SHA broke panel'

note 'Case 2: actual npm test failure causes real Git rollback and Web restart'
touch /var/lib/linux-panel-updater/STAGE_FAIL_NPM_TEST_ONCE
chown linuxpanel-updater:linuxpanel-updater \
 /var/lib/linux-panel-updater/STAGE_FAIL_NPM_TEST_ONCE
queue 22222222222222222222222222222222 "$TARGET"
wait_result 22222222222222222222222222222222 rolled_back
[[ "$(head_now)" == "$OLD" ]] || fail 'Rollback did not restore HEAD'
wait_healthy || fail 'Rollback did not restore Web'
[[ -f "/var/lib/linux-panel-update-root/panel-state.json.before-$OLD-22222222222222222222222222222222" ]] ||
 fail 'Per-request backup missing'

note 'Case 3: SIGKILL root Broker during npm ci, then dedicated boot recovery'
touch /var/lib/linux-panel-updater/STAGE_HANG_NPM_CI
chown linuxpanel-updater:linuxpanel-updater \
 /var/lib/linux-panel-updater/STAGE_HANG_NPM_CI
queue 44444444444444444444444444444444 "$TARGET"
transaction=/var/lib/linux-panel-update-root/active-transaction
saw_interrupt_point=0
for i in $(seq 1 150);do
 if [[ -f "$transaction" &&
       -f /var/lib/linux-panel-updater/STAGE_NPM_CI_REACHED ]];then
   saw_interrupt_point=1; break
 fi
 sleep 0.2
done
((saw_interrupt_point)) || fail 'Worker never reached in-flight recovery point'
systemctl kill --kill-who=all --signal=SIGKILL linux-panel-update.service || true
rm -f /var/lib/linux-panel-updater/STAGE_HANG_NPM_CI
for i in $(seq 1 30);do
  if ! systemctl is-active --quiet linux-panel-update.service;then break;fi
  sleep 0.2
done
[[ -f "$transaction" ]] || fail 'SIGKILL lost durable transaction'
[[ -f /var/lib/linux-panel/update-processing ]] || fail 'SIGKILL lost processing metadata'
systemctl reset-failed linux-panel-update.service || true
# Simulate systemd boot recovery without rebooting the ephemeral CI runner.
systemctl start linux-panel-update-recover.service
note 'Boot recovery unit returned; examining exact transaction result'
[[ -f "$RESULT" ]] && cat "$RESULT" || true
wait_result 44444444444444444444444444444444 rolled_back
[[ "$(head_now)" == "$OLD" ]] || fail 'Recovery did not restore old Git revision'
wait_healthy || fail 'Recovery failed to restart healthy Web'
[[ ! -e "$transaction" && ! -e /var/lib/linux-panel/update-processing ]] ||
 fail 'Recovery left active transaction or processing file'
# Recovery entrypoint must never consume a fresh unrelated trigger.
systemctl start linux-panel-update-recover.service
note 'SIGKILL interrupted deployment recovered through real systemd unit'

note 'Case 4: real cgroup OOM inside npm ci must fail closed and recover'
[[ -e /sys/fs/cgroup/cgroup.controllers ]] ||
  fail 'OOM acceptance requires real systemd unified cgroup v2'
# MemoryMax affects only this disposable root worker service, never Web or
# unrelated systemd units. The root journal is written before npm ci.
systemctl set-property --runtime linux-panel-update.service MemoryMax=96M
[[ "$(systemctl show linux-panel-update.service -p MemoryMax --value)" == 100663296 ]] ||
  fail 'Failed to apply 96MiB cgroup memory limit'
touch /var/lib/linux-panel-updater/STAGE_FORCE_CGROUP_OOM
chown linuxpanel-updater:linuxpanel-updater   /var/lib/linux-panel-updater/STAGE_FORCE_CGROUP_OOM
queue 77777777777777777777777777777777 "$TARGET"
oom_reached=0
for i in $(seq 1 180);do
  if [[ -f /var/lib/linux-panel-updater/STAGE_CGROUP_OOM_REACHED ]];then
    oom_reached=1
    break
  fi
  sleep 0.2
done
((oom_reached)) || fail 'Broker never reached the deliberate npm-ci cgroup OOM'
# is-active exits nonzero while a Type=oneshot unit is *activating*:
# that does not mean the root worker exited. Do not start recovery until PID1
# explicitly reports a terminal state, or it can race the live root lock.
oom_terminal=0
for i in $(seq 1 450);do
  worker_state="$(systemctl show linux-panel-update.service -p ActiveState --value)"
  if [[ "$worker_state" == failed || "$worker_state" == inactive ]];then
    oom_terminal=1
    break
  fi
  sleep 0.2
done
((oom_terminal)) ||
  fail 'OOM-constrained worker never entered failed/inactive terminal state'
systemctl set-property --runtime linux-panel-update.service MemoryMax=infinity
rm -f /var/lib/linux-panel-updater/STAGE_FORCE_CGROUP_OOM   /var/lib/linux-panel-updater/STAGE_CGROUP_OOM_REACHED
# The killed worker may have rolled back itself, or be unable to do so while
# memory-capped. In either case, only the independent recovery unit may
# settle an outstanding root journal after lifting the resource limit.
if [[ -f "$transaction" ]];then
  systemctl reset-failed linux-panel-update.service || true
  systemctl start linux-panel-update-recover.service
fi
wait_result 77777777777777777777777777777777 rolled_back
[[ "$(head_now)" == "$OLD" ]] || fail 'OOM recovery left updated Git HEAD'
wait_healthy || fail 'OOM recovery did not restore Web'
[[ ! -e "$transaction" && ! -e /var/lib/linux-panel/update-processing ]] ||
  fail 'OOM recovery left unfinished root transaction'
note 'Real cgroup OOM during npm recovered old revision and Web'

note 'Case 5: real ENOSPC in isolated status tmpfs retains recovery journal'
# The only full filesystem is a temporary status-only mount in a disposable
# GitHub-hosted runner. No root/opt/VPS filesystem is filled or modified.
status_dir=/var/lib/linux-panel-update-status
mountpoint -q "$status_dir" && fail 'Status already mounted unexpectedly'
mount -t tmpfs -o size=1m,mode=0750 tmpfs "$status_dir" ||
 fail 'Cannot isolate the status mount; refuse disk-fill test'
# Force real kernel ENOSPC, not an injected shell return code. Never fill /
# or any application/data filesystem used by another service.
if dd if=/dev/zero of="$status_dir/.enospc-only" bs=4096 count=512 status=none 2>/dev/null;then
 fail 'Status-only tmpfs unexpectedly accepted twice its declared capacity'
fi
[[ "$(df -Pk "$status_dir" | awk 'NR==2{print $4}')" == 0 ]] ||
 fail 'Status tmpfs did not reach actual ENOSPC'
# Existing target remains trusted. The injected npm-test failure triggers
# rollback, but its final status cannot be persisted while tmpfs is full.
touch /var/lib/linux-panel-updater/STAGE_FAIL_NPM_TEST_ONCE
chown linuxpanel-updater:linuxpanel-updater \
 /var/lib/linux-panel-updater/STAGE_FAIL_NPM_TEST_ONCE
enospc_id=88888888888888888888888888888888
queue "$enospc_id" "$TARGET"
enospc_terminal=0
for i in $(seq 1 450);do
  state_now="$(systemctl show linux-panel-update.service -p ActiveState --value)"
  if [[ "$state_now" == failed || "$state_now" == inactive ]];then
    # Do not mistake a pre-start inactive state for completion: require
    # the durable transaction first and the exact worker job to finish.
    if [[ -f "$transaction" &&
          -f "/var/lib/linux-panel-update-root/panel-state.json.before-$OLD-$enospc_id" ]];then
      enospc_terminal=1
      break
    fi
  fi
  sleep 0.2
done
((enospc_terminal)) ||
 fail 'ENOSPC case failed to reach terminal journaled worker state'
[[ "$(head_now)" == "$OLD" ]] ||
 fail 'ENOSPC rollback changed expected original Git HEAD'
[[ -f "$transaction" && -f /var/lib/linux-panel/update-processing ]] ||
 fail 'ENOSPC incorrectly discarded active transaction'
! grep -Fq '"status":"success"' "$status_dir/result.json" 2>/dev/null ||
 fail 'ENOSPC produced a false durable success result'
# Recover only after freeing the dedicated status filesystem. This unmasks
# the original status directory (normal root-owned persistence path).
rm -f -- "$status_dir/.enospc-only"
umount "$status_dir"
systemctl reset-failed linux-panel-update.service || true
systemctl start linux-panel-update-recover.service ||
 fail 'Boot recovery could not settle once status space returned'
wait_result "$enospc_id" rolled_back
[[ "$(head_now)" == "$OLD" ]] || fail 'ENOSPC recovery changed original HEAD'
wait_healthy || fail 'ENOSPC recovery left Web unavailable'
[[ ! -e "$transaction" && ! -e /var/lib/linux-panel/update-processing ]] ||
 fail 'ENOSPC recovery left root journal or processing marker'
note 'Actual status-filesystem ENOSPC retained journal, then independently recovered'

note 'Case 4: valid Web or MCP update after real crash recovery'
[[ "${STAGE_POSITIVE_PATH:-}" == web || "${STAGE_POSITIVE_PATH:-}" == mcp ]] ||
  fail 'Positive path must be web or mcp'
[[ "$(head_now)" == "$OLD" ]] || fail 'Positive HTTP test requires old revision'
# Resource acceptance: constrain the COMPLETE real npm ci/check/test/build
# transaction, not only a synthetic Python allocator. This test-only cgroup
# cap is never set on an actual VPS. No first-run package cache assumptions.
systemctl set-property --runtime linux-panel-update.service MemoryMax=768M CPUQuota=100%
[[ "$(systemctl show linux-panel-update.service -p MemoryMax --value)" == 805306368 ]] ||
 fail 'Cannot apply real 768MiB root-worker cgroup cap'
[[ "$(systemctl show linux-panel-update.service -p CPUQuotaPerSecUSec --value)" == 1s ]] ||
 fail 'Cannot apply single-vCPU 100% CPUQuota to root worker'
resource_start_seconds="$SECONDS"
code_before_kib="$(df -Pk "$ROOT" | awk 'NR==2{print $4}')"
free_before_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
note "FULL npm ci/check/test/build with MemoryMax=768MiB (free code disk ${code_before_kib}KiB)"
# A Type=oneshot worker's cgroup disappears immediately after it exits.
# Sample the authoritative kernel cgroup-v2 memory.peak WHILE the real
# npm transaction is active; systemctl show MemoryPeak afterward is [not set].
peak_file="$(mktemp /tmp/lp-updater-memory-peak.XXXXXXXX)"
(
 max=0
 while [[ ! -e "$peak_file.stop" ]];do
   control_group="$(systemctl show linux-panel-update.service -p ControlGroup --value 2>/dev/null || true)"
   if [[ "$control_group" == /system.slice/linux-panel-update.service &&
         -r "/sys/fs/cgroup${control_group}/memory.peak" ]];then
     # The oneshot cgroup may vanish between -r and cat on completion.
     sample="$(cat "/sys/fs/cgroup${control_group}/memory.peak" 2>/dev/null || true)"
     if [[ "$sample" =~ ^[0-9]+$ ]] && ((sample>max));then
       max="$sample"
       printf '%s\n' "$max" > "$peak_file"
     fi
   fi
   sleep 0.1
 done
) &
resource_sampler_pid=$!
note 'Real HTTP Web approval + OAuth PKCE + MCP → systemd Broker'
# Enabled only in throwaway GitHub-hosted runner.
! grep -q '^PANEL_UPDATER_ENABLED=1$' /etc/linux-panel/panel.env ||
 fail 'Staging Web gate prematurely enabled'
printf '\nPANEL_UPDATER_ENABLED=1\n' >>/etc/linux-panel/panel.env
systemctl restart linux-panel.service
wait_healthy || fail 'Web unhealthy after staging-only gate enable'
STAGE_PASSWORD="$STAGE_PASSWORD" STAGE_POSITIVE_PATH="$STAGE_POSITIVE_PATH" \
 STAGE_OLD_SHA="$OLD" STAGE_TARGET_SHA="$TARGET" \
 /opt/node24/bin/node "$GITHUB_WORKSPACE/tests/staging/web-mcp-broker.mjs"
[[ "$(head_now)" == "$TARGET" ]] || fail 'Positive HTTP update did not reach target SHA'
grep -Fq '"status":"success"' "$RESULT" || fail 'Root Broker did not report success'
touch "$peak_file.stop"
wait "$resource_sampler_pid" || fail 'Cgroup resource sampler unexpectedly failed'
peak_bytes="$(cat "$peak_file")"
rm -f -- "$peak_file" "$peak_file.stop"
code_after_kib="$(df -Pk "$ROOT" | awk 'NR==2{print $4}')"
[[ "$peak_bytes" =~ ^[0-9]+$ && "$peak_bytes" -gt 0 ]] ||
 fail "Kernel cgroup-v2 memory.peak was never sampled for the real npm transaction: $peak_bytes"
resource_elapsed_seconds="$((SECONDS-resource_start_seconds))"
note "Measured actual peak cgroup-v2 memory.peak=${peak_bytes} bytes; MemoryMax=805306368 CPUQuota=100%; total positive HTTP update ${resource_elapsed_seconds}s; code before=${code_before_kib}KiB after=${code_after_kib}KiB"
systemctl set-property --runtime linux-panel-update.service MemoryMax=infinity CPUQuota=infinity
wait_healthy || fail 'Updated Web unhealthy'
[[ ! -e /var/lib/linux-panel/update-trigger &&
   ! -e /var/lib/linux-panel/update-processing ]] || fail 'Stale marker'
sed -i '/^PANEL_UPDATER_ENABLED=1$/d' /etc/linux-panel/panel.env
systemctl restart linux-panel.service
wait_healthy || fail 'Web unhealthy after staging gate reset'
unset STAGE_PASSWORD
note 'Recovery must withhold rolled_back until restarted Web answers HTTP'
# A synthetic crash before backup: old revision and state already intact.
# Install a disposable runtime-only dummy Web process that reports active but
# never answers HTTP, then require the root recovery journal to survive.
unhealthy_id=66666666666666666666666666666666
saved_state_sha="$(sha256sum /var/lib/linux-panel/panel-state.json | awk '{print $1}')"
printf 'id=%s\nsha=%s\nold=%s\n' "$unhealthy_id" "$TARGET" "$TARGET" \
 > /var/lib/linux-panel-update-root/active-transaction
chmod 0600 /var/lib/linux-panel-update-root/active-transaction
systemctl stop linux-panel.service
install -d -m 0755 /run/systemd/system/linux-panel.service.d
cat >/run/systemd/system/linux-panel.service.d/stage-unhealthy.conf <<'STAGE_SERVICE'
[Service]
ExecStart=
ExecStart=/usr/bin/sleep 90
Restart=no
STAGE_SERVICE
systemctl daemon-reload
if systemctl start linux-panel-update-recover.service;then
 fail 'Active-but-unhealthy Web must never be accepted as rolled_back'
fi
wait_result "$unhealthy_id" failed
[[ -f "$transaction" ]] || fail 'Unhealthy rollback erased transaction'
! systemctl is-active --quiet linux-panel.service ||
 fail 'Failed recovery left unhealthy Web process active'
[[ ! -e /run/linux-panel-root-updater/allow-panel-start ]] ||
 fail 'Failed recovery left volatile startup bypass'
[[ "$(sha256sum /var/lib/linux-panel/panel-state.json | awk '{print $1}')" == "$saved_state_sha" ]] ||
 fail 'Failed recovery modified private state'
rm -f /run/systemd/system/linux-panel.service.d/stage-unhealthy.conf
systemctl daemon-reload
systemctl reset-failed linux-panel.service linux-panel-update-recover.service || true
systemctl start linux-panel-update-recover.service
wait_result "$unhealthy_id" rolled_back
[[ ! -e "$transaction" ]] || fail 'Successful retry retained root journal'
wait_healthy || fail 'Retry did not restore real Web listener'
[[ "$(sha256sum /var/lib/linux-panel/panel-state.json | awk '{print $1}')" == "$saved_state_sha" ]] ||
 fail 'Retry altered original private state'
note 'Active-but-unhealthy recovery denied and manual retry passed'

note 'Failed boot recovery must block panel until root operator resolves journal'
# Synthetic transaction points to an OLD SHA but deliberately lacks its
# per-request state snapshot. This exercises the fail-closed path without
# changing the successful Git checkout or deleting real backups.
blocked_id=55555555555555555555555555555555
printf 'id=%s\nsha=%s\nold=%s\n' "$blocked_id" "$TARGET" "$OLD" \
 > /var/lib/linux-panel-update-root/active-transaction
chmod 0600 /var/lib/linux-panel-update-root/active-transaction
rm -f "/var/lib/linux-panel-update-root/panel-state.json.before-$OLD-$blocked_id"
systemctl stop linux-panel.service
if systemctl start linux-panel-update-recover.service;then
 fail 'Recovery with missing state snapshot must fail'
fi
wait_result "$blocked_id" failed
[[ -f /var/lib/linux-panel-update-root/active-transaction ]] ||
 fail 'Failed recovery erased root transaction'
systemctl reset-failed linux-panel-update-recover.service || true
# Conditions use systemd PID1 evaluation. A successful start command can be
# SKIPPED, so verify actual service remains inactive.
systemctl start linux-panel.service || true
if systemctl is-active --quiet linux-panel.service;then
 fail 'Unresolved root journal allowed non-broker panel startup'
fi
! systemctl is-active --quiet linux-panel-update.service ||
 fail 'Unexpected privileged worker execution'
# Test-only operator repair: remove synthetic journal, no application data
# was touched by this deliberately pre-backup failed recovery.
rm -f /var/lib/linux-panel-update-root/active-transaction
systemctl reset-failed linux-panel.service || true
systemctl start linux-panel.service
wait_healthy || fail 'Recovered Web did not return after operator cleanup'
note 'Fail-closed systemd boot guard verified against missing recovery snapshot'

systemctl stop linux-panel-update.path
note 'Stage migration from LEGACY already-installed immutable worker/service'
# Historical real installer snapshot from a known public main revision.
LEGACY=cdc48a38d7e89298bd410fe78611f98e03c786f4
runuser -u linuxpanel-updater -- git -C "$ROOT" cat-file -e "${LEGACY}^{commit}" ||
  fail 'Expected audited legacy commit absent from test Git history'
legacy_dir="$(mktemp -d /tmp/linux-panel-legacy-XXXXXXXX)"
chmod 0700 "$legacy_dir"
runuser -u linuxpanel-updater -- git -C "$ROOT" show "$LEGACY:scripts/update-worker.sh" \
  > "$legacy_dir/worker"
runuser -u linuxpanel-updater -- git -C "$ROOT" show "$LEGACY:deployment/systemd/linux-panel-update.service" \
  > "$legacy_dir/service"
install -o root -g root -m 0755 "$legacy_dir/worker" /usr/local/libexec/linux-panel-update-worker
install -o root -g root -m 0644 "$legacy_dir/service" /etc/systemd/system/linux-panel-update.service
systemctl daemon-reload
[[ "$(head_now)" == "$TARGET" ]] || fail 'Migration staging checkout not at approved main'
[[ ! -e /var/lib/linux-panel/update-trigger && ! -e /var/lib/linux-panel/update-processing ]] ||
 fail 'Marker not cleared before legacy simulation'
pid_before="$(systemctl show linux-panel.service -p MainPID --value)"
# Test the proposed upgrade script against the checked-out historical main
# without altering the public GitHub pinned checkout. The only test-only
# difference is the proposed recovery unit source/blob identity.
raw_migration="$GITHUB_WORKSPACE/scripts/upgrade-update-broker.sh"
MIGRATION="$(mktemp /tmp/linux-panel-migration-stage.XXXXXXXX)"
sed \
 -e "s|SOURCE_RECOVERY=\"\$ROOT/deployment/systemd/linux-panel-update-recover.service\"|SOURCE_RECOVERY=\"$GITHUB_WORKSPACE/deployment/systemd/linux-panel-update-recover.service\"|" \
 -e 's|expected_recovery="$(runuser -u linuxpanel-updater -- git -C "$ROOT" rev-parse HEAD:deployment/systemd/linux-panel-update-recover.service)"|expected_recovery="$(git hash-object -- "$SOURCE_RECOVERY")"|' \
 -e 's|SOURCE_GUARD="$ROOT/deployment/systemd/linux-panel-update-guard.conf"|SOURCE_GUARD="'"$GITHUB_WORKSPACE"'/deployment/systemd/linux-panel-update-guard.conf"|' \
 -e 's|expected_guard="$(runuser -u linuxpanel-updater -- git -C "$ROOT" rev-parse HEAD:deployment/systemd/linux-panel-update-guard.conf)"|expected_guard="$(git hash-object -- "$SOURCE_GUARD")"|' \
 "$raw_migration" > "$MIGRATION"
chmod 0700 "$MIGRATION"

bash -n "$MIGRATION"
bash "$MIGRATION" --check
if bash "$MIGRATION" --verify;then
  fail 'Read-only migration verification incorrectly accepted legacy files'
fi
# Rehearse an exactly-once post-replacement systemd daemon-reload failure:
# the migration must restore both prior artifacts from its root-only backup.
inject_dir="$(mktemp -d /tmp/linux-panel-migrate-fault-XXXXXXXX)"
chmod 0700 "$inject_dir"
cat >"$inject_dir/systemctl" <<'SYSTEMCTL'
#!/usr/bin/env bash
if [[ "$1" == daemon-reload && ! -e /tmp/lp-migrate-daemon-failed-once ]];then
  /usr/bin/touch /tmp/lp-migrate-daemon-failed-once
  exit 73
fi
exec /usr/bin/systemctl "$@"
SYSTEMCTL
chmod 0755 "$inject_dir/systemctl"
if PATH="$inject_dir:$PATH" bash "$MIGRATION" --apply;then
 fail 'Injected systemd failure incorrectly reported migration success'
fi
cmp -s /usr/local/libexec/linux-panel-update-worker "$legacy_dir/worker" ||
 fail 'Migration failure did not restore installed legacy worker'
cmp -s /etc/systemd/system/linux-panel-update.service "$legacy_dir/service" ||
 fail 'Migration failure did not restore legacy systemd unit'
! systemctl is-active --quiet linux-panel-update.path || fail 'Watcher enabled by failed migration'
healthy || fail 'Failed Broker migration interrupted Web API'

note 'Successful migration after fault injection: root worker/unit and live sandbox'
bash "$MIGRATION" --check
bash "$MIGRATION" --apply
bash "$MIGRATION" --verify
cmp -s /usr/local/libexec/linux-panel-update-worker "$ROOT/scripts/update-worker.sh" ||
 fail 'Installed worker does not match current pinned Git source'
cmp -s /etc/systemd/system/linux-panel-update.service "$ROOT/deployment/systemd/linux-panel-update.service" ||
 fail 'Installed Broker unit does not match current pinned Git source'
find /var/lib/linux-panel-update-root -maxdepth 1 -name '.broker-migration-*' -type d | grep -q . ||
 fail 'No per-run root backup persisted'
[[ "$(systemctl show linux-panel.service -p MainPID --value)" == "$pid_before" ]] ||
 fail 'Migration restarted running Web service'
! systemctl is-active --quiet linux-panel-update.path || fail 'Migration activated update watcher'
! systemctl is-enabled --quiet linux-panel-update.path || fail 'Migration enabled update watcher'
! grep -q '^PANEL_UPDATER_ENABLED=1$' /etc/linux-panel/panel.env ||
 fail 'Migration enabled Web updater gate'
bash "$MIGRATION" --apply  # idempotent no-op
bash "$MIGRATION" --verify
note 'Real migration from old immutable root-worker succeeded and stayed DISABLED'

note 'Real staging systemd/git/npm update and retry PASSED'
note 'Not tested: machine power loss, interrupted kernel, resource starvation'
