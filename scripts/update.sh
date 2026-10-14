#!/usr/bin/env bash
# Conservative, planned downtime update for Git-based systemd installations.
set -Eeuo pipefail
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
((EUID == 0)) || die 'Run as root/sudo'
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
npm test
npm run build:web
systemctl start linux-panel.service
systemctl is-active --quiet linux-panel.service || die 'Service failed; inspect journalctl and roll back'
echo "Updated successfully: $(git rev-parse HEAD)"
