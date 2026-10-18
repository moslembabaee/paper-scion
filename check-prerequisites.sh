#!/usr/bin/env bash
# ==============================================================================
# Paper Tri-Agent Orchestra — Prerequisites & Environment Health Check
# ==============================================================================

set -uo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

pass() { echo -e "  [${GREEN}✓${NC}] $1"; }
warn() { echo -e "  [${YELLOW}!${NC}] $1"; }
fail() { echo -e "  [${RED}✗${NC}] $1"; }
header() { echo -e "\n${BLUE}=== $1 ===${NC}"; }

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}  Paper Environment & Agent Prerequisites Diagnostic  ${NC}"
echo -e "${BLUE}======================================================${NC}"

# 1. System & Hardware
header "1. System & Resource Capacity"
OS=$(uname -s)
ARCH=$(uname -m)
pass "Operating System: $OS ($ARCH)"

if command -v free >/dev/null 2>&1; then
    TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
    FREE_RAM=$(free -m | awk '/^Mem:/{print $7}')
    TOTAL_SWAP=$(free -m | awk '/^Swap:/{print $2}')
    
    if [ "$TOTAL_RAM" -ge 3500 ]; then
        pass "Total RAM: ${TOTAL_RAM} MB (Sufficient)"
    else
        warn "Total RAM: ${TOTAL_RAM} MB (Minimum 4000 MB recommended for heavy agent builds)"
    fi
    
    if [ "$TOTAL_SWAP" -ge 1000 ]; then
        pass "Swap Space: ${TOTAL_SWAP} MB configured"
    else
        warn "Swap Space: ${TOTAL_SWAP} MB (Configuring >= 2048 MB swap prevents OOM build kills)"
    fi
else
    pass "Resource check: free command unavailable (non-Linux)"
fi

# 2. Core Runtimes
header "2. Core Runtimes & Container Engine"

if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    pass "Node.js: $NODE_VER"
else
    fail "Node.js is NOT installed (Required: v20+ or v22+)"
fi

if command -v python3 >/dev/null 2>&1; then
    PY_VER=$(python3 --version 2>&1)
    pass "Python: $PY_VER"
else
    fail "Python3 is NOT installed (Required: v3.10+)"
fi

if command -v docker >/dev/null 2>&1; then
    DOCKER_VER=$(docker --version 2>&1)
    pass "Docker: $DOCKER_VER"
    if docker compose version >/dev/null 2>&1; then
        pass "Docker Compose: $(docker compose version 2>&1)"
    else
        warn "Docker Compose plugin missing (needed for self-hosting)"
    fi
else
    warn "Docker is NOT installed (Optional for local dev, required for self-hosted container deployment)"
fi

if command -v tmux >/dev/null 2>&1; then
    pass "tmux: $(tmux -V 2>&1) (Required for persistent orchestrator session)"
else
    fail "tmux is NOT installed (Run: apt install tmux)"
fi

# 3. GitHub CLI & Authentication
header "3. GitHub CLI & Issue Automation"

if command -v gh >/dev/null 2>&1; then
    pass "GitHub CLI: installed"
    if gh auth status >/dev/null 2>&1; then
        GH_USER=$(gh api user --jq .login 2>/dev/null || echo "authenticated")
        pass "GitHub Auth: Logged in as @$GH_USER (Issue triage & closing active)"
    else
        fail "GitHub CLI is NOT authenticated (Run: gh auth login)"
    fi
else
    fail "GitHub CLI (gh) is NOT installed (Required for issue bot: apt install gh)"
fi

# 4. Tri-Agent Coding CLIs
header "4. Tri-Agent Coding CLI Engines (Failover Chain)"
AVAILABLE_AGENTS=0

# A) Claude Code
if command -v claude >/dev/null 2>&1; then
    CLAUDE_TEST=$(claude -p "ping" --max-turns 1 2>&1 || true)
    if echo "$CLAUDE_TEST" | grep -qiE "hello|pong|ping|error: reached max turns"; then
        pass "Claude Code (claude): Operational and authenticated"
        AVAILABLE_AGENTS=$((AVAILABLE_AGENTS + 1))
    elif echo "$CLAUDE_TEST" | grep -qE "503|login|unauthorized"; then
        warn "Claude Code (claude): Installed, but authentication/gateway check returned: $CLAUDE_TEST"
    else
        pass "Claude Code (claude): Installed"
        AVAILABLE_AGENTS=$((AVAILABLE_AGENTS + 1))
    fi
else
    warn "Claude Code (claude) is not installed (npm install -g @anthropic-ai/claude-code)"
fi

# B) OpenAI Codex
if command -v codex >/dev/null 2>&1; then
    if command -v bwrap >/dev/null 2>&1; then
        pass "Bubblewrap (bwrap): Installed (required for Codex workspace sandbox)"
    else
        warn "Bubblewrap (bwrap) missing (Linux: apt install bubblewrap)"
    fi
    pass "OpenAI Codex (codex): Installed"
    AVAILABLE_AGENTS=$((AVAILABLE_AGENTS + 1))
else
    warn "OpenAI Codex (codex) is not installed (npm install -g @openai/codex)"
fi

# C) Google Antigravity
if command -v agy >/dev/null 2>&1; then
    pass "Google Antigravity (agy): Installed"
    AVAILABLE_AGENTS=$((AVAILABLE_AGENTS + 1))
else
    warn "Google Antigravity (agy) is not installed (optional third-tier fallback)"
fi

# Summary
header "Summary & Recommendations"
if [ "$AVAILABLE_AGENTS" -ge 1 ]; then
    pass "Orchestrator Readiness: ${AVAILABLE_AGENTS} agent CLI engine(s) available for the failover chain."
    echo -e "  ${GREEN}Ready to run: python3 orchestrator.py${NC}"
else
    fail "No coding agent CLIs available! Install at least one (Claude Code, OpenAI Codex, or Antigravity)."
fi
echo -e "${BLUE}======================================================${NC}\n"
