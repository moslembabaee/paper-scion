import { useEffect } from 'react'
import type { ViewportController } from '../canvas'
import { alignSelection, createAutoLayoutSelection, deleteSelection, distributeSelection, duplicateSelection, groupSelection, nudgeSelection, orderSelection, removeAutoLayoutSelection, resizeSelection, ungroupSelection } from './arrange'
import type { Alignment } from './arrange'
import { componentRoot } from './components'
import type { SceneStore } from './store'

const ALIGN_KEYS: Readonly<Record<string, Alignment>> = { KeyW: 'top', KeyS: 'bottom', KeyA: 'left', KeyD: 'right', KeyH: 'horizontal-center', KeyV: 'vertical-center' }
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

export function useArrangeShortcuts(store: SceneStore, controller: ViewportController, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let gesture = false
    const held = new Set<string>()
    const finish = () => { if (gesture) { gesture = false; store.endTransaction() } held.clear() }
    const blocked = (event: KeyboardEvent) => event.defaultPrevented || event.isComposing ||
      (event.target instanceof Element && !!event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="menu"], [data-token-ui], [inert]')) ||
      !!document.querySelector('[aria-modal="true"]')
    const keydown = (event: KeyboardEvent) => {
      if (blocked(event)) return
      if (store.getHistorySnapshot().active && !gesture) return
      const key = event.code || event.key
      const command = event.metaKey || event.ctrlKey
      if (event.altKey && !event.shiftKey && !event.metaKey) {
        const alignment = ALIGN_KEYS[key]
        if (alignment && (!event.ctrlKey || key === 'KeyH' || key === 'KeyV')) {
          event.preventDefault(); finish()
          if (event.ctrlKey) distributeSelection(store, key === 'KeyH' ? 'horizontal' : 'vertical')
          else alignSelection(store, alignment, controller.getSnapshot().visibleBounds)
          return
        }
      }
      const bracket = key === 'BracketLeft' || key === 'BracketRight'
      const depthArrow = command && event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')
      if ((bracket && !event.altKey && !event.shiftKey) || (depthArrow && !event.shiftKey)) {
        event.preventDefault(); finish()
        const front = key === 'BracketRight' || key === 'ArrowUp'
        orderSelection(store, command ? front ? 'forward' : 'backward' : front ? 'front' : 'back')
        return
      }
      if (command && event.altKey && (key === 'KeyK' || event.key === 'k' || event.key === 'K')) {
        const selection = store.getSnapshot().selection
        if (selection.length > 0) {
          const reason = store.selectionComponentCreationReason(selection)
          if (!reason) {
            event.preventDefault(); finish()
            store.createComponentFromSelection(selection)
            return
          }
        }
      }
      if (command && (event.altKey || event.shiftKey) && (key === 'KeyB' || event.key === 'b' || event.key === 'B')) {
        const selection = store.getSnapshot().selection
        if (selection.length > 0) {
          const root = componentRoot(store.getSnapshot().elements, selection[0])
          if (root?.component?.kind === 'instance' && !store.isLocked(root.id)) {
            event.preventDefault(); finish()
            store.detachComponentInstance(selection[0])
            return
          }
        }
      }
      if (command && (key === 'KeyD' || event.key === 'd' || event.key === 'D') && !event.altKey) {
        if (store.getSnapshot().selection.length > 0) {
          event.preventDefault(); finish()
          duplicateSelection(store)
          return
        }
      }
      if ((key === 'KeyA' || event.key === 'a' || event.key === 'A') && event.shiftKey && !command) {
        if (store.getSnapshot().selection.length > 0) {
          event.preventDefault(); finish()
          if (event.altKey) removeAutoLayoutSelection(store)
          else createAutoLayoutSelection(store)
          return
        }
      }
      if (command && (key === 'KeyG' || event.key === 'g' || event.key === 'G') && !event.altKey) {
        if (store.getSnapshot().selection.length > 0) {
          event.preventDefault(); finish()
          if (event.shiftKey) ungroupSelection(store)
          else groupSelection(store)
          return
        }
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !event.altKey && !command) {
        if (store.getSnapshot().selection.length > 0) {
          event.preventDefault(); finish()
          deleteSelection(store)
          return
        }
      }
      if (!ARROWS.has(event.key) || event.altKey) { if (!['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) finish(); return }
      const hasSelection = store.getSnapshot().selection.length > 0
      const viewport = document.querySelector('.canvas-viewport')
      if (!hasSelection && !(viewport?.matches(':hover') || viewport?.contains(document.activeElement))) return
      event.preventDefault()
      const amount = event.shiftKey ? 8 : 1
      const delta = { x: event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0, y: event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0 }
      if (!hasSelection) {
        if (!command) controller.panBy({ x: -delta.x, y: -delta.y })
        return
      }
      if (!gesture) { store.beginTransaction(command ? 'Resize elements' : 'Nudge elements'); gesture = true }
      held.add(event.key)
      if (command) resizeSelection(store, delta)
      else nudgeSelection(store, delta)
    }
    const keyup = (event: KeyboardEvent) => { held.delete(event.key); if (!held.size) finish() }
    const pointerdown = () => finish()
    const visibility = () => { if (document.hidden) finish() }
    document.addEventListener('keydown', keydown)
    document.addEventListener('keyup', keyup)
    document.addEventListener('pointerdown', pointerdown, true)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', finish)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('keyup', keyup)
      document.removeEventListener('pointerdown', pointerdown, true)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', finish)
      finish()
    }
  }, [store, controller, enabled])
}
