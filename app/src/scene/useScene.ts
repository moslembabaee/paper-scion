import { useSyncExternalStore } from 'react'
import type { SceneStore } from './store.ts'
import type { SceneSnapshot } from './types.ts'

/** Selectors return stable snapshots; unrelated node edits do not re-render subscribers. */
export function useScene<T>(store: SceneStore, selector: (state: SceneSnapshot) => T): T {
  const read = () => selector(store.getSnapshot())
  return useSyncExternalStore(store.subscribe, read, read)
}
