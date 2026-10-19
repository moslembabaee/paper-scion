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
