#!/usr/bin/env bash
# Disposable QEMU guest only; full immutable worker + real Git/systemd.
set -Eeuo pipefail
[[ "$EUID" == 0 && "${LP_QEMU_EPHEMERAL:-}" == yes &&
   "$(hostname)" == lp-disposable-vm &&
   "$(cloud-init query instance_id 2>/dev/null)" == linux-panel-qemu-powercut-01 &&
   -f /home/stage/lp-worker-under-test.sh ]] ||
 { echo 'REFUSED: non-QEMU acceptance host' >&2; exit 2; }
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || exit 2
if ! command -v git >/dev/null || ! command -v curl >/dev/null;then
 export DEBIAN_FRONTEND=noninteractive
 apt-get -qq update
 apt-get install -y -qq --no-install-recommends git curl
fi
useradd --system --user-group --create-home --home-dir /var/lib/linux-panel-updater \
 --shell /usr/sbin/nologin linuxpanel-updater
useradd --system --user-group --create-home --home-dir /var/lib/linux-panel \
 --shell /usr/sbin/nologin linuxpanel
install -d -o linuxpanel -g linuxpanel -m 0700 /var/lib/linux-panel
install -d -o linuxpanel-updater -g linuxpanel-updater -m 0700 /var/lib/linux-panel-updater
install -d -o root -g root -m 0700 /var/lib/linux-panel-update-root
install -d -o root -g linuxpanel -m 0750 /var/lib/linux-panel-update-status
install -d -o root -g root -m 0755 /etc/linux-panel /usr/local/libexec /opt/node24/bin
install -o linuxpanel -g linuxpanel -m 0600 \
 /home/stage/state/private.json /var/lib/linux-panel/panel-state.json
printf 'PANEL_LISTEN_HOST=127.0.0.1\nPANEL_LISTEN_PORT=4188\nPANEL_DATA_DIR=/var/lib/linux-panel\n' \
 >/etc/linux-panel/panel.env
chmod 0600 /etc/linux-panel/panel.env
printf 'https://github.com/Ran-ying/linux-panel.git\n' >/etc/linux-panel/update-source
chmod 0600 /etc/linux-panel/update-source
install -d -o linuxpanel-updater -g linuxpanel-updater -m 0755 /opt/linux-panel
runuser -u linuxpanel-updater -- git clone -q --single-branch --branch main \
 https://github.com/Ran-ying/linux-panel.git /opt/linux-panel
target="$(runuser -u linuxpanel-updater -- git -C /opt/linux-panel rev-parse HEAD)"
old="$(runuser -u linuxpanel-updater -- git -C /opt/linux-panel rev-parse 'HEAD^')"
[[ "$target" =~ ^[0-9a-f]{40}$ && "$old" =~ ^[0-9a-f]{40}$ ]] || exit 1
runuser -u linuxpanel-updater -- git -C /opt/linux-panel reset --hard "$old"
printf '%s\n' "$target" >/home/stage/lp-target-sha
printf '%s\n' "$old" >/home/stage/lp-old-sha
sha256sum /var/lib/linux-panel/panel-state.json | cut -d' ' -f1 \
 >/home/stage/lp-private-digest
cat >/opt/node24/bin/npm <<'NPM'
#!/usr/bin/env bash
# TEST SUBSTITUTE only. Avoid installing untrusted npm packages in this guest.
set -e
if [[ "${1:-}" == ci && -f /run/lp-hold-npm ]];then
 touch /var/lib/linux-panel-updater/lp-reached-npm
 while [[ -f /run/lp-hold-npm ]];do /usr/bin/sleep 0.3;done
fi
exit 0
NPM
chmod 0755 /opt/node24/bin/npm
cat >/usr/local/libexec/lp-qemu-healthy.py <<'PYTHON'
from http.server import HTTPServer, BaseHTTPRequestHandler
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path != "/api/auth/status":
   self.send_error(404); return
  data=b'{"initialized":true}'
  self.send_response(200)
  self.send_header("Content-Length",str(len(data)))
  self.end_headers()
  self.wfile.write(data)
 def log_message(self, *_): pass
HTTPServer(("127.0.0.1",4188),Handler).serve_forever()
PYTHON
cat >/etc/systemd/system/linux-panel.service <<'UNIT'
[Unit]
Description=Disposable QEMU minimal Web readiness fixture
After=network.target
[Service]
User=linuxpanel
Group=linuxpanel
ExecStart=/usr/bin/python3 /usr/local/libexec/lp-qemu-healthy.py
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
install -o root -g root -m 0755 /home/stage/lp-worker-under-test.sh \
 /usr/local/libexec/linux-panel-update-worker
install -o root -g root -m 0644 /home/stage/lp-update.service \
 /etc/systemd/system/linux-panel-update.service
install -o root -g root -m 0644 /home/stage/lp-recover.service \
 /etc/systemd/system/linux-panel-update-recover.service
install -d -o root -g root -m 0755 /etc/systemd/system/linux-panel.service.d
install -o root -g root -m 0644 /home/stage/lp-guard.conf \
 /etc/systemd/system/linux-panel.service.d/90-update-recovery-guard.conf
systemctl daemon-reload
systemctl enable linux-panel-update-recover.service
# A guest-wide hard power cut immediately after privileged provisioning can
# otherwise lose recently installed systemd unit contents or enablement
# symlink metadata. Commit the unit/state/source-pin files and directory
# entries BEFORE entering the root updater's journaled transaction.
source /home/stage/durable-sync.sh
for path in \
 /usr/local/libexec/linux-panel-update-worker \
 /etc/systemd/system/linux-panel.service \
 /etc/systemd/system/linux-panel-update.service \
 /etc/systemd/system/linux-panel-update-recover.service \
 /etc/systemd/system/linux-panel.service.d/90-update-recovery-guard.conf \
 /etc/linux-panel/panel.env \
 /etc/linux-panel/update-source \
 /var/lib/linux-panel/panel-state.json;do
 durable_sync file "$path"
done
for path in \
 /usr/local/libexec \
 /etc/systemd/system \
 /etc/systemd/system/linux-panel.service.d \
 /etc/systemd/system/multi-user.target.wants \
 /etc/linux-panel \
 /var/lib/linux-panel;do
 durable_sync dir "$path"
done
[[ "$(systemctl is-enabled linux-panel-update-recover.service)" == enabled ]] ||
 { echo 'Recovery unit was not enabled before cut' >&2; exit 1; }
systemctl start linux-panel.service
# systemctl start returns when the process is spawned, not when the HTTP
# listener has completed startup. Do not race the readiness signal.
web_ready=0
for attempt in $(seq 1 40);do
 if curl -fsS --max-time 2 http://127.0.0.1:4188/api/auth/status 2>/dev/null |
    grep -q '"initialized":true';then
  web_ready=1
  break
 fi
 sleep 1
done
if ((web_ready==0));then
 systemctl status linux-panel.service --no-pager --lines=25 || true
 journalctl -u linux-panel.service --no-pager -n 50 || true
 echo 'QEMU fixture Web did not reach healthy HTTP readiness' >&2
 exit 1
fi
test ! -e /var/lib/linux-panel-update-root/active-transaction
touch /run/lp-hold-npm
printf 'id=%s\nsha=%s\n' cccccccccccccccccccccccccccccccc "$target" \
 > /var/lib/linux-panel/update-trigger
chmod 0600 /var/lib/linux-panel/update-trigger
systemctl start --no-block linux-panel-update.service
echo "[qemu-worker] Real systemd worker armed old=$old target=$target"
