import type { Point } from '../canvas/types.ts'
import { getWorldMatrix } from './geometry.ts'
import { parsePath } from './pathGeometry.ts'
import type { SceneElement, SceneSnapshot } from './types.ts'

export interface SnapVertex extends Point { readonly label: string }
const localVertices = new WeakMap<SceneElement, readonly Point[]>()

function vertices(node: SceneElement): readonly Point[] {
  const cached = localVertices.get(node)
  if (cached) return cached
  let points: readonly Point[] = []
  if (node.type === 'path') {
    try {
      points = (node.nodes ?? parsePath(node.d)).flatMap(c => c.anchors.map(a => ({
        x: (a.x - node.viewBox[0]) * node.width / node.viewBox[2],
        y: (a.y - node.viewBox[1]) * node.height / node.viewBox[3],
      })))
    } catch { /* Legacy SVG that cannot be edited must not interrupt drawing. */ }
  } else if (node.type === 'frame') {
    points = [{ x: 0, y: 0 }, { x: node.width, y: 0 }, { x: node.width, y: node.height }, { x: 0, y: node.height }]
  } else if (node.type === 'rectangle' || node.type === 'ellipse') {
    const inset = Math.min((node.style.stroke?.width ?? 0) / 2, node.width / 2, node.height / 2)
    const right = node.width - inset, bottom = node.height - inset
    if (node.type === 'ellipse') points = [{ x: node.width / 2, y: inset }, { x: right, y: node.height / 2 }, { x: node.width / 2, y: bottom }, { x: inset, y: node.height / 2 }]
    else {
      const rx = Math.min(node.cornerRadius, (right - inset) / 2), ry = Math.min(node.cornerRadius, (bottom - inset) / 2)
      points = [{ x: inset + rx, y: inset }, { x: right - rx, y: inset }, { x: right, y: inset + ry }, { x: right, y: bottom - ry }, { x: right - rx, y: bottom }, { x: inset + rx, y: bottom }, { x: inset, y: bottom - ry }, { x: inset, y: inset + ry }]
    }
  }
  localVertices.set(node, points)
  return points
}

/** Sorted world vertices: pointer queries only visit the narrow snap interval. */
export class VertexIndex {
  private readonly points: readonly SnapVertex[]
  constructor(points: readonly SnapVertex[]) { this.points = [...points].sort((a, b) => a.x - b.x) }

  nearest(point: Point, zoom: number, radius = 8): SnapVertex | null {
    const tolerance = radius / Math.max(zoom, .001)
    let lo = 0, hi = this.points.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.points[mid].x < point.x - tolerance) lo = mid + 1
      else hi = mid
    }
    let best: SnapVertex | null = null, distance = tolerance ** 2
    for (let i = lo; i < this.points.length && this.points[i].x <= point.x + tolerance; i++) {
      const candidate = this.points[i], d = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2
      if (d <= distance) { distance = d; best = candidate }
    }
    return best
  }
}

/** Resolve ancestor visibility and transforms once, outside the pointer loop. */
export function sceneVertexIndex(state: Pick<SceneSnapshot, 'elements'>, excludeId: string | null): VertexIndex {
  const points: SnapVertex[] = [], available = new Map<string, boolean>()
  const isAvailable = (node: SceneElement): boolean => {
    const cached = available.get(node.id)
    if (cached !== undefined) return cached
    const value = node.visible && !node.locked && (!node.parentId || !!state.elements[node.parentId] && isAvailable(state.elements[node.parentId]))
    available.set(node.id, value)
    return value
  }
  for (const node of Object.values(state.elements)) {
    if (node.id === excludeId || !isAvailable(node)) continue
    const local = vertices(node)
    if (!local.length) continue
    const [a, b, c, d, e, f] = getWorldMatrix(state, node.id)
    for (const p of local) points.push({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f, label: node.name })
  }
  return new VertexIndex(points)
}
