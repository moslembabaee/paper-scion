#!/usr/bin/env python3
"""
Autonomous Multi-Agent Pipeline for Paper Scion.
Supervises continuous task execution, GitHub PR lifecycle, and zero-downtime deployment.
"""

import os
import sys
import time
import json
import subprocess
from datetime import datetime

PROJECT_DIR = "/root/projects/paper-scion"
LOG_DIR = os.path.join(PROJECT_DIR, "logs")
PIPELINE_LOG = os.path.join(LOG_DIR, "pipeline.log")
DEPLOY_SCRIPT = os.path.join(PROJECT_DIR, "auto_deploy.sh")
CONFLICT_CHECKER = os.path.join(PROJECT_DIR, "scripts", "conflict_checker.py")
REPO = "moslembabaee/paper-scion"
STATE_FILE = os.path.join(LOG_DIR, "pipeline_state.json")

# Maximum number of dispatch attempts per issue before it is parked as blocked.
# Without this guard a repeatedly failing issue (clone error, quota error, stall)
# is re-dispatched every supervisor cycle, burning tokens and flooding the log.
MAX_ATTEMPTS_PER_ISSUE = 3
# Backoff between attempts for the same issue (seconds).
RETRY_BACKOFF_SECONDS = 900

os.makedirs(LOG_DIR, exist_ok=True)

def log(msg: str):
    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    line = f"[{timestamp}] [PIPELINE] {msg}"
    print(line, flush=True)
    with open(PIPELINE_LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def run_cmd(cmd, cwd=PROJECT_DIR, timeout=300):
    res = subprocess.run(cmd, shell=isinstance(cmd, str), cwd=cwd, capture_output=True, text=True, timeout=timeout)
    return res.returncode, res.stdout.strip(), res.stderr.strip()

def load_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}

def save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except OSError as e:
        log(f"Failed to persist pipeline state: {e}")

def attempt_allowed(state, issue_num):
    """Return True when the issue may be dispatched now (attempt + backoff guard)."""
    entry = state.get(str(issue_num))
    if not entry:
        return True
    attempts = entry.get("attempts", 0)
    if attempts >= MAX_ATTEMPTS_PER_ISSUE:
        return False
    last = entry.get("last_attempt_ts", 0)
    if (time.time() - last) < RETRY_BACKOFF_SECONDS:
        return False
    return True

def record_attempt(state, issue_num, success=False):
    """Count a dispatch attempt. `success=True` resets the counter (issue shipped)."""
    entry = state.setdefault(str(issue_num), {"attempts": 0})
    if success:
        entry["attempts"] = 0
        entry["last_attempt_ts"] = 0
    else:
        entry["attempts"] = entry.get("attempts", 0) + 1
        entry["last_attempt_ts"] = time.time()
    save_state(state)

def get_scion_agents():
    code, stdout, stderr = run_cmd(["scion", "list", "--format", "json"])
    if code != 0:
        log(f"Error querying scion list: {stderr}")
        return []
    try:
        return json.loads(stdout) if stdout else []
    except Exception as e:
        log(f"Failed to parse scion list json: {e}")
        return []

def get_open_issues():
    code, stdout, stderr = run_cmd([
        "gh", "issue", "list",
        "-R", REPO,
        "--state", "open",
        "--limit", "100",
        "--json", "number,title,body,labels"
    ])
    if code != 0:
        log(f"Error fetching issues from GitHub: {stderr}")
        return []
    try:
        issues = json.loads(stdout)
        issues.sort(key=lambda x: x["number"])
        return issues
    except Exception as e:
        log(f"Failed to parse issues json: {e}")
        return []

def select_next_issue(issues):
    # 1. First prioritize an issue already marked in-progress
    for issue in issues:
        label_names = [l["name"] for l in issue.get("labels", [])]
        if "in-progress" in label_names:
            return issue

    # 2. Prefer #108 if open (user's target feature)
    for issue in issues:
        if issue["number"] == 108:
            return issue

    # 3. Otherwise pick lowest open issue without blocked label
    for issue in issues:
        label_names = [l["name"] for l in issue.get("labels", [])]
        if "blocked" not in label_names and "conflict" not in label_names:
            return issue

    # 4. Fallback: lowest open issue
    return issues[0] if issues else None

def deploy_now():
    log("Running zero-downtime auto_deploy.sh...")
    code, stdout, stderr = run_cmd(["bash", DEPLOY_SCRIPT])
    if code == 0:
        log("auto_deploy.sh finished successfully.")
    else:
        log(f"auto_deploy.sh returned non-zero code {code}: {stderr or stdout}")

def handle_completed_agent(agent):
    name = agent.get("name", "")
    phase = agent.get("phase", "")
    log(f"Agent '{name}' reached terminal phase: '{phase}'. Processing results...")

    # Extract issue number from agent name (e.g. agent-issue-108)
    issue_num = None
    if name.startswith("agent-issue-"):
        try:
            issue_num = int(name.replace("agent-issue-", ""))
        except ValueError:
            pass

    # Check if a Pull Request exists for this issue or agent branch
    code, stdout, _ = run_cmd(["gh", "pr", "list", "-R", REPO, "--state", "open", "--json", "number,headRefName,title"])
    prs = json.loads(stdout) if code == 0 and stdout else []
    
    matching_pr = None
    for pr in prs:
        if issue_num and f"#{issue_num}" in pr["title"] or f"issue-{issue_num}" in pr["headRefName"] or name in pr["headRefName"]:
            matching_pr = pr
            break

    if matching_pr:
        pr_num = matching_pr["number"]
        log(f"Found active PR #{pr_num} for issue #{issue_num}. Merging...")
        m_code, m_out, m_err = run_cmd(["gh", "pr", "merge", str(pr_num), "-R", REPO, "--squash", "--auto", "--delete-branch"])
        if m_code != 0:
            # Try immediate merge if auto-merge wasn't needed
            m_code, m_out, m_err = run_cmd(["gh", "pr", "merge", str(pr_num), "-R", REPO, "--squash", "--delete-branch"])
        
        log(f"PR merge result: code={m_code}, output={m_out or m_err}")
        deploy_now()

        if issue_num:
            log(f"Closing GitHub Issue #{issue_num}...")
            run_cmd(["gh", "issue", "close", str(issue_num), "-R", REPO, "-c", f"Resolved and deployed by Scion agent `{name}`."])
            run_cmd(["gh", "issue", "edit", str(issue_num), "-R", REPO, "--remove-label", "in-progress"])
            # The issue shipped: clear its attempt counter so a future issue with
            # the same number would not inherit a stale failure count.
            state = load_state()
            record_attempt(state, issue_num, success=True)
    else:
        log(f"⚠️ Agent '{name}' exited without creating a PR for issue #{issue_num}.")
        if issue_num:
            run_cmd(["gh", "issue", "edit", str(issue_num), "-R", REPO, "--remove-label", "in-progress"])

    log(f"Cleaning up completed Scion agent '{name}'...")
    run_cmd(["scion", "delete", name, "--yes"])

def dispatch_task(issue, state):
    num = issue["number"]
    title = issue["title"]
    body = issue.get("body", "")
    agent_name = f"agent-issue-{num}"

    log(f"Dispatching new autonomous task: Issue #{num} - '{title}' to agent '{agent_name}'")

    # Strictly update issue labels: ensure ONLY this issue is in-progress
    run_cmd(["gh", "issue", "edit", str(num), "-R", REPO, "--add-label", "in-progress", "--remove-label", "blocked"])

    # Build prompt
    prompt = f"""You are an autonomous senior engineer working on the Paper Scion project.
Task: Issue #{num}: {title}

Requirements & Specifications:
{body}

Engineering Rules (from AGENTS.md & LESSONS.md):
1. Always read LESSONS.md first to avoid known pitfalls with shaders, geometry, or typings.
2. Work cleanly on the feature branch.
3. Verify quality gates before finishing:
   cd /workspace/app && npm test
   cd /workspace/app && npm run build
   All tests must pass (100% green) and compilation must succeed with zero errors.
4. Commit your changes using Conventional Commits (e.g. feat(...): ...).
5. Push your branch and open a Pull Request to main:
   git push -u origin HEAD
   gh pr create --title "{title}" --body "Closes #{num} - Implemented and verified by Scion agent."
"""

    # Launch agent with feature-developer template and Claude harness (connected to Nine Router)
    start_cmd = [
        "scion", "start", agent_name, prompt,
        "--type", "feature-developer",
        "--harness-config", "claude"
    ]
    code, stdout, stderr = run_cmd(start_cmd)
    if code == 0:
        log(f"✅ Agent '{agent_name}' launched successfully: {stdout}")
    else:
        log(f"❌ Failed to launch agent '{agent_name}': {stderr or stdout}")
        run_cmd(["gh", "issue", "edit", str(num), "-R", REPO, "--remove-label", "in-progress", "--add-label", "blocked"])
    # A dispatch is always an attempt. The counter is only reset when the agent
    # actually ships a merged PR (see handle_completed_agent).
    record_attempt(state, num, success=False)

def step():
    agents = get_scion_agents()
    # Filter out long-running consultative agents (like architect) from pipeline task handling
    active_agents = [
        a for a in agents 
        if a.get("phase") not in ("deleted", "none") 
        and not a.get("name", "").startswith("architect")
    ]

    if active_agents:
        agent = active_agents[0]
        phase = agent.get("phase", "")
        activity = agent.get("activity", "")
        name = agent.get("name", "")
        container_status = agent.get("containerStatus", "")

        is_terminal = (
            phase in ("completed", "stopped", "failed", "error")
            or activity in ("completed", "limits_exceeded")
            or container_status.startswith("Exited")
        )
        # NOTE: "stalled" and "offline" are NOT terminal. Scion marks an agent
        # stalled after ~10 min without a state transition, which happens
        # routinely while the agent waits on a long test/build command.
        # Treating those as terminal made the supervisor delete and re-dispatch
        # a healthy, mid-flight agent every cycle, destroying its context and
        # work (issue #79 was restarted 86 times over 8 hours).
        if is_terminal:
            handle_completed_agent(agent)
        else:
            log(f"Active agent running: '{name}' (phase: {phase}, activity: {activity}, container: {container_status}). Supervising...")
        return

    # No agent running -> check if there's any pending deployment
    deploy_now()

    state = load_state()

    # Pick next issue
    issues = get_open_issues()
    if not issues:
        log("No open issues remaining. Repository roadmap is 100% complete!")
        return

    next_issue = select_next_issue(issues)
    if not next_issue:
        return

    num = next_issue["number"]
    if not attempt_allowed(state, num):
        entry = state.get(str(num), {})
        attempts = entry.get("attempts", 0)
        if attempts >= MAX_ATTEMPTS_PER_ISSUE:
            log(f"⛔ Issue #{num} exceeded {MAX_ATTEMPTS_PER_ISSUE} attempts; parking it as blocked.")
            run_cmd(["gh", "issue", "edit", str(num), "-R", REPO, "--remove-label", "in-progress", "--add-label", "blocked"])
        else:
            log(f"⏳ Issue #{num} is in retry backoff (attempt {attempts}/{MAX_ATTEMPTS_PER_ISSUE}).")
        return

    dispatch_task(next_issue, state)

def main():
    log("Starting Paper Scion Autonomous Pipeline supervisor...")
    while True:
        try:
            step()
        except Exception as e:
            log(f"Unexpected error in pipeline loop: {e}")
        time.sleep(30)

if __name__ == "__main__":
    main()
