#!/usr/bin/env bash
# Linux Panel first-install helper. ONLY manages its own Node app, account and
# systemd service. It never reads/writes Nginx, proxy, DNS, firewall or TLS files.
set -Eeuo pipefail
umask 027
usage() {
  cat <<'USAGE'
Usage:
  sudo bash scripts/install.sh --host 127.0.0.1 --port 4188 \
    --node-bin /opt/node24/bin/node [--preflight]

Options:
  --host ADDRESS      HTTP listen address: 127.0.0.1 (default), or 0.0.0.0
  --port PORT         HTTP listen port 1024..65535 (default 4188)
  --public-origin URL Canonical external HTTPS origin for OAuth/login when
                      using a reverse proxy or public listener.
                      Default for loopback: http://127.0.0.1:PORT
  --node-bin FILE     Dedicated Node binary (npm in the same directory)
  --preflight         Read-only compatibility and port-conflict report
  --check             Alias for --preflight (no changes)
  --admin-password-stdin Read one admin password from stdin; for unattended CI.
                      Never place passwords in arguments or environment values.
  --resume            Resume an interrupted FIRST install (before admin init).
                      Requires a clean, root-owned /opt/linux-panel Git checkout,
                      and no service, private state or panel.env.
  --repo URL          Trusted Git repository URL (default GitHub main repo)
  --ref BRANCH        Git branch to clone (default main)
  --help              Print usage

Installer never touches third-party reverse proxies, websites, firewall or
TLS certificates. 0.0.0.0 requires an HTTPS --public-origin and an operator-
managed TLS reverse proxy/firewall. Raw HTTP on a public network is unsafe.
--resume NEVER overwrites service, private state or administrator credentials.
Do not use --resume to update a previously installed panel.
USAGE
}
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[linux-panel] %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || die "Missing program: $1"; }
LP_HOST='127.0.0.1'
LP_PORT='4188'
LP_PUBLIC_ORIGIN=''
LP_ORIGIN_EXPLICIT=0
LP_REQUESTED_NODE_BIN=''
REPO='https://github.com/Ran-ying/linux-panel.git'
REF='main'
PREFLIGHT_ONLY=0
LP_RESUME=0
LP_PASSWORD_STDIN=0
while (($#)); do
  case "$1" in
    --host|--port|--public-origin|--repo|--ref|--node-bin)
      (($#>=2)) || die "Missing value after $1"
      case "$1" in
        --host) LP_HOST="$2";; --port) LP_PORT="$2";;
        --public-origin) LP_PUBLIC_ORIGIN="$2"; LP_ORIGIN_EXPLICIT=1;;
        --repo) REPO="$2";; --ref) REF="$2";;
        --node-bin) LP_REQUESTED_NODE_BIN="$2";;
      esac; shift 2;;
    --preflight|--check) PREFLIGHT_ONLY=1; shift;;
    --admin-password-stdin) LP_PASSWORD_STDIN=1; shift;;
    --resume) LP_RESUME=1; shift;;
    --help|-h) usage; exit 0;;
    *) die "Unknown option: $1; see --help. Proxy/TLS configuration is outside this installer.";;
  esac
done
[[ "$LP_HOST" == '127.0.0.1' || "$LP_HOST" == '0.0.0.0' ]] ||
  die 'Listen --host must be 127.0.0.1 or 0.0.0.0'
[[ "$LP_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$LP_PORT>=1024 && 10#$LP_PORT<=65535)) ||
  die 'Listen --port must be an integer from 1024 to 65535'
LP_PORT="$((10#$LP_PORT))"
[[ "$REF" =~ ^[A-Za-z0-9._/-]+$ && "$REF" != *..* ]] || die 'Invalid --ref'
[[ "$REPO" =~ ^(https://|git@github.com:|ssh://) ]] || die 'Use a trusted HTTPS/SSH Git clone URL'
if [[ -z "$LP_PUBLIC_ORIGIN" ]]; then
  [[ "$LP_HOST" == '127.0.0.1' ]] ||
    die '0.0.0.0 requires explicit HTTPS --public-origin plus operator-managed TLS and firewall'
  LP_PUBLIC_ORIGIN="http://127.0.0.1:$LP_PORT"
else
  [[ "$LP_PUBLIC_ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] ||
    die '--public-origin must be an exact HTTPS origin without a path/trailing slash'
fi
# shellcheck source=scripts/install-preflight.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-preflight.sh"
if ! lp_preflight; then
  die 'Preflight blocked installation. Resolve BLOCK items and retry. No installation changes were made.'
fi
if ((LP_RESUME)); then
  [[ -d /opt/linux-panel && ! -L /opt/linux-panel &&
     -d /opt/linux-panel/.git && ! -L /opt/linux-panel/.git ]] ||
    die '--resume requires a real /opt/linux-panel Git checkout from the interrupted install'
  [[ "$(stat -c '%u' /opt/linux-panel)" == 0 ]] ||
    die '--resume requires a root-owned /opt/linux-panel directory'
  [[ "$(git -C /opt/linux-panel rev-parse --show-toplevel 2>/dev/null)" == /opt/linux-panel ]] ||
    die '--resume refused a checkout outside /opt/linux-panel'
  [[ "$(git -C /opt/linux-panel remote get-url origin)" == "$REPO" ]] ||
    die '--resume Git remote differs from --repo; refusing to overwrite unknown checkout'
  [[ "$(git -C /opt/linux-panel branch --show-current)" == "$REF" ]] ||
    die '--resume Git branch differs from --ref'
  [[ -z "$(git -C /opt/linux-panel status --porcelain)" ]] ||
    die '--resume requires clean tracked/untracked Git status; inspect changes first'
else
  [[ ! -e /opt/linux-panel && ! -L /opt/linux-panel ]] ||
    die '/opt/linux-panel exists; use --resume ONLY for a partial first install, or docs/UPGRADING.md'
fi
if ((PREFLIGHT_ONLY)); then
  log 'All mandatory checks passed. No installation changes were made.'
  exit 0
fi
((EUID==0)) || die 'Run actual installation as root/sudo'
if ((LP_PASSWORD_STDIN)); then
  [[ ! -t 0 ]] || die '--admin-password-stdin requires redirected input'
  # Keep the input out of argv, environment and every Git/npm child process.
  unset LP_ADMIN_PASSWORD
  IFS= read -r LP_ADMIN_PASSWORD || [[ -n "$LP_ADMIN_PASSWORD" ]] || die 'Missing admin password'
  if IFS= read -r LP_EXTRA_LINE || [[ -n "$LP_EXTRA_LINE" ]]; then
    die 'Provide exactly one password line'
  fi
  LP_PASSWORD_BYTES=$(printf '%s' "$LP_ADMIN_PASSWORD" | wc -c)
  ((LP_PASSWORD_BYTES>=12 && LP_PASSWORD_BYTES<=256)) || die 'Password must be 12-256 UTF-8 bytes'
  exec </dev/null
else
  [[ -t 0 ]] || die 'Interactive administrator setup needs a TTY; for CI use --admin-password-stdin'
fi
if [[ -n "$LP_REQUESTED_NODE_BIN" ]]; then
  export PATH="$(dirname "$NODE_BIN"):$PATH"
fi
need systemctl; need git; need runuser; need install; need sed; need df
[[ ! -e /etc/systemd/system/linux-panel.service && ! -L /etc/systemd/system/linux-panel.service ]] ||
  die 'Service unit already exists'
[[ ! -e /var/lib/linux-panel/panel-state.json && ! -L /var/lib/linux-panel/panel-state.json ]] ||
  die 'Existing private state detected; stop'
[[ ! -e /etc/linux-panel/panel.env && ! -L /etc/linux-panel/panel.env ]] ||
  die 'Existing panel.env detected; stop'
if ((LP_RESUME)); then
  log "Resuming incomplete first installation using existing checkout $(git -C /opt/linux-panel rev-parse --short HEAD)"
  log 'No service, private state or configuration existed when preflight ran.'
else
  log "Cloning trusted source $REPO ($REF)"
  git clone --depth 1 --single-branch --branch "$REF" "$REPO" /opt/linux-panel
fi
cd /opt/linux-panel
log 'Installing dependencies and running tests/builds (resource-intensive)'
"$NPM_BIN" ci --no-audit --no-fund
"$NPM_BIN" install --prefix extensions/mcp --omit=dev --no-audit --no-fund --no-package-lock
"$NPM_BIN" run check
"$NPM_BIN" test
"$NPM_BIN" run build:web
if ! id linuxpanel >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/linux-panel --shell /usr/sbin/nologin linuxpanel
fi
runuser -u linuxpanel -- "$NODE_BIN" -v >/dev/null ||
  die 'Selected Node binary cannot run as linuxpanel'
install -d -o linuxpanel -g linuxpanel -m 0700 /var/lib/linux-panel
install -d -o root -g root -m 0755 /etc/linux-panel
printf 'PANEL_LISTEN_HOST=%s\nPANEL_LISTEN_PORT=%s\nPANEL_DATA_DIR=/var/lib/linux-panel\n' \
  "$LP_HOST" "$LP_PORT" > /etc/linux-panel/panel.env
# For loopback-only mode, derive the Origin from the effective port each boot,
# including after a Web-approved listener change.
if (( LP_ORIGIN_EXPLICIT )); then
  printf 'PANEL_PUBLIC_ORIGIN=%s\n' "$LP_PUBLIC_ORIGIN" >> /etc/linux-panel/panel.env
fi
chmod 0600 /etc/linux-panel/panel.env
chown -R root:linuxpanel /opt/linux-panel
chmod -R g+rX,g-w,o-w /opt/linux-panel
# Validate the view of the actual unprivileged service identity, not root/npm.
# This catches install-time umask/mode regressions before initializing an
# administrator or writing a production systemd service.
runuser -u linuxpanel -- test -r /opt/linux-panel/node_modules/fastify/package.json ||
  die 'Web account cannot read Fastify runtime dependencies after install'
runuser -u linuxpanel -- test -r /opt/linux-panel/apps/web/dist/index.html ||
  die 'Web account cannot read built frontend assets after install'
runuser -u linuxpanel -- "$NODE_BIN" --input-type=module -e "await import('fastify'); await import('@fastify/static');" ||
  die 'Web account cannot import production Node dependencies after install'
log 'Initialize admin credentials interactively (only once)'
if ((LP_PASSWORD_STDIN)); then
  printf '%s\n' "$LP_ADMIN_PASSWORD" | runuser -u linuxpanel -- env PANEL_DATA_DIR=/var/lib/linux-panel "$NODE_BIN" /opt/linux-panel/scripts/admin-init.js admin --password-stdin
  unset LP_ADMIN_PASSWORD
else
  runuser -u linuxpanel -- env PANEL_DATA_DIR=/var/lib/linux-panel "$NODE_BIN" /opt/linux-panel/scripts/admin-init.js admin
fi
sed "s|ExecStart=/usr/bin/node |ExecStart=$NODE_BIN |" \
  deployment/systemd/linux-panel.service.example > /etc/systemd/system/linux-panel.service
chmod 0644 /etc/systemd/system/linux-panel.service
systemctl daemon-reload
systemctl enable --now linux-panel.service
systemctl is-active --quiet linux-panel.service ||
  die 'Service failed to start; inspect journalctl -u linux-panel'
log "Installed Linux Panel at $LP_HOST:$LP_PORT"
log 'No reverse proxy, DNS, firewall or certificates were touched.'
log "Canonical origin: $LP_PUBLIC_ORIGIN"
log 'MCP and automatic updater are OFF by default.'
log 'Run preflight checks before installing. See docs/INSTALL.md for operations.'
