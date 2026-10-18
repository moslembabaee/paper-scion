# App project manifest

`AppProject` is the `paper-app` v1 manifest for Paper Make. It is separate from
`paper` scene documents and contains only a reference to a scene snapshot; importing
an app never loads or changes a scene. Import the public API from `make/index.ts`.

- `createAppProject(input)` creates a complete v1 manifest with defaults for omitted
  settings, a starter file, revision 1, draft release and idle preview.
- `validateAppProject(unknown)` validates a complete v1 object and returns a detached,
  canonical copy. Required fields are not supplied by the validator.
- `parseAppProject(json)` also rejects duplicate JSON keys, including escaped keys.
- `serializeAppProject(project)` validates before serialization. Every accepted
  manifest fits the import budget after JSON escaping and formatting.
- `migrateAppProject(unknown)` explicitly upgrades unversioned/v0 app drafts. v1 is
  validated unchanged; scenes, foreign formats and future versions are rejected.
  Parse legacy JSON with `parseJsonStrict` first to preserve duplicate-key checks.

V0 supports file arrays (`{ path, content }`) or maps of strings/file records and
flat `projectId`, `sceneId`, `frameId`, `sceneRevision` references. Root source files
such as `App.tsx` move to `src/`; `package.json`, `tsconfig.json`, `README.md` and
`index.html` stay at the root. Preview entry points follow the same rule. Colliding
paths or ambiguous scene references reject the entire migration. Existing metadata
is preserved; only omitted values receive defaults. Source modules are stored as
text and are never evaluated by this module.

The v1 schema requires `format`, `version`, `id`, `name`, `revision`,
`sceneReference` (nullable), `files`, `assetIds`, `release`, `preview`, `createdAt`
and `updatedAt`. Only `description` is optional. Nested types in `types.ts` list
all permitted fields. Unknown fields and incorrect types reject rather than being
silently dropped or coerced. Revisions are positive safe integers; timestamps use
UTC ISO strings (`YYYY-MM-DDTHH:mm:ss.sssZ`); release URLs use HTTP(S) without
credentials. Release metadata describes a release; it does not publish anything.

Limits are inclusive: 100 files, 512 KiB UTF-8 per file, 2 MiB total source,
100 unique asset IDs, 128 characters per ID, 200 per name, 256 per path, and
4 MiB UTF-8 for both imported JSON and canonical serialized JSON. Description,
release notes and preview errors allow 16,384 characters; release channels and
URLs allow 2,048. Object/JSON nesting is bounded to 16 levels. Paths are relative
POSIX paths; one leading `./` is normalized. Traversal, encoded paths, absolute
paths, controls, Windows aliases/reserved names, forbidden prototype segments and
normalized duplicates reject. Object inputs must contain plain enumerable data
properties and dense arrays, without accessors, cycles or prototype keys.

Validation/migration builds an isolated result and returns only after all checks
pass. Callers must replace their stored manifest only after successful validation;
a thrown `AppProjectValidationError` must never be used as permission to fall back
to a permissive import.

## Account-scoped artifact storage

`AppStorage` (`server/app-storage.ts`, re-exported from `server/storage.ts`) persists
app artifacts under `apps/<userId>/<appId>/`:

- `manifest.json`: Canonical `AppProject` manifest and the sole publication point.
- `revisions/<revision>/files/`: Immutable materialized source files for that revision.
- `revisions/<revision>/record.json`: Immutable revision number, SHA-256 manifest hash,
  timestamp, and complete project snapshot. Reads verify the record's identity and hash.

Confinement and safety guarantees:

- **Atomic publication**: A writer stages a complete snapshot in `.staging_<uuid>/`
  inside the app, syncs files and directories, installs the snapshot, then atomically
  replaces the manifest. The live app directory is never moved. A directory-sync
  failure after publication rolls back the prior manifest. A crash leaves either
  the old or new complete revision. Unpublished snapshots are hidden from readers
  and reclaimed by the next writer holding that app's lock; readers never clean
  another operation's staging tree.
- **Optimistic revision check**: Updates require matching `expectedRevision` (`null` for new
  apps; positive integer matching current revision for updates). Stale writes reject
  with `409 Revision conflict` and include `{ current }`. Invalid revision tokens
  reject with `400`. As with scene storage, one service process owns the volume;
  concurrent writes serialize per volume/account/app across all store instances
  in that process. Multiple independent writer processes are unsupported.
- **Account isolation & symlink confinement**: Account and app directories, manifests,
  every intermediate artifact directory, and files reject symbolic links with `403`.
  Reads require bounded regular files opened with `O_NOFOLLOW` and `O_NONBLOCK`.
  Traversals (`..`, absolute paths, encoded slashes, control characters) reject with `400` or validation errors. Accounts
  cannot read, overwrite, list or delete another user's artifacts.
- **Strict input validation**: v1 manifests keep the strict schema from Make 01;
  storage does not drop unknown file fields, collapse duplicate legacy paths, or
  execute accessors. Only explicit legacy drafts go through migration. The account
  ID must come from authenticated server context, never an untrusted request body.

Verification from `app/`:

```sh
node --experimental-strip-types tests/app-project-manifest.test.mjs
node --experimental-strip-types tests/app-storage.test.mjs
npx --no-install playwright test e2e/app-project-manifest.spec.ts
npm test && npm run build
```

## Authenticated App Project API

All endpoints use the existing `paper_session` cookie. Mutations require
`X-Paper-Client: web`; a supplied `Origin` must match `PAPER_PUBLIC_URL`. Optional
`X-Paper-Account` must match the signed-in account. Account IDs never come from
the project payload. App routes also accept the `/api/app-projects` prefix.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/apps` | `{ apps, projects }`, both containing account-scoped summaries |
| POST | `/api/apps` | Create a project; `201`, complete manifest and `Location` |
| GET | `/api/apps/:id` | Complete current manifest |
| PUT | `/api/apps/:id` | Replace the project using a positive `expectedRevision` |
| DELETE | `/api/apps/:id` | Remove the manifest, files and history; `{ ok: true }` |
| GET | `/api/apps/:id/files?path=src/App.tsx` | `{ path, content }` |
| GET | `/api/apps/:id/revisions` | `{ revisions }`, immutable revision metadata |
| GET | `/api/apps/:id/revisions/:revision` | Complete immutable revision record |

Create/update bodies can be a manifest/draft with `expectedRevision` alongside its
fields, or `{ project, expectedRevision }`. Creation accepts an omitted or null
expected revision and always rejects duplicate IDs within that account. An omitted
ID is generated by the server. PUT requires a positive matching expected revision
and cannot create a missing project. Send the complete manifest returned by GET
for replacement; omitted draft fields receive manifest defaults, rather than being
merged into the saved project. The server assigns revision numbers and timestamps;
the URL and supplied project ID must agree.

Missing sessions return `401`; rejected origins, account headers or request guards
return `403`. Missing reads/deletes return `404`; stale writes return `409` with
the authenticated account's current manifest (or null for a missing project).
Malformed manifests, files, paths, revisions and JSON return `400`; request bodies
over 4 MiB UTF-8 return `413`. Production app routes enforce that limit before
buffering and preserve raw JSON for duplicate-key validation. Failed validation
and revision conflicts leave the saved revision untouched. Responses are JSON,
`no-store` and `nosniff`. Source text is stored without execution or AI calls.

Targeted API/security verification:

```sh
npm run build:server
node --test server/tests/apps-api.test.mjs
```

## Safe static React/TSX compiler

`compileSourceFiles` and `compileAppProject` (`src/make/compiler.ts`) compile editable
React/TSX, CSS and JSON sources into preview assets without executing generated scripts,
running shell commands, or invoking arbitrary dependency installers.

- **Transform-only pipeline**: Analyzes and transpiles source code into CommonJS modules using TypeScript's AST parser and transpiler. CSS is parsed with PostCSS; JSON is strictly parsed and serialized. Modules are bundled into a standalone HTML/JS/CSS bundle carrying data URI assets.
- **Strict package allowlist**: Only allowlisted modules can be imported: `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-dom`, `react-dom/client`, `lucide-react`, `@paper-design/shaders-react`. All other package imports produce `DENIED_IMPORT` diagnostics with exact line and column numbers.
- **Execution bans**: Dynamic `import(...)`, `eval(...)`, `Function(...)`, `new Function(...)`, `require(...)`, JSX runtime pragma overrides, and CSS `@import` are rejected with targeted diagnostics (`DYNAMIC_IMPORT_FORBIDDEN`, `FORBIDDEN_CALL`, `FORBIDDEN_CSS_IMPORT`).
- **Input bounds & diagnostics**: Max 512 KiB per file, 2 MiB total input, max 100 files, and max AST depth of 128. Path traversal and duplicate files are rejected safely. Syntax errors return exact line and column locations (`SYNTAX_ERROR`).
- **Preview assets**: Returns `{ js, css, html }` where the runtime loader mounts the entry component in an isolated DOM container matching Paper aesthetics (`#080808` background, `#edebe1` text, `#81adec` accents).

Targeted compiler verification:

```sh
node --experimental-strip-types tests/app-compiler.test.mjs
npx playwright test app-compiler.spec.ts --config=playwright.compiler.config.ts
```

## Credential-isolated preview

Render compiled assets with `<PreviewFrame assets={result.assets} />` from
`src/make/PreviewFrame.tsx`. The compiler stays host-only; this component's
compiler import is type-only. Never mount `assets.html` directly into the host
DOM, or use a single iframe as the production security boundary.

The component creates two opaque-origin `sandbox="allow-scripts"` frames. Only
trusted relay code runs in the outer frame. Its `frame-src 'none'` policy blocks
network navigation by the generated inner frame, including self-navigation via
links, `location` and meta refresh. Both frames deny forms, popups, downloads,
top navigation, same-origin privileges and sensitive permissions. The outer
policy is inherited by `about:srcdoc`; it cannot be relaxed by generated markup.
The compiled script and styles use local data URLs. `connect-src 'none'`,
resource-specific policies and `worker-src 'none'` deny external loads. The
policy also includes `webrtc 'block'` and disables DNS prefetch; enforcement of
those features varies by browser, so the supported-browser security suite is a
release gate, not an assumption that CSP controls every browser network API.

Messages carry a versioned channel, direction, ID, timestamp and validated typed
payload. Receivers verify the exact sending window; the host also requires the
opaque origin `null`. Messages are bounded to 64 KiB UTF-8, 16 levels, 4096 visited
values and 120 messages/second per receiver. Cycles, accessors, prototype keys,
non-JSON values, malformed payloads and unknown envelope fields are rejected.
Only ping, theme and reset controls leave the host; no credentials, session data
or scene objects are sent. A new revision or reload creates a fresh browsing
context, rejects outstanding pings and resets diagnostics. The preview exposes
ready/error events, bounded ping deadlines and a 10-second readiness timeout.

Protocol and compiler regression checks:

```sh
node --experimental-strip-types tests/app-preview-iframe.test.mjs
npm test && npm run build
```

Browser acceptance (requires localhost listeners and a working Chromium):

```sh
npx playwright test --config=playwright.preview.config.ts
```

This suite mounts the actual React component from `/e2e/fixtures/preview.html`,
checks desktop/mobile interaction and lifecycle, and attacks DOM/session access,
forged messages, resource loads, popups, forms, top navigation and self-navigation.
It records exfiltration requests before aborting them, so network failure alone
cannot satisfy an assertion. Screenshots go to `/tmp/paper-preview-{desktop,mobile}.png`.
The node VM tests check only the trusted protocol, never browser SOP/CSP enforcement.

Policy references: [CSP inheritance](https://www.w3.org/TR/CSP3/#security-inherit-csp),
[iframe sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox).

## Generate from an approved plan

In Make, create or open an app, enter a prompt, inspect the proposed files and
interactions, approve the plan, then choose **Generate app**. Saved apps commit
an immutable next revision only after manifest and compiler validation succeed.
Unsaved drafts use the same validation and preview path; **Save a copy** persists
a draft explicitly. Generation never edits a Paper scene or calls MCP tools.

`POST /api/apps/:id/generate` accepts `{ plan, expectedRevision }` for a saved
app. `POST /api/model/generate` accepts `{ plan, project }` for an unsaved draft.
Both require the normal session/CSRF guards. Saved approval must match the exact
server-issued, approved plan; draft approval must match an issued plan and the
exact source supplied during planning. Approvals expire after 30 minutes and
service restarts require replanning. Output may only touch approved file paths.
No generated source executes on the server, installs packages, or changes the
compiler allowlist or iframe policies.

Each generation turn retains the approved plan, source/rollback revision,
changed paths, compiler diagnostics and validation outcome in the account-scoped
model ledger (the existing 100-turn retention applies). Successful saved output
also retains the previous source in immutable revision storage. Invalid output
returns `success: false`, `assets: null` and diagnostics without writing a
revision. The workspace retains the existing usable preview, including its
interactive state, while displaying the failure. Cancelling generation or
switching projects ignores late output; concurrent saved edits reject the commit
with HTTP 409. Provider configuration remains server-side; tests use deterministic
adapters and need no live model credentials.

Targeted generation verification:

```sh
node --experimental-strip-types tests/make-app-generation.test.mjs
npm run build:server && node server/tests/model-gateway.test.mjs
npx playwright test e2e/make-app-generation.spec.ts
npm test && npm run build
```

The browser suite exercises the real service, durable storage, safe compiler and
sandboxed React preview using only a deterministic model adapter. It verifies
saved and unsaved generation, desktop/mobile interactions, invalid replacement
recovery and reload. Screenshots go to `/tmp/paper-generation-*.png`. Browser
acceptance requires localhost listeners and a working Chromium; a sandbox that
blocks either cannot satisfy the browser release gate.

## Selected design frame

Select exactly one frame in a cloud-synced Design workspace, then open Make.
The prompt shows a checked **Use selected frame** attachment; detach it to plan
without design context. Changing the attachment invalidates the current plan.
Unsynced designs must finish syncing before attachment is available.

The browser sends only `sceneReference` (`projectId`, `frameId`, content-hash
`revision`). The authenticated server resolves it from that account's storage;
missing/foreign projects return 404, non-frame IDs return 400, and stale scene
revisions return 409 before provider dispatch. Client-authored `designContext`
payloads are rejected. `GET /api/projects/:projectId/frames/:frameId/context`
returns the same account-scoped snapshot for inspection.

MCP element summaries are reused on an isolated frame subtree. Snapshots contain
frame-relative geometry, nested layout/typography, referenced tokens (including
aliases, themes and shared-style dependencies), asset references and stable layer
IDs. Ancestors, siblings, component links, comments and unrelated tokens never
enter this context. Extraction is capped at 100 layers, 50 tokens and 48 KiB;
count truncation is explicit and excessive byte size rejects the request. Assets
remain reference data; no server-side URL fetching or preview CSP relaxation is
introduced.

Both planning and generation receive the snapshot, with `data-layer-id` mapping
instructions for corresponding JSX. The exact snapshot is covered by existing
server-issued plan approval checks and retained in generation provenance. Later
scene edits do not silently change an approved snapshot. The app records its
source scene reference only after generated source passes compilation.

```sh
node --experimental-strip-types tests/make-frame-design-context.test.mjs
npm run build:server && node server/tests/frame-design-context.test.mjs
npx playwright test e2e/make-frame-design-context.spec.ts e2e/make-app-generation.spec.ts e2e/make-prompt-plan.spec.ts e2e/app-preview-iframe.spec.ts
npm test && npm run build
```

The selected-frame browser test uses the real service/compiler with a deterministic
model adapter and checks frame-derived styling, functional interaction, layer IDs,
desktop/mobile layout, detachment and design preservation. Localhost/Chromium
restrictions block browser acceptance; they do not waive that release gate.

## Direct visual properties

Run a Make preview, choose **Select element**, then click a native HTML element.
The **Visual properties** inspector exposes a bounded set of typography, spacing,
color and border overrides. Existing source overrides appear as values; computed
styles are placeholders. Clear an override to inherit. Bare numbers retain React's
numeric CSS semantics; use units for shorthand values. Colors accept hex, rgb/rgba
and a small set of common keywords. Repeated component/list instances share the
same JSX source style; this is stated in the inspector.

**Review changes** shows the exact bounded source diff without changing the app.
**Apply visual changes** checks the reviewed source and revision, compiles with the
project's real entry point and account asset resolver, then saves using the existing
optimistic revision API. A failed build, save, conflict or late response retains the
working source, preview and rollback point. The save response must match the
validated source, next revision, preview configuration and asset references.
**Undo last edit** restores the source
as a new immutable revision. Rebuild, resize and reload use the persisted source.
Undo also validates the restored app identity, next revision, source, entry point,
asset references and compiler diagnostics before replacing the working preview.

The transformer uses TypeScript AST ranges to change only selected property values,
insertions or removals. Untouched comments, numeric values, quoted/custom keys,
attributes and sibling files are preserved. Dynamic/computed/spread styles,
spread/duplicate attributes, ambiguous IDs and unmapped DOM are read-only.
ID matching accounts for JSX entities and the guest's ID sanitization/truncation
across source files; colliding source sites remain read-only. Explicit
source IDs that are dynamic, empty or spread-overridden cannot be mapped safely,
so visual editing stays read-only in those projects. Guest
computed styles are bounded display data, never trusted source edits or persisted
annotation fields. The TypeScript parser and inspector load only on selection;
normal Design/Make startup does not fetch this chunk. No scene or MCP mutation is
involved.

```sh
node --experimental-strip-types --test --test-isolation=none tests/make-visual-inspector.test.mjs
npm test && npm run build
npx playwright test --config playwright.visual.config.ts
```

The browser suite serves built artifacts in-process and covers diff review,
rendered styles, rebuild, reload, immutable undo, a mobile preview and 390px host,
read-only elements, injection rejection, failed validation and revision conflicts.
It also runs annotation and responsive regressions. Chromium must launch for this
gate to pass; a sandbox launch failure blocks browser acceptance. Screenshots are
written to `/tmp/paper-visual-inspector-{desktop,mobile}.png`.

### Immutable version history

Open **Version history** to browse account-scoped checkpoints, inspect their full source and bounded diffs, and restore an earlier revision. Checkpoints identify chat, manual, inspector, asset and restore operations. Chat checkpoints include their model turn ID; restores record both their parent and the restored revision. Legacy snapshots remain readable and are labeled as earlier checkpoints.

Restore validates the historical source and referenced asset bytes before publishing a new revision with an optimistic revision check. A failed compile, missing asset or concurrent write leaves the current revision untouched. Re-editing a restored app continues the revision sequence. Source drafts remain separate and become stale after a restore, so they cannot silently overwrite it.

Committed history is retained until the app is deleted; it is never pruned on save or restore. Detached asset bytes are retained for historical revisions and continue to count toward the existing asset quotas. The history list omits source and diff lines; complete source and bounded diff excerpts load on demand. Unsaved drafts keep session history only. Saving a copy creates a separate app with its own initial checkpoint.

Checkpoint provenance is validated and copied before a write is queued, and its integrity hash covers both source and metadata. Tests cover caller mutation during queued writes, immutable retention, stale reads and restores, ownership/CSRF checks, failed validation, restart/re-edit, and restored source with detached or missing asset bytes.

Browser gate: `npm run test:e2e -- e2e/make-version-history.spec.ts e2e/make-source-editor.spec.ts e2e/app-preview-iframe.spec.ts`. This exercises checkpoint inspection, manual/inspector provenance, restore/re-edit/reload, stale restore conflicts, sandbox isolation and mobile layout. The gate requires Vite to bind localhost and Chromium to launch; an environment failure blocks browser acceptance.

## Bounded agent validation (Make 18)

Approved generation checks each candidate with the static compiler, then renders
it in fresh, opaque-origin Chromium frames at 1280×800 and 390×844. It requires
visible content, observes startup errors/rejections for 350 ms after mounting, and
checks horizontal overflow. These are startup/render checks; they do not prove
all interactions or arbitrary future timers correct. A failed candidate can spend
one additional metered model turn on repair. Two candidates is the fixed maximum
per approval; retrying requires a new plan. The working revision is written only
after all checks pass, with the existing revision conflict guard.

The API runtime needs the `playwright` dependency and its matching Chromium:
`npx playwright install --with-deps chromium` in an environment that permits browser
processes. `PAPER_VALIDATION_CHROMIUM` can point to a system Chromium executable
(e.g. `/usr/bin/chromium` in an Alpine API image with Chromium installed). Missing
browser binaries, browser capacity, capture failures, and the 15-second browser
timeout are blockers, never successful validations. At most two browser checks
run concurrently per API process. Deploy the validator with process/resource
isolation appropriate for untrusted browser workloads.

Generation also owns a 15-second deadline around the validator, so cancellation
or a runner that ignores its signal cannot leave the request waiting forever.
It rejects a passing status accompanied by errors, missing/duplicate viewports,
incorrect viewport sizes, or missing/oversized/invalid JPEG evidence. These
infrastructure blockers stop immediately without spending another repair turn
or writing a revision. Diagnostic secrets and image URLs are removed before
truncation, including image payloads in filenames.

No account cookies, host screenshots, or storage state enter the validation
browser. It uses the existing sandbox/CSP with all network requests denied.
Credential-like source blocks capture; known server credentials and token patterns
are redacted from bounded feedback. Each failed render can send two JPEG captures
(maximum 12 KB each) to the configured model provider, only as ephemeral repair
context. Successful captures are discarded. No image bytes enter API results,
revision history, the usage ledger, or application logs. Feedback is limited to
8 diagnostics of 500 characters each; the ledger and UI retain only diagnostic
and viewport/capture-size summaries. Keep provider-side retention settings aligned
with your project's privacy requirements.

API orchestration tests use an explicit scripted browser boundary. Real Chromium
checks are separate and required before release:
`npx playwright test e2e/make-validation.spec.ts e2e/make-app-generation.spec.ts e2e/app-preview-iframe.spec.ts`.
A browser infrastructure failure must be resolved before that release gate passes.
