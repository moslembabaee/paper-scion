# Vector editing

Press **P** or choose the pen in the toolbar. Click to place a corner, drag to
place a Bezier anchor with mirrored tangents, and click the first anchor to close
the outline. Enter or Done commits an open path. Shift constrains directions to
45 degrees; Alt breaks a tangent or temporarily bypasses pixel snapping.

While drawing, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo draft edits. The pen
also exposes Undo and Redo buttons. Draft history never modifies existing layers;
the completed path enters document history as one command. Escape during a drag
restores the geometry from before that gesture.

Double-click a path, or select it and press Enter, to edit its nodes. Shift-click
selects multiple anchors; arrow keys nudge by one unit (ten with Shift).
Double-click an edge to insert a node without changing the curve. The node panel
offers Corner, Mirrored, Asymmetric (smooth with independent lengths), and
Disconnected tangents, numeric positions, and corner radii. Node edits support
document undo/redo and persist in project files.

Select at least two sibling rectangles, ellipses, or paths to access Union,
Subtract, Intersect, and Exclude in the inspector. Subtract uses the bottom shape
as its base. Compounds retain their sources: change their geometry or switch the
operation at any time. Release sources restores the original editable layers at
the compound's current transform. Flatten path converts the result to a directly
editable outline. Empty results retain their sources and can be edited again.

SVG export compacts native outlines and vector masks using horizontal/vertical
lines, reflected cubic shorthand, shorter relative coordinates, and compact
number separators. Coordinates retain full precision; relative commands are used
only when they recover the original coordinates exactly. Analytical arcs and
quadratic curves retain their original commands. Export never rewrites editable
nodes, Boolean sources, fill rules, or the document's cached path data.
