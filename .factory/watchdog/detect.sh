#!/usr/bin/env bash
# Paper Factory — Layer 1: DETECT (no LLM)
#
# Deterministic health checks for the Paper Scion factory. Runs every 2 minutes
# from a systemd timer, entirely independent of Scion (so it still works when
# Scion itself is down).
#
# Emits a JSON findings file and exits non-zero if any check fails.
#   exit 0 = healthy
#   exit 1 = problems found (see findings JSON)
#
# Layer 2 (diagnose.sh) consumes the findings file and decides what to do.

set -u

CONFIG_FILE="${FACTORY_CONFIG:-/root/projects/paper-scion/.factory/watchdog/config.env}"
STATE_DIR="${FACTORY_STATE_DIR:-/var/lib/paper-watchdog}"

# shellcheck source=/dev/null
[ -f "$CONFIG_FILE" ] && . "$CONFIG_FILE"

PROJECT_DIR="${PROJECT_DIR:-/root/projects/paper-scion}"
REPO="${REPO:-moslembabaee/paper-scion}"
SITE_URL="${SITE_URL:-https://paper.141.11.32.213.nip.io}"
SCION_HUB="${SCION_HUB:-http://127.0.0.1:8080}"
PIPELINE_LOG="${PIPELINE_LOG:-$PROJECT_DIR/logs/pipeline.log}"
DEPLOY_LOG="${DEPLOY_LOG:-$PROJECT_DIR/logs/deploy.log}"
PIPELINE_STATE="${PIPELINE_STATE:-$PROJECT_DIR/logs/pipeline_state.json}"
NO_PROGRESS_MINUTES="${NO_PROGRESS_MINUTES:-45}"
HEALTH_FAIL_THRESHOLD="${HEALTH_FAIL_THRESHOLD:-3}"
REPEAT_DISPATCH_LIMIT="${REPEAT_DISPATCH_LIMIT:-5}"
DEPLOY_FAIL_LIMIT="${DEPLOY_FAIL_LIMIT:-3}"
# Only count deploy failures inside this window (minutes) — old failures stay
# in the log forever and would keep re-triggering the alarm.
DEPLOY_FAIL_WINDOW_MIN="${DEPLOY_FAIL_WINDOW_MIN:-60}"
DISPATCH_WINDOW_MIN="${DISPATCH_WINDOW_MIN:-60}"
DISK_FREE_MB_MIN="${DISK_FREE_MB_MIN:-2000}"

mkdir -p "$STATE_DIR"
FINDINGS_FILE="$STATE_DIR/findings.json"
COUNTER_FILE="$STATE_DIR/health_fail_count"
LAST_NOTIFY_FILE="$STATE_DIR/last_notify_ts"
LOG_FILE="$STATE_DIR/watchdog.log"

log() {
  echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] [WATCHDOG] $*" >> "$LOG_FILE"
}

FINDINGS="[]"
add_finding() {
  # $1 = severity (critical|warning), $2 = check id, $3 = message, $4 = detail
  local sev="$1" id="$2" msg="$3" detail="${4:-}"
  local escaped
  escaped=$(printf '%s' "$detail" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()[:2000]))' 2>/dev/null || echo '""')
  FINDINGS=$(printf '%s' "$FINDINGS" | python3 -c "
import json,sys
arr = json.load(sys.stdin)
arr.append({'severity': '$sev', 'check': '$id', 'message': '''$msg''', 'detail': $escaped})
print(json.dumps(arr))
")
  log "[$sev] $id: $msg"
}

# ---------------------------------------------------------------------------
# CHECK 1: public site health
# ---------------------------------------------------------------------------
site_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE_URL/healthz" 2>/dev/null || echo "000")
if [ "$site_code" = "200" ]; then
  echo 0 > "$COUNTER_FILE"
else
  count=$(( $(cat "$COUNTER_FILE" 2>/dev/null || echo 0) + 1 ))
  echo "$count" > "$COUNTER_FILE"
  sev="warning"
  [ "$count" -ge "$HEALTH_FAIL_THRESHOLD" ] && sev="critical"
  add_finding "$sev" "site_health" \
    "Site health endpoint returned HTTP $site_code (${count} consecutive failure(s))" \
    "url=$SITE_URL/healthz code=$site_code consecutive=$count"
fi

# ---------------------------------------------------------------------------
# CHECK 2: docker container health (paper-api crash-looping = site down)
# ---------------------------------------------------------------------------
for svc in paper-scion-paper-api-1 paper; do
  state=$(docker inspect -f '{{.State.Status}}' "$svc" 2>/dev/null || echo "missing")
  if [ "$state" = "running" ]; then
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$svc" 2>/dev/null || echo "none")
    if [ "$health" = "unhealthy" ]; then
      logs=$(docker logs --tail 25 "$svc" 2>&1 | tail -n 12)
      add_finding "critical" "container_health" \
        "Container '$svc' is running but UNHEALTHY" \
        "service=$svc health=$health logs=$logs"
    fi
  else
    add_finding "critical" "container_health" \
      "Container '$svc' is not running (state=$state)" \
      "service=$svc state=$state"
  fi
done

# ---------------------------------------------------------------------------
# CHECK 3: repeated dispatch of the same issue (the restart-loop bug)
#
# Time-windowed, not line-windowed: the old bug produced 88 dispatches of
# issue #79 over 8 hours, but that history stays in the log forever and would
# keep re-triggering. Only dispatches inside the window are counted.
# ---------------------------------------------------------------------------
DISPATCH_WINDOW_MIN="${DISPATCH_WINDOW_MIN:-60}"
if [ -f "$PIPELINE_LOG" ]; then
  window_start=$(date -u -d "${DISPATCH_WINDOW_MIN} minutes ago" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "1970-01-01 00:00:00")
  dispatch_lines=$(awk -v start="$window_start" '
    $0 ~ /Dispatching new autonomous task: Issue #[0-9]+/ {
      # log line format: [YYYY-MM-DD HH:MM:SS UTC] [PIPELINE] ...
      ts = substr($0, 2, 19)
      if (ts >= start) print
    }' "$PIPELINE_LOG" 2>/dev/null)
  repeats=$(printf '%s' "$dispatch_lines" | grep -oE "Issue #[0-9]+" | grep -oE "#[0-9]+" | sort | uniq -c | sort -rn | head -n 1 | awk '{print $1}')
  issue=$(printf '%s' "$dispatch_lines" | grep -oE "Issue #[0-9]+" | grep -oE "#[0-9]+" | sort | uniq -c | sort -rn | head -n 1 | awk '{print $2}')
  if [ -n "${repeats:-}" ] && [ "${repeats:-0}" -gt "$REPEAT_DISPATCH_LIMIT" ]; then
    add_finding "critical" "dispatch_loop" \
      "Issue $issue was dispatched $repeats times in the last ${DISPATCH_WINDOW_MIN}min (limit $REPEAT_DISPATCH_LIMIT)" \
      "issue=$issue dispatches=$repeats limit=$REPEAT_DISPATCH_LIMIT window_min=$DISPATCH_WINDOW_MIN"
  fi
fi

# ---------------------------------------------------------------------------
# CHECK 4: no progress — repo has not moved in N minutes
# ---------------------------------------------------------------------------
last_commit_ts=$(git -C "$PROJECT_DIR" log -1 --format=%ct 2>/dev/null || echo 0)
now_ts=$(date +%s)
if [ "$last_commit_ts" -gt 0 ]; then
  idle_min=$(( (now_ts - last_commit_ts) / 60 ))
  if [ "$idle_min" -gt "$NO_PROGRESS_MINUTES" ]; then
    # Distinguish "no work in the queue" from "work is stuck".
    open_approved=$(gh issue list -R "$REPO" --state open --label approved --limit 100 --json number 2>/dev/null | grep -oE '"number":[0-9]+' | wc -l)
    if [ "${open_approved:-0}" -gt 0 ]; then
      add_finding "warning" "no_progress" \
        "No new commit for ${idle_min}min while ${open_approved} approved issue(s) are pending" \
        "idle_minutes=$idle_min open_approved=$open_approved"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# CHECK 5: deployment failures piling up
# ---------------------------------------------------------------------------
if [ -f "$DEPLOY_LOG" ]; then
  deploy_window_start=$(date -u -d "${DEPLOY_FAIL_WINDOW_MIN} minutes ago" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "1970-01-01 00:00:00")
  deploy_fails=$(awk -v start="$deploy_window_start" '
    $0 ~ /Error restarting Docker container/ {
      ts = substr($0, 2, 19)
      if (ts >= start) c++
    }
    END { print c+0 }' "$DEPLOY_LOG" 2>/dev/null)
  if [ "${deploy_fails:-0}" -ge "$DEPLOY_FAIL_LIMIT" ]; then
    last_err=$(awk -v start="$deploy_window_start" '
      ts = substr($0, 2, 19)
      if (ts >= start) buf[NR] = $0
      END { n = NR; for (i = n-9; i <= n; i++) if (buf[i] != "") print buf[i] }' "$DEPLOY_LOG" 2>/dev/null)
    add_finding "critical" "deploy_failures" \
      "${deploy_fails} deployment failures in the last ${DEPLOY_FAIL_WINDOW_MIN}min (limit $DEPLOY_FAIL_LIMIT)" \
      "$last_err"
  fi
fi

# ---------------------------------------------------------------------------
# CHECK 6: the autonomous pipeline supervisor is alive
# ---------------------------------------------------------------------------
if pgrep -f "scion_pipeline.py" >/dev/null 2>&1; then
  : # alive
else
  add_finding "warning" "pipeline_down" \
    "Autonomous pipeline supervisor (scion_pipeline.py) is not running" \
    "expected_process=scion_pipeline.py"
fi

# ---------------------------------------------------------------------------
# CHECK 7: server bundle must not import react (the outage of 2026-10-21)
# ---------------------------------------------------------------------------
if [ "${CHECK_SERVER_BUNDLE:-1}" = "1" ] && [ -d "$PROJECT_DIR/app" ]; then
  # Wipe the scratch output dir first: tsc does not remove files that are no
  # longer part of the graph, so a stale injector.js from an earlier build
  # would keep reporting a leak that no longer exists.
  rm -rf "$STATE_DIR/srvcheck"
  leak=$(cd "$PROJECT_DIR/app" && \
    npx tsc -p tsconfig.server.json --outDir "$STATE_DIR/srvcheck" >/dev/null 2>&1 && \
    grep -rl "from 'react'" "$STATE_DIR/srvcheck" --include=*.js 2>/dev/null \
    | grep -v "manifest.js" | grep -v "model-gateway.js" | head -n 3)
  if [ -n "${leak:-}" ]; then
    add_finding "critical" "server_bundle_react" \
      "Server bundle imports react — the cloud API will crash-loop on boot" \
      "files=$(echo "$leak" | tr '\n' ' ')"
  fi
  rm -rf "$STATE_DIR/srvcheck"
fi

# ---------------------------------------------------------------------------
# CHECK 8: disk space
# ---------------------------------------------------------------------------
disk_free_mb=$(df -Pm "$PROJECT_DIR" | awk 'NR==2 {print $4}')
if [ -n "${disk_free_mb:-}" ] && [ "$disk_free_mb" -lt "$DISK_FREE_MB_MIN" ]; then
  add_finding "warning" "disk_space" \
    "Only ${disk_free_mb}MB free on the project filesystem (min $DISK_FREE_MB_MIN)" \
    "free_mb=$disk_free_mb"
fi

# ---------------------------------------------------------------------------
# CHECK 9: memory pressure
# ---------------------------------------------------------------------------
avail_mb=$(free -m | awk '/^Mem:/ {print $7}')
if [ -n "${avail_mb:-}" ] && [ "$avail_mb" -lt 500 ]; then
  add_finding "warning" "memory_pressure" \
    "Only ${avail_mb}MB RAM available (min 500)" \
    "avail_mb=$avail_mb"
fi

# ---------------------------------------------------------------------------
# Write findings + decide exit code
# ---------------------------------------------------------------------------
count=$(printf '%s' "$FINDINGS" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
critical=$(printf '%s' "$FINDINGS" | python3 -c 'import json,sys; print(sum(1 for f in json.load(sys.stdin) if f["severity"]=="critical"))' 2>/dev/null || echo 0)

printf '%s\n' "$FINDINGS" > "$FINDINGS_FILE"

if [ "$count" -gt 0 ]; then
  log "Found $count issue(s), $critical critical."
  exit 1
fi

log "All checks passed."
exit 0
