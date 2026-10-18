# Make publication

Publish app creates a public, frozen copy of the **saved revision**. Source edits
remain private until **Update to revision N** succeeds. Every publish compiles
with Paper's fixed package allowlist, resolves and verifies local asset bytes,
and requires the isolated desktop/mobile browser checks to pass. Failed or
unavailable validation leaves the existing release unchanged. No generated
packages, scripts, configs or server code execute in this pipeline.

The Publication panel opens the current version URL. **Unpublish app** revokes
all versions, which subsequently return 404. Publishing again creates a fresh
release generation; old URLs stay revoked. Closing the editor or restarting the
server does not remove a live release. Deleting the saved app revokes its URLs.

## Self-hosted setup

Set `PAPER_RELEASE_ORIGIN=https://apps.example.net` on the API process, and route
that hostname to its dedicated `PAPER_RELEASE_PORT` listener (default `3002`).
The editor continues to use `PAPER_PUBLIC_URL` and API port `3001`. The release
hostname must differ from the editor hostname; changing only the port, letter
case or a DNS name's final dot is rejected. Use a separate registrable domain in
production and never configure editor cookies with a shared Domain. The public
listener does not dispatch auth, API, preview or MCP routes and ignores incoming
cookies and authorization.

For the existing Docker Compose deployment, add `PAPER_RELEASE_ORIGIN` and
`PAPER_RELEASE_PORT: 3002` to the API environment and expose port 3002 to your
TLS reverse proxy. Keep the original Host header, including any non-default port.
Forward only the release hostname to port 3002; do not forward `/r/` through the
editor origin. No custom domain workflow is implemented. HTTP is supported only
for loopback testing with distinct hostnames, for example editor
`http://127.0.0.1:4173` and release `http://localhost:4180`.

The API host also needs the matching Playwright Chromium browser and its system
dependencies (`npx playwright install --with-deps chromium` on a supported host).
The current Alpine API image needs a compatible browser installation configured
with `PAPER_VALIDATION_CHROMIUM`, or a supported browser-capable API image.
An unavailable browser blocks publication; it never falls back to compile-only.

Preserve CSP, Permissions-Policy, COOP, COEP, CORP and no-referrer response headers
through the proxy. Generated code runs in an opaque, credentialless sandbox
inside a trusted shell without an editor message bridge. Network requests,
workers, frames, forms and popups are denied. No session cookie is created or
copied to the public host. Local images/fonts and the frozen runtime are embedded
in the release, so it needs no preview session or authenticated asset endpoint.

Version URLs contain a source revision content hash and never change bytes.
Responses use `public, max-age=0, must-revalidate` so browsers and conforming CDNs
check revocation before reuse. Do not override this with immutable caching,
stale-while-revalidate or an SPA fallback. A document already open or downloaded
cannot be recalled by unpublish. Release history is capped at 20 versions per
publication generation and each document at 16 MiB; unpublish clears that history.

## API and checks

Authenticated `GET /api/apps/:id/release` returns server-owned publication metadata
or null. `POST` publishes/updates; `DELETE` unpublishes. Both mutations accept
only `{"expectedRevision": N}` and require the normal session and request guard.
Client-supplied manifest release fields never authorize a public release. A
concurrent source edit, deletion/recreation or publication revocation rejects
activation with 409. Activation compares the entire validated saved snapshot
under the source writer lock, because recreated apps can reuse revision numbers.
Publication metadata does not create a source revision or mutate scene/MCP data.

From `app/`:

```sh
npm test
npm run build
npx playwright test --config playwright.publication.config.ts
npx playwright test --config playwright.preview.config.ts
```

The publication browser tests load the actual built UI and actual public HTTP
handler in Chromium using in-process route transport, exercise real browser
validation, click a public counter, check credential/DOM isolation, explicitly
update, and verify all URLs return 404 after unpublish. They do not substitute a
passing browser validator. The preview suite additionally requires a local Vite
listener. Browser or runner restrictions are failures, not successful acceptance.
A deployed-origin smoke test and real-account checks remain required before a
public production release, per `docs/MAKE_PLAN.md`.
