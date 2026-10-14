#!/usr/bin/env bash
# Explicit preparation helper for a shared host. Never invoked by install.sh.
# Default is dry-run. Mutations require an operation AND --apply.
set -Eeuo pipefail
umask 077
NODE_VERSION=24.21.0
NODE_DEST=/opt/node24
SWAP_FILE=/swapfile-linux-panel
MODE=check
APPLY=0
SWAP_MIB=''
usage() {
cat <<'HELP'
Usage:
  bash scripts/prepare-host.sh --check
  sudo bash scripts/prepare-host.sh --install-node [--apply]
  sudo bash scripts/prepare-host.sh --create-swap 1024 [--apply]
--check: read-only report; default.
--install-node: install official Node.js 24 into /opt/node24, NEVER system Node.
--create-swap MiB: new /swapfile-linux-panel, size 512..2048 MiB;
                   when applied, activate and persist in /etc/fstab.
--apply: actually perform the explicitly selected operation.
Without --apply, planned operations do not modify the host.
Never auto-upgrades, reboots, or restarts existing services.
HELP
}
die(){ printf '[BLOCK] %s\n' "$*" >&2; exit 1; }
info(){ printf '[INFO ] %s\n' "$*"; }
need(){ command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"; }
while (($#)); do
  case "$1" in
    --check) [[ "$MODE" == check ]] || die 'Select one operation'; shift;;
    --install-node) [[ "$MODE" == check ]] || die 'Select one operation'; MODE=node; shift;;
    --create-swap)
      [[ "$MODE" == check && $# -ge 2 ]] || die 'Expected --create-swap MiB'
      MODE=swap; SWAP_MIB="$2"; shift 2;;
    --apply) APPLY=1; shift;;
    --help|-h) usage; exit 0;;
    *) die "Unknown argument: $1";;
  esac
done
[[ "$MODE" != check || "$APPLY" == 0 ]] || die '--apply requires a chosen operation'
for cmd in awk df uname grep; do need "$cmd"; done
[[ -r /proc/meminfo ]] || die 'Cannot inspect /proc/meminfo'
info "Mode=$MODE $( ((APPLY)) && echo APPLY || echo DRY-RUN )"
info "Existing Node: $(command -v node || echo missing), $(node -v 2>/dev/null || true) (unchanged)"
info "Available RAM: $(awk '/^MemAvailable:/ {printf "%d MiB", $2/1024}' /proc/meminfo); free Swap: $(awk '/^SwapFree:/ {printf "%d MiB", $2/1024}' /proc/meminfo)"
info "Free disk: $(df -Pk / | awk 'NR==2 {printf "%d MiB", $4/1024}')"
if [[ "$MODE" == check ]]; then
  info 'No changes. Choose --install-node or --create-swap to plan an operation.'
  exit 0
fi

if [[ "$MODE" == node ]]; then
  case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;;
    *) die 'Unsupported CPU architecture (requires x86_64 or aarch64)';; esac
  [[ -d /opt && ! -L /opt ]] || die '/opt is not a normal directory'
  [[ ! -e "$NODE_DEST" && ! -L "$NODE_DEST" ]] || die "$NODE_DEST already exists; refusing to overwrite"
  disk="$(df -Pk /opt | awk 'NR==2 {print $4}')"
  [[ "$disk" =~ ^[0-9]+$ ]] && ((disk>=524288)) || die 'At least 512 MiB free space on /opt required'
  info "Plan: fetch official Node v$NODE_VERSION linux-$arch over HTTPS; SHA256 verify, install into $NODE_DEST"
  info 'Will NOT alter /usr/bin/node, /usr/bin/npm, system PATH, Nginx, PM2 or existing services'
  ((APPLY)) || exit 0
  ((EUID==0)) || die 'Apply requires sudo/root'
  for cmd in curl sha256sum tar mktemp mv chmod rm; do need "$cmd"; done
  archive="node-v$NODE_VERSION-linux-$arch.tar.xz"
  url="https://nodejs.org/dist/v$NODE_VERSION"
  stage="$(mktemp -d /opt/.linux-panel-node24.XXXXXXXX)"
  cleanup(){ [[ -z "${stage:-}" ]] || rm -rf -- "$stage"; }
  trap cleanup EXIT
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 2 "$url/$archive" -o "$stage/$archive"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 2 "$url/SHASUMS256.txt" -o "$stage/SHASUMS256.txt"
  sum="$(awk -v target="$archive" '$2 == target {print $1}' "$stage/SHASUMS256.txt")"
  [[ "$sum" =~ ^[a-fA-F0-9]{64}$ ]] || die 'Official checksum missing/invalid'
  (cd "$stage" && printf '%s  %s\n' "$sum" "$archive" | sha256sum -c --status) || die 'SHA256 verification failed'
  tar -xJf "$stage/$archive" -C "$stage" --strip-components=1 --no-same-owner || die 'Node archive extraction failed'
  [[ -x "$stage/bin/node" && -e "$stage/bin/npm" ]] || die 'Node/npm missing in verified archive'
  [[ "$("$stage/bin/node" -v)" == "v$NODE_VERSION" ]] || die 'Extracted version mismatch'
  rm -f -- "$stage/$archive" "$stage/SHASUMS256.txt"
  chmod -R go-w,a+rX "$stage"
  [[ ! -e "$NODE_DEST" && ! -L "$NODE_DEST" ]] || die 'Node destination appeared concurrently'
  mv -T -- "$stage" "$NODE_DEST"
  stage=''
  info "Installed $("$NODE_DEST/bin/node" -v) into $NODE_DEST"
fi

if [[ "$MODE" == swap ]]; then
  [[ "$SWAP_MIB" =~ ^[0-9]+$ ]] && ((SWAP_MIB>=512 && SWAP_MIB<=2048)) || die 'Swap MiB must be 512..2048'
  [[ ! -e "$SWAP_FILE" && ! -L "$SWAP_FILE" ]] || die "$SWAP_FILE exists; refusing overwrite"
  [[ -f /etc/fstab && ! -L /etc/fstab ]] || die 'Cannot safely edit /etc/fstab'
  ! grep -Eq '^[[:space:]]*/swapfile-linux-panel[[:space:]]' /etc/fstab || die 'fstab already includes this swap file'
  need findmnt
  fs="$(findmnt -n -o FSTYPE -T /)"
  case "$fs" in ext4|xfs) :;; *) die "Filesystem '$fs' not supported for this swap helper (ext4/xfs only)";; esac
  disk="$(df -Pk / | awk 'NR==2 {print $4}')"
  [[ "$disk" =~ ^[0-9]+$ ]] && ((disk>=SWAP_MIB*1024+2097152)) || die "Insufficient disk: need $((SWAP_MIB+2048)) MiB available (2 GiB reserve)"
  info "Plan: create $SWAP_MIB MiB swap at $SWAP_FILE, chmod 600, activate and persist /etc/fstab"
  info 'Swap increases disk I/O and can hold sensitive memory pages; review server encryption and workload latency'
  ((APPLY)) || exit 0
  ((EUID==0)) || die 'Apply requires sudo/root'
  for cmd in fallocate mkswap swapon chmod rm mktemp cp; do need "$cmd"; done
  (set -C; umask 077; : > "$SWAP_FILE") || die 'Swap file appeared concurrently'
  chmod 0600 "$SWAP_FILE"
  if ! fallocate -l "${SWAP_MIB}M" "$SWAP_FILE"; then
    rm -f -- "$SWAP_FILE"
    die 'Swap allocation failed; unused file cleaned'
  fi
  if ! mkswap "$SWAP_FILE" >/dev/null || ! swapon "$SWAP_FILE"; then
    rm -f -- "$SWAP_FILE"
    die 'Swap activation failed; unused file cleaned'
  fi
  # If persistence fails, preserve active swap; never unlink an active swap file.
  backup="$(mktemp /etc/fstab.linux-panel.bak.XXXXXXXX)" || die 'Swap active; cannot reserve fstab backup'
  cp -p /etc/fstab "$backup" || die 'Swap active; could not back up fstab'
  printf '\n%s none swap sw 0 0\n' "$SWAP_FILE" >> /etc/fstab || die 'Swap active; failed to persist fstab'
  info "Activated and persisted swap. Original fstab backup: $backup"
  swapon --show
fi
