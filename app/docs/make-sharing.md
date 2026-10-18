# Make project sharing

Sharing uses existing authenticated Paper identities. Find your account ID in
**Make → Share for review** and send it to the owner. The owner pastes that ID,
chooses Viewer or Editor, and grants access. Shared apps appear under **Shared
with you** in the project chooser. Account IDs identify recipients; they are
not bearer links or credentials.

Each grant names an immutable saved revision. Subsequent owner edits, assets,
chat history, and other revision history stay private. **Share rN** explicitly
updates a recipient's snapshot. Granting, changing roles, and revoking do not
publish or unpublish an app. Local unsaved drafts are never uploaded by sharing.
Changing an existing recipient's role preserves their shared revision and asset
access. Use **Share rN** separately to disclose newer saved content.

| Role | Access |
| --- | --- |
| Owner | All revisions and assets; manage permissions, source, exports and releases |
| Editor | Read and preview the granted revision; save its source, name and description |
| Viewer | Read the granted source and interact with its sandboxed preview |

Editor saves require the shared revision to equal the project's current head.
If the owner has a newer private draft, saving returns a conflict without its
contents. Build validation runs before committing. An editor save creates a new
immutable revision and advances that editor's grant; other reviewers remain on
their explicitly shared snapshots. Editors cannot change asset references,
provenance, permissions, releases, or revision history. To review another
editor's changes, the owner shares the new revision explicitly.

The review workspace checks access on focus, refresh, and every ten seconds
while visible. Revocation clears its preview and source on the next check.
Previously downloaded information cannot be recalled. Every server read,
compile and asset request checks the current grant, independently of the UI.
Revoking a grant takes effect on subsequent server requests immediately.

## API

All endpoints use the existing Paper session, account guard and mutation CSRF
guard (`X-Paper-Client: web`), with no-store responses.

* `GET /api/apps/:id/permissions`: owner role and grants.
* `PUT /api/apps/:id/permissions`: grant or replace
  `{ "accountId": "<existing Paper ID>", "role": "viewer", "revision": 1 }`.
  Omit `revision` to change only an existing recipient's role; the saved snapshot
  and its integrity hash remain pinned under the project writer lock. Initial
  grants require a revision, including after revocation.
* `DELETE /api/apps/:id/permissions`: revoke `{ "accountId": "<Paper ID>" }`.
* `GET /api/shared-apps`: only granted snapshot summaries.
* `GET /api/shared-apps/:owner/:id`: `{ ownerId, role, project }`.
* `POST /api/shared-apps/:owner/:id/compile`: compile the granted snapshot.
* `GET /api/shared-apps/:owner/:id/assets[/:assetId]`: only the granted
  snapshot's assets, including retained assets detached from the private head.
* `PUT /api/shared-apps/:owner/:id`: editor-only
  `{ project, expectedRevision }`, returning `{ ownerId, role, project }`.

Owner permission routes also support the existing `/api/app-projects` alias.
The shared namespace includes owner IDs because different accounts can use the
same project ID. Other shared subresources are denied. Missing and revoked
grants return 404; forbidden actions on granted projects return 403. There are
at most 100 recipients per project. Permission files are private, atomically
replaced and removed with the project; recreating an ID grants no old access.
Authorization, response byte resolution, edits and revocation share the source
writer lock. Symlink protections and asset integrity checks remain in effect.
Grants bind the revision's integrity hash as well as its number, so a source
write interrupted by a crash cannot accidentally share a later private draft.

## Verification

`npm test && npm run build` runs the application and server gates. The
two-account API cases are in `server/tests/apps-sharing.test.mjs`. Run browser
sharing plus publication and validation security regressions with:

```sh
npx playwright test --config playwright.sharing.config.ts
```

Browser tests route the built frontend and real service in process, use separate
browser contexts and real session cookies, and retain the actual compiler and
preview sandbox. This avoids needing a bound HTTP listener in restricted CI.
