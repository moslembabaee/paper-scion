# Scene history

The scene store records immutable, reversible commands for element creation,
updates, deletion, reparenting, sibling order, visibility, locking, and shader
paints. At most 100 commands are retained across the undo and redo stacks.
Snapshots share unchanged element records; no scene serialization runs during
transform frames.

`store.undo()` and `store.redo()` restore the document and the selection associated
with the command, then notify subscribers once. `store.getHistorySnapshot()`
provides stable, frozen availability, counts, action labels, and transaction state
for toolbar subscriptions. A new document edit after undo discards the redo
branch. Selection changes, invalid edits, and no-op edits preserve it.

Use `store.batch(work, label)` for a single action with several mutations, such as
creation plus selection or importing a tree. Nested batches publish one command
and notification. Batching groups notifications; it does not roll back exceptions.

For live gestures, call `beginTransaction(label)`, apply updates at animation-frame
cadence, and call `endTransaction()` on release. `cancelTransaction()` restores
the starting snapshot without changing either stack. Transform gestures and shader
slider drags use this API. Undo and redo are unavailable during a transaction.
Escape, pointer cancellation, lost pointer capture, and window blur cancel canvas
transforms. A click or a gesture returning to its original document creates no
checkpoint.

Toolbar buttons and Ctrl+Z / Ctrl+Shift+Z (Cmd on macOS) share the same actions.
Editable fields retain native text undo. Camera navigation, selection, and grid
preferences do not create scene commands.

Demo creation, restored sessions, and opening a different Paper JSON project call
`clearHistory()` to establish a baseline. Imported or pasted artwork is one undoable
command. History is session-local and excluded from project JSON and autosave;
the scene restored by undo or redo is saved through the existing store subscription.

Verification: `npm run build`, `npm test`, and
`npm run test:e2e -- e2e/history.spec.ts`. The history unit tests cover immutable
restoration, all structural actions, shader paints, branch invalidation, gestures,
notifications, and the 100-command limit. Browser tests cover toolbar and keyboard
actions, resizing, cancellation, styles, ordering, deletion, native text editing,
and shader slider grouping.
