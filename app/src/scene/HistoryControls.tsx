import { useEffect, useSyncExternalStore } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import type { SceneStore } from './store'

export function HistoryControls({ store }: { store: SceneStore }) {
  const history = useSyncExternalStore(store.subscribe, store.getHistorySnapshot, store.getHistorySnapshot)
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      // Let text fields keep their native editing history.
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="menu"]')) return
      event.preventDefault()
      if (event.shiftKey) store.redo()
      else store.undo()
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [store])

  return <div className="history-controls" role="group" aria-label="Edit history">
    <button className="tool-button" data-testid="history-undo" aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z" title={`${history.undoLabel ? `Undo: ${history.undoLabel}` : 'Undo'} (${modifier}Z)`} disabled={!history.canUndo} onClick={store.undo}><Undo2 size={16} /></button>
    <button className="tool-button" data-testid="history-redo" aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" title={`${history.redoLabel ? `Redo: ${history.redoLabel}` : 'Redo'} (${modifier}Shift+Z)`} disabled={!history.canRedo} onClick={store.redo}><Redo2 size={16} /></button>
  </div>
}
