# Editable booleans and vector masks

Select overlapping rectangles, ellipses, or paths in the same frame to use Union,
Subtract, Intersect, or Exclude. Subtract uses the bottom shape as the base. The
default result is an editable compound: expand its layer row to see sources, and
edit source positions, dimensions, radii, rotations, or path data in the boolean
inspector. Changing the operation recomputes the outline. Release sources restores
layers at the compound's current transform; Flatten path makes the merged outline
editable with the pen tool. Both actions support undo.

To mask content, select sibling layers with a vector shape or frame on top, then
choose **Use top layer as mask**. Paper creates a transparent frame and preserves
each child's geometry and world placement. Alternatively, select a shape inside
an existing frame and choose **Use as mask** to clip its siblings. A frame source
uses its rounded boundary; its children do not define the clipping shape.

The source carries a MASK indicator in the hierarchy. Select it there, or use the
Source button in the mask inspector, to change its geometry. Editable paths keep
their nodes, handles, and subpaths; boolean compounds retain their operands. Press
Enter on a selected editable path to edit nodes on the canvas. To release the
sources of a boolean mask, release its mask role first.

Each frame has one mask source. Setting another source replaces the previous role
in one undo step. Nested frames may have their own masks; ancestor clips intersect.
Masks respect rotation, path viewBoxes, winding rules, holes, and frame clipping.
Active mask sources do not paint. Disabling or hiding the source reveals the
original sibling layers; releasing the mask removes the role while retaining all
layers. In auto layout, an enabled mask keeps its free position while content flows.

The hierarchy and inspector offer independent clipping and outline toggles. A
selected source also shows its outline automatically. Outlines are editor chrome
and are excluded from presentation and export. Clipped regions and path holes
allow canvas clicks to reach lower layers. Geometry and winding spans are cached
on immutable nodes, so pointer movement does not repeatedly parse paths.

Native SVG export uses transformed vector clip paths, including when exporting
selected descendants. React handoff for a masked frame includes a unique `useId`
clip path and a content wrapper. Pass content layers as its children; the source
geometry is already in the clip definition. Paper project files preserve editable
mask sources and boolean operands, including inside component instances.

Verification: `npm run build`, `npm test`, and
`npx playwright test e2e/boolean.spec.ts e2e/masks.spec.ts`.
