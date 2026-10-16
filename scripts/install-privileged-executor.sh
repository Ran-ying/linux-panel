#!/usr/bin/env bash
# Explicit operator bootstrap/update for root-owned reviewed Action handlers.
set -Eeuo pipefail
umask 077
LP_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LP_DEST=/usr/local/lib/linux-panel-privileged
LP_UNIT=/etc/systemd/system/linux-panel-privileged.service
LP_DROPIN=/etc/systemd/system/linux-panel.service.d/privileged-executor.conf
usage(){ cat <<'EOF'
Usage: sudo bash scripts/install-privileged-executor.sh --enable [--node-bin /opt/node24/bin/node]
       sudo bash scripts/install-privileged-executor.sh --disable
       bash scripts/install-privileged-executor.sh --help

Enables reviewed root file operations for Web and the trusted linuxpanel OS
identity. Terminal/PTY and editable collectors share that UID and can call the
same fixed root file Actions directly; Web-only is NOT an OS isolation boundary.
System file administration is a broad root capability. No root Shell endpoint.
Installs fixed root-owned code/dependencies, starts a separate executor and
restarts Web. Does not modify the update Broker, proxies or other services.
New privileged handlers require rerunning this command after review/update.
EOF
}
LP_MODE='';LP_NODE=/opt/node24/bin/node
while (($#));do
  case "$1" in
    --help|-h)usage;exit 0;;
    --enable|--disable)LP_MODE="$1";shift;;
    --node-bin)(($#>=2)) || exit 2;LP_NODE="$2";shift 2;;
    *)usage;exit 2;;
  esac
done
[[ -n "$LP_MODE" ]] || { usage;exit 2; }
((EUID==0)) || { echo 'Run this installation command with sudo/root' >&2;exit 1; }
[[ -f /etc/systemd/system/linux-panel.service ]] || { echo 'Install the ordinary Web service first' >&2;exit 1; }
if [[ "$LP_MODE" == --disable ]];then
  systemctl disable --now linux-panel-privileged.service
  rm -f "$LP_DROPIN"
  systemctl daemon-reload
  systemctl restart linux-panel.service
  echo 'Root Action channel disabled; file Actions use the ordinary service identity.'
  exit 0
fi
id linuxpanel >/dev/null
[[ "$LP_NODE" =~ ^/[A-Za-z0-9._/-]+$ && -x "$LP_NODE" ]] || { echo 'Provide an absolute Node 22.12+ binary' >&2;exit 1; }
# The runtime and its parent directories must not be writable by the Web UID.
python3 - "$LP_NODE" <<'PY'
import os,stat,sys
p=os.path.realpath(sys.argv[1])
while True:
 s=os.stat(p)
 if s.st_uid != 0 or s.st_mode & 0o022: raise SystemExit('Node runtime/parents must be root-owned and not group/world writable')
 if p=='/': break
 p=os.path.dirname(p)
PY
"$LP_NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22 || a===22&&b<12)process.exit(1)'
[[ ! -L "$LP_DEST" ]] || { echo 'Refuse symlinked executor package' >&2;exit 1; }
install -d -o root -g root -m 0755 /usr/local/lib
LP_STAGE=$(mktemp -d /usr/local/lib/.linux-panel-privileged.XXXXXX)
trap 'rm -rf "$LP_STAGE"' EXIT
for file in server.js handlers.js file-contracts.js file-operations.js;do
  install -o root -g root -m 0600 "$LP_ROOT/platform/privileged/$file" "$LP_STAGE/$file"
done
printf '{"type":"module"}\n' > "$LP_STAGE/package.json"
mkdir "$LP_STAGE/node_modules"
for package in ajv fast-deep-equal fast-uri json-schema-traverse require-from-string;do
  cp -R -L "$LP_ROOT/node_modules/$package" "$LP_STAGE/node_modules/$package"
done
chown -R root:root "$LP_STAGE"
chmod -R go-rwx "$LP_STAGE"
"$LP_NODE" --input-type=module -e 'const h=await import(process.argv[1]);if(h.createPrivilegedHandlers().size<1)process.exit(1)' "file://$LP_STAGE/handlers.js"
systemctl stop linux-panel-privileged.service 2>/dev/null || true
rm -rf "$LP_DEST"
mv "$LP_STAGE" "$LP_DEST"
LP_GID=$(id -g linuxpanel)
sed -e "s|ExecStart=/opt/node24/bin/node |ExecStart=$LP_NODE |" \
  -e "/Environment=NODE_PATH=/a Environment=PANEL_WEB_GID=$LP_GID" \
  "$LP_ROOT/deployment/systemd/linux-panel-privileged.service" > "$LP_UNIT"
chmod 0644 "$LP_UNIT"
install -d -o root -g root -m 0755 /etc/systemd/system/linux-panel.service.d
cat > "$LP_DROPIN" <<'EOF'
[Unit]
Wants=linux-panel-privileged.service
After=linux-panel-privileged.service

[Service]
Environment=PANEL_PRIVILEGED_SOCKET=/run/linux-panel-privileged/executor.sock
EOF
chmod 0644 "$LP_DROPIN"
systemctl daemon-reload
systemctl enable --now linux-panel-privileged.service
systemctl is-active --quiet linux-panel-privileged.service
# Wait for the service's bounded startup instead of racing socket creation.
for ((LP_ATTEMPT=0; LP_ATTEMPT<50; LP_ATTEMPT++));do
  [[ -S /run/linux-panel-privileged/executor.sock ]] && break
  sleep .1
done
[[ -S /run/linux-panel-privileged/executor.sock ]]
systemctl restart linux-panel.service
systemctl is-active --quiet linux-panel.service
echo 'Enabled reviewed root Actions; Web remains linuxpanel. The same UID terminal is trusted to use these file operations.'
