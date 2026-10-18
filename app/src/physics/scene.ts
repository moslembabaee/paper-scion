import type { SceneStore } from '../scene/store.ts'
import type { SceneSnapshot } from '../scene/types.ts'
import { getWorldBounds, getWorldMatrix } from '../scene/geometry.ts'
import { unionBounds } from '../canvas/math.ts'
import { createBody } from './simulation.ts'

export const MAX_PHYSICS_BODIES = 64

export function createPhysicsScene(store: SceneStore, state: SceneSnapshot = store.getSnapshot()) {
  const candidates = (state.selection.length ? state.selection : state.rootIds).filter(id => store.isVisible(id) && !store.isLocked(id))
  const selected = new Set(candidates)
  const ids = candidates.filter(id => {
    let parent = state.elements[id].parentId
    while (parent) {
      if (selected.has(parent)) return false
      parent = state.elements[parent]?.parentId ?? null
    }
    return true
  })
  const bodies = ids.slice(0, MAX_PHYSICS_BODIES).map(id => createBody(id, getWorldBounds(state, id)))
  const bounds = unionBounds(bodies)
  const arena = { x: Math.floor(bounds.x / 120) * 120 - 120, y: Math.floor(bounds.y / 120) * 120 - 120, width: Math.ceil((bounds.width + 360) / 120) * 120, height: Math.ceil((bounds.height + 360) / 120) * 120 }
  const basis = new Map(bodies.map(body => {
    const parent = state.elements[body.id].parentId
    const [a, b, c, d] = parent ? getWorldMatrix(state, parent) : [1, 0, 0, 1]
    return [body.id, { a, b, c, d }]
  }))
  return { bodies, arena, basis, omitted: Math.max(0, ids.length - MAX_PHYSICS_BODIES) }
}
