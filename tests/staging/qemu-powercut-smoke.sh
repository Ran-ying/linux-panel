#!/usr/bin/env bash
# Real guest-wide power cuts in a disposable QEMU Ubuntu 24.04 VM.
# This tests fsync barriers, NOT the full root Broker Git/npm transaction.
set -Eeuo pipefail
[[ "$EUID" != 0 && -v GITHUB_ACTIONS && "$GITHUB_ACTIONS" == true &&
   "$RUNNER_ENVIRONMENT" == github-hosted && "$RUNNER_OS" == Linux &&
   -f "$GITHUB_WORKSPACE/platform/state-store.js" ]] ||
  { echo "::error::Disposable GitHub-hosted Linux CI only" >&2; exit 2; }
work="$(mktemp -d "$RUNNER_TEMP/lp-qemu-cut.XXXXXXXX")"
vm_pid=''
fail(){ echo "::error::QEMU power-cut: $*" >&2; exit 1; }
note(){ echo "[qemu-cut] $*"; }
cleanup(){
  local rc=$?
  if ((rc));then
    echo "::error::QEMU smoke exited $rc; last guest serial output:" >&2
    if [[ -f "$work/console.log" ]];then tail -n 120 "$work/console.log" >&2;fi
  fi
  if [[ -n "$vm_pid" ]];then kill -KILL "$vm_pid" 2>/dev/null || true;fi
  rm -rf -- "$work"
}
trap 'rc=$?; echo "::error::QEMU failing command at line $LINENO: $BASH_COMMAND (exit $rc)" >&2' ERR
trap cleanup EXIT
for cmd in qemu-system-x86_64 qemu-img cloud-localds ssh scp curl sha256sum python3 node;do
  command -v "$cmd" >/dev/null || fail "Missing test command: $cmd"
done
note 'Fetch/verify official Ubuntu 24.04 cloud image (not a shared VPS)'
base=https://cloud-images.ubuntu.com/releases/noble/release
name=ubuntu-24.04-server-cloudimg-amd64.img
curl -fsSL --retry 3 "$base/SHA256SUMS" -o "$work/SHA256SUMS"
curl -fsSL --retry 3 "$base/$name" -o "$work/$name"
grep -E '[[:space:]][*]?ubuntu-24\.04-server-cloudimg-amd64\.img$' \
 "$work/SHA256SUMS" > "$work/image.sha"
[[ -s "$work/image.sha" ]] || fail 'Official image checksum absent'
(cd "$work" && sha256sum -c image.sha) || fail 'Cloud image checksum mismatch'
cp "$work/$name" "$work/guest.qcow2"
qemu-img resize "$work/guest.qcow2" 8G >/dev/null
ssh-keygen -q -t ed25519 -N '' -f "$work/key"
pubkey="$(cat "$work/key.pub")"
cat > "$work/user-data" <<CLOUD
#cloud-config
ssh_pwauth: false
users:
  - default
  - name: stage
    shell: /bin/bash
    groups: [sudo]
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - $pubkey
CLOUD
cat > "$work/meta-data" <<'META'
instance-id: linux-panel-qemu-powercut-01
local-hostname: lp-disposable-vm
META
cloud-localds "$work/seed.img" "$work/user-data" "$work/meta-data"
ssh_run(){ ssh -o BatchMode=yes -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=12 \
  -o ServerAliveInterval=10 -o ServerAliveCountMax=6 \
  -i "$work/key" -p 22647 stage@127.0.0.1 "$@"; }
scp_run(){ scp -q -P 22647 -o BatchMode=yes -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
  -i "$work/key" "$1" "stage@127.0.0.1:$2"; }
# Retry only transport failures (ssh exit 255) for read-only probes after
# a hard reboot. Never hide assertion failures from the guest command.
ssh_retry(){
  local rc=0
  for i in $(seq 1 25);do
    if ssh_run "$@";then return 0;else rc=$?;fi
    ((rc==255)) || return "$rc"
    sleep 2
  done
  echo "::error::Post-reboot SSH transport failed after 25 retries: $*" >&2
  return "$rc"
}
boot(){
  rm -f "$work/vm.pid"
  qemu-system-x86_64 -machine accel=kvm:tcg -cpu max -smp 2 -m 2048 \
    -drive "file=$work/guest.qcow2,format=qcow2,if=virtio" \
    -drive "file=$work/seed.img,format=raw,media=cdrom" \
    -netdev user,id=net0,hostfwd=tcp:127.0.0.1:22647-:22 \
    -device virtio-net-pci,netdev=net0 -display none \
    -serial "file:$work/console.log" \
    -daemonize -pidfile "$work/vm.pid" || fail 'QEMU did not start'
  vm_pid="$(cat "$work/vm.pid")"
  if [[ "${1:-}" == serial-only ]];then
    note 'Rebooted isolated QEMU: awaiting in-guest serial recovery proof'
    return
  fi
  for i in $(seq 1 180);do
    # One successful SSH connect is insufficient: cloud-init may still
    # restart sshd. Require the complete remote readiness command.
    if ssh_run 'sudo cloud-init status --wait >/dev/null' >/dev/null 2>&1;then
      note 'QEMU guest SSH and cloud-init ready'
      return
    fi
    sleep 2
  done
  tail -n 70 "$work/console.log" || true
  fail 'Guest SSH did not become ready'
}
hard_cut(){
  [[ "$vm_pid" =~ ^[0-9]+$ ]] || fail 'No valid guest VM process'
  note "Host SIGKILL of QEMU process $vm_pid — no guest shutdown"
  kill -KILL "$vm_pid" || fail 'VM hard power cut failed'
  for i in $(seq 1 80);do
    if ! kill -0 "$vm_pid" 2>/dev/null;then break;fi
    sleep 0.1
  done
  vm_pid=''
  rm -f "$work/vm.pid"
}
boot
note 'Transfer actual StateStore and extracted fixed-worker fsync function'
cp "$GITHUB_WORKSPACE/platform/state-store.js" "$work/state-store.js"
printf '{"type":"module"}\n' > "$work/package.json"
awk '/^durable_sync\(\)\{/{inside=1} inside{print} inside && /^}/{exit}' \
 "$GITHUB_WORKSPACE/scripts/update-worker.sh" > "$work/durable-sync.sh"
grep -q 'os.fsync(fd)' "$work/durable-sync.sh" || fail 'Worker fsync extraction failed'
cat > "$work/state-test.mjs" <<'NODE'
import {StateStore} from './state-store.js';
const store=new StateStore('/home/stage/state/private.json');
if(process.argv[2]==='write'){
 await store.mutate(s=>{
  s.settings.panelName='QEMU_POWER_CUT_COMMITTED';
  s.audit.push({id:'qemu',at:'test',event:'powercut.durable'});
 });
}else{
 const s=await store.snapshot();
 if(s.settings.panelName!=='QEMU_POWER_CUT_COMMITTED' ||
    !s.audit.some(a=>a.event==='powercut.durable'))
   throw new Error('Private state lost across QEMU power cut');
}
NODE
cat > "$work/phase1.sh" <<'PHASE1'
#!/usr/bin/env bash
set -Eeuo pipefail
source /home/stage/durable-sync.sh
install -d -o root -g root -m 0700 /var/lib/linux-panel-update-root
install -d -o root -g root -m 0700 /var/lib/linux-panel
dir=/var/lib/linux-panel-update-root
tmp="$(mktemp "$dir/.pending-transaction.XXXXXXXX")"
printf 'id=%032d\nsha=%040d\nold=%040d\n' 1 2 3 > "$tmp"
chmod 0600 "$tmp"
durable_sync file "$tmp"
mv -nT "$tmp" "$dir/active-transaction"
durable_sync dir "$dir"
printf 'id=%032d\nsha=%040d\n' 1 2 > /var/lib/linux-panel/update-processing
chmod 0600 /var/lib/linux-panel/update-processing
durable_sync file /var/lib/linux-panel/update-processing
durable_sync dir /var/lib/linux-panel
PHASE1
cat > "$work/phase2.sh" <<'PHASE2'
#!/usr/bin/env bash
set -Eeuo pipefail
source /home/stage/durable-sync.sh
dir=/var/lib/linux-panel-update-status
install -d -o root -g root -m 0750 "$dir"
tmp="$(mktemp "$dir/.update-result.XXXXXXXX")"
printf '{"id":"%032d","sha":"%040d","status":"success","at":"2026-10-15T00:00:00Z"}\n' 1 2 > "$tmp"
chmod 0640 "$tmp"
durable_sync file "$tmp"
mv -fT "$tmp" "$dir/result.json"
durable_sync dir "$dir"
rm -f /var/lib/linux-panel/update-processing
durable_sync dir /var/lib/linux-panel
rm -f /var/lib/linux-panel-update-root/active-transaction
durable_sync dir /var/lib/linux-panel-update-root
PHASE2
for name in state-store.js package.json durable-sync.sh state-test.mjs phase1.sh phase2.sh;do
  scp_run "$work/$name" "/home/stage/$name"
done
scp_run "$(command -v node)" /home/stage/node
ssh_run 'chmod 700 /home/stage/node; mkdir -p /home/stage/state; chmod 700 /home/stage/state'
ssh_run '/home/stage/node /home/stage/state-test.mjs write'
if [[ "${LP_QEMU_SCENARIO:-file}" == file ]];then
ssh_run 'sudo bash /home/stage/phase1.sh'
note 'POWER CUT A — synced state, journal, processing marker'
hard_cut
boot
ssh_retry '/home/stage/node /home/stage/state-test.mjs verify'
ssh_retry 'sudo test -s /var/lib/linux-panel-update-root/active-transaction &&
  sudo test -s /var/lib/linux-panel/update-processing' ||
  fail 'Power cut A lost journal or processing marker'
mode="$(ssh_retry 'sudo stat -c %a /var/lib/linux-panel-update-root/active-transaction')"
[[ "$mode" == 600 ]] || fail 'Power cut A lost journal owner-only permissions'
note 'PASS A: private state, journal and processing survived guest power cut'
ssh_run 'sudo bash /home/stage/phase2.sh'
note 'POWER CUT B — synced success and journal/processing cleanup'
hard_cut
boot
ssh_run '/home/stage/node /home/stage/state-test.mjs verify'
ssh_run "sudo grep -Fq '\"status\":\"success\"' /var/lib/linux-panel-update-status/result.json" ||
  fail 'Power cut B lost success record'
ssh_retry 'sudo test ! -e /var/lib/linux-panel-update-root/active-transaction &&
  sudo test ! -e /var/lib/linux-panel/update-processing' ||
  fail 'Power cut B resurrected cleaned transaction marker'
note 'PASS B: result and cleanup survived hard reset and reboot'
note 'File-level QEMU power-cut acceptance passed; separate VM tests the live worker'
exit 0
fi

[[ "${LP_QEMU_SCENARIO:-file}" == broker ]] ||
  fail 'Unsupported isolated QEMU scenario'
# On missing boot-verifier evidence, inspect the GUEST DISK OFFLINE,
# read-only, after stopping the disposable QEMU process. Never inspect
# or expose private state JSON contents in CI logs (digest only).
offline_guest_diagnostics(){
  note 'Collecting offline guest-disk evidence in throwaway runner'
  if [[ -n "$vm_pid" ]];then hard_cut;fi
  qemu-img convert -f qcow2 -O raw -S 4096 "$work/guest.qcow2" "$work/offline.raw" ||
    { note 'Offline image conversion unavailable';return 1; }
  local loop='' part='' mp="$work/offline-mount"
  mkdir -p "$mp"
  loop="$(sudo losetup -fP --show "$work/offline.raw")" ||
    { note 'Guest disk loop interface unavailable';return 1; }
  sudo lsblk -o NAME,FSTYPE,SIZE,MOUNTPOINT "$loop" || true
  part="${loop}p1"
  if ! sudo mount -o ro,noload "$part" "$mp";then
    note 'Unable to mount guest ext4 root read-only'
    sudo losetup -d "$loop" || true
    return 1
  fi
  note 'Trusted recovery and verification unit file metadata:'
  for p in \
   etc/systemd/system/linux-panel-update-recover.service \
   etc/systemd/system/lp-qemu-boot-verify.service \
   etc/systemd/system/multi-user.target.wants/linux-panel-update-recover.service \
   etc/systemd/system/multi-user.target.wants/lp-qemu-boot-verify.service \
   var/lib/linux-panel-update-root/active-transaction \
   var/lib/linux-panel/update-processing \
   var/lib/linux-panel-update-status/result.json;do
    sudo stat -c '%F %U:%G %a %n' "$mp/$p" || true
  done
  note 'Guest last update result (no secrets):'
  sudo cat "$mp/var/lib/linux-panel-update-status/result.json" 2>/dev/null || true
  note 'Guest transaction journal (identities only):'
  sudo cat "$mp/var/lib/linux-panel-update-root/active-transaction" 2>/dev/null || true
  note 'Expected and actual guest Git HEAD:'
  sudo cat "$mp/home/stage/lp-old-sha" || true
  sudo git --git-dir="$mp/opt/linux-panel/.git" rev-parse HEAD 2>/dev/null || true
  note 'Private state sha256 only:'
  sudo sha256sum "$mp/var/lib/linux-panel/panel-state.json" || true
  sudo umount "$mp" || true
  sudo losetup -d "$loop" || true
}
note 'Power-cut C: stage actual immutable root worker on disposable QEMU systemd'
for pair in \
 "scripts/update-worker.sh:lp-worker-under-test.sh" \
 "deployment/systemd/linux-panel-update.service:lp-update.service" \
 "deployment/systemd/linux-panel-update-recover.service:lp-recover.service" \
 "deployment/systemd/linux-panel-update-guard.conf:lp-guard.conf" \
 "tests/staging/qemu-guest-live-worker.sh:lp-guest-live-worker.sh";do
 srcfile="${pair%%:*}"
 dstfile="${pair#*:}"
 scp_run "$GITHUB_WORKSPACE/$srcfile" "/home/stage/$dstfile"
done
ssh_run 'sudo env LP_QEMU_EPHEMERAL=yes bash /home/stage/lp-guest-live-worker.sh'
grep -Fq 'LP_QEMU_PRECUT_SERIAL_READY' "$work/console.log" ||
  fail 'Real systemd TTY output was not visible in QEMU host serial log BEFORE cut'
note 'Proved systemd guest-to-host serial evidence channel before hard power cut'
worker_reached=0
for i in $(seq 1 150);do
 if ssh_run 'sudo test -f /var/lib/linux-panel-updater/lp-reached-npm' >/dev/null 2>&1;then
  worker_reached=1
  break
 fi
 sleep 2
done
((worker_reached)) || fail 'Real guest worker never reached npm checkpoint'
ssh_run 'sudo test -f /var/lib/linux-panel-update-root/active-transaction &&
 sudo test -f /var/lib/linux-panel/update-processing' ||
 fail 'Root journal or processing marker missing before real guest power cut'
note 'POWER CUT C — actual systemd root worker inside npm ci; journal durable'
hard_cut
# The guest itself verifies root recovery and prints a fixed signed-off
# milestone to the host-owned QEMU serial log. SSH can be unavailable after
# abrupt cut even with healthy Linux systemd; do not conflate that with a
# failed rollback or give SSH output authority over the rollback outcome.
boot serial-only
verified=0
for attempt in $(seq 1 650);do
  if grep -Fq 'LP_QEMU_LIVE_BROKER_RECOVERED' "$work/console.log";then
    verified=1
    break
  fi
  if grep -Fq 'LP_QEMU_BOOT_VERIFIER_FAIL' "$work/console.log";then
    tail -n 120 "$work/console.log" >&2
    fail 'In-guest root Broker recovery proof rejected state'
  fi
  kill -0 "$vm_pid" 2>/dev/null ||
    fail 'QEMU guest stopped before publishing root recovery evidence'
  sleep 1
done
if ((verified==0));then
  tail -n 120 "$work/console.log" >&2
  offline_guest_diagnostics || note 'Offline disk diagnostics unavailable'
  fail 'In-guest root Broker recovery did not publish serial proof'
fi
note 'PASS C: real root systemd worker/old Git+state/HTTP recovered after VM-wide hard power cut'
note 'LIMIT: npm/build is an isolated no-op/hang fixture, not full production dependency build'

