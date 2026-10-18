# Scoped app data

For a saved app, its signed-in owner can open **Make → App data → Define a
collection** to grant fixed CRUD operations against a bounded schema. No
collection exists by default. Choose allowed operations and quotas, then create
the capability. Its `dat_…` handle is an identifier, not a bearer credential.
Only that account's preview of that app can use it. Shared reviewers/editors,
MCP credentials, exported apps, automated validators and public releases have
no data authority. This slice does not provide public form submission.

## Form integration

The default schema accepts `name` (required string, at most 80 UTF-8 bytes) and
`subscribed` (required boolean). Use the handle displayed in the panel:

```ts
const handle = 'dat_REPLACE_WITH_THE_32_CHARACTER_ID'
if (!window.paperData) throw new Error('Open an owner preview')
const current = await window.paperData.invoke(handle, { operation: 'list' })
const created = await window.paperData.invoke(handle, {
  operation: 'create', expectedRevision: current.revision,
  value: { name: 'Ada', subscribed: true },
})
const id = created.records[0].id
const updated = await window.paperData.invoke(handle, {
  operation: 'update', id, expectedRevision: created.revision,
  value: { name: 'Grace', subscribed: false },
})
await window.paperData.invoke(handle, {
  operation: 'delete', id, expectedRevision: updated.revision,
})
```

`get` takes a record `id`. `list` returns at most eight records; pass its
`nextOffset` as the next request's `offset` while it is present. Each response
contains the current collection `revision`. Mutations require the current
`expectedRevision`; concurrent stale mutations return 409 without changing
records. Updates replace the entire value. Reload before retrying conflicts.
The guest receives a fixed `Data operation unavailable` error for denied or
failed requests. The host API retains status codes for owner tooling.

## Schemas and quotas

Schemas contain 1–16 named fields of type `string`, `number` or `boolean`.
`required` is optional. Strings require `maxLength` (1–4096 UTF-8 bytes).
Numbers may specify finite `minimum` and `maximum`. Unknown fields, nested
values, prototype keys, duplicate JSON keys and non-finite numbers are rejected.
There are no user-defined expressions, SQL, filters, URLs, network adapters or
generated server code. Injection-looking strings remain inert record values.

Owner-defined quotas must be positive integers within these hard limits:

| Limit | Maximum |
| --- | --- |
| Collections per app, including revoked tombstones | 16 |
| Records per collection | 1000 |
| Serialized record value | 4096 bytes |
| Stored records per collection, including IDs/JSON overhead | 256 KiB |
| Stored records across all app collections | 1 MiB |
| Successful reads and writes per collection per minute | 120 |
| HTTP request | 16 KiB |

Rate counters survive restart and reset after their one-minute window.
Quota/schema failures do not advance revisions or consume successful-operation
quota. The preview also shares a four-call concurrency limit and 20 dispatches
per minute with secret capabilities. Direct HTTP access cannot bypass the
server's collection quotas or owner/session/origin guards.

## Owner HTTP API

All routes require the existing session, origin and `X-Paper-Client: web`
guards. `/api/app-projects` supports the same paths. Responses are `no-store`.

| Route | Input | Result |
| --- | --- | --- |
| `GET /api/apps/:id/data` | — | `{ collections }`, schema/grant/usage metadata only |
| `POST /api/apps/:id/data` | `{ name, schema, operations, quotas }` | New capability metadata, 201 |
| `POST /api/apps/:id/data/:handle` | Fixed CRUD request | `{ revision, records, nextOffset? }` |
| `DELETE /api/apps/:id/data/:handle` | `{ expectedVersion }` | Revoked metadata; live records erased |

403 means revoked or disallowed operation, 404 means missing app/capability/row,
409 means stale revision/version or storage quota, and 429 means operation
quota. Invalid JSON errors never reflect submitted keys or values. Revoke is
irreversible; a source rollback cannot re-enable a grant or recover erased data.

## Persistence and boundaries

Records live in `apps/:owner/:app/data.json`, mode 0600 inside a 0700 app
directory. They are private JSON on the server volume, not encrypted secrets.
Atomic writes share the app lock with source writes/deletion. Symlinks,
nonregular files, oversized files and corrupt stored state fail closed.
One API process owns the volume, matching existing app storage.

Records are excluded from app source, revisions, model inputs, export ZIPs and
publication artifacts. Restoring a source revision leaves live records and
capability revocations intact. Deleting the app removes its data; recreating
the same app ID does not revive handles. Operator backups have their own
retention policy. Refresh the panel to update usage after a preview mutation.

## Verification

`npm test && npm run build` runs protocol, storage, security and offline-export
regressions. The production-minified bridge and offline-export tests were
observed failing before their fixes. `server/tests/apps-data.test.mjs` covers
CRUD/restart, app/account isolation, shared-editor denial, schema/injection,
record/byte/rate quotas, concurrent writes, failed-write rollback, source
restore, revocation and storage corruption.

After building, run the persisted form and adjacent release security browser
tests with:

```sh
npx playwright test --config playwright.data.config.ts
```

The form fixture provisions a capability in the real panel, saves through the
opaque iframe, checks quota rollback, restarts the API/browser, reloads the saved
record, tests forged messages and revokes access. It captures desktop and mobile
screenshots under `/tmp`. On this restricted runner, Chromium cannot launch
(`sandbox_host_linux.cc:41`, `Operation not permitted`). Browser acceptance
remains a release gate and must be rerun on a host that permits Chromium.
