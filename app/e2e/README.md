# Paper browser verification

Run from `app/` with dependencies and Playwright Chromium installed:

```sh
npx playwright test --reporter=line
```

Playwright starts Vite at `http://127.0.0.1:4173`. The suite covers canvas
mounting, the engineering grid and rulers, pan and zoom controls and gestures,
shape creation, selection and resizing, Paper shader rendering and playback,
precision measurement, alignment and distribution, arrange hotkeys, and Dev Mode handoff. Editor tests mock an authenticated session with `mockStudioSession` before opening the fresh seeded document. Auth and cloud tests supply their own session responses. New editor entry points, including invited browser tabs, must install this fixture before navigation.

Zoom assertions wait for the camera to reach its target and settle. Keyboard
tests explicitly focus the canvas and use physical key chords. Shader tests
require a visible canvas and a linked WebGL program; a CSS fallback alone fails
the rendering check. Chromium uses software WebGL so the tests do not require
a dedicated GPU.

The six visual tests capture PNGs in their own directories under `test-results/`
and attach them to the test report. They wait for fonts, the shader engine, and
local autosave, with reduced motion fixing shaders to their configured frame.
Selection captures include handles outside the bounding box. These are review
artifacts, not pixel-difference baseline assertions. Failed tests also retain
a screenshot and trace; inspect a trace with `npx playwright show-trace <path>`.

The suite needs permission to start a local HTTP server and Chromium. A sandbox
that denies sockets or browser processes cannot execute these browser tests;
test discovery (`npx playwright test --list`) can still run there.

Verify the login gate, appearance preview, session timeout/retry, callback transition and sign out with:

```sh
npx playwright test e2e/auth.spec.ts e2e/cloud.spec.ts
```
