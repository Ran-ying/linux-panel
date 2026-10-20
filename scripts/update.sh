#!/usr/bin/env bash
# Conservative, planned downtime update for Git-based systemd installations.
set -Eeuo pipefail
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
((EUID == 0)) || die 'Run as root/sudo'
# Never mix the root-driven manual updater with a separately installed
# linuxpanel-updater-owned checkout and root Broker transaction machinery.
if [[ -e /usr/local/libexec/linux-panel-update-worker ||
      -L /usr/local/libexec/linux-panel-update-worker ||
      -e /etc/systemd/system/linux-panel-update.service ||
      -L /etc/systemd/system/linux-panel-update.service ]];then
  die 'Installed update Broker detected; use the Broker update/recovery flow, not scripts/update.sh'
fi
[[ -d /opt/linux-panel/.git ]] || die 'No Git checkout at /opt/linux-panel'
cd /opt/linux-panel
[[ -z "$(git status --porcelain)" ]] || die 'Working tree contains local changes'
[[ "$(git branch --show-current)" == main ]] || die 'This updater requires main branch'
[[ -f /var/lib/linux-panel/panel-state.json ]] || die 'Missing private state file'
systemctl cat linux-panel.service >/dev/null || die 'Missing service unit'
OLD="$(git rev-parse HEAD)"
git fetch origin main
NEW="$(git rev-parse origin/main)"
if [[ "$OLD" == "$NEW" ]]; then echo "Already up to date: $OLD"; exit 0; fi
echo "Updating $OLD -> $NEW"
cp -a /var/lib/linux-panel/panel-state.json "/var/lib/linux-panel/panel-state.json.before-${OLD:0:12}"
systemctl stop linux-panel.service
git merge --ff-only origin/main || die 'Non-fast-forward refused; restore service manually'
npm ci --no-audit --no-fund
npm install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock
npm run check
# npm ci is run as root, but actual Web and MCP Actions run as linuxpanel.
# Tests that execute system.info and terminal.execute must run as this ordinary
# account. Make dependencies readable *before* testing; the normal full
# permission normalization after the frontend build remains in place.
chown -R root:linuxpanel /opt/linux-panel
chmod -R -- g+rX,g-w,o-w /opt/linux-panel
# The parent root shell might have sourced the production panel.env. Preserve
# neither its PANEL_* settings (notably PANEL_PUBLIC_ORIGIN) nor NODE_ENV:
# test OAuth fixtures intentionally use a loopback origin and disposable state.
# env -i also prevents root-only HOME/NPM_CONFIG from influencing test results.
runuser -u linuxpanel -- env -i \
  HOME=/var/lib/linux-panel \
  PATH=/opt/node24/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  NODE_ENV=test \
  /opt/node24/bin/npm test
npm run build:web
# npm ci recreates runtime files. Restore the same Web-group visibility that
# a fresh install establishes; do not rely on the operator's default umask.
chown -R root:linuxpanel /opt/linux-panel
chmod -R g+rX,g-w,o-w /opt/linux-panel
runuser -u linuxpanel -- test -r /opt/linux-panel/node_modules/fastify/package.json ||
  die 'Web account cannot read Fastify after manual update'
runuser -u linuxpanel -- test -r /opt/linux-panel/apps/web/dist/index.html ||
  die 'Web account cannot read frontend after manual update'
NODE_BIN="$(command -v node)"
runuser -u linuxpanel -- "$NODE_BIN" --input-type=module -e "await import('fastify'); await import('@fastify/static');" ||
  die 'Web account cannot load production dependencies after manual update'
systemctl start linux-panel.service
systemctl is-active --quiet linux-panel.service || die 'Service failed; inspect journalctl and roll back'
echo "Updated successfully: $(git rev-parse HEAD)"
