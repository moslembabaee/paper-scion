#!/usr/bin/env bash
# Paper Factory — Remediation (safe actions only)
#
# Applies only SAFE automatic fixes:
#   - restart an unhealthy/crash-looping container
#   - roll back the deployed commit to the last known-good one
#
# Anything classified RISKY is reported to the owner and left alone.
#
# This script never edits source code and never force-pushes.

set -u

CONFIG_FILE="${FACTORY_CONFIG:-/root/projects/paper-scion/.factory/watchdog/config.env}"
STATE_DIR="${FACTORY_STATE_DIR:-/var/lib/paper-watchdog}"
# shellcheck source=/dev/null
[ -f "$CONFIG_FILE" ] && . "$CONFIG_FILE"

FINDINGS_FILE="$STATE_DIR/findings.json"
DIAGNOSIS_FILE="$STATE_DIR/diagnosis.md"
LOG_FILE="$STATE_DIR/watchdog.log"
DEPLOY_LOG="${DEPLOY_LOG:-$PROJECT_DIR/logs/deploy.log}"
LAST_DEPLOYED_FILE="$PROJECT_DIR/.last_deployed_commit"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] [REMEDIATE] $*" >> "$LOG_FILE"; }

[ -f "$FINDINGS_FILE" ] || exit 0
[ "${AUTO_REMEDIATE:-0}" = "1" ] || { log "AUTO_REMEDIATE disabled."; exit 0; }

# Only act when the LLM (if it ran) classified the fix as SAFE.
classification="NONE"
if [ -f "$DIAGNOSIS_FILE" ]; then
  classification=$(grep -oiE "CLASSIFY:\s*(SAFE|RISKY|NONE)" "$DIAGNOSIS_FILE" | head -n 1 | awk '{print $2}')
  classification="${classification:-NONE}"
fi

findings=$(cat "$FINDINGS_FILE")

# --- SAFE FIX 1: recreate an unhealthy / crash-looping container -------------
needs_restart=$(printf '%s' "$findings" | python3 -c '
import json,sys
try: f = json.load(sys.stdin)
except Exception: print(""); raise SystemExit
hits = [x for x in f if x.get("check") == "container_health"]
if hits and any("UNHEALTHY" in x.get("message","") or "not running" in x.get("message","") for x in hits):
    print("yes")
' 2>/dev/null)

if [ "${needs_restart:-}" = "yes" ]; then
  if [ "$classification" = "RISKY" ]; then
    log "Container unhealthy but LLM classified as RISKY — not auto-fixing."
  else
    log "Container unhealthy — recreating containers."
    docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d --wait --wait-timeout 120 --remove-orphans \
      >> "$LOG_FILE" 2>&1 && log "Containers recreated." || log "Container recreate failed."
  fi
fi

# --- SAFE FIX 2: roll back to the last deployed commit ----------------------
needs_rollback=$(printf '%s' "$findings" | python3 -c '
import json,sys
try: f = json.load(sys.stdin)
except Exception: print(""); raise SystemExit
if any(x.get("check") in ("deploy_failures","server_bundle_react") for x in f):
    print("yes")
' 2>/dev/null)

if [ "${needs_rollback:-}" = "yes" ] && [ -f "$LAST_DEPLOYED_FILE" ]; then
  if [ "$classification" = "RISKY" ]; then
    log "Deploy failing but LLM classified as RISKY — not rolling back."
  else
    good=$(cat "$LAST_DEPLOYED_FILE" 2>/dev/null)
    bad=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null)
    if [ -n "$good" ] && [ "$good" != "$bad" ]; then
      log "Rolling back working tree from $bad to last deployed $good."
      git -C "$PROJECT_DIR" checkout --detach "$good" >> "$LOG_FILE" 2>&1 \
        && log "Rolled back to $good." \
        || log "Rollback failed."
    else
      log "Deploy failing but working tree already at last deployed commit ($bad)."
    fi
  fi
fi

exit 0
