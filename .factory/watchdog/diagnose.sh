#!/usr/bin/env bash
# Paper Factory — Layer 2: DIAGNOSE (LLM, only on incident)
#
# Takes the findings produced by detect.sh, asks a free LLM to identify the
# likely root cause, and writes a recommended action list. It does NOT change
# anything by itself — remediate.sh decides what is safe to apply.
#
# Cost: one cheap model call per incident. Nothing at all in the healthy case.

set -u

CONFIG_FILE="${FACTORY_CONFIG:-/root/projects/paper-scion/.factory/watchdog/config.env}"
STATE_DIR="${FACTORY_STATE_DIR:-/var/lib/paper-watchdog}"
# shellcheck source=/dev/null
[ -f "$CONFIG_FILE" ] && . "$CONFIG_FILE"

FINDINGS_FILE="$STATE_DIR/findings.json"
DIAGNOSIS_FILE="$STATE_DIR/diagnosis.md"
LOG_FILE="$STATE_DIR/watchdog.log"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] [DIAGNOSE] $*" >> "$LOG_FILE"; }

[ -f "$FINDINGS_FILE" ] || { log "No findings file."; exit 0; }

# Respect LLM_MIN_SEVERITY (default: critical). Do not call LLM for minor warnings.
min_sev="${LLM_MIN_SEVERITY:-critical}"
has_matching_sev=$(python3 - "$FINDINGS_FILE" "$min_sev" << 'PY' 2>/dev/null
import json, sys
try:
    findings = json.load(open(sys.argv[1]))
    min_s = sys.argv[2].lower()
    if min_s == "critical":
        ok = any(f.get("severity") == "critical" for f in findings)
    else:
        ok = len(findings) > 0
    print("yes" if ok else "no")
except Exception:
    print("no")
PY
)

if [ "${has_matching_sev:-no}" != "yes" ]; then
  log "No findings match LLM_MIN_SEVERITY ($min_sev). Skipping LLM diagnosis."
  exit 0
fi

[ -f "${LLM_API_KEY_FILE:-}" ] || { log "No LLM key file (${LLM_API_KEY_FILE:-unset})."; exit 0; }

API_KEY=$(tr -d '\r\n' < "$LLM_API_KEY_FILE")
[ -z "$API_KEY" ] && { log "Empty LLM key."; exit 0; }

# Gather a compact diagnostic bundle.
DIAG_BUNDLE=$(python3 - "$FINDINGS_FILE" "$PROJECT_DIR" << 'PY' 2>/dev/null
import json, subprocess, sys, os
findings_path, project = sys.argv[1], sys.argv[2]
out = []
try:
    out.append("FINDINGS:\n" + json.dumps(json.load(open(findings_path)), indent=1)[:3000])
except Exception as e:
    out.append(f"findings unreadable: {e}")

def run(cmd, t=25):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=t, cwd=project)
        return (r.stdout + r.stderr)[:2500]
    except Exception as e:
        return f"(cmd failed: {e})"

out.append("\nDOCKER PS:\n" + run("docker ps -a --format '{{.Names}}\\t{{.Status}}' | head -20"))
out.append("\nRECENT API LOG:\n" + run("docker logs --tail 30 paper-scion-paper-api-1 2>&1 | tail -20"))
out.append("\nRECENT DEPLOY LOG:\n" + run("tail -n 40 logs/deploy.log 2>/dev/null | tail -25"))
out.append("\nRECENT PIPELINE LOG:\n" + run("tail -n 60 logs/pipeline.log 2>/dev/null | grep -v DeprecationWarning | tail -30"))
out.append("\nGIT LOG:\n" + run("git log --oneline -8"))
out.append("\nOPEN ISSUES:\n" + run("gh issue list -R moslembabaee/paper-scion --state open --limit 20 --json number,title,labels 2>/dev/null | head -c 2000"))
print("\n".join(out))
PY
)

PROMPT="You are the incident commander for an autonomous multi-agent software factory.

Below is a machine-generated health report plus diagnostic context. Identify the
single most likely ROOT CAUSE of the incident and propose the safest concrete
fix.

OUTPUT FORMAT — follow it EXACTLY, nothing before or after:

ROOT CAUSE: <one sentence>
CLASSIFY: <SAFE|RISKY|NONE>
FIX:
- <step 1>
- <step 2>

CLASSIFY rules:
  SAFE  = service restart, container recreate, git rollback to last good commit
  RISKY = editing source code, changing config, force-push, touching data
  NONE  = no action needed, or a human must decide

Be specific: name files and commands. Maximum 120 words total.

=== DIAGNOSTIC BUNDLE ===
$DIAG_BUNDLE"

req=$(python3 - "$LLM_BASE_URL" "$LLM_MODEL" "$PROMPT" << 'PY'
import json, sys
base, model, prompt = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({
    "model": model,
    "messages": [{"role": "user", "content": prompt}],
    "max_tokens": 2000,
    "temperature": 0.2,
    "stream": False,
}))
PY
)

resp=$(curl -s --max-time 90 -X POST "${LLM_BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$req" 2>&1)

text=$(printf '%s' "$resp" | python3 -c '
import json,sys
raw = sys.stdin.read()
def from_json(d):
    try:
        m = d["choices"][0]["message"]
    except Exception:
        return ""
    # Reasoning models put the answer in reasoning_content and may leave
    # content empty when the token budget is small.
    return (m.get("content") or "").strip() or (m.get("reasoning_content") or "").strip()
try:
    d = json.loads(raw)
    if "choices" in d:
        t = from_json(d)
        print(t if t else "LLM_ERROR: empty response " + raw[:300])
    else:
        print("LLM_ERROR: " + raw[:400])
except Exception:
    # Some routers stream SSE even for non-stream requests.
    parts = []
    for line in raw.splitlines():
        if line.startswith("data: "):
            try:
                chunk = json.loads(line[6:])
                parts.append(chunk["choices"][0]["delta"].get("content",""))
            except Exception:
                pass
    joined = "".join(parts)
    print(joined if joined else "LLM_ERROR: " + raw[:400])
' 2>/dev/null)

if [ -z "$text" ] || printf '%s' "$text" | grep -q "^LLM_ERROR"; then
  log "LLM diagnosis failed: $(printf '%s' "$text" | head -c 200)"
  exit 1
fi

printf '%s\n' "$text" > "$DIAGNOSIS_FILE"
log "Diagnosis written to $DIAGNOSIS_FILE"
exit 0
