import type { Bounds, Point } from '../canvas/types.ts'
import { frameMask, maskContainsWorldPoint, shapeContainsWorldPoint } from './maskGeometry.ts'
import type { SceneSnapshot } from './types.ts'

export interface DistanceGuide {
  axis: 'horizontal' | 'vertical'
  start: Point
  end: Point
  /** Edge points that project onto the dimension line. */
  startEdge: Point
  endEdge: Point
  distance: number
}

/** Measure gaps for separated boxes, and corresponding edges for overlapping/contained boxes. */
export function measureBounds(selected: Bounds, target: Bounds): DistanceGuide[] {
  const guides: DistanceGuide[] = []
  for (const axis of ['horizontal', 'vertical'] as const) {
    const horizontal = axis === 'horizontal'
    const coordinate = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x'
    const dimension = horizontal ? 'width' : 'height', crossDimension = horizontal ? 'height' : 'width'
    const a = selected[coordinate], b = a + selected[dimension]
    const c = target[coordinate], d = c + target[dimension]
    const overlapStart = Math.max(selected[cross], target[cross])
    const overlapEnd = Math.min(selected[cross] + selected[crossDimension], target[cross] + target[crossDimension])
    const line = overlapStart <= overlapEnd ? (overlapStart + overlapEnd) / 2 : selected[cross] + selected[crossDimension] / 2
    const point = (along: number, across: number): Point => horizontal ? { x: along, y: across } : { x: across, y: along }
    const edge = (box: Bounds) => Math.max(box[cross], Math.min(box[cross] + box[crossDimension], line))
    const pairs = b <= c ? [[b, c]] : d <= a ? [[a, d]] : [[a, c], [b, d]]
    pairs.forEach(([from, to], index) => {
      // Offset the two inset dimensions so equal-sized nested layers remain readable.
      const across = pairs.length === 2 ? line + (index ? 1 : -1) * Math.min(16, selected[crossDimension] / 4, target[crossDimension] / 4) : line
      guides.push({ axis, start: point(from, across), end: point(to, across), startEdge: point(from, edge(selected)), endEdge: point(to, edge(target)), distance: Math.abs(to - from) })
    })
  }
  return guides
}

/** Hit-test in paint order, including locked layers, rotated frames and clip boundaries. */
export function measurementHit(state: SceneSnapshot, point: Point, selectable = false): string | null {
  const visit = (ids: readonly string[], inheritedLocked = false): string | null => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const node = state.elements[ids[i]]
      const locked = inheritedLocked || node.locked
      if (!node.visible || (selectable && locked)) continue
      const inside = shapeContainsWorldPoint(state, node, point)
      const mask = node.type === 'frame' ? frameMask(state.elements, node) : undefined
      const inMask = !mask || maskContainsWorldPoint(state, mask, point)
      if (node.type === 'frame' && (inside || !node.clipContent)) {
        const child = inMask ? visit(node.children.filter(id => id !== mask?.id), locked) : null
        if (child) return child
      }
      if (inside && (inMask || node.style.fill || node.style.shader || node.style.stroke)) return node.id
    }
    return null
  }
  return visit(state.rootIds)
}

export function isWithinSelection(state: SceneSnapshot, id: string): boolean {
  const selected = new Set(state.selection)
  let node = state.elements[id]
  while (node) {
    if (selected.has(node.id)) return true
    if (node.parentId === null) break
    node = state.elements[node.parentId]
  }
  return false
}
