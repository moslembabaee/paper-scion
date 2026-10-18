# Live Paper MCP

For the production, Bearer-authenticated `/mcp` gateway that edits account projects while the browser is closed, see [remote agents and deployment](cloud.md#remote-agents). This page describes the separate localhost bridge for the focused browser editor.

Agents operate on the most recently focused Paper editor. Mutations appear immediately in the canvas, enter its undo history, and use the existing IndexedDB autosave. Human selection stays in place. Recently affected layers glow in Paper blue; focused reads also show agent activity. Same-origin tabs of the same project synchronize through BroadcastChannel. Other projects stay separate.

## Connect

Requires Node.js 22+. From `app`, run `npm run build`, then `npm run dev` or `npm run preview`. Both start the localhost bridge at `http://127.0.0.1:29979`; the editor header shows **MCP live** when registered. Configure an agent's stdio MCP server:

```json
{
  "mcpServers": {
    "paper": {
      "command": "node",
      "args": ["/root/projects/paper/mcp-server/bin/paper-mcp.mjs"]
    }
  }
}
```

Replace the absolute path for your installation. Agents that support MCP over HTTP can instead connect directly to `http://127.0.0.1:29979/mcp`. Initialize a session and retain its `MCP-Session-Id` header. Stdio discovery works before the editor opens; canvas tools return a useful error until an editor connects.

For a static build, start `npm run bridge` on the machine running the browser. The editor tries its own server, then the local bridge. Set `VITE_PAPER_BRIDGE_URL` at build time to override the bridge base URL, or `PAPER_BRIDGE_PORT` when starting the standalone bridge to override port 29979. Browser policies may require permission to reach localhost from a hosted page. The bridge accepts only loopback connections and loopback web origins; run Paper on localhost for this setup.

Vite also serves `/mcp` on its own port. If 29979 is occupied, use `--live http://127.0.0.1:5173` in the stdio arguments (substitute your Vite port), or set `PAPER_BRIDGE_URL` for the stdio process. Existing offline workflows remain available with explicit `--workspace /path/to/designs --file study.paper.json`; file-backed edits remain independent of live projects.

## Tools

| Tool | Behavior |
| --- | --- |
| `get_basic_info` | Active project ID, file name, top-level artboards, node count, human selection, grid size, and revision |
| `get_selection_context` | Bounded context for current human selection (or explicit `element_ids`): compact element summaries, ancestor chain, adjacent siblings, effective world bounds, and linked tokens/styles/components |
| `search_layers` | Case-insensitive substring search of layer name, text, and type with scoping (`parentId`, `scope_id`), filters (`visible`, `locked`), and deterministic pagination (`limit`, `cursor`) |
| `get_canvas_elements` | Full scene dump, hierarchy, tokens and project settings; optional `element_ids` includes descendants |
| `create_frame` | Creates an undoable frame in the active scene |
| `update_element` | Validates and applies an atomic patch, including reparenting or reordering |
| `apply_changes` | Previews or applies ordered edits atomically, with required revision, optional retry key, and one live undo entry |
| `add_shader_shape` | Creates a native shader rectangle or ellipse |
| `list_tokens` | Lists design tokens, optionally filtered by `type` |
| `create_token` | Creates an undoable token with a unique lowercase kebab-case name and a value matching its type |
| `export_selection` | Returns JSON or SVG inline; live mode does not write disk files |

## Recommended agent workflow

Avoid dumping the entire scene with `get_canvas_elements` on large documents. Use the bounded agent workflow:

1. **Basic info**: Call `get_basic_info` to verify the active project ID, file name, artboard list, current human selection, and document `revision`.
2. **Targeted search/context**:
   - In live mode with a human selection, call `get_selection_context` with `{}` to inspect selected layers, their root-to-parent ancestor chain, up to 5 adjacent siblings per side, center-rotated effective bounds, and linked tokens, styles, and components within a deterministic 32 KiB budget.
   - To locate specific layers across the project or within a frame subtree, call `search_layers` with targeted filters (`query`, `type`, `parentId`, `scope_id`, `visible`, `locked`). When `hasMore` is true, pass `nextCursor` with identical filters to continue paginating deterministically.
   - In headless or offline file mode (or to inspect unselected elements), call `get_selection_context` with explicit `element_ids`. Empty selection returns `empty: true`; invalid IDs fail explicitly.
3. **Preview and edit with revision**: For a complete edit, use `apply_changes` with the opaque `revision` from context as `expected_revision`, ordered `operations`, and `dry_run: true`. Present its bounded before/after `summary` and `warnings` to the designer, including any truncation. Apply the identical plan with `dry_run` omitted or false. If the revision has changed, read fresh context and preview again. Existing mutations also accept `expected_revision`.

## Atomic edit plans

The same `apply_changes` contract works in the live editor, offline stdio file mode, and authenticated remote mode. Offline calls take `file` (or the configured `--file`); remote calls take `project_id`. Live calls omit both. A current `expected_revision` is required in every mode.

```json
{
  "expected_revision": "<context revision>",
  "idempotency_key": "hero-card-v1",
  "dry_run": true,
  "operations": [
    { "action": "create", "type": "frame", "name": "Hero card", "width": 360, "height": 240 },
    { "action": "create", "type": "text", "parentId": "$0", "text": "Space to think", "fontSize": 24 },
    { "action": "create_token", "name": "card-accent", "type": "color", "value": "#81adec" },
    { "action": "bind_token", "element_id": "$1", "property": "fill", "token_id": "$2" }
  ]
}
```

References such as `$0` use zero-based operation indices and must point to an earlier create result. Explicit layer and token IDs also work. Supported creation types are `frame`, `text`, `image`, `rectangle`, `ellipse`, and `path`. Other actions include `update`, `reparent`, `reorder`, `delete`, `add_shader_shape`, `create_token`, `update_token`, `bind_token`, `unbind_token`, `set_layout`, `create_component`, `create_instance`, `set_component_properties`, `set_component_property`, `detach_instance`, and `reset_component_overrides`. `tools/list` publishes exact schemas and aliases; conflicting ID aliases reject. Layout values use the complete frame layout schema. Locked ancestors, cycles, invalid token bindings, and component structure restrictions follow the UI's SceneStore rules. A failing step publishes none of the plan.

Dry-run validates on a disposable scene. It changes no scene, revision, history, file, agent activity, or human selection, and does not reserve a retry key. Responses include the current/new `revision`, full `changedIds`, ordered `actionResults`, compact `summary`, and `warnings`. Previews cap summaries at 32 KiB and report `truncated`/`omittedCount`; full artwork strings may be abbreviated. Generated IDs in a preview are provisional; use operation references when applying. Live application preserves valid human selection and creates one undo command for the complete edit (no command for a no-op). Offline application stages and atomically renames the validated file under an exclusive lock; remote application serializes writes per authenticated project.

Plans allow 1–100 operations and at most 512 KiB of UTF-8 JSON. Use a unique `idempotency_key` for each plan. After an uncertain response, retry the same operations, key, and original revision: a successful receipt returns without applying again, even if the revision has since advanced. Reusing a key with a different plan rejects. Receipts are scoped to the live editor, canonical offline file, or remote account/project and retained for up to 10 minutes, 200 transactions, or 8 MiB, within the running process/editor. They do not survive process/editor restart; after expiry or restart, inspect fresh context before resubmitting. File lock contention also requires a retry. An ongoing human gesture rejects live application until it finishes.

Example arguments:

```json
{"id":"hero","name":"Hero","x":120,"y":240,"expected_revision":"<last revision>"}
```

```json
{"name":"agent-blue","type":"color","value":"#81adec","expected_revision":"<last revision>"}
```

```json
{"query":"button","limit":20}
```

```json
{"element_ids":["hero","button"]}
```

## Synchronization and recovery

The browser is authoritative. The HTTP endpoint holds an editor request open and delivers agent calls as soon as they arrive, with no periodic request latency. Replies contain the actual browser result. Reconnects use bounded requests and automatic retries; mutating tool calls are never automatically replayed after an uncertain reply. Retry an uncertain `apply_changes` call with its original idempotency key and payload while its receipt is retained; otherwise read the scene before retrying. Closing or switching a project rejects pending requests addressed to that editor.

Tab synchronization uses project-scoped snapshots with deterministic logical-clock ordering. It batches document serialization after gestures, preserves each tab's own camera and selection, and defers incoming snapshots while a gesture is active. Concurrent edits use the newest ordered snapshot; this is not a collaborative text-style merge of simultaneous edits. Use one active editing tab for conflicting changes to the same project. Activity messages travel separately, so reads do not replace artwork or add undo entries. Indicators expire after 2.6 seconds without another agent call.

Checks: `npm run build`, `npm test`, `npm run test:mcp`, and `npm run test:e2e -- e2e/live-mcp.spec.ts`. Unit tests exercise the real BroadcastChannel and HTTP middleware without opening sockets; browser tests cover live canvas push, outline alignment, shader rendering, undo, autosave, focus routing and project isolation.
