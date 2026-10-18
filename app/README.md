# React + TypeScript + Vite

## Mesh material studio

Select a layer, then choose **Mesh Gradient** under **Paper Shaders** in the inspector. With no layer selected, the material applies to the canvas background. Drag numbered color anchors on the canvas or in the inspector preview. Focus an anchor and use arrow keys for 1% adjustments, or Shift + arrows for 10%. Each drag is one undo step; Escape cancels it.

Add up to ten color stops, edit hex colors (including eight-digit alpha), and adjust each anchor's position and influence. **Procedural finish** provides turbulence, noise frequency, chromatic aberration, grain mixing and grain overlay with overlay, soft light, multiply or screen blending. Material compositing and motion controls adjust opacity, blend mode, playback, scale, rotation and offset. Mesh data persists with the project and is available through the code bridge.

Expand **React shader code** to copy or download a self-contained `PaperMaterial.tsx` component using `@paper-design/shaders-react`. The generated shader retains the current color stops, anchor placement, finishes, transforms and static frame. Give its parent an explicit height. Existing mesh materials without custom anchors can be upgraded with **Open interactive mesh studio**.

Run `node --experimental-strip-types --test tests/mesh-material.test.mjs tests/shaders.test.mjs` for model, persistence, history, code bridge and generated TypeScript checks, or `npx playwright test e2e/mesh-material.spec.ts` for WebGL rendering and interactive editing.

## Interactive prototyping

Toggle **Prototype** in the header to author connection wires directly on the canvas. Select a frame or layer and drag the connector handle to a target frame, or use **Add interaction** in the prototype inspector. Press Enter or Space on a connection wire to select it, or Backspace/Delete to remove it.

Prototypes support four interaction triggers (**On Click**, **On Hover**, **Drag**, and **After Delay** with configurable timing), three navigation actions (**Navigate to**, **Open Overlay** with backdrop dismissal, and **Scroll to** target elements), and five transitions (**Instant**, **Dissolve**, **Smart Animate**, and **Slide In** / **Slide Out** across all four directions). Transitions include standard curves and editable cubic Bezier control handles with a live SVG curve preview. Smart Animate pairs visible layers by type and hierarchy to smoothly interpolate transforms, rotation, fills, corner radii, and text colors.

Click **Play** to launch the embedded presentation player. Choose device mockup framing (**Canvas / No device**, **Phone**, **Tablet**, or **Desktop**), inspect interaction hotspots, navigate back through the screen history, pause or restart playback, and test scrollable artboard content. Interaction wires and prototype settings serialize into native project files and share the editor's undo/redo history.

Scroll-to interactions reveal content on both axes while respecting nested clipping. Pausing preserves the remaining time for After Delay interactions; restarting resets playback, scrolling, and delay timers. The player honors reduced-motion preferences.

Run `npm test` for prototype model and history regressions, and `npx playwright test e2e/prototype.spec.ts` for end-to-end authoring and presentation playback.

## Design tokens and shared styles

Open **Theme / Tokens** in the document sidebar to create named tokens, organize colors with palette names, and save shared color styles, typography presets, and ordered effect stacks. Capture a preset from the selected layer, apply it to the selection, or bind it in the inspector. Editing a shared value updates every bound layer, including component instances and retained Boolean sources. Manual edits detach the affected preset; explicit detach and deletion retain the current appearance. All library edits participate in undo/redo and native project saves.

**Add foundation tokens** installs Paper’s palette, semantic surface/content/action aliases, a five-step typography scale, and flat/raised/floating elevation values. Existing names are reused. Bind **Elevation** in the layer’s Shadow inspector: its pixel distance sets the vertical offset and twice that distance sets the blur; zero removes the shadow. Elevation follows token aliases and document themes, and CSS/Tailwind handoff retains the variable. Editing a shadow or applying an effect stack releases its elevation binding.

Use **Document theme** to add a named theme and switch between it and **Base**. Edit a token while that theme is selected to set an override, or choose **Reset to base value** to restore inheritance. Aliases reference another token of the same type and follow its value across every theme; invalid references and alias cycles reject the entire edit. Document themes are independent of the editor's light/dark appearance.

Typography presets include font family, size, weight, unitless line height, tracking, alignment, and optional token bindings. Effects support up to 32 enabled or disabled drop shadows, inner shadows, and layer blurs, with reorder controls and token-bound shadow colors. Canvas and SVG exports share the same ordered filter primitives. **Copy theme CSS** exports base variables, aliases, theme scopes, and shared-style classes; CSS paste imports base tokens and alias chains. Native JSON retains the complete library and active theme, and same-project tabs synchronize library-only changes.

The framework-independent engine is in `src/tokens/library.ts` and `src/scene/store.ts`. Resolved tokens and lookup indexes are cached by immutable snapshot identity; unrelated layers retain their references. Run `npm test` for aliases, themes, preset propagation, detach, persistence, effects, and live synchronization regressions.

## Precision canvas

Hold **Option / Alt** to measure between your selection and another layer. Use the inspector's **Arrange** bar for alignment and equal spacing, arrows to nudge, Cmd/Ctrl + arrows to resize, and brackets to change layer depth. See [precision controls and shortcuts](docs/precision.md).

## Auto layout

Select a frame and click **+** beside **Auto layout**. Choose horizontal or vertical flow, gap, independent padding on each side, main-axis alignment (including space between), and cross-axis alignment. Children follow their layer order; reorder layers to change the flow. Hidden children do not occupy space. Removing auto layout preserves the current positions.

Choose **No wrap**, **Wrap**, or **Wrap reverse**. Wrapped rows or columns break when their main axis runs out of space; a hugging main axis keeps a single line. **Lines** controls cross-axis packing: start, center, end, space between, or stretch. Fill siblings share the remaining space within their own line, and cross-axis fill stretches to that line. A frame with a fixed width and hugging height grows as its rows wrap.

Select an unlocked auto layout frame to show blue padding and gap handles on the canvas. Drag to adjust spacing at any zoom or rotation; Shift snaps to 8 px increments. Hover or focus a handle to see its value and the content boundary. Each drag is one undo step; Escape restores its starting value. Focused handles also support arrow keys (1 px), Shift + arrows (8 px), and Home (zero). Gap handles between wrapped lines adjust the same gap used between children.

Set each layer's width and height to **Fixed**, **Hug contents**, or **Fill container**. Hug frames wrap their visible children and padding; hug text measures its content and wraps when its width is constrained. Shapes and images hug their current dimensions. Fill siblings divide the remaining main-axis space equally, and fill on the cross axis occupies the parent's content area. Fill inside a hugging parent axis uses the child's intrinsic size to avoid a circular dependency. Fixed children retain their dimensions when space runs out; clipping follows the frame's Clip content setting. A direct resize changes the edited axis to Fixed.

Layout reflows after creation, edits, reordering, reparenting, visibility changes, deletion, and token updates, within the same undo step. Project files retain layout settings, and legacy frames remain freely positioned. Dev mode exports matching flexbox CSS, Tailwind, and React rules. MCP `create_frame` and `update_element` accept `layout` and `sizing`; see [layout types](src/scene/types.ts).

Run `npm test` for layout, history, persistence, and handoff regressions, or `npx playwright test e2e/auto-layout.spec.ts` for the inspector workflow. Headless MCP uses estimated font metrics; the editor measures the loaded browser font and reflows when fonts finish loading.

## Boolean paths

Shift-select two or more rectangles, ellipses, or paths in the same frame, then choose **Union**, **Subtract**, **Intersect**, or **Exclude** in the inspector's Boolean toolbar. Subtract removes the upper layers from the bottom selected layer; Exclude keeps areas covered by an odd number of sources.

Operations create editable compounds by default. Expand a source to edit its geometry, switch the operation, or **Release sources** to restore the layers at the compound's current transform. **Flatten path**, or **Flatten result** before combining, produces a regular path for pen editing. Each action supports undo and redo. Compounds retain their sources in project files and use cached cubic outlines for canvas rendering, shader masks, SVG export, and React handoff.

Source token bindings remain live, including inside nested compounds. Deleting tokens retains resolved geometry and paint; releasing transformed sources detaches changed geometry bindings and preserves color bindings. Geometry is recomputed only for source edits or operation changes, so moving a compound reuses its cached outline.

Run `npm test` for geometry and store regressions, and `npx playwright test e2e/boolean.spec.ts` for toolbar workflows and comparisons with native browser path filling.

## Reusable components

Select a layer or frame and choose **Create component** in the inspector, or **Create from selection** in the sidebar's **Components** tab. Frames include all their child layers. Search the document library, use **+** to insert a linked instance, and choose **Go to master** to edit its source.

Master edits synchronize geometry, appearance, text, layout and child structure across instances. Edit an instance's fill, stroke, opacity or text to keep a local override; stroke color and width inherit independently. Local token bindings affect only their property. Detaching a token keeps its current value. Moving or rotating an instance sets its own placement.

**Reset overrides** on an instance restores the master's current values across its subtree; on a child layer it restores only that layer. **Detach instance** keeps the rendered appearance and releases the entire instance for independent editing. Deleting a master also detaches its surviving instances. Component actions and propagation share the editor's undo/redo history, and project files and local saves retain links and overrides.

Use **Properties → +** on a master to expose a named variant switch, a layer visibility switch, or a text slot. Variant option names are comma-separated. Edit the master’s appearance and click **Capture** beside an option to save its paints, dimensions, corners, typography, and token/style links. Uncaptured options keep inheriting the master. Select an instance to switch variants, toggle visibility, or edit text; per-property reset restores the latest default. Variants compose in definition order, text/visibility slots apply next, and direct layer overrides apply last. Root **Reset overrides** resets both the property values and layer edits. Deleted layers release their property definitions; deleted tokens or styles retain their current values in saved variants.

Definitions live on the master’s component link and property values on the instance root. `SceneStore.setComponentProperties` validates all options, including inactive ones; `setComponentProperty` changes a value or releases it with `null`. Native projects retain this data and the published project schema describes it.

Nested components are not supported. Edit child structure and boolean sources in the master, or detach an instance first. Run `npm test` for store and persistence coverage, and `npx playwright test e2e/components.spec.ts` for the library, overrides, reset, detach and reload workflow.

## Vector node editing

Double-click an unlocked vector path, or select it and press **Enter**, to edit its subpaths. Click an anchor to select it, **Shift-click** to select more, and drag to move anchors with their handles. Use arrows to nudge by one path unit, or Shift + arrows for ten. Cmd/Ctrl + A selects every anchor; Backspace/Delete removes selected anchors. **Done**, Enter, or Escape leaves editing; Escape during a drag restores its starting geometry.

The node panel edits coordinates, corner radius, and handle types: **Mirrored** shares direction and length, **Asymmetric** shares direction with independent lengths, and **Disconnected** moves handles independently. **Corner** removes handles. Alt-drag disconnects a handle, while Shift constrains dragging. Double-click a node to toggle between corner and mirrored handles.

Double-click an outline edge to insert an anchor without changing its curve, or use **Insert node** for the next segment's midpoint. Corner radii apply to nodes with straight adjacent edges, clamp to available space, and stay editable when reopening a project. Inserting on a rounded subpath converts that subpath's visible outline to cubic anchors; undo restores its radius properties. Boolean compounds must be flattened before node editing. Rendering, shaders, exports, and handoff share the same cached SVG outline.

Run `npm test` for node geometry, persistence, and undo regressions, and `npx playwright test e2e/path-edit.spec.ts` for canvas interaction coverage.


## Paper native MCP server

`npm run build` also compiles the Paper MCP server. By default, stdio tools connect to the focused live browser editor through the localhost HTTP bridge; agent changes appear immediately, glow on the canvas, and support undo. Same-project tabs synchronize through BroadcastChannel. Tools include `get_basic_info`, `list_tokens`, `create_token`, `get_canvas_elements`, `create_frame`, `add_shader_shape`, `update_element`, and `export_selection`. Explicit `--file` mode supports offline `.paper.json` edits. See [live connection instructions and synchronization behavior](docs/live-mcp.md). Run `npm run test:mcp` to verify the protocol and file workflows.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
