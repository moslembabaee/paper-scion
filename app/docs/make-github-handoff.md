# GitHub handoff for reviewed app source

For a saved app, its signed-in owner can connect a repository-scoped GitHub
credential, review an exact dry-run diff, and commit the reviewed source revision
to a selected branch. No writes to GitHub occur without explicit consent.

## Workflow

1. **Connect:** Open **Make → GitHub handoff → Choose repository & branch**.
   Provide repository in `owner/name` format, an existing branch, and a fine-grained
   GitHub Personal Access Token with repository Contents read/write permissions.
   Tokens are held in server memory for 10 minutes and never persisted to disk,
   logs, client storage, or model context.
2. **Review:** Click **Show dry-run diff**. The server validates the app,
   verifies push permissions, inspects the current remote branch commit tree,
   and computes a bounded diff against existing files in `paper-make/${appId}/`.
   Remote deletions and modifications outside the app directory are ignored.
3. **Confirm & commit:** Inspect the displayed diff. Check the confirmation
   checkbox authorizing the specific revision, repository, and branch. Clicking
   **Confirm & commit** writes the reviewed source trees and commits to the
   branch. The review draft is single-use and invalidated immediately upon commit.

## Security and safety guarantees

- **Owner-only:** Only the project owner's active session can connect, review, or
  commit. Collaborators (editors/viewers) are denied access with 403/404.
- **Revocation:** Disconnecting via **Disconnect & revoke review** clears in-memory
  tokens immediately. Server restarts and session expiry also revoke connections.
- **Branch protection & race guard:** The target branch head commit SHA is verified
  during review and immediately before the ref update. If the remote branch moves
  or conflicts occur, the commit aborts with 409 without modifying the branch.
- **Zero-diff rejection:** If the remote files already match the reviewed source,
  the commit is rejected with 409 to prevent empty commits.
- **No private assets or secrets:** Revisions containing local uploaded assets,
  embedded `data:` URIs, `.env*` files, private keys, or detected secret tokens
  are rejected at validation time (422) and cannot produce a diff.
- **Isolated repository namespace:** All committed files are scoped under
  `paper-make/${project.id}/source/` alongside `paper-source.json` and a README.
  Root files and external directory paths cannot be touched or deleted.

## Verification

Run integration and browser tests from `app/`:

```sh
npm run build
node --test server/tests/apps-github-handoff.test.mjs
npx playwright test --config playwright.github.config.ts
```
