# Autonomous Agent Guidelines: Paper (Scion Multi-Agent Edition)

This repository is maintained and developed autonomously using the **Scion Multi-Agent Platform** (Google Cloud Platform), orchestrating concurrent, isolated containerized agents (`Claude Code`, `OpenAI Codex`, `Gemini CLI`, and `Antigravity`).

Every agent operating within this project workspace must follow these guidelines.

---

## 🏗 Project Architecture & Layout

- **`app/`**: Core React + Vite + TypeScript application (Infinite Canvas, WebGL Shaders, Scene Graph, UI).
  - Framework: React 19, Tailwind CSS v4, Vite 8, TypeScript 6.
  - Dependencies: `@paper-design/shaders-react`, `lucide-react`.
  - Testing: `npm test` (820 node test runner suites covering all engines, shaders, CSG/CAG, tokens, layout).
  - Production Build: `npm run build`.
- **`mcp-server/`**: Paper Live Model Context Protocol (MCP) server exposing design canvas inspection, layer editing, and token manipulation.
- **`docker-compose.yml` & `Dockerfile`**: Production container stack serving SPA and API service on port `3000`.
- **`ROADMAP.md` / `ROADMAP.json`**: Product development roadmap, phases, and technical requirements.

---

## 📋 Scion Agent Workflow & Quality Gates

1. **Isolated Worktrees:**
   - Each agent operates in its own dedicated Git worktree on an independent branch (`feature/<issue-number>-<slug>`).
   - Worktrees are provisioned and synchronized by Scion.

2. **Quality Gates (Mandatory Before Commit):**
   Before committing any code or finalizing a task, the agent MUST run:
   ```bash
   cd app && npm test
   cd app && npm run build
   ```
   All tests must pass (green) and TypeScript compilation must succeed without warnings or errors.

3. **Scope Control (Blast Radius):**
   - Strictly touch only the files directly required for the assigned task/issue.
   - Never modify unrelated dependencies, root build files, or system configs unless explicitly requested.

4. **Conventional Commits:**
   - Commit messages follow Conventional Commits:
     - `feat(<component>): description`
     - `fix(<component>): description`
     - `test(<component>): description`

5. **Closing the Loop:**
   - When a feature is verified and pushed, reference the corresponding GitHub Issue number in the commit and pull request.
