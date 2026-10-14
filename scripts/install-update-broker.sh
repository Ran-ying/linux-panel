#!/usr/bin/env bash
# One-time, operator-controlled installation of the privileged updater broker.
# MUST be reviewed and run manually. Does NOT initiate an update.
set -Eeuo pipefail
(( EUID == 0 )) || { echo 'Run with sudo/root' >&2; exit 1; }
ROOT=/opt/linux-panel
command -v flock >/dev/null && command -v curl >/dev/null || { echo 'Requires flock and curl' >&2;exit 1; }
[[ -d "$ROOT/.git" ]] || { echo 'A Git checkout is required' >&2; exit 1; }
[[ -f /etc/systemd/system/linux-panel.service ]] || { echo 'linux-panel.service not installed' >&2; exit 1; }
[[ "$(git -C "$ROOT" branch --show-current)" == main ]] || { echo 'Expected main branch' >&2; exit 1; }
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || { echo 'Git checkout must be clean' >&2; exit 1; }
[[ -f /var/lib/linux-panel/panel-state.json ]] || { echo 'Missing private panel state' >&2;exit 1; }
[[ ! -e /usr/local/libexec/linux-panel-update-worker ]] || { echo 'Broker already exists; refusing overwrite' >&2;exit 1; }
[[ ! -e /etc/systemd/system/linux-panel-update.path ]] || { echo 'Updater already configured' >&2;exit 1; }
REMOTE="$(git -C "$ROOT" remote get-url origin)"
[[ "$REMOTE" =~ ^(https://github\.com/[^[:space:]]+\.git|git@github\.com:[^[:space:]]+\.git)$ ]] || { echo 'GitHub Git remote URL required' >&2;exit 1; }
if ! id linuxpanel-updater >/dev/null 2>&1;then
  useradd --system --home-dir /var/lib/linux-panel-updater --create-home --shell /usr/sbin/nologin linuxpanel-updater
fi
install -d -m 0755 /usr/local/libexec
install -o root -g root -m 0755 "$ROOT/scripts/update-worker.sh" /usr/local/libexec/linux-panel-update-worker
install -d -o root -g root -m 0755 /etc/linux-panel
install -d -o root -g root -m 0700 /var/lib/linux-panel-update-root
printf '%s\n' "$REMOTE" > /etc/linux-panel/update-source
chown root:root /etc/linux-panel/update-source
chmod 0600 /etc/linux-panel/update-source
install -o root -g root -m 0644 "$ROOT/deployment/systemd/linux-panel-update.path" /etc/systemd/system/
install -o root -g root -m 0644 "$ROOT/deployment/systemd/linux-panel-update.service" /etc/systemd/system/
chown -R linuxpanel-updater:linuxpanel-updater "$ROOT"
install -d -o linuxpanel-updater -g linuxpanel-updater -m 0700 /var/lib/linux-panel-updater
# chmod 0755 on checkout dirs was already necessary for linuxpanel service.
if ! grep -q '^PANEL_UPDATER_ENABLED=1$' /etc/linux-panel/panel.env;then
  printf '\nPANEL_UPDATER_ENABLED=1\n' >> /etc/linux-panel/panel.env
fi
systemctl daemon-reload
systemctl enable --now linux-panel-update.path
systemctl restart linux-panel.service
echo 'Updater installed. Configure a read-only GitHub deploy key for linuxpanel-updater if repository is private.'
echo 'For private repos MCP clients may supply targetSha (obtained via GitHub) without granting Git access to the Web service.'
echo 'MCP update requests are still forbidden until you explicitly enable the update policy and authorize panel:update.'
