#!/usr/bin/env bash
# Operator-only installation of the separate personal Telegram client service.
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Run as root.' >&2; exit 1; fi
for tool in python3 git runuser systemctl useradd; do
  command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 1; }
done
readonly PIN=e0f4f9c16322d1446d25638adafcb0a6e5b221d6
readonly SRC=/opt/telegram-mcp
readonly STATE=/var/lib/telegram-mcp
readonly CONF=/etc/telegram-mcp/telegram.env
readonly UNIT=/etc/systemd/system/telegram-mcp.service

if ! id telegrammcp >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$STATE" --shell /usr/sbin/nologin telegrammcp
fi
install -d -m 0750 -o telegrammcp -g telegrammcp "$STATE"
install -d -m 0750 -o root -g telegrammcp /etc/telegram-mcp

if [[ ! -d "$SRC/.git" ]]; then
  if [[ -e "$SRC" ]]; then echo "Refusing to replace $SRC" >&2; exit 1; fi
  git clone -q https://github.com/chigwell/telegram-mcp.git "$SRC"
fi
git -C "$SRC" fetch -q origin "$PIN"
git -C "$SRC" checkout -q --detach "$PIN"
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$PIN" ]] || exit 1
# Build the upstream Python wheel as its restricted service user, never root.
# Setuptools may write egg-info to the source tree during the build.
if [[ ! -x "$SRC/.venv/bin/python" ]]; then
  chown -R telegrammcp:telegrammcp "$SRC"
  # Keep the checkout immutable if dependency installation fails partway.
  trap 'chown -R root:root "$SRC"; chmod -R go-w "$SRC"' EXIT
  install -d -m 0755 -o telegrammcp -g telegrammcp "$SRC/.venv"
  runuser -u telegrammcp -- python3 -m venv "$SRC/.venv"
  runuser -u telegrammcp -- "$SRC/.venv/bin/python" -m pip install --disable-pip-version-check --no-cache-dir "$SRC"
fi
# After the build, freeze both source and venv against runtime modifications.
chown -R root:root "$SRC"
chmod -R go-w "$SRC"
trap - EXIT

if [[ ! -e "$CONF" ]]; then
  cat > "$CONF" <<'ENV'
# Fill these values directly on the VPS; never send the session string to chat.
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_SESSION_STRING=
TELEGRAM_ALLOWED_CHAT_IDS=@replace_with_bot_username
TELEGRAM_EXPOSED_TOOLS=read-only+send_message,press_inline_button
TELEGRAM_TRANSCRIBE_ENGINE=off
TELEGRAM_DEVICE_MODEL=LinuxPanel-Telegram-MCP
MCP_TRANSPORT=http
MCP_HOST=127.0.0.1
MCP_PORT=8765
MCP_ALLOWED_HOSTS=127.0.0.1,localhost
ENV
fi
chown root:telegrammcp "$CONF"
chmod 0640 "$CONF"

cat > "$UNIT" <<'UNIT'
[Unit]
Description=Telegram user-account MCP (isolated)
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=telegrammcp
Group=telegrammcp
WorkingDirectory=/var/lib/telegram-mcp
EnvironmentFile=/etc/telegram-mcp/telegram.env
ExecStart=/opt/telegram-mcp/.venv/bin/telegram-mcp
Restart=on-failure
RestartSec=10
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/telegram-mcp
PrivateTmp=true
PrivateDevices=true
ProtectControlGroups=true
ProtectKernelTunables=true
ProtectKernelModules=true
RestrictSUIDSGID=true
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 "$UNIT"
systemctl daemon-reload
echo 'Installed (not started). Next: configure Telegram credentials, generate a session,'
echo 'set PANEL_TELEGRAM_ALLOWED_BOTS for Linux Panel, then systemctl enable --now telegram-mcp.service.'
echo 'Do not share TELEGRAM_SESSION_STRING or API_HASH in chat.'
