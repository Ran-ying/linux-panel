#!/usr/bin/env bash
# Read-only host compatibility gate for scripts/install.sh.
# Sourced by install.sh after validating CLI arguments; NO host mutations.
lp_preflight() {
  local blockers=0 warnings=0 os_id='' os_version='' systemd_version=''
  local node_major='' node_minor='' node_version='' nginx_version=''
  local memory_kib='' swap_kib='' free_kib='' disk_kib=''
  lp_report() {
    printf '[%-5s] %s\n' "$1" "$2"
    case "$1" in BLOCK) blockers=$((blockers+1));; WARN) warnings=$((warnings+1));; esac
  }
  printf 'Linux Panel install preflight (read-only)\n'
  printf '  Domain: %s | Nginx managed by installer: %s\n' "$DOMAIN" "$([[ "$NO_NGINX" == 1 ]] && echo no || echo yes)"

  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    os_id="${ID:-}"
    os_version="${VERSION_ID:-}"
    local os_major="${os_version%%.*}"
    if [[ "$os_major" =~ ^[0-9]+$ ]] &&
      { { [[ "$os_id" == ubuntu ]] && (( os_major >= 24 )); } ||
        { [[ "$os_id" == debian ]] && (( os_major >= 12 )); }; }; then
      lp_report PASS "OS: $PRETTY_NAME"
    else
      lp_report BLOCK "OS $os_id $os_version unsupported: use Ubuntu 24.04+ or Debian 12+."
    fi
  else
    lp_report BLOCK 'Cannot read /etc/os-release.'
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemd_version="$(systemctl --version 2>/dev/null | awk 'NR==1 {print $2}')"
    if [[ "$systemd_version" =~ ^[0-9]+$ ]] && (( systemd_version >= 240 )); then
      lp_report PASS "systemd $systemd_version (>= 240 for the update broker)"
    else
      lp_report BLOCK "systemd ${systemd_version:-unknown} is too old: require >= 240 (do not bypass broker sandbox requirements)."
    fi
  else
    lp_report BLOCK 'systemctl missing: this installer requires systemd.'
  fi

  if [[ -n "${LP_REQUESTED_NODE_BIN:-}" ]]; then
    NODE_BIN="$LP_REQUESTED_NODE_BIN"
    if [[ "$NODE_BIN" != /* ]]; then
      lp_report BLOCK '--node-bin must be an absolute path to an isolated system-readable Node executable.'
    fi
    NPM_BIN="$(dirname "$NODE_BIN")/npm"
  else
    NODE_BIN="$(command -v node 2>/dev/null || true)"
    NPM_BIN="$(command -v npm 2>/dev/null || true)"
  fi

  if [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]]; then
    node_version="$("$NODE_BIN" -p 'process.versions.node' 2>/dev/null || true)"
    IFS=. read -r node_major node_minor _ <<< "$node_version"
    if [[ "$node_major" =~ ^[0-9]+$ && "$node_minor" =~ ^[0-9]+$ ]] &&
      { (( node_major >= 24 )) || (( node_major == 22 && node_minor >= 12 )); }; then
      lp_report PASS "Node.js $node_version ($NODE_BIN)"
      if (( node_major != 24 )); then
        lp_report WARN 'Node.js 24 LTS is recommended; 22.12+ is currently accepted.'
      fi
    else
      lp_report BLOCK "Node.js ${node_version:-not executable/unknown} ($NODE_BIN): need 24 LTS or 22.12+. Do not replace Node used by other apps; use --node-bin /opt/node24/bin/node."
    fi
  else
    lp_report BLOCK "Node.js executable not found: ${NODE_BIN:-not installed}. Install a compatible isolated runtime."
  fi
  if [[ -n "$NPM_BIN" && -x "$NPM_BIN" ]]; then
    lp_report PASS "npm available ($NPM_BIN)"
  else
    lp_report BLOCK "npm missing/not executable at ${NPM_BIN:-unknown}. The selected Node installation must supply npm."
  fi
  for cmd in git runuser install sed awk df ss useradd; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      lp_report BLOCK "Required command '$cmd' missing; install its OS package first."
    fi
  done

  if command -v ss >/dev/null 2>&1; then
    if [[ -n "$(ss -H -ltn '( sport = :4188 )' 2>/dev/null)" ]]; then
      lp_report BLOCK 'Port 4188 is already listening; stop or reconfigure the conflicting service before installing.'
    else
      lp_report PASS 'Port 4188 appears free (rechecked during installation).'
    fi
  fi
  for target in /opt/linux-panel /etc/systemd/system/linux-panel.service /etc/linux-panel/panel.env /var/lib/linux-panel/panel-state.json; do
    if [[ -e "$target" || -L "$target" ]]; then
      lp_report BLOCK "Existing panel component $target: use upgrade/migration procedure; never overwrite."
    fi
  done

  if [[ -d /opt ]]; then
    disk_kib="$(df -Pk /opt 2>/dev/null | awk 'NR==2 {print $4}')"
    if [[ "$disk_kib" =~ ^[0-9]+$ ]]; then
      if (( disk_kib < 1048576 )); then
        lp_report BLOCK "Only $((disk_kib/1024)) MiB free on /opt: at least 1024 MiB required."
      elif (( disk_kib < 5242880 )); then
        lp_report WARN "Only $((disk_kib/1024)) MiB free on /opt; 5 GiB+ recommended for build, backup and rollback."
      else
        lp_report PASS "$((disk_kib/1024)) MiB free on /opt"
      fi
    else
      lp_report BLOCK 'Cannot determine free space on /opt.'
    fi
  else
    lp_report BLOCK 'Missing /opt; create standard /opt directory before installing.'
  fi
  if [[ -r /proc/meminfo ]]; then
    memory_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
    swap_kib="$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)"
    if [[ "$memory_kib" =~ ^[0-9]+$ && "$swap_kib" =~ ^[0-9]+$ ]]; then
      free_kib=$((memory_kib+swap_kib))
      if (( free_kib < 786432 )); then
        lp_report BLOCK "Only $((memory_kib/1024)) MiB memory available + $((swap_kib/1024)) MiB swap free: local npm install/build requires >=768 MiB headroom. Add RAM/swap or use a reviewed prebuilt deployment path."
      elif (( free_kib < 1572864 )); then
        lp_report WARN "$((memory_kib/1024)) MiB available RAM + $((swap_kib/1024)) MiB free swap; build may be slow/OOM. Prefer >=1.5 GiB."
      else
        lp_report PASS "$((memory_kib/1024)) MiB available RAM + $((swap_kib/1024)) MiB free swap"
      fi
    else
      lp_report BLOCK 'Cannot measure MemAvailable/SwapFree from /proc/meminfo.'
    fi
  else
    lp_report BLOCK '/proc/meminfo unavailable.'
  fi

  if (( NO_NGINX == 0 )); then
    if ! command -v nginx >/dev/null 2>&1; then
      lp_report BLOCK 'Nginx missing: install supported Nginx, or use --no-nginx for an existing reverse proxy.'
    else
      nginx_version="$(nginx -v 2>&1 | sed -n 's|.*nginx/\([0-9][0-9.]*\).*|\1|p' | head -1)"
      local nginx_major='' nginx_minor=''
      IFS=. read -r nginx_major nginx_minor _ <<< "$nginx_version"
      if [[ "$nginx_major" =~ ^[0-9]+$ && "$nginx_minor" =~ ^[0-9]+$ ]] &&
        { (( nginx_major > 1 )) || (( nginx_major == 1 && nginx_minor >= 18 )); }; then
        lp_report PASS "Nginx $nginx_version (minimum 1.18)"
      else
        lp_report BLOCK "Nginx ${nginx_version:-unknown} unsupported: require >= 1.18. Upgrade manually without interrupting existing sites, then retry."
      fi
      if nginx -t >/dev/null 2>&1; then
        lp_report PASS 'Existing Nginx configuration validates.'
      else
        lp_report BLOCK 'nginx -t failed (or insufficient permissions); fix existing configuration or use sudo for preflight.'
      fi
    fi
    if [[ "$CERT" != /* || "$KEY" != /* || ! -r "$CERT" || ! -r "$KEY" || ! -f "$CERT" || ! -f "$KEY" ]]; then
      lp_report BLOCK 'Provide readable absolute TLS --cert and --key paths; never stop the existing Nginx to obtain them.'
    fi
    for target in /etc/nginx/sites-available/linux-panel.conf /etc/nginx/sites-enabled/linux-panel.conf /etc/nginx/conf.d/linux-panel-limits.conf /etc/nginx/snippets/linux-panel-proxy.inc; do
      if [[ -e "$target" || -L "$target" ]]; then
        lp_report BLOCK "Nginx target $target already exists: refusing to overwrite."
      fi
    done
    for folder in /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d /etc/nginx/snippets; do
      [[ -d "$folder" ]] || lp_report BLOCK "Nginx directory $folder missing. Use --no-nginx for a custom layout."
    done
    if command -v nginx >/dev/null 2>&1; then
      # Read the complete dump before testing to avoid grep -q SIGPIPE
      # suppressing a hit under pipefail. Literal domain comparison avoids
      # regex wildcard false matches and includes alternate server_name entries.
      local nginx_dump=''
      nginx_dump="$(nginx -T 2>/dev/null || true)"
      if awk -v domain="$DOMAIN" '
        /^[[:space:]]*server_name[[:space:]]/ {
          for (i=2; i<=NF; i++) {
            name=$i; sub(/;$/, "", name)
            if (name == domain) found=1
          }
        }
        END { exit(!found) }
      ' <<< "$nginx_dump"; then
        lp_report BLOCK "Existing Nginx server_name $DOMAIN found: choose a dedicated hostname."
      fi
      if grep -Eq 'zone=lp_(login|oauth_register|oauth_token):' <<< "$nginx_dump"; then
        lp_report BLOCK 'Existing Nginx limit_req_zone lp_* conflicts with installer-managed zones; use --no-nginx and integrate manually.'
      fi
    fi
  else
    lp_report WARN 'Nginx/HTTPS integration skipped (--no-nginx); operator must configure secure reverse proxy, throttling, and certificate.'
  fi
  printf 'Preflight summary: %d blocker(s), %d warning(s).\n' "$blockers" "$warnings"
  (( blockers == 0 ))
}
