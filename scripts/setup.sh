#!/usr/bin/env bash
# Guided first install; never enables Broker or MCP policies.
set -Eeuo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
usage() {
  cat <<'HELP'
Usage: bash scripts/setup.sh [--check | --plan | --apply] [installer options]
No flags: interactive guided first installation (requires a terminal).
--check: read-only preflight, forwarded to install.sh.
--plan: print the app install command without running it.
--apply: explicitly run the app installer; accepts --admin-password-stdin for CI.
Other options: --host, --port, --node-bin, --public-origin, --repo, --ref, --resume.
Broker installation and activation remain separate explicit operator commands.
HELP
}
mode=wizard
args=()
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0;;
    --check|--plan|--apply)
      [[ "$mode" == wizard ]] || { echo 'Choose only one mode' >&2; exit 1; }
      mode=${1#--}; shift;;
    --host|--port|--node-bin|--public-origin|--repo|--ref)
      (($#>=2)) || { echo "Missing value: $1" >&2; exit 1; }
      args+=("$1" "$2"); shift 2;;
    --resume|--admin-password-stdin) args+=("$1"); shift;;
    *) echo "Unknown option: $1" >&2; exit 1;;
  esac
done
if [[ "$mode" == wizard ]]; then
  [[ -t 0 ]] || { echo 'Use --check, --plan or --apply without a terminal' >&2; exit 1; }
  ((${#args[@]}==0)) || { echo 'Use --plan or --apply with explicit options' >&2; exit 1; }
  echo 'Linux Panel: first installation. Existing installations must use UPGRADING.md.'
  read -r -p 'Listen host [127.0.0.1]: ' host
  read -r -p 'Listen port [4188]: ' port
  read -r -p 'Node executable (blank = autodetect): ' node
  read -r -p 'External HTTPS origin (blank = local only): ' origin
  args=(--host "${host:-127.0.0.1}" --port "${port:-4188}")
  [[ -z "$node" ]] || args+=(--node-bin "$node")
  [[ -z "$origin" ]] || args+=(--public-origin "$origin")
  bash "$ROOT/scripts/install.sh" --check "${args[@]}"
  printf 'App install command: '; printf '%q ' bash "$ROOT/scripts/install.sh" "${args[@]}"; printf '\n'
  read -r -p 'Type INSTALL to install the app (MCP/Broker stay off): ' answer
  [[ "$answer" == INSTALL ]] || { echo 'Cancelled; no installation changes.'; exit 0; }
  mode=apply
fi
case "$mode" in
  check) exec bash "$ROOT/scripts/install.sh" --check "${args[@]}";;
  plan) printf '%q ' bash "$ROOT/scripts/install.sh" "${args[@]}"; printf '\n';;
  apply)
    bash "$ROOT/scripts/install.sh" "${args[@]}"
    echo 'Application installed. MCP and Broker remain OFF.'
    echo 'Optional Broker steps (review UPDATER.md first):'
    echo 'sudo bash /opt/linux-panel/scripts/install-update-broker.sh --check'
    echo 'sudo bash /opt/linux-panel/scripts/install-update-broker.sh --apply'
    echo 'Activation is a separate decision after acceptance; see UPDATER.md.';;
esac
