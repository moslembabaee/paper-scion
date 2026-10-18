import type { Bounds, Point } from '../canvas/types.ts'
import { getWorldBounds, getWorldMatrix } from './geometry.ts'
import type { ElementGeometry, SceneSnapshot } from './types.ts'

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export interface SelectionBox extends Bounds { rotation: number }
export interface TransformOrigin extends ElementGeometry {
  id: string
  center: Point
  worldRotation: number
  parentMatrix: ReturnType<typeof getWorldMatrix>
}

const identity = [1, 0, 0, 1, 0, 0] as const
export const rotateVector = (point: Point, degrees: number): Point => {
  const angle = degrees * Math.PI / 180
  return { x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) }
}

/** Only transform the highest selected ancestor; descendants follow their frame. */
export function selectionRoots(state: SceneSnapshot, ids: readonly string[]): string[] {
  const selected = new Set(ids)
  return ids.filter(id => {
    const node = state.elements[id]
    if (!node) return false
    let parent = node.parentId
    while (parent !== null) {
      if (selected.has(parent)) return false
      parent = state.elements[parent].parentId
    }
    return true
  })
}

export function captureOrigins(state: SceneSnapshot, ids: readonly string[]): TransformOrigin[] {
  return selectionRoots(state, ids).map(id => {
    const node = state.elements[id]
    const [a, b, c, d, e, f] = getWorldMatrix(state, id)
    return {
      id, x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation,
      center: { x: a * node.width / 2 + c * node.height / 2 + e, y: b * node.width / 2 + d * node.height / 2 + f },
      worldRotation: Math.atan2(b, a) * 180 / Math.PI,
      parentMatrix: node.parentId === null ? identity : getWorldMatrix(state, node.parentId),
    }
  })
}

export function selectionBox(state: SceneSnapshot, ids: readonly string[]): SelectionBox | null {
  const origins = captureOrigins(state, ids)
  if (!origins.length) return null
  if (origins.length === 1) {
    const node = origins[0]
    return { x: node.center.x - node.width / 2, y: node.center.y - node.height / 2, width: node.width, height: node.height, rotation: node.worldRotation }
  }
  const bounds = origins.map(origin => getWorldBounds(state, origin.id))
  const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y))
  return { x, y, width: Math.max(...bounds.map(b => b.x + b.width)) - x, height: Math.max(...bounds.map(b => b.y + b.height)) - y, rotation: 0 }
}

export function selectionBounds(state: SceneSnapshot, ids: readonly string[]): Bounds | null {
  const roots = selectionRoots(state, ids)
  if (!roots.length) return null
  const bounds = roots.map(id => getWorldBounds(state, id))
  const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y))
  return { x, y, width: Math.max(...bounds.map(b => b.x + b.width)) - x, height: Math.max(...bounds.map(b => b.y + b.height)) - y }
}

function placeCenter(origin: TransformOrigin, world: Point, width = origin.width, height = origin.height): ElementGeometry {
  const [a, b, c, d, e, f] = origin.parentMatrix
  const det = a * d - b * c
  const x = world.x - e, y = world.y - f
  return { x: (d * x - c * y) / det - width / 2, y: (-b * x + a * y) / det - height / 2, width, height, rotation: origin.rotation }
}

export function moveGeometry(origin: TransformOrigin, delta: Point): ElementGeometry {
  return placeCenter(origin, { x: origin.center.x + delta.x, y: origin.center.y + delta.y })
}

/** Resize in the selection's axes while keeping the opposite handle stationary. */
export function resizedBox(box: SelectionBox, handle: ResizeHandle, worldDelta: Point, proportional: boolean): SelectionBox {
  const delta = rotateVector(worldDelta, -box.rotation)
  let width = Math.max(1, box.width + (handle.includes('e') ? delta.x : handle.includes('w') ? -delta.x : 0))
  let height = Math.max(1, box.height + (handle.includes('s') ? delta.y : handle.includes('n') ? -delta.y : 0))
  if (proportional) {
    const sx = width / box.width, sy = height / box.height
    const scale = handle === 'n' || handle === 's' ? sy : handle === 'e' || handle === 'w' ? sx : Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy
    width = Math.max(1 / box.width, 1 / box.height, scale) * box.width
    height = width / box.width * box.height
  }
  const offset = rotateVector({ x: (width - box.width) * (handle.includes('w') ? -.5 : handle.includes('e') ? .5 : 0), y: (height - box.height) * (handle.includes('n') ? -.5 : handle.includes('s') ? .5 : 0) }, box.rotation)
  return { x: box.x + box.width / 2 + offset.x - width / 2, y: box.y + box.height / 2 + offset.y - height / 2, width, height, rotation: box.rotation }
}

export function resizeGeometry(origin: TransformOrigin, before: SelectionBox, after: SelectionBox): ElementGeometry {
  const sx = after.width / before.width, sy = after.height / before.height
  const relative = rotateVector({ x: origin.center.x - before.x - before.width / 2, y: origin.center.y - before.y - before.height / 2 }, -before.rotation)
  const offset = rotateVector({ x: relative.x * sx, y: relative.y * sy }, before.rotation)
  const angle = (origin.worldRotation - before.rotation) * Math.PI / 180
  const width = Math.max(.01, origin.width * Math.hypot(sx * Math.cos(angle), sy * Math.sin(angle)))
  const height = Math.max(.01, origin.height * Math.hypot(sx * Math.sin(angle), sy * Math.cos(angle)))
  return placeCenter(origin, { x: after.x + after.width / 2 + offset.x, y: after.y + after.height / 2 + offset.y }, width, height)
}

export function rotateGeometry(origin: TransformOrigin, center: Point, degrees: number): ElementGeometry {
  const offset = rotateVector({ x: origin.center.x - center.x, y: origin.center.y - center.y }, degrees)
  return { ...placeCenter(origin, { x: center.x + offset.x, y: center.y + offset.y }), rotation: ((origin.rotation + degrees) % 360 + 360) % 360 }
}
