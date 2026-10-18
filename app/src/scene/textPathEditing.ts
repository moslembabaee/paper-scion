import type { SceneStore } from './store.ts'

/** Preserve path placement and flow options when deforming a local or linked baseline. */
export function updateTextCurve(store: SceneStore, textId: string, pathData: string): boolean {
  const elements = store.getSnapshot().elements
  const node = elements[textId]
  if (node?.type !== 'text' || store.isLocked(textId)) return false
  const source = node.textOnPath?.pathId ? elements[node.textOnPath.pathId] : undefined
  if (source?.type === 'path') {
    if (store.isLocked(source.id) || source.boolean) return false
    store.update(source.id, 'path', { d: pathData })
  } else {
    store.update(textId, 'text', {
      textOnPath: { ...node.textOnPath, enabled: true, preset: 'custom', pathId: null, pathData },
    })
  }
  return true
}
