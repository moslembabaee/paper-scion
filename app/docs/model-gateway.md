# Make model gateway

Make slice 07 supplies an authenticated request adapter and metering; it does not apply generated source files. Model content is returned for a later validated revision workflow. Existing scenes, MCP, source files and app revisions are never written by a model turn.

Configure the API process with `PAPER_MODEL_URL`, `PAPER_MODEL_NAME` and `PAPER_MODEL_API_KEY`. These are server environment variables: keep them out of Vite variables, browser storage, source manifests and exports. With no provider configured, generation returns 503. The deterministic `mock` provider is an explicit test/development option, never an automatic generation fallback.

The generic HTTP adapter sends JSON `{ model, prompt, system, context, temperature, max_tokens }` to the operator-configured URL with a server-only bearer credential. It expects `{ content, usage?: { promptTokens, completionTokens } }` (`text` is also accepted). An existing provider proxy can implement this contract; provider-specific protocols can be supplied through the server's `customAdapter`. The adapter must honor its abort signal. The gateway also independently rejects on timeout/cancellation and discards late results. Requests cannot choose a different model, endpoint or credential. Redirects are rejected.

Session-authenticated endpoints:

- `POST /api/model/generate`: bounded `prompt`, optional `systemPrompt`, `context`, `maxTokens`, `temperature`, `appId` and `expectedRevision`.
- `GET /api/model/budget`: account-wide remaining turns and tokens, including active reservations.
- `GET /api/model/turns`: the account's latest 100 records, including pending turn IDs.
- `POST /api/model/cancel`: `{ turnId }`; only the owning account can cancel it. Browser callers can also abort the generation request with an `AbortSignal`.
- App-scoped `/api/apps/:id/generate`, `/budget` and `/turns` require ownership; `app-projects` aliases are supported. An expected revision mismatch returns 409.

Mutations require the existing `X-Paper-Client: web` guard, and the existing origin validation applies. Prompt size is capped at 64 KiB, request size at 128 KiB, output content at 256 KiB and output tokens at 8192. The HTTP adapter also bounds the response envelope while reading it. Defaults are a 30-second deadline, 20 attempts per minute per account, 50 turns and 200,000 tokens. Operators can set deadline, rate and account budgets in `ModelGatewayConfig`; clients cannot increase them.

Before dispatch, the gateway reserves one turn plus a conservative UTF-8-byte input allowance and the permitted output tokens. Concurrent requests share that reservation. Valid provider token usage reconciles the reservation; missing usage retains the allowance for that part of the request instead of estimating tokens from text length. Unknown usage on timeout, cancellation or failure retains the reservation, since upstream work may already have been billed. Usage totals therefore include conservative allowances, not a currency invoice. Budgets are cumulative, with no automatic reset. Failed turns consume turns too.

The API's data volume stores `model-usage.json` with account usage and bounded metadata, but no prompts, generated source or provider credentials. Writes replace the ledger atomically, and reservations are saved before provider dispatch. Restarting preserves spent budgets and marks interrupted turns cancelled. Run one API process per volume, as required for app storage. Back up the ledger with the rest of `/data`; a new data volume starts new budgets. Rate windows are process-local. This slice has no billing/reset administration API.

Upstream exception messages are replaced with a generic failure before responding or recording metadata: they may echo private request content or partial source. Gateway-authored validation and HTTP status diagnostics remain available. Successful content is scrubbed for known credential patterns and the configured provider key.

Run `node server/tests/model-gateway.test.mjs` after `npm run build:server` for focused security tests, `npm test && npm run build` for the quality gate, and `npm run test:e2e -- e2e/make-workspace.spec.ts e2e/app-compiler.spec.ts` for browser regressions.

When using Vite with `PAPER_API_URL`, `/api/model` is proxied to the API alongside app and scene routes. Browser requests use same-origin session cookies; pass the workspace `accountId` to the client adapter to enforce the existing account-change guard.
