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

Enables reviewed root file and managed Cron operations for Web and the trusted linuxpanel OS
identity. Terminal/PTY and editable collectors share that UID and can call the
same fixed root file Actions directly; Web-only is NOT an OS isolation boundary.
System file administration is a broad root capability. No root Shell endpoint.
Installs fixed root-owned code/dependencies, starts a separate executor and
restarts Web. Does not modify the update Broker, proxies or other services.
Once the immutable Broker is upgraded, pinned main updates synchronize the fixed
root package automatically. Existing installations need one operator bootstrap.
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
  echo 'Root Action channel disabled; file Actions use the ordinary service identity and managed Cron is unavailable.'
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
 if s.st_uid != 0 or s.st_mode & 0o022: raise SystemExit('Node runtime/parents must be root-owned and not group/world writable: '+p)
 if p=='/': break
 p=os.path.dirname(p)
PY
"$LP_NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22 || a===22&&b<12)process.exit(1)'
[[ ! -L "$LP_DEST" ]] || { echo 'Refuse symlinked executor package' >&2;exit 1; }
install -d -o root -g root -m 0755 /usr/local/lib
LP_SHA="$(git -c safe.directory="$LP_ROOT" -C "$LP_ROOT" rev-parse HEAD)"
[[ "$LP_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
LP_STAGE=$(mktemp -d /usr/local/lib/.linux-panel-privileged.XXXXXX)
LP_PREVIOUS=''
LP_UNIT_BEFORE=''
LP_DEPLOYING=0
LP_COMPLETED=0
if [[ -f "$LP_UNIT" ]];then
  LP_UNIT_BEFORE="$(mktemp /etc/systemd/system/.linux-panel-privileged-unit.XXXXXX)"
  cp -- "$LP_UNIT" "$LP_UNIT_BEFORE"
fi
cleanup_install(){
  local rc=$?
  if ((rc!=0)) && ((LP_DEPLOYING));then
    systemctl stop linux-panel-privileged.service 2>/dev/null || true
    if [[ -n "$LP_PREVIOUS" && -d "$LP_PREVIOUS" ]];then
      rm -rf -- "$LP_DEST" 2>/dev/null || true
      mv -T "$LP_PREVIOUS" "$LP_DEST" || true
    fi
    if [[ -n "$LP_UNIT_BEFORE" && -f "$LP_UNIT_BEFORE" ]];then
      install -o root -g root -m 0644 "$LP_UNIT_BEFORE" "$LP_UNIT" || true
    fi
    systemctl daemon-reload || true
    if [[ -d "$LP_DEST" ]];then systemctl start linux-panel-privileged.service || true;fi
    systemctl restart linux-panel.service || true
  fi
  rm -rf -- "$LP_STAGE"
  if ((rc==0 && LP_COMPLETED));then
    if [[ -n "$LP_PREVIOUS" ]];then rm -rf -- "$LP_PREVIOUS";fi
  fi
  if [[ -n "$LP_UNIT_BEFORE" ]];then rm -f -- "$LP_UNIT_BEFORE";fi
}
trap cleanup_install EXIT
mkdir -m 0700 "$LP_STAGE/releases"
mkdir -m 0700 "$LP_STAGE/releases/$LP_SHA"
LP_PACKAGE="$LP_STAGE/releases/$LP_SHA"
# The reviewed package manifest supports future bundled root modules without
# adding special cases to either installer or immutable Broker.
LP_MANIFEST="$LP_ROOT/platform/privileged/package-manifest.json"
LP_ENTRIES="$LP_PACKAGE/.entries"
python3 -I - "$LP_MANIFEST" > "$LP_ENTRIES" <<'PY'
import json,re,sys
with open(sys.argv[1],encoding='utf-8') as f: m=json.load(f)
if set(m)!={'version','files','dependencies'} or m['version']!=1: raise SystemExit('Unsupported root package manifest')
files,deps=m['files'],m['dependencies']
if not isinstance(files,list) or not 2<=len(files)<=40 or len(set(files))!=len(files) or not {'server.js','handlers.js'}.issubset(files):
    raise SystemExit('Invalid root package files')
if not isinstance(deps,list) or not 1<=len(deps)<=20 or len(set(deps))!=len(deps): raise SystemExit('Invalid root dependencies')
if any(not isinstance(f,str) or not re.fullmatch(r'[a-z][a-z0-9-]*\.js',f) for f in files): raise SystemExit('Unsafe source')
if any(not isinstance(d,str) or not re.fullmatch(r'[a-z][a-z0-9-]*',d) for d in deps): raise SystemExit('Unsafe dependency')
for f in files: print('file '+f)
for d in deps: print('dep '+d)
PY
cp -- "$LP_MANIFEST" "$LP_PACKAGE/manifest.json"
while read -r kind file;do
  [[ "$kind" == file ]] || continue
  install -o root -g root -m 0600 "$LP_ROOT/platform/privileged/$file" "$LP_PACKAGE/$file"
done < "$LP_ENTRIES"
printf '{"type":"module"}\n' > "$LP_PACKAGE/package.json"
mkdir "$LP_PACKAGE/node_modules"
while read -r kind package;do
  [[ "$kind" == dep ]] || continue
  [[ -d "$LP_ROOT/node_modules/$package" && ! -L "$LP_ROOT/node_modules/$package" ]] || exit 1
  [[ -z "$(find "$LP_ROOT/node_modules/$package" -type l -print -quit)" ]] || exit 1
  cp -R -- "$LP_ROOT/node_modules/$package" "$LP_PACKAGE/node_modules/$package"
done < "$LP_ENTRIES"
chown -R root:root "$LP_STAGE"
chmod -R go-rwx "$LP_STAGE"
"$LP_NODE" --input-type=module -e 'const h=await import(process.argv[1]);if(h.createPrivilegedHandlers().size<1)process.exit(1)' "file://$LP_PACKAGE/handlers.js"
printf '%s\n' "$LP_SHA" > "$LP_PACKAGE/.ready"
chmod 0600 "$LP_PACKAGE/.ready"
ln -s "releases/$LP_SHA" "$LP_STAGE/current"
systemctl stop linux-panel-privileged.service 2>/dev/null || true
if [[ -e "$LP_DEST" ]];then
  LP_PREVIOUS="$(mktemp -d /usr/local/lib/.linux-panel-previous.XXXXXX)"
  rmdir "$LP_PREVIOUS"
  mv -T "$LP_DEST" "$LP_PREVIOUS"
fi
LP_DEPLOYING=1
mv -T "$LP_STAGE" "$LP_DEST"
if ! getent group linux-panel-privileged >/dev/null;then groupadd --system linux-panel-privileged;fi
LP_GID=$(getent group linux-panel-privileged | cut -d: -f3)
sed -e "s|ExecStart=/opt/node24/bin/node |ExecStart=$LP_NODE |" \
  -e "/Environment=NODE_PATH=/a Environment=PANEL_CLIENT_GID=$LP_GID" \
  "$LP_ROOT/deployment/systemd/linux-panel-privileged.service" > "$LP_UNIT"
chmod 0644 "$LP_UNIT"
install -d -o root -g root -m 0755 /etc/systemd/system/linux-panel.service.d
cat > "$LP_DROPIN" <<'EOF'
[Unit]
Wants=linux-panel-privileged.service
After=linux-panel-privileged.service

[Service]
Environment=PANEL_PRIVILEGED_SOCKET=/run/linux-panel-privileged/executor.sock
SupplementaryGroups=linux-panel-privileged
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
runuser -u linuxpanel -g linuxpanel -G linux-panel-privileged -- "$LP_NODE" --input-type=module -e '
const {PrivilegedActionClient}=await import(process.argv[1]);
const client=new PrivilegedActionClient({socketPath:"/run/linux-panel-privileged/executor.sock"});
const result=await client.execute({id:"files.list",privileged:{channels:["web"]}},{path:"/root",limit:1},{authenticated:true,userId:"operator-enable",channel:"web"});
if(result.accessMode!=="root")process.exit(1);
' "file://$LP_ROOT/platform/privileged/client.js"
systemctl restart linux-panel.service
systemctl is-active --quiet linux-panel.service
LP_COMPLETED=1
echo 'Enabled versioned root Actions; Web remains linuxpanel.'
