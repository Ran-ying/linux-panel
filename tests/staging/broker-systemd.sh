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
# Random throwaway password, never written to public test logs.
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
systemctl daemon-reload
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

note 'Case 3: same old revision retries successfully with real npm and systemd'
queue 33333333333333333333333333333333 "$TARGET"
wait_result 33333333333333333333333333333333 success
[[ "$(head_now)" == "$TARGET" ]] || fail 'Update did not reach main target'
wait_healthy || fail 'Updated Web unhealthy'
[[ ! -e /var/lib/linux-panel/update-trigger &&
   ! -e /var/lib/linux-panel/update-processing ]] || fail 'Stale marker'
note 'Real HTTP Web approval + OAuth PKCE + MCP → systemd Broker'
# Enable only in this throwaway runner; production remains disabled.
! grep -q '^PANEL_UPDATER_ENABLED=1
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
note 'Not tested: machine power loss, interrupted kernel, Web OAuth approval'
 /etc/linux-panel/panel.env ||
 fail 'Staging panel prematurely permitted live updates'
printf '\nPANEL_UPDATER_ENABLED=1\n' >>/etc/linux-panel/panel.env
systemctl restart linux-panel.service
wait_healthy || fail 'Web unavailable after staging-only gate enablement'
STAGE_PASSWORD="$STAGE_PASSWORD" /opt/node24/bin/node \
 "$GITHUB_WORKSPACE/tests/staging/web-mcp-broker.mjs"
# Restore disabled production-equivalent gate BEFORE legacy migration checks.
sed -i '/^PANEL_UPDATER_ENABLED=1$/d' /etc/linux-panel/panel.env
systemctl restart linux-panel.service
wait_healthy || fail 'Web unavailable after staging-only gate cleanup'
unset STAGE_PASSWORD

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
note 'Not tested: machine power loss, interrupted kernel, Web OAuth approval'
