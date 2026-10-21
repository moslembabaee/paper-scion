#!/usr/bin/env bash
# Paper Factory — Watchdog installer.
#
# Installs a systemd service + timer so the watchdog runs every 2 minutes,
# independently of Scion (it must survive Scion being down).
#
# Usage: bash .factory/watchdog/install.sh [--no-enable]

set -eu

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-/root/projects/paper-scion}"
SECRETS_DIR="/root/.factory-secrets"
STATE_DIR="/var/lib/paper-watchdog"
UNIT_NAME="paper-watchdog"

ENABLE=1
[ "${1:-}" = "--no-enable" ] && ENABLE=0

echo "==> Installing Paper Factory watchdog"

# 1. Secrets directory (never in git)
mkdir -p "$SECRETS_DIR" "$STATE_DIR"
chmod 700 "$SECRETS_DIR"

if [ ! -f "$SECRETS_DIR/telegram_bot_token" ]; then
  # Try to source the token from the Hermes env file.
  if [ -f /root/.hermes/.env ]; then
    tok=$(grep -E '^TELEGRAM_BOT_TOKEN=' /root/.hermes/.env | head -1 | cut -d= -f2- | tr -d '"'"'"' \r\n')
    if [ -n "$tok" ]; then
      printf '%s' "$tok" > "$SECRETS_DIR/telegram_bot_token"
      chmod 600 "$SECRETS_DIR/telegram_bot_token"
      echo "    telegram bot token: imported from /root/.hermes/.env"
    fi
  fi
  [ -f "$SECRETS_DIR/telegram_bot_token" ] || echo "    WARNING: no telegram token — notifications disabled"
fi

if [ ! -f "$SECRETS_DIR/llm_api_key" ]; then
  # The LLM key is the same key Scion uses for the Nine Router.
  if [ -f /root/.scion/hub.db ]; then
    key=$(strings /root/.scion/hub.db | grep -oE 'sk-[a-zA-Z0-9-]{20,}' | head -1)
    if [ -n "$key" ]; then
      printf '%s' "$key" > "$SECRETS_DIR/llm_api_key"
      chmod 600 "$SECRETS_DIR/llm_api_key"
      echo "    llm api key: imported from scion hub"
    fi
  fi
  [ -f "$SECRETS_DIR/llm_api_key" ] || echo "    WARNING: no llm key — LLM diagnosis disabled (layer 1 still works)"
fi

# 2. Executable bits
chmod +x "$HERE"/*.sh

# 3. systemd unit + timer
cat > "/etc/systemd/system/${UNIT_NAME}.service" << EOF
[Unit]
Description=Paper Scion Factory Watchdog (health detection + notification)
Documentation=file://$PROJECT_DIR/.factory/README.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
Environment="FACTORY_CONFIG=$HERE/config.env"
Environment="FACTORY_STATE_DIR=$STATE_DIR"
WorkingDirectory=$PROJECT_DIR
ExecStart=/bin/bash $HERE/run.sh
# Never let the watchdog itself become the outage.
TimeoutStartSec=180
Nice=10
IOSchedulingClass=idle
EOF

cat > "/etc/systemd/system/${UNIT_NAME}.timer" << EOF
[Unit]
Description=Run the Paper Scion Factory Watchdog every 2 minutes

[Timer]
OnBootSec=90s
OnUnitActiveSec=120s
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
if [ "$ENABLE" = "1" ]; then
  systemctl enable --now "${UNIT_NAME}.timer"
  echo "==> Timer enabled. Next runs:"
  systemctl list-timers "${UNIT_NAME}.timer" --no-pager | head -3
else
  echo "==> Timer installed but not enabled."
fi

echo "==> Watchdog installed. Logs: $STATE_DIR/watchdog.log"
echo "    Manual run: systemctl start ${UNIT_NAME}.service"
