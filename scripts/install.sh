#!/usr/bin/env bash
# Linux Panel first-install helper for supported Debian/Ubuntu systemd hosts.
# Preconditions: Node.js 24 LTS, npm, git, Nginx and a valid TLS certificate.
# Does not overwrite existing installations, credentials or web sites.
set -Eeuo pipefail
umask 027

usage() {
  cat <<'USAGE'
Usage:
  sudo bash scripts/install.sh --domain panel.example.com \
    --cert /etc/letsencrypt/live/panel.example.com/fullchain.pem \
    --key /etc/letsencrypt/live/panel.example.com/privkey.pem

Options:
  --domain FQDN       Public HTTPS hostname (required)
  --cert FILE         Existing TLS certificate (required unless --no-nginx)
  --key FILE          Existing TLS private key (required unless --no-nginx)
  --no-nginx          Set up only Node/systemd; configure your own HTTPS reverse proxy
  --repo URL          Clone URL (default: https://github.com/Ran-ying/linux-panel.git)
  --ref BRANCH        Git branch to clone (default: main)
  --help              Show this usage

This is a FRESH install, not an updater. Aborts if /opt/linux-panel or
the service/data already exist. Never pipe an unreviewed installer into root.
USAGE
}

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[linux-panel] %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || die "Missing program: $1"; }
DOMAIN='' CERT='' KEY='' REPO='https://github.com/Ran-ying/linux-panel.git' REF='main' NO_NGINX=0
while (($#)); do
  case "$1" in
    --domain|--cert|--key|--repo|--ref)
      (($# >= 2)) || die "Missing value after $1"
      case "$1" in
        --domain) DOMAIN="$2";; --cert) CERT="$2";; --key) KEY="$2";;
        --repo) REPO="$2";; --ref) REF="$2";;
      esac; shift 2;;
    --no-nginx) NO_NGINX=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "Unknown argument: $1";;
  esac
done

((EUID == 0)) || die "Run with sudo/root"
[[ -n "$DOMAIN" && "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die 'Invalid --domain'
[[ "$DOMAIN" == *.* && ! "$DOMAIN" == *..* && "${#DOMAIN}" -le 253 ]] || die 'Use a valid DNS hostname'
[[ "$REF" =~ ^[A-Za-z0-9._/-]+$ && "$REF" != *..* ]] || die 'Invalid --ref'
[[ "$CERT" =~ ^[A-Za-z0-9_./-]*$ && "$KEY" =~ ^[A-Za-z0-9_./-]*$ ]] || die 'Unsafe TLS certificate or key filename'
[[ "$REPO" =~ ^(https://|git@github.com:|ssh://) ]] || die 'Use a trusted HTTPS/SSH Git clone URL'
[[ -r /etc/os-release ]] || die 'Cannot determine OS'
. /etc/os-release
[[ "$ID" == ubuntu || "$ID" == debian ]] || die 'Use supported Debian/Ubuntu with systemd; other distros use the manual guide'
need systemctl; need git; need node; need npm; need runuser; need install; need sed; need df
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
NODE_MINOR="$(node -p "process.versions.node.split('.')[1]")"
if ! { (( NODE_MAJOR == 24 )) || (( NODE_MAJOR == 22 && NODE_MINOR >= 12 )); }; then
  die "Node.js 24 LTS recommended (22.12+ minimum), found $(node -v)"
fi
(( $(df -Pk /opt | awk 'NR==2 {print $4}') >= 1048576 )) || die 'Need >=1 GiB free disk space on /opt filesystem'
[[ ! -e /opt/linux-panel ]] || die '/opt/linux-panel exists; use docs/UPGRADING.md'
[[ ! -e /etc/systemd/system/linux-panel.service ]] || die 'Service unit already exists'
[[ ! -e /var/lib/linux-panel/panel-state.json ]] || die 'Existing user state detected; refusing to overwrite'
if ((NO_NGINX == 0)); then
  need nginx
  [[ "$CERT" == /* && "$KEY" == /* ]] || die 'TLS paths must be absolute'
  [[ -f "$CERT" && -r "$CERT" && -f "$KEY" && -r "$KEY" ]] || die 'Existing TLS --cert and --key must be readable'
  [[ -d /etc/nginx/conf.d && -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]] || die 'Use Debian/Ubuntu standard Nginx layout or --no-nginx'
  [[ ! -e /etc/nginx/sites-available/linux-panel.conf ]] || die 'Nginx linux-panel.conf already exists'
  [[ ! -e /etc/nginx/sites-enabled/linux-panel.conf ]] || die 'Nginx site link already exists'
  [[ ! -e /etc/nginx/conf.d/linux-panel-limits.conf ]] || die 'Nginx limit config already exists'
  [[ -d /etc/nginx/snippets && ! -e /etc/nginx/snippets/linux-panel-proxy.inc ]] || die 'Nginx snippets directory or target file unsuitable'
  if nginx -T 2>&1 | grep -Eq "server_name[[:space:]]+$DOMAIN([[:space:];]|$)"; then
    die "An Nginx server_name for $DOMAIN already exists; stop to avoid overriding it"
  fi
fi
log "Cloning $REPO ($REF). This requires access if the repository is private."
git clone --depth 1 --single-branch --branch "$REF" "$REPO" /opt/linux-panel
cd /opt/linux-panel
log 'Installing locked root dependencies and optional MCP extension dependencies'
"$NPM_BIN" ci --no-audit --no-fund
"$NPM_BIN" install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock
log 'Checking, testing and building the frontend'
"$NPM_BIN" run check
"$NPM_BIN" test
"$NPM_BIN" run build:web
if ! id linuxpanel >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/linux-panel --shell /usr/sbin/nologin linuxpanel
fi
# Root-only nvm installations often fail for the non-root service account.
runuser -u linuxpanel -- "$NODE_BIN" -v >/dev/null || die "Node at $NODE_BIN cannot run as linuxpanel; install system-wide Node.js"
install -d -o linuxpanel -g linuxpanel -m 0700 /var/lib/linux-panel
install -d -o root -g root -m 0755 /etc/linux-panel
[[ ! -e /etc/linux-panel/panel.env ]] || die 'Existing /etc/linux-panel/panel.env detected'
printf 'PANEL_PUBLIC_ORIGIN=https://%s\nPANEL_DATA_DIR=/var/lib/linux-panel\n' "$DOMAIN" > /etc/linux-panel/panel.env
chmod 0600 /etc/linux-panel/panel.env
# Code must stay root-owned and readable by the unprivileged service user.
chown -R root:root /opt/linux-panel
log 'Create your administrator account interactively; no default password is used'
runuser -u linuxpanel -- env PANEL_DATA_DIR=/var/lib/linux-panel "$NODE_BIN" /opt/linux-panel/scripts/admin-init.js admin
sed "s|ExecStart=/usr/bin/node |ExecStart=$NODE_BIN |" deployment/systemd/linux-panel.service.example \
  | sed 's/^Description=.*/Description=Linux Panel (systemd service)/' \
  > /etc/systemd/system/linux-panel.service
chmod 0644 /etc/systemd/system/linux-panel.service
systemctl daemon-reload
systemctl enable --now linux-panel.service
systemctl is-active --quiet linux-panel.service || die 'Linux Panel failed to start; check journalctl -u linux-panel'
if ((NO_NGINX == 0)); then
  # Substitute user-supplied fields only after constraining to safe filesystem strings.
  [[ "$CERT" != *'|'* && "$KEY" != *'|'* && "$CERT" != *$'\n'* && "$KEY" != *$'\n'* ]] || die 'Unsupported TLS filename'
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__CERT__|$CERT|g" -e "s|__KEY__|$KEY|g" \
    deployment/nginx/linux-panel-public.conf.template > /etc/nginx/sites-available/linux-panel.conf
  install -m 0644 deployment/nginx/linux-panel-limits.conf /etc/nginx/conf.d/linux-panel-limits.conf
  install -m 0644 deployment/nginx/linux-panel-proxy.inc /etc/nginx/snippets/linux-panel-proxy.inc
  ln -s /etc/nginx/sites-available/linux-panel.conf /etc/nginx/sites-enabled/linux-panel.conf
  if ! nginx -t; then
    rm -f /etc/nginx/sites-enabled/linux-panel.conf /etc/nginx/sites-available/linux-panel.conf /etc/nginx/conf.d/linux-panel-limits.conf /etc/nginx/snippets/linux-panel-proxy.inc
    die 'Nginx config rejected; proxy files rolled back. The application service is running locally.'
  fi
  systemctl reload nginx || die 'Nginx reload failed; inspect nginx logs'
fi
log "Installed to /opt/linux-panel; data: /var/lib/linux-panel"
log "MCP and new OAuth client registration are OFF until enabled from the Web UI."
log "Check: https://$DOMAIN/api/auth/status"
log 'For future upgrades read docs/UPGRADING.md. Do not run install.sh again.'
