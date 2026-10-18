# Scoped app secret handles

Owners create, rotate and revoke handles in Make → Secret handles for a saved
app. The password field is cleared before dispatch and values cannot be
revealed. Enter values here, rather than in chat or generated source. Handles
are identifiers, not bearer credentials. Only the signed-in owner can manage
or invoke them. Reviewers, MCP tokens, public releases and exported apps receive
no capability authority.

This slice provides one narrow capability: `hmac-sha256`. It signs an
app-domain-separated message without network access. It does not accept
third-party API keys for network integrations. Each future integration needs a
reviewed operation, input/output schema and authorization policy. There is no
fetch/HTTP proxy, user-selected URL, host, method, headers, algorithm or reveal
operation.

## Calling from an owner preview

Use the handle in generated source; its value stays on the server:

```ts
if (!window.paperCapabilities) throw new Error('Open this app in an owner preview')
const { signature } = await window.paperCapabilities.invoke(
  'sec_REPLACE_WITH_THE_32_CHARACTER_ID',
  { operation: 'hmac-sha256', message: 'Hello Paper' },
)
```

The host fixes the app ID and account; the iframe cannot choose either. The
bounded message bridge checks the exact source window and opaque origin,
correlates requests, limits concurrent calls to four and dispatches at most 20
per minute per preview. Changing app, account or preview document tears down
the context and aborts outstanding requests. The server reauthorizes every use.
The existing `connect-src 'none'` CSP and sandbox privileges remain in effect.
Only `{ signature }` or a fixed unavailable error returns to the iframe. Shared,
exported, browser-validation and public previews have no signing authority.

Messages contain at most 4096 UTF-8 bytes. The signature is lowercase hexadecimal
HMAC-SHA256 of the UTF-8 JSON encoding of this exact array:

```json
["paper-app-hmac-v1", "OWNER_ACCOUNT_ID", "APP_ID", "MESSAGE"]
```

This separation prevents an app from asking the capability to sign arbitrary
provider authentication payloads. Rotation preserves the handle, increments its
version and changes future signatures. Revocation removes its ciphertext and
increments its version. Revoked handles cannot be rotated back into use.
Already returned signatures cannot be recalled; applications needing expiration
or replay protection must include and verify those fields in their messages.

## Owner API

All routes require the existing session, origin and `X-Paper-Client: web` guards.
The `/api/app-projects` alias supports the same routes. Only these exact fields
are accepted; duplicate JSON keys and extra fields are rejected.

| Route | Input | Result |
| --- | --- | --- |
| `GET /api/apps/:id/secrets` | — | `{ secrets: [{ handle, capability, version, status }] }` |
| `POST /api/apps/:id/secrets` | `{ capability: "hmac-sha256", value }` | Metadata only, 201 |
| `PUT /api/apps/:id/secrets/:handle` | `{ value, expectedVersion }` | Rotated metadata |
| `DELETE /api/apps/:id/secrets/:handle` | `{ expectedVersion }` | Revoked metadata |
| `POST /api/apps/:id/capabilities/:handle` | `{ operation: "hmac-sha256", message }` | `{ signature }` |

Secrets require 32–4096 UTF-8 bytes. Request bodies are bounded to 16 KiB. There
are at most 64 handles, including revoked tombstones, per app. A stale version
returns 409; missing handles/apps return 404 and revoked handles return 403.
There is no individual GET/reveal endpoint. Responses use `Cache-Control:
no-store`; errors never include input, plaintext or ciphertext. Server request
logging must continue to exclude request/response bodies. Malformed JSON returns
only `Invalid JSON`, including duplicate fields and invalid escape sequences;
parser diagnostics must never reflect submitted field names or values.

## Storage and restart

`apps/:owner/:app/secrets.json` is a private server artifact, outside all source
manifests, revisions, assets, export ZIPs, model inputs/ledgers and publication
artifacts. Values use AES-256-GCM with fresh random nonces. A domain-separated
HKDF-SHA256 key is derived from the persistent `PAPER_SESSION_SECRET`. Associated
data binds owner, app, handle, operation and version. Tampering, substitution,
missing keys and decryption failures fail closed. Store directories are mode
0700 and files mode 0600; symlink reads are denied. Atomic writes and directory
syncs share the source writer lock with deletion and recreation. One API process
owns the volume, matching existing app storage.

Retain the data volume and stable session secret across restarts. Changing the
session secret makes existing values unavailable; provision replacement handles
before intentionally migrating it. Back up the key separately from encrypted
data. Rotation/revocation affect the live volume; historical operator backups
require their own retention policy. App deletion removes the vault; recreating,
copying or restoring source cannot resurrect removed handles. Source version
history does not rotate or revoke an active handle.

## Verification

The malformed-request leakage regression was observed failing before the error
sanitization fix. `npm test && npm run build` checks the application,
server and MCP build. `server/tests/apps-secrets.test.mjs` covers plaintext leakage,
restart, rotation, revocation, unauthorized accounts/apps/reviewers, strict input,
concurrent rotation, failed writes, ciphertext substitution, replacement master
keys, malformed vaults and symlink denial. Protocol tests
are in `tests/make-secret-capabilities.test.mjs`.

After building, run the real browser and adjacent security regressions:

```sh
npx playwright test --config playwright.secrets.config.ts
```

The config routes the built frontend and real API in process, using real session
cookies and the real compiler/sandbox. Browser execution remains a release gate:
a sandbox denying Chromium processes must be reported as blocked, never skipped
or accepted as a passing browser validation.

On the 2026-10-15 restricted runner, all seven browser tests failed before
execution because Chromium could not launch (`sandbox_host_linux.cc:41`,
`Operation not permitted`). Browser acceptance remains unresolved; rerun the
command above on a host that permits Chromium before releasing this slice.
