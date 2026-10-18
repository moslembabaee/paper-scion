# 📋 Prerequisites & Environment Setup Guide

This guide details the complete system requirements, runtime dependencies, and AI agent CLIs needed to run, develop, and autonomously orchestrate **Paper**.

---

## ⚡️ Quick Diagnostic

To instantly check what dependencies are present and operational on your machine:
```bash
./check-prerequisites.sh
```

---

## 1. System & Hardware Specifications

| Component | Minimum Specification | Recommended | Notes |
|---|---|---|---|
| **OS** | Linux (Ubuntu 22.04 / 24.04, Debian), macOS 13+, Windows WSL2 | Ubuntu 24.04 LTS | Standard POSIX tools required (`tmux`, `bash`, `cron`) |
| **CPU** | 2 vCPUs | 4+ vCPUs | Needed for parallel TypeScript builds & Vite |
| **RAM** | 3.5 GB | 8 GB+ | Heavy node builds require memory |
| **Swap Space** | 2 GB Swap | 4 GB Swap | **Critical** on 4GB VMs to prevent OOM build crashes |
| **Disk Space** | 10 GB free | 20 GB free | Space for Docker images, npm cache, and build outputs |

---

## 2. Core Language Runtimes & Utilities

### Node.js & npm (Required for web app & Playwright)
- **Version:** Node.js `v20.x` or `v22.x` (LTS)
- **Installation:**
  ```bash
  # Via NodeSource or nvm:
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
  ```

### Python 3 (Required for Orchestrator & Bots)
- **Version:** Python `3.10` or newer
- **Installation:**
  ```bash
  apt install -y python3 python3-pip
  ```

### tmux (Required for persistent orchestrator keep-alive)
- **Installation:**
  ```bash
  apt install -y tmux
  ```

### Docker & Docker Compose (Required for self-hosting)
- **Version:** Docker Engine `24.x+` with Docker Compose plugin `v2.x+`
- **Installation:**
  ```bash
  apt install -y docker.io docker-compose-v2
  # Allow non-root docker access:
  usermod -aG docker $USER
  ```

---

## 3. GitHub CLI & Issue Automation (`gh`)

The autonomous orchestra integrates directly with GitHub Issues for task triage, authorization gates, and automated closing.

- **Installation:**
  ```bash
  type -p curl >/dev/null || apt install curl -y
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
  apt update && apt install gh -y
  ```
- **Authentication:**
  ```bash
  gh auth login -s "repo,read:org,workflow"
  ```

---

## 4. Coding Agent CLI Engines (The Tri-Agent Orchestra)

The orchestrator operates a **Failover Relay Chain**:
$$\text{Claude Code} \longrightarrow \text{OpenAI Codex} \longrightarrow \text{Google Antigravity}$$

> **Important:** You do **not** need all three engines to run autonomous development. Having **at least one** allows the orchestrator to build features; having two or three provides automatic failover if one hits quota limits.

### A. Claude Code CLI (`claude`)
- **Installation:**
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```
- **Authentication / Proxy:**
  - Standard: Run `claude login` to authenticate with your Anthropic console account.
  - Gateway / Custom Endpoint: Configure `~/.claude/settings.json` with an OpenAI-compatible proxy or model router.

### B. OpenAI Codex CLI (`codex`)
- **Prerequisite (Linux sandbox):**
  ```bash
  apt install -y bubblewrap
  ```
- **Installation:**
  ```bash
  npm install -g @openai/codex
  ```
- **Authentication:**
  - Run `codex login` (authenticates via ChatGPT Plus/Pro OAuth or OpenAI API Key).

### C. Google Antigravity CLI (`agy`)
- **Installation:**
  - Place `agy` binary in your system PATH (e.g., `~/.local/bin/agy`).
- **Authentication:**
  - Authenticates via Google Cloud OAuth in `~/.gemini/antigravity-cli/`.

---

## 5. Hermes Agent Integration (Optional)

If using [Hermes Agent](https://github.com/NousResearch/hermes-agent) to supervise and command this project:

1. **Enable In-Repo Project Skills:**
   In your Hermes profile configuration (`~/.hermes/config.yaml`), ensure the repository root is marked as trusted:
   ```yaml
   skills:
     trusted_project_dirs:
       - /root/projects/paper   # (or your cloned repository directory)
   ```
2. Hermes will automatically discover and register the bundled skills:
   - `tri-agent-orchestrator` (`.hermes/skills/tri-agent-orchestrator/SKILL.md`)
   - `tri-agent-watchdog` (`.hermes/skills/tri-agent-watchdog/SKILL.md`)

---

## 6. Verification & Launch

Once prerequisites are confirmed:
```bash
# 1. Run diagnostic
./check-prerequisites.sh

# 2. Build local frontend
cd app && npm run build

# 3. Launch orchestrator loop
cd ..
tmux new-session -d -s paper-orchestrator "python3 orchestrator.py"

# 4. Attach watchdog to cron
(crontab -l 2>/dev/null; echo "*/2 * * * * $(pwd)/watchdog.sh >> $(pwd)/logs/watchdog.log 2>&1") | crontab -
```
