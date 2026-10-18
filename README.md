# Paper

An open-source, self-hosted, code-bridged infinite canvas design platform inspired by [Paper.design](https://paper.design).

Built autonomously by the **Tri-Agent Orchestra** (`Claude Code` ↔ `OpenAI Codex` ↔ `Google Antigravity`).

---

### 🗺️ Live Development Roadmap & Task Tracker
Track progress, planned features, and completed milestones:
- 📊 **[Read the Roadmap (`ROADMAP.md`)](ROADMAP.md)** (Updated continuously on milestones)

---

## ⚡️ Architecture & Key Features

1. **60 FPS Vector Infinite Canvas**: Hardware-accelerated viewport with smooth pan/zoom (10% to 3200%), world-to-screen matrix transformations, and interactive navigator minimap.
2. **Dark Studio Pro Palette & Clean Slate Light**: Premium dark studio environment (`#0c0c0e`, `#18181b`, `#27272a`, `#3b82f6`) with an instant theme switcher in the header.
3. **Paper Engineering Grid & Precision Rulers**: 120px major divisions, sub-ticks, synchronized top/left pixel rulers, and vertex intersection markers.
4. **Scene Graph & Vector Elements**: Frames (artboards), Rectangles, Ellipses, Editable Text, Vector Pen paths, and interactive layer hierarchy.
5. **Interactive Selection & Smart Snapping**: 8 resize handles, rotation handle, marquee selection, and distance/edge snapping guide lines.
6. **Integrated Paper Shaders**: Official `@paper-design/shaders-react` engine support (Mesh Gradient, Halftone, Gooey, Dithering, Noise) with real-time parameter inspector.
7. **Command-Pattern Undo / Redo**: Up to 100 immutable history checkpoints with `Ctrl+Z` / `Ctrl+Shift+Z` and toolbar controls.
8. **Dev Mode Code Bridge**: One-click toggle inspecting CSS box model, design tokens, and generating clean copyable React + Tailwind production code.
9. **Vector Pen Tool**: Interactive Bezier curve pen editor (`P`) with anchor point and control handle manipulation.
10. **Native Paper MCP Server**: Integrated Model Context Protocol server (`/root/projects/paper/mcp-server`) allowing Claude, Codex, and Cursor to read/write canvas files programmatically.
11. **Import & Export**: High-DPI PNG, crisp SVG, JSON project serialization, and clipboard pasting from Figma and HTML.
12. **Single-Command Self-Hosting**: Multi-stage production `Dockerfile` and `docker-compose.yml` with healthchecks.

---

## 🛠 Prerequisites & Environment Setup

Before running autonomous development or deploying on a new machine, check your system readiness:
```bash
./check-prerequisites.sh
```
For a complete breakdown of runtimes (Node 22, Python 3.10+, Docker), agent CLIs (Claude Code, OpenAI Codex, Antigravity), and GitHub CLI auth, see:
👉 **[Full Prerequisites & Setup Guide (`PREREQUISITES.md`)](PREREQUISITES.md)**

---

## 🚀 Quick Start (Self-Hosting)

### Run with Docker Compose
```bash
git clone https://github.com/moslembabaee/paper.git
cd paper
cp .env.example .env
# Set PAPER_SESSION_SECRET using: openssl rand -hex 32
# Configure PAPER_PUBLIC_URL and OAuth credentials in .env (see app/docs/cloud.md).
docker compose up -d --build
```
Open **`http://localhost:3000`** in your browser.

### Run Locally with Node.js
```bash
git clone https://github.com/moslembabaee/paper.git
cd paper/app
npm install
npm run dev
```

---

## 🤖 Community Issues & Autonomous Development

Anyone can submit a feature request or bug report via [GitHub Issues](https://github.com/moslembabaee/paper/issues).

1. **Automated AI Triage**: When an issue is created, the AI Architect automatically analyzes the codebase, evaluates technical feasibility, detects any architectural conflicts, and posts an implementation plan comment.
2. **Owner Authorization Gate**: For security and architectural control, autonomous development only begins when the repository owner (`@moslembabaee`) approves the issue by adding the `approved` label or commenting `/approve`.
3. **Automatic Implementation & Closure**: Once approved, the Tri-Agent Orchestra automatically pulls the issue into the active queue, implements it, passes Playwright test suites, commits the code, and closes the issue.
