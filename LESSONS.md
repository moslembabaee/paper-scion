# Repository Lessons Learned & Engineering Guidelines (Paper Scion)

This file contains accumulated technical insights, pitfalls, and invariant rules for the Paper codebase.
**All autonomous agents must read this file before beginning work on any task.**
If you discover a non-trivial bug, architectural constraint, or testing nuance, record it here concisely.

---

### 1. Shaders & WebGL Pipeline
- **Shader Initialization in Tests:**
  Never construct partial manual shader objects in tests (e.g. `{ kind: 'procedural-noise', params: { scale: 2 } }`). Always use `createShader(kind)` from `app/src/shaders/catalog.ts` and spread overrides onto it. `validateShader()` strictly validates all `motionControls` (`speed`, `frame`, `scale`, `rotation`, `offsetX`, `offsetY`) and exact parameter counts.
- **SVG Export of Shader Layers:**
  When calling `sceneToSVG()` in headless node tests for elements with shaders, pass a mock `shaders` Map in options:
  `sceneToSVG(snapshot, options, { shaders: new Map([['element-id', 'data:image/png;base64,...']]) })`. Headless Node cannot capture WebGL surfaces directly.

### 2. Geometry & CAG/CSG Engine
- **Boolean Result Fill Rules:**
  `BooleanResult.fillRule` must support `'nonzero' | 'evenodd'`. Single operands or decomposed compound outlines frequently preserve `evenodd` winding rules.
- **Path Simplification Threshold:**
  CAG/CSG boolean evaluation caps input complexity at 2,000 curves per operation. Keep path segmentation optimized.

### 3. Subsystem Modularity & Parallel Safety
- **Core vs Independent Subsystems:**
  - **Shared Core:** `app/src/scene/store.ts`, `app/src/scene/elements.ts`, `app/src/scene/types.ts`. Any change here affects the entire application and all other active branches. Keep edits backward compatible.
  - **Independent Subsystems:**
    - `app/src/shaders/` (WebGL shaders, presets, materials)
    - `app/src/motion/` & `app/src/physics/` (Spring physics, keyframes, timeline)
    - `app/src/scene/typography.ts` & `fontEngine.ts` (Variable fonts, text on path)
    - `app/src/io/codeExport/` (JSX, SVG, GLSL export)
  Tasks belonging to different independent subsystems can be executed in parallel without merge conflicts.

### 4. Git, Worktree & Pull Request Workflow
- **No Direct Push to `main`:**
  All changes must be developed in a dedicated task branch: `feat/issue-<number>-<slug>` or `fix/issue-<number>-<slug>`.
- **Pre-PR Quality Gate:**
  Before pushing, the agent must run and verify:
  ```bash
  cd app && npm test
  cd app && npm run build
  ```
  Both must pass with zero failures.
- **Automated PR Creation:**
  Push the branch and create a PR linking the issue:
  ```bash
  gh pr create --title "feat: <title>" --body "Closes #<number> - <summary>"
  ```

### 5. Developer & Engine Tooling
- **`codebase-memory-mcp`:** Full knowledge graph indexed for `paper-scion` (6,647 nodes, 33,494 edges). Use `search_code`, `query_graph`, and `get_code_snippet` to inspect modules without full-file read penalties.
- **`playwright`:** Chromium headless browser installed at `/root/.cache/ms-playwright/`. Run `npx playwright test` inside `app/` to execute real-browser E2E specs.
- **`glslangValidator`:** Official Khronos GLSL validator available on system PATH (`glslangValidator <shader.frag>`) to syntax-check GLSL 3.00 ES shaders before canvas mounting.
- **`svgo`:** SVG path optimizer CLI available on system PATH (`svgo <file.svg>`).
- **`paper-mcp`:** Live Paper canvas inspection & editing bridge available at `/usr/local/bin/paper-mcp`.
- **`rtk`:** Rust Token Killer v1.0.1 installed at `/usr/bin/rtk` for command output compression and noise reduction.
- **`context7-mcp`:** Official library API reference CLI at `/usr/local/bin/context7-mcp`.
- **`multi-stop-gradient` Schema Rule:** `shaderSchema` in `app/src/mcp/schema.ts` includes `gradient` specification. All gradient shaders must conform to `GradientPaint`.

### 6. Server vs Client Boundary (Cloud API image)
- **The `paper-api` Docker image does NOT ship React.** `app/server/package.json` installs only `fastify`, `typescript`, `postcss`, `playwright`. Any `import ... from 'react'` that is *reachable* from the server bundle crashes the API on boot with `ERR_MODULE_NOT_FOUND: Cannot find package 'react'`.
- **How the server bundle is assembled:** `npm run build:server` runs `tsc -p tsconfig.server.json` over `server/*.ts` + `collaboration/server.ts`, which transitively pulls in `src/scene/store.ts` → `src/tokens/*`. So a React import buried deep in `src/tokens/` or `src/scene/` breaks the cloud API even though no server file imports React directly.
- **Rule:** shared modules reachable from `src/scene/store.ts` must stay framework-free. Keep React-dependent code in separate modules (e.g. `src/tokens/injector.ts` uses `useScene`/React hooks) and never re-export it from a module the store graph touches. Shared constants belong in a dedicated module (see `src/tokens/themes.ts`).
- **How to verify before pushing:** build the server bundle and grep it for React imports:
  ```bash
  cd app && npx tsc -p tsconfig.server.json --outDir /tmp/srvcheck
  grep -rn "from 'react'" /tmp/srvcheck --include=*.js   # must be empty
  ```
- **Symptom of a violation:** `docker compose up` reports `container paper-scion-paper-api-1 is unhealthy`, the container crash-loops, and the public site returns HTTP 502. The nginx `paper` container depends on `paper-api` being healthy, so a single bad import takes the whole product offline.
