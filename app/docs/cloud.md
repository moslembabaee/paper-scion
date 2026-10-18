# Self-hosted accounts, cloud sync, and remote MCP

Paper checks `/api/auth/session` on startup before opening the studio. Signed-out visitors see a welcome screen with the configured Google and GitHub sign-in options and a persistent appearance preview. Failed checks offer a retry; static-only deployments need an auth API to open the studio. Projects belong to the authenticated account on the server. IndexedDB is a transparent offline cache for instant loading and durable edits during network outages in an open studio. The header shows your account name and avatar, with **Sign out** in the profile menu; signing out saves pending local edits and returns to the welcome screen.

## Deployment

From the repository root:

```sh
cp .env.example .env
# Set PAPER_SESSION_SECRET to the output of: openssl rand -hex 32
# Set PAPER_PUBLIC_URL to your externally reachable origin, e.g. https://paper.example.com
# Add the OAuth client IDs/secrets for one or both providers.
docker compose up -d --build --wait
```

Keep `PAPER_SESSION_SECRET` stable and private. It encrypts the recoverable MCP token at rest. Compose requires an explicitly configured secret; an empty or short secret prevents startup. Use HTTPS for public deployments: cookies are marked Secure when `PAPER_PUBLIC_URL` starts with `https:`. Terminate TLS at your existing reverse proxy; forward `/`, `/api/`, and `/mcp` to Paper's port 3000. The API service is exposed only on the Docker network. Nginx forwards the Bearer credential, MCP session/version headers and all three MCP methods, disables SSE buffering and compression, and allows 90 seconds between stream reads (the API sends heartbeats every 20 seconds).

Register OAuth applications using the provider instructions for [Google](https://developers.google.com/identity/protocols/oauth2/web-server) and [GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps). Set their callback URLs to:

- Google: `https://paper.example.com/api/auth/google/callback`
- GitHub: `https://paper.example.com/api/auth/github/callback`

The backend exchanges authorization codes with PKCE, binds single-use state to an HttpOnly cookie, and uses verified provider identities. Different providers remain separate accounts even if they share an email address. OAuth provider access tokens are never persisted or exposed to the client.

`paper_projects` persists `/data/auth.json` and `/data/projects/<user_id>/<project_id>.paper.json`. Each project file contains a document envelope with the Paper document, revision, and timestamps. Back up the entire volume and the session secret. Run one API service against a volume: comparison/write locks are per process, not a distributed database.

`auto_deploy.sh` builds both images, validates configuration, and waits for both services to become healthy before marking a commit deployed.

## Workspace and conflict handling

Paper silently assigns legacy unowned projects to the signed-in account and uploads them without migration dialogs. New projects belong to that account from creation. The header shows **Saving…**, **Saved to Cloud**, or an offline/session status. Cached projects and the last open canvas are scoped to their account; another account’s projects are never shown, adopted, or uploaded.

Edits save to IndexedDB first and automatically upload to `/api/projects/:id` after a debounce. Remote edits arrive through an account-scoped SSE stream and a periodic reconciliation. All project lists and documents come from the current session's account. A network outage retains pending local edits and resumes reconciliation on reconnect or focus.

Writes compare an expected SHA-256 revision before replacement. On a conflict, the client deterministically chooses the later `updatedAt` timestamp, breaking exact ties with the lexicographically larger canonical document hash. Timestamps more than a minute ahead of server time are rejected. Concurrent edits resolve at the document level, so this is not a collaborative merge or CRDT; the losing document is retained as a separate recovery project in the same account and silently saved to the server. Canvas changes during a pending pull defer the pull, and IndexedDB updates compare the document in a transaction before replacing it.

## Remote agents

Open the header avatar → **Profile & account** to edit your account name and picture. Signed-in profiles are stored on the server and survive future provider logins. Workspace name, appearance and the 120 px engineering grid preference stay on this device. Signing in never replaces your local guest profile.

Choose **Generate MCP token** to create a private, cryptographically random 256-bit credential. Reveal, hide or copy it in this dialog. **Rotate token** immediately revokes the previous credential; **Revoke token** removes access without creating a replacement. These actions apply immediately, independently of **Save changes**. Rotated and revoked tokens remain invalid after a server restart. Revealing a token requires an active browser session; tokens alone cannot access account settings.

The server stores a SHA-256 digest for authentication and an AES-256-GCM encrypted copy for authenticated reveal. Plaintext credentials never enter browser storage, project exports, session responses or the configuration snippet. Paste a copied token into the snippet's `<YOUR_PAPER_TOKEN>` placeholder in your own agent client configuration. Keep the server's session secret stable so existing encrypted tokens remain recoverable.

Connect a client supporting [MCP Streamable HTTP](https://ts.sdk.modelcontextprotocol.io/server) to:

```json
{
  "url": "https://paper.example.com/mcp",
  "headers": { "Authorization": "Bearer paper_<your-private-token>" }
}
```

Client configuration shapes vary. The endpoint implements [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) with protocol revisions 2025-03-26, 2025-06-18, and 2025-11-25:

1. POST `initialize` with `Content-Type: application/json` and `Accept: application/json, text/event-stream`. Retain the returned `MCP-Session-Id` and negotiated `protocolVersion`.
2. Include `Authorization: Bearer …`, `MCP-Session-Id`, and `MCP-Protocol-Version` on every subsequent request. POST `notifications/initialized` without an `id` before using tools; notifications and client responses return an empty 202. Requests return JSON by default; putting `text/event-stream` first (or giving it a higher Accept quality) selects an SSE response containing the JSON-RPC result.
3. Optionally GET `/mcp` with `Accept: text/event-stream` to listen for account-scoped `notifications/paper/project_changed` JSON-RPC notifications. The initialization result advertises this Paper extension under `capabilities.experimental`. Each notification contains `project_id` and `revision`. The separate cookie-authenticated `/api/events` stream updates browser editors.
4. DELETE `/mcp` to close the session and its stream. Sessions expire after 30 minutes without a client request; a persistent GET does not renew the idle timer. HTTP 404 means initialize a new session. Token rotation and revocation immediately end that account's sessions and streams.

Every request requires a valid Bearer token; a browser cookie or another user's session ID cannot authorize an agent. Unknown/mismatched session IDs return 404, missing IDs return 400, and an untrusted `Origin` returns 403. The service permits 20 sessions per account, 1,000 in total, and one GET stream per session. SSE sends heartbeats every 20 seconds. It does not retain event history or replay `Last-Event-ID`: after reconnecting, call `list_projects` and re-read changed projects. Never automatically replay a mutation after an uncertain response; read the persisted document first.

Call `list_projects`, then supply `project_id` to the standard Paper tools: `get_basic_info`, `get_selection_context`, `search_layers`, `get_canvas_elements`, `create_frame`, `update_element`, `list_tokens`, `create_token`, `add_shader_shape`, and `export_selection`. Follow the agent workflow: inspect file details with `get_basic_info`, perform targeted reads using `search_layers` and `get_selection_context` (supplying explicit `element_ids` in headless mode), and pass `expected_revision` from the last read to guard mutations against stale edits. `create_frame` can create a new project using a new ID. Remote tools never accept filesystem paths or export paths.

The gateway always edits the persisted project; an active editor receives the new revision and glowing agent outlines. Closed tabs are not required for tool execution. Reopening or switching to the project downloads agent edits during reconciliation. JSON preserves shaders; SVG shader export still needs explicit browser-captured shader snapshots. `resources/read` exposes `paper://schema` and `paper://shaders`, matching the local server. Account/project symlinks are rejected; agents cannot supply paths or redirect storage outside their account directory.

The file-backed `mcp-server/bin/paper-mcp.mjs` stdio workflow is unchanged. A production UI can still connect to the separately running local bridge by setting `VITE_PAPER_BRIDGE_URL` at build time.

## Development and verification

The Fastify deployment dependency is isolated in `app/server/package.json`. The backend compiles with the app, while the reusable HTTP handler can be tested without binding sockets or installing Fastify.

```sh
cd app
npm run build
npm run test:cloud
npm test
npm run test:mcp
npm run test:e2e -- e2e/cloud.spec.ts e2e/workspace.spec.ts
```

The backend suite covers session initialization, HTTP/SSE negotiation, account/token isolation, stream cleanup on rotation/revocation/shutdown, headless edits and exports, stale queued mutations, symlink rejection, and atomic REST/MCP revision checks. Validate Compose without starting services using `docker compose config --quiet` after configuring `.env`.

For live development, install backend dependencies and run the service:

```sh
cd app/server
npm install
cd ..
npm run build:server
PAPER_SESSION_SECRET=<stable-secret> PAPER_DATA_DIR=/tmp/paper-cloud \
PAPER_PUBLIC_URL=http://localhost:5173 npm run dev:server
```

In another terminal run `PAPER_API_URL=http://localhost:3001 npm run dev`. Add OAuth provider credentials to the backend environment when testing actual provider sign-in. The Vite proxy advertises cloud capability only when `PAPER_API_URL` is set.
