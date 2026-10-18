# Precision canvas controls

Select a layer, hold **Option / Alt**, and hover another layer to measure the distances between their edges. Red guides show gaps and edge offsets; blue guides mark zero-distance alignment. Badges report canvas pixels independently of zoom. Hover empty canvas to measure to the four visible canvas boundaries. Locked layers can be measured. Releasing the modifier, leaving the canvas, panning, or transforming hides the HUD.

The inspector's **Arrange** toolbar aligns the selection and distributes three or more layers. Multiple layers align to their combined bounds. A single layer aligns to its parent frame, or to the visible canvas when it has no parent. Distribution equalizes edge gaps while retaining the two outer layers and supports overlapping layers. Selected frames carry their children through each action.

| Action | Shortcut |
| --- | --- |
| Align top / bottom | Alt W / Alt S |
| Align left / right | Alt A / Alt D |
| Align horizontal / vertical center | Alt H / Alt V |
| Distribute horizontally / vertically | Ctrl Alt H / Ctrl Alt V |
| Move 1 px | Arrow keys |
| Move 8 px | Shift + arrow keys |
| Resize 1 px / 8 px | Cmd or Ctrl + arrow keys / Shift + Cmd or Ctrl + arrow keys |
| Bring to front / send to back | ] / [ |
| Bring forward / send backward one step | Cmd or Ctrl + ] / [ |
| Bring forward / send backward one step | Cmd or Ctrl + Alt + Up / Down |

With nothing selected, arrows pan the canvas; Shift increases the step to 8 px. Right/Down grows a selection and Left/Up shrinks it, retaining its top-left anchor and a minimum selection size of 1 px. Hold an arrow to repeat an edit; releasing the arrows records one undo command. Text fields and dialogs retain their native keyboard behavior. Arrange shortcuts are suspended while drawing or editing vector paths.

These controls follow the checked-in official shortcut reference at `../../docs/official-specs/support.txt`. `tests/arrange.test.mjs` verifies geometry, hierarchy, locking, measurements and undo. `e2e/precision.spec.ts` covers browser keyboard routing, toolbar states, measurement zoom independence and camera panning.
