# Runnable Paper Make source

Save an app to your account, then choose **Download source ZIP** in the Make
workspace's **Runnable source** panel. Save source edits first: the download
contains the current saved revision, not unsaved editor buffers.

Paper compiles that revision and checks its rendered app at desktop and mobile
sizes before approving the download. Failed or unavailable checks block export.
Concurrent saves require reviewing and exporting the new revision. Approval
expires after ten minutes and is cleared when the API restarts.

Unzip the archive and run these commands with Node.js 22 or newer:

```sh
npm ci --offline --ignore-scripts
npm run build
npm start
```

Open `http://127.0.0.1:3000`. Set `PORT` to use another local port.

The ZIP includes a package manifest and lockfile, editable files under `source/`,
local image/font bytes under `assets/`, and the entry point and file list in
`paper-app.json`. Edit those source files and rebuild. Build tools and the
allowlisted React, React DOM, Lucide and Paper Shaders runtime are bundled from
the trusted Paper release, with version metadata and licenses under `.paper/`.
Installation and builds need no package downloads. Generated package manifests
and configuration files remain source data; their scripts never run.

The same revision and release kit produce identical ZIP bytes and HTML. Missing
or modified assets, source traversal, local symlinks and unapproved package
imports reject. Failed builds preserve the last successful `dist/index.html`.
The local server serves only a regular built HTML file and rejects symlinked
output files or directories at startup. Its content keeps the preview network
policy. Account credentials, chat history and annotations are excluded.

The account-scoped API uses `POST /api/apps/:id/export/approve` with only
`{"expectedRevision": N}`, followed by `GET /api/apps/:id/export.zip?revision=N`.
Both requests require an authenticated session. The approval request also uses
Paper's normal origin/client checks. Clients cannot override dependency policy,
provide arbitrary files, or claim that validation passed.

Run the focused checks from `app/`:

```sh
npm run build
node --test server/tests/apps-source-export.test.mjs server/tests/source-export-package.test.mjs
npx playwright test --config playwright.source-export.config.ts
```

The browser acceptance suite requires a working Playwright Chromium installation
and permission to start a local HTTP server. It performs real export validation,
downloads and unzips the ZIP, installs offline, builds, starts the exported app,
and checks its image and counter interaction. It must fail when the required
browser or local server is unavailable.
