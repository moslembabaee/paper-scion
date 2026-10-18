import { useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import type { SceneStore } from './store'

/** Keep a live shader slider responsive while committing one command on release. */
export function useRangeHistory(store: SceneStore) {
  const pointer = useRef<number | null>(null)

  useEffect(() => {
    const finish = (cancel: boolean) => {
      if (pointer.current === null) return
      pointer.current = null
      if (cancel) store.cancelTransaction()
      else store.endTransaction()
    }
    const up = (event: globalThis.PointerEvent) => {
      if (event.pointerId === pointer.current) finish(event.type === 'pointercancel')
    }
    const blur = () => finish(true)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('blur', blur)
      finish(true)
    }
  }, [store])

  return (event: PointerEvent<HTMLElement>) => {
    const input = event.target
    if (event.button !== 0 || !(input instanceof HTMLInputElement) || input.type !== 'range' || store.getHistorySnapshot().active) return
    pointer.current = event.pointerId
    store.beginTransaction(`Adjust ${input.getAttribute('aria-label') ?? 'shader'}`)
  }
}
