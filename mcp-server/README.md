# Paper MCP server

A standalone, file-backed MCP server for Paper's infinite vector canvas. Agents can inspect the scene, create frames and native shader shapes, edit layers, and export a selection. The server speaks newline-delimited JSON-RPC on stdio; it has no network listener or runtime dependencies.

## Build and run

Requires Node.js 22+ and the app's installed development dependencies:

```sh
cd /root/projects/paper/app
npm ci
npm run build
```

The app build also compiles the server into `mcp-server/dist`. To build only the server, use `npm run build:mcp` in `app`, or `npm run build` in `mcp-server`.

Launch it with a workspace directory and an optional default canvas file:

```sh
node /root/projects/paper/mcp-server/bin/paper-mcp.mjs \
  --workspace /path/to/designs \
  --file study.paper.json
```

`--workspace` defaults to the working directory; `--file` is optional when calls include `file`. `PAPER_WORKSPACE` and `PAPER_FILE` provide equivalent defaults. The workspace and parent directories must already exist. `create_frame` can start a new project; the other tools require an existing file. Once built, `bin/` and `dist/` run independently of the app, React, npm, and a browser.

## Connect an agent

Use `node` as the server command with these arguments in your MCP host. Hosts using a JSON `mcpServers` configuration can use:

```json
{
  "mcpServers": {
    "paper": {
      "command": "node",
      "args": [
        "/root/projects/paper/mcp-server/bin/paper-mcp.mjs",
        "--workspace", "/path/to/designs",
        "--file", "study.paper.json"
      ]
    }
  }
}
```

Use absolute paths so the host's working directory does not affect startup. This process can be launched by Claude, Codex, Cursor, or another MCP host supporting the initialize-based stdio protocol. The server negotiates MCP revisions `2025-11-25`, `2025-06-18`, `2025-03-26`, and `2024-11-05`. It implements the [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [initialization lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle); the stateless 2026 protocol is not implemented.

## Work with Paper

1. Save a project in Paper with **Save project JSON** (or ⌘/Ctrl S), and place the `.paper.json` file in your workspace.
2. Follow the agent-first workflow:
   - **Basic info**: Call `get_basic_info` to inspect file identity, top-level artboards, element count, and opaque `revision`.
   - **Targeted search/context**: Call `search_layers` with targeted filters (`query`, `type`, `parentId`, `scope_id`, `visible`, `locked`) or `get_selection_context` with explicit `element_ids` to read compact layer summaries, ancestor chain, adjacent siblings, center-rotated effective bounds, and linked tokens/styles/components without dumping the entire canvas.
   - **Edit with revision**: Make edits with `create_frame`, `add_shader_shape`, or `update_element`, passing the latest opaque `revision` as `expected_revision`.
3. Inspect `paper://schema` and `paper://shaders` for schema invariants and supported shader parameters.
4. Reopen the edited JSON file in Paper with **Open or import file**.

The editor's local-storage document and the file on disk are separate. File edits do not push into a running browser. Save browser edits before handing a file to an agent, and reopen the file after agent edits.

## Tools

Every tool accepts an optional `file` relative to the workspace (or an absolute path inside it). Successful calls return both MCP text content and structured JSON; tool failures return `isError: true` with an actionable message.

| Tool | Inputs | Result |
| --- | --- | --- |
| `get_basic_info` | Optional `file` | Active project ID, file name, artboard list, element count, and opaque `revision` |
| `get_selection_context` | Optional `element_ids`, `file` | Compact element summaries, root-to-parent ancestor chain, adjacent siblings, world effective bounds, linked tokens/styles/components (capped at 32 KiB) |
| `search_layers` | Optional `query`, `type`, `types`, `parentId`, `scope_id`, `visible`, `locked`, `limit`, `cursor`, `file` | Bounded matching layers with IDs, types, bounds, parent paths, total count, and deterministic continuation `nextCursor` |
| `get_canvas_elements` | Optional `element_ids`, `file` | Current project settings, background shader, ordered elements, root IDs, 120px grid size, SHA-256 `revision` |
| `create_frame` | Optional `id`, `name`, `parentId`, geometry, `style`, `clipContent`, `cornerRadius`, `project_name`, `expected_revision`, `file` | Created frame and new file revision |
| `add_shader_shape` | Required `shader_kind`; optional `shape` (`rectangle` / `ellipse`), geometry, `parentId`, `style`, `params`, `motion`, `expected_revision`, `file` | Created shape with a native shader paint and new revision |
| `update_element` | Required `element_id`, `patch`; optional `parentId`, `index`, `expected_revision`, `file` | Updated element and new revision |
| `export_selection` | Optional `element_ids`, `format` (`json` / `svg`), `background`, `output`, `shader_snapshots`, `file` | MIME type, inline file content, selected root IDs; optional new output file |

Coordinates are in pixels relative to the parent frame; rotation is in degrees about the element center. Default frames are 720 × 480px, clipped, and filled with `#edebe1`. Default shapes are 120 × 120px. Shader defaults use Paper's cream, ink, blue, and charcoal palette.

Example tool arguments:

```json
{"id":"hero","name":"Hero","x":120,"y":120,"width":720,"height":480}
```

```json
{"parentId":"hero","shader_kind":"mesh-gradient","width":720,"height":480,"params":{"distortion":0.3},"motion":{"animated":false,"frame":12000}}
```

```json
{"element_id":"hero","patch":{"name":"Landing hero","style":{"fill":"#222222"}},"expected_revision":"<revision from the last read or edit>"}
```

`patch.style` merges at the style-field level. A `shader` inside an update patch must be a complete paint; use the catalog resource for its values. Structural fields (`id`, `type`, `children`, `zIndex`) cannot be patched. Use top-level `parentId` and `index` to reparent or reorder. Unlock a layer with `patch.locked: false` before editing its contents. A locked ancestor must be unlocked separately.

## Schema and shaders

`resources/list` exposes `paper://schema` (JSON Schema for the actual version 1 project and all six element types) and `paper://shaders` (seven shader kinds, defaults, controls, and animation bounds). The scene graph, shader catalog, validation, and SVG writer are shared directly with the app. Existing legacy version 1 scene-only JSON remains scene-only on write; project files preserve their name, camera, grid, and background shader.

## Exports and persistence

JSON exports preserve native shader parameters and frame descendants, deduplicate overlapping selections, retain paint order, and convert selected roots to world coordinates. A selected descendant's inherited opacity and visibility are retained. Ancestor clip masks are retained in SVG; JSON selection exports are independent editable layers and do not carry ancestor clip masks.

SVG exports use the app's vector serializer with editable text, rotation, clipping, strokes, and shadows. Text layout uses the serializer's approximate font metrics; referenced image URLs are retained without fetching. SVG shader fills require PNG data URIs in `shader_snapshots`, keyed by element ID (`paper:background` for a canvas shader). Without those snapshots, export returns an error; use JSON for lossless shader handoff, or the browser export dialog for WebGL capture and PNG.

All paths are confined to the configured workspace, including resolved symlinks. Inputs and project writes are limited to 16 MB. Mutations validate in a disposable scene store before staging a synced temporary file and replacing the original with an atomic rename. An exclusive `.paper-mcp.lock` coordinates MCP processes; concurrent calls may return a retryable lock error. Each edit reloads disk and compares revisions before committing. External writers do not take this lock: revisions detect changes during staging, but another program must avoid writing during the final rename. On process failure, remove a stale lock only after verifying its recorded process has stopped. Exports create new files exclusively and never overwrite existing files.

## Verification

```sh
cd /root/projects/paper/mcp-server
npm test
```

Tests exercise all five tools through a real stdio subprocess, split UTF-8 messages, protocol negotiation, schema discovery, file round trips, shader validation, atomic failures, hierarchy edits, revision conflicts, path confinement, locking, and export compatibility with Paper.
