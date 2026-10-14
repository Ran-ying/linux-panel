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
if [[ "$1" == run && "${2:-}" == test &&
      -f /var/lib/linux-panel-updater/STAGE_FAIL_NPM_TEST_ONCE ]];then
  rm /var/lib/linux-panel-updater/STAGE_FAIL_NPM_TEST_ONCE
  echo 'Injected one-shot staging npm test failure' >&2
  exit 73
fi
exec "$(cat /opt/node24/bin/npm.realpath)" "$@"
WRAPPER
chmod 0755 /opt/node24/bin/npm
export PATH=/opt/node24/bin:/usr/local/bin:/usr/bin:/bin
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
runuser -u linuxpanel -- /opt/node24/bin/node --input-type=module -e '
import { AuthService } from "/opt/linux-panel/platform/auth/service.js";
import { StateStore } from "/opt/linux-panel/platform/state-store.js";
import { randomBytes } from "node:crypto";
await new AuthService(new StateStore("/var/lib/linux-panel/panel-state.json"))
 .bootstrap("staging",randomBytes(32).toString("hex"));
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
 for i in $(seq 1 360);do
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
healthy || fail 'Rollback did not restore Web'
[[ -f "/var/lib/linux-panel-update-root/panel-state.json.before-$OLD-22222222222222222222222222222222" ]] ||
 fail 'Per-request backup missing'

note 'Case 3: same old revision retries successfully with real npm and systemd'
queue 33333333333333333333333333333333 "$TARGET"
wait_result 33333333333333333333333333333333 success
[[ "$(head_now)" == "$TARGET" ]] || fail 'Update did not reach main target'
healthy || fail 'Updated Web unhealthy'
[[ ! -e /var/lib/linux-panel/update-trigger &&
   ! -e /var/lib/linux-panel/update-processing ]] || fail 'Stale marker'
note 'Real staging systemd/git/npm update and retry PASSED'
note 'Not tested: machine power loss, interrupted kernel, Web OAuth approval'
