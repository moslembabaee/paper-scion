#!/usr/bin/env bash
# Paper Factory — Watchdog main entry point.
#
# Runs the three layers in order:
#   1. detect.sh    — deterministic checks, no LLM (always runs)
#   2. diagnose.sh  — LLM root-cause analysis (only if layer 1 found a problem)
#   3. remediate.sh — SAFE automatic fixes
#   4. notify.sh    — Telegram message to the owner
#
# Designed to run from a systemd timer every 2 minutes, independently of Scion.

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${FACTORY_CONFIG:-$HERE/config.env}"
STATE_DIR="${FACTORY_STATE_DIR:-/var/lib/paper-watchdog}"
LOG_FILE="$STATE_DIR/watchdog.log"

mkdir -p "$STATE_DIR"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] [WATCHDOG] $*" >> "$LOG_FILE"; }

# --- Layer 1: detect --------------------------------------------------------
bash "$HERE/detect.sh"
detect_code=$?

if [ "$detect_code" -eq 0 ]; then
  log "Healthy — no diagnosis, no notification."
  exit 0
fi

log "Problems detected (exit $detect_code). Running diagnosis..."

# --- Layer 2: diagnose (LLM) ----------------------------------------------
bash "$HERE/diagnose.sh" || log "Diagnosis skipped or failed."

# --- Layer 3: remediate (safe actions only) -------------------------------
bash "$HERE/remediate.sh" || log "Remediation skipped or failed."

# --- Layer 4: notify --------------------------------------------------------
bash "$HERE/notify.sh" || log "Notification failed."

exit 0
