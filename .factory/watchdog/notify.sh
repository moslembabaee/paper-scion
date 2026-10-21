#!/usr/bin/env bash
# Paper Factory — Layer 2: NOTIFY (Telegram)
#
# Sends the findings summary to the owner on Telegram. Secrets are read from
# files under /root/.factory-secrets so nothing sensitive lives in git.

set -u

CONFIG_FILE="${FACTORY_CONFIG:-/root/projects/paper-scion/.factory/watchdog/config.env}"
STATE_DIR="${FACTORY_STATE_DIR:-/var/lib/paper-watchdog}"
# shellcheck source=/dev/null
[ -f "$CONFIG_FILE" ] && . "$CONFIG_FILE"

FINDINGS_FILE="$STATE_DIR/findings.json"
LAST_NOTIFY_FILE="$STATE_DIR/last_notify_ts"
LOG_FILE="$STATE_DIR/watchdog.log"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] [NOTIFY] $*" >> "$LOG_FILE"; }

[ -f "$FINDINGS_FILE" ] || { log "No findings file."; exit 0; }

TOKEN=""
[ -f "${TELEGRAM_TOKEN_FILE:-}" ] && TOKEN=$(tr -d '\r\n' < "$TELEGRAM_TOKEN_FILE")
if [ -z "$TOKEN" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  log "Telegram not configured (token file: ${TELEGRAM_TOKEN_FILE:-unset}). Skipping."
  exit 0
fi

summary=$(python3 - "$FINDINGS_FILE" << 'PY'
import json, sys
try:
    findings = json.load(open(sys.argv[1]))
except Exception:
    print("Watchdog could not read findings."); raise SystemExit
if not findings:
    print("No findings."); raise SystemExit
lines = ["<b>Paper Factory Watchdog</b>", ""]
for f in findings:
    icon = "\U0001F534" if f.get("severity") == "critical" else "\U0001F7E1"
    lines.append(f"{icon} <b>{f.get('check')}</b>: {f.get('message')}")
    d = (f.get("detail") or "").strip()
    if d:
        lines.append(f"<code>{d[:600]}</code>")
    lines.append("")
print("\n".join(lines))
PY
)

[ -z "$summary" ] && { log "Empty summary."; exit 0; }

# Suppress duplicate notifications for the same finding set unless NOTIFY_ALWAYS=1.
if [ "${NOTIFY_ALWAYS:-0}" != "1" ]; then
  fingerprint=$(printf '%s' "$summary" | md5sum | awk '{print $1}')
  prev=$(cat "$LAST_NOTIFY_FILE" 2>/dev/null || echo "")
  if [ "$fingerprint" = "$prev" ]; then
    log "Same finding set as last time, skipping notification."
    exit 0
  fi
  echo "$fingerprint" > "$LAST_NOTIFY_FILE"
fi

# Telegram has a 4096 char limit per message.
msg=$(printf '%s' "$summary" | head -c 3900)

resp=$(curl -s --max-time 20 -X POST \
  "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "parse_mode=HTML" \
  --data-urlencode "disable_web_page_preview=true" \
  --data-urlencode "text=${msg}" 2>&1)

if printf '%s' "$resp" | grep -q '"ok":true'; then
  log "Telegram notification sent."
  exit 0
fi

log "Telegram send failed: $(printf '%s' "$resp" | head -c 300)"
exit 1
