# 🏭 Paper Factory — Complete Configuration Record

> **This file is the answer to "پیکار کردی؟" (what did we do?).**
> Everything the factory needs to be rebuilt from scratch on a new server lives here.
> Read this file first when something breaks or when you move to a new machine.

**Last verified:** 2026-10-21
**Repository:** `https://github.com/moslembabaee/paper-scion`
**Live app:** `https://paper.141.11.32.213.nip.io`
**Scion panel:** `https://scion.141.11.32.213.nip.io`
**Hindsight memory:** `https://hindsight.141.11.32.213.nip.io`

---

## 1. The big picture

```
                    ┌─────────────────────────────────────────┐
                    │  GitHub  moslembabaee/paper-scion        │
                    │  (source of truth for code + config)    │
                    └───────────────┬─────────────────────────┘
                                    │  pull / push
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
┌───────▼────────┐        ┌─────────▼──────────┐       ┌────────▼────────┐
│  Scion Hub     │        │  paper-pipeline    │       │  paper-watchdog│
│  :8080         │◀──────▶│  (supervisor)      │       │  (systemd timer)│
│  panel + API   │        │  scripts/scion_    │       │  every 2 min    │
└───────┬────────┘        │  pipeline.py       │       └────────┬────────┘
        │                 └────────────────────┘                │
        │  launches agents                                      │  independent
┌───────▼────────┐                                            │  of Scion
│ agent containers│                                            │
│ (docker)        │                                            │
└─────────────────┘                                            │
                                                              │
                   ┌──────────────────────────────────────────┘
                   ▼
        ┌────────────────────┐        ┌────────────────────┐
        │  paper (nginx)    │◀──────▶│  paper-api         │
        │  :3000            │        │  :3001 (fastify)   │
        └────────────────────┘        └────────────────────┘
```

**Key principle:** anything that *detects* a problem lives OUTSIDE Scion
(the watchdog), so it still works when Scion is down. Anything that *fixes*
code lives INSIDE Scion, where the agents live.

---

## 2. What was done OUTSIDE the repository (the "outside actions" log)

Everything below happened on the server and is NOT in git. Each item lists
where its reproducible copy now lives.

| # | Action | Where it was done | Reproducible copy |
|---|---|---|---|
| 1 | Installed Scion CLI | `/usr/local/bin/scion` | `ghcr.io/homebrew-scion/scion-*` images |
| 2 | Started Scion Hub server | `systemd`/nohup → `scion server start` (PID 7482), port 8080 | `scion server start` |
| 3 | Created 4 agent templates | `/root/.scion/templates/` | ✅ `.factory/templates/` |
| 4 | Patched the **claude** harness (root user, provision path, MCP transport map, `http`→`streamable-http`, onboarding flags) | `/root/.scion/harness-configs/claude/` | ✅ `.factory/harness/claude.*` |
| 5 | Patched the **antigravity** harness (root user, provision path, wrapper fix) | `/root/.scion/harness-configs/antigravity/` | ✅ `.factory/harness/antigravity.*` |
| 6 | Injected `paper-mcp` + `hindsight` MCP servers into agent templates | template YAML | ✅ `.factory/templates/*/scion-agent.yaml` |
| 7 | Stored 4 secrets in Scion Hub (user + project scope) | Scion Hub SQLite | `scion hub secret set` (see §5) |
| 8 | Built the **autonomous pipeline supervisor** | `scripts/scion_pipeline.py` + `/usr/local/bin/paper-pipeline` | ✅ already in git |
| 9 | Set up Caddy reverse proxy + TLS for 4 subdomains | `/etc/caddy/Caddyfile` | ⚠️ see §7 |
| 10 | Deployed **Hindsight** memory service (Docker) | container `hindsight` | `.factory/hindsight/` + §6 |
| 11 | Installed injected dev tools into agents (glslangValidator, svgo, rtk, codebase-memory-mcp, context7-mcp, Playwright) | `/workspace/.bin` inside agent containers | `LESSONS.md` §5 |
| 12 | Installed the **watchdog** (systemd service + timer) | `/etc/systemd/system/paper-watchdog.{service,timer}` | ✅ `.factory/watchdog/install.sh` |
| 13 | Created secret files for the watchdog | `/root/.factory-secrets/` | ⚠️ secrets are NOT in git (by design) |
| 14 | Wrote `paper-factory` control script | `/usr/local/bin/paper-factory` | ✅ `.factory/bin/paper-factory` |

---

## 3. Agent templates

| Template | Role | Key behaviour |
|---|---|---|
| `feature-developer` | Implements one issue end-to-end | Reads `LESSONS.md`; runs `npm test` + `npm run build`; opens a PR |
| `project-architect` | Consultative architect | Talks to the owner; decomposes features; creates issues. Excluded from the pipeline queue. |
| `quality-gatekeeper` | Independent reviewer | Re-runs the gates, reviews the diff, approves the PR |
| `default` | Scion built-in | Generic agent |

## 4. Harness configurations (the LLM CLIs)

| Harness | Image | Command | Auth | Model routing |
|---|---|---|---|---|
| **claude** (primary) | `scion-claude:latest` | `claude --no-chrome` | `ANTHROPIC_API_KEY` | Nine Router `http://100.123.217.25:20128/v1`, model `ag/gemini-3.8-flash-high` |
| antigravity | `scion-antigravity:latest` | `agy --dangerously-skip-permissions` | `AGY_TOKEN` (file) | Antigravity account `babaeecoin@gmail.com` |
| codex | `scion-codex:latest` | `codex --sandbox danger-full-access …` | `CODEX_AUTH` | OpenAI Codex |
| opencode | `scion-opencode:latest` | `opencode` | `ANTHROPIC_API_KEY` | via router |
| hermes | `scion-hermes:latest` | `hermes chat --yolo` | `ANTHROPIC_API_KEY` | via router |

### Critical harness fixes (why the copies in `.factory/harness/` exist)
1. `user: root` — Claude Code refuses `--dangerously-skip-permissions` as root.
2. `command: ["python3", "/root/.scion/harness/provision.py"]` — the default
   `/home/scion/...` path does not exist when running as root.
3. `transport_map: {streamable-http → http}` — Claude Code needs `type: "http"`,
   not `streamable-http`, for the Hindsight MCP endpoint.
4. `.claude/settings.json` — `permissions.allow` must name concrete tools;
   `"*"` is rejected. `ModelResponse` is not a valid hook event.
5. `.claude.json` — `hasCompletedOnboarding`, `theme`, project entries for
   `/workspace` and `/root`, written to both `$HOME`s.

---

## 5. Secrets (recreate these on a new server)

| Key | Type | Scope | Where to get it |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | env | user + project | Nine Router key (also `HERMES_CUSTOM_9ROUTER_API_KEY` in `/root/.hermes/.env`) |
| `GITHUB_TOKEN` | env | user + project | `gh auth token` (needs `repo` scope) |
| `AGY_TOKEN` | file | user + project | Antigravity OAuth token file |
| `CODEX_AUTH` | file | user + project | Codex auth file |

```bash
B64=$(gh auth token | tr -d '\n' | base64)
scion hub secret set --project=paper-scion GITHUB_TOKEN "$B64"
scion hub secret set GITHUB_TOKEN "$B64"
```

---

## 6. Hindsight (agent long-term memory)

| Item | Value |
|---|---|
| Image | `ghcr.io/vectorize-io/hindsight:latest` |
| API | `http://127.0.0.1:8888` (MCP at `/mcp/paper-scion/`) |
| UI | `http://127.0.0.1:9999` → `https://hindsight.141.11.32.213.nip.io` |
| Bank id | `paper-scion` |
| Volume | `hindsight-data` (Postgres 18.1 inside the container) |
| LLM | `ag/gemini-3.8-flash-high` via Nine Router |
| Embeddings | local `BAAI/bge-small-en-v1.5` (384-dim) |
| Reranker | local `cross-encoder/ms-marco-MiniLM-L-6-v2` |
| MCP transport | `streamable-http` → Claude needs `type: "http"` |

Bank config (missions + dispositions) is exported to `.factory/hindsight/bank-config.json`.

**Note:** the `hindsight` container must be reachable from agent containers at
`http://172.17.0.1:8888` (the docker0 bridge), not `localhost`.

---

## 7. Host-level configuration (outside git)

### Caddy (`/etc/caddy/Caddyfile`)
```caddyfile
paper.141.11.32.213.nip.io {
    encode zstd gzip
    handle /api/webhook/github* { reverse_proxy 127.0.0.1:9095 }
    handle { reverse_proxy 127.0.0.1:3000 }
}
scion.141.11.32.213.nip.io {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
hindsight.141.11.32.213.nip.io {
    encode zstd gzip
    reverse_proxy 127.0.0.1:9999
}
```

### systemd units created by the factory
* `paper-watchdog.service` + `paper-watchdog.timer` — `.factory/watchdog/install.sh`

### Secrets directory
`/root/.factory-secrets/` (mode 700):
* `telegram_bot_token` — Telegram bot token
* `llm_api_key` — Nine Router key used for LLM diagnosis

---

## 8. The autonomous pipeline

```
/usr/local/bin/paper-pipeline {start|stop|status|logs|deploy-logs}
```
Backed by `scripts/scion_pipeline.py` (in git).

**Rules it enforces** (learned the hard way — see §9):
* Only one agent at a time (single-active-agent).
* `stalled` / `offline` are **not** terminal — a healthy agent waiting on a long
  test must not be restarted.
* Per-issue attempt counter: 3 attempts max, 15-minute backoff, then the
  issue is parked as `blocked`.
* An issue is only closed when a PR was actually merged.

---

## 9. Incident history — the failures that shaped this setup

| Date | Incident | Root cause | Fix |
|---|---|---|---|
| 2026-10-21 00:31→13:24 | **Whole site down (502) for 13h** | `src/tokens/engine.ts` re-exported the React-dependent `injector.ts`; the server bundle then imported `react`, which the `paper-api` image does not ship | Moved `STANDARD_THEMES` to `src/tokens/themes.ts`; dropped the re-export. Added `LESSONS.md` §6 + a watchdog check. |
| 2026-10-21 05:29→13:25 | **Issue #79 restarted 86× over 8h** | The supervisor treated `activity: stalled` (Scion marks an agent stalled after ~10 min without a state change) as terminal, so it deleted and re-dispatched a healthy agent every cycle | `stalled`/`offline` are no longer terminal |
| 2026-10-21 13:29 | **Infinite retry loop** | No attempt accounting; a failing issue was re-dispatched every 30 s | Persistent attempt counter + backoff + `blocked` parking |
| 2026-10-20 02:11 | **Agent clone failed for 13h** | Expired/invalid `GITHUB_TOKEN` in Scion Hub, and the supervisor did not recognise `phase: error` | Token refreshed; `error` phase added to terminal states |

**Lesson encoded in `LESSONS.md`:** shared modules reachable from
`src/scene/store.ts` must stay framework-free. Verify with:
```bash
cd app && npx tsc -p tsconfig.server.json --outDir /tmp/srvcheck
grep -rn "from 'react'" /tmp/srvcheck --include=*.js   # must be empty
```

---

## 10. The watchdog (Layer 1 + Layer 2)

```
.factory/watchdog/
├── detect.sh     9 deterministic checks, no LLM — always runs
├── diagnose.sh   LLM root-cause analysis — only on an incident
├── remediate.sh  SAFE automatic fixes only (restart / rollback)
├── notify.sh     Telegram message to the owner
├── run.sh        entry point
├── config.env    thresholds and endpoints
└── install.sh    installs the systemd timer
```

**Checks:** site health · container health · dispatch loop · no progress ·
deploy failures · supervisor alive · server-bundle react leak · disk · memory.

**Design:** Layer 1 costs zero tokens and runs every 2 minutes. Layer 2 (LLM)
only runs when Layer 1 finds something, using a free model
(`openrouter/poolside/laguna-s-2.1:free` — **not** a reasoning model, those
return an empty `content` and burn the budget on `reasoning_content`).

```bash
systemctl status paper-watchdog.timer
tail -f /var/lib/paper-watchdog/watchdog.log
bash .factory/watchdog/run.sh          # manual run
```

---

## 11. Rebuilding the factory on a new server

```bash
git clone https://github.com/moslembabaee/paper-scion.git
cd paper-scion

# 1. Scion
curl -fsSL <scion-install> | sh          # or use the ghcr images
scion server start &

# 2. Project
scion init
scion hub link

# 3. Harness configs + templates
bash .factory/restore.sh

# 4. Secrets
scion hub secret set --project=paper-scion GITHUB_TOKEN "$(gh auth token | base64 -w0)"

# 5. Hindsight
docker run -d --name hindsight --restart always \
  -p 8888:8888 -p 9999:9999 \
  -e HINDSIGHT_API_LLM_PROVIDER=openai \
  -e HINDSIGHT_API_LLM_BASE_URL=http://100.123.217.25:20128/v1 \
  -e HINDSIGHT_API_LLM_API_KEY="$KEY" \
  -v hindsight-data:/home/hindsight/.pg0 \
  ghcr.io/vectorize-io/hindsight:latest

# 6. Watchdog
bash .factory/watchdog/install.sh

# 7. Pipeline
paper-pipeline start
```

---

## 12. Where to look when something is wrong

| Symptom | Look at |
|---|---|
| Site returns 502 | `docker logs paper-scion-paper-api-1` → likely a react leak; check `LESSONS.md` §6 |
| Site is down but containers look fine | `tail /var/lib/paper-watchdog/watchdog.log` |
| An issue is not progressing | `grep "Issue #N" logs/pipeline.log` — count the dispatches |
| Agent is stuck | `scion look agent-issue-N` (live terminal) |
| Site is 502 but the watchdog is silent | the watchdog may not be installed: `systemctl status paper-watchdog.timer` |
| Wrong model is answering | `scion harness-config list` + `docker exec <agent> claude mcp list` |
