import type { Point } from '../canvas/types.ts'
import { parsePath, type PathContour } from './pathGeometry.ts'

export interface OptimizeOptions {
  /** Maximum deviation in path units; real cubic boundaries are preserved. */
  tolerance?: number
  precision?: number
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
function onSegment(p: Point, a: Point, b: Point, tolerance: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return distance(p, a) <= tolerance
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy }) <= tolerance
}

/** Linear passes remove redundant anchors without touching winding or open endpoints. */
export function optimizeContours(contours: readonly PathContour[], options: OptimizeOptions = {}): PathContour[] {
  const tolerance = options.tolerance ?? 1e-7
  return contours.map(({ anchors: original, closed }) => {
    const anchors = original.map(a => ({ ...a, in: a.in && { ...a.in }, out: a.out && { ...a.out } }))
    for (let i = 0; i < anchors.length - (closed ? 0 : 1); i++) {
      const a = anchors[i], b = anchors[(i + 1) % anchors.length]
      if (onSegment(a.out ?? a, a, b, tolerance) && onSegment(b.in ?? b, a, b, tolerance)) {
        a.out = undefined
        b.in = undefined
      }
    }
    const kept: typeof anchors = []
    for (const anchor of anchors) {
      const previous = kept.at(-1)
      if (previous && !previous.out && !anchor.in && distance(previous, anchor) <= tolerance) {
        previous.out = anchor.out
        continue
      }
      while (kept.length >= 2) {
        const a = kept[kept.length - 2], b = kept[kept.length - 1]
        if (a.out || b.in || b.out || anchor.in || !onSegment(b, a, anchor, tolerance)) break
        kept.pop()
      }
      kept.push(anchor)
    }
    // Only the seam needs another pass after simplifying the interior.
    if (closed) {
      while (kept.length > 2) {
        const a = kept.at(-2)!, b = kept.at(-1)!, c = kept[0]
        if (a.out || b.in || b.out || c.in || !onSegment(b, a, c, tolerance)) break
        kept.pop()
      }
      if (kept.length > 2) {
        const a = kept.at(-1)!, b = kept[0], c = kept[1]
        if (!a.out && !b.in && !b.out && !c.in && onSegment(b, a, c, tolerance)) kept.shift()
      }
    }
    return { anchors: kept, closed }
  }).filter(contour => contour.anchors.length > 0)
}

/** Compact SVG commands, retaining cubics instead of polygonizing curved outlines. */
export function optimizeSvgBezierData(d: string, options: OptimizeOptions = {}): string {
  const tolerance = options.tolerance ?? 1e-7, precision = options.precision ?? 8
  if (!Number.isFinite(tolerance) || tolerance < 0 || !Number.isInteger(precision) || precision < 0 || precision > 12) throw new Error('Invalid path optimization options')
  const format = (n: number) => String(Number(n.toFixed(precision)))
  const pair = (p: Point) => `${format(p.x)} ${format(p.y)}`
  return optimizeContours(parsePath(d), options).map(({ anchors, closed }) => {
    let result = `M ${pair(anchors[0])}`
    for (let i = 0; i < anchors.length - (closed ? 0 : 1); i++) {
      const a = anchors[i], b = anchors[(i + 1) % anchors.length]
      if (a.out || b.in) result += ` C ${pair(a.out ?? a)} ${pair(b.in ?? b)} ${pair(b)}`
      else if (closed && i === anchors.length - 1) continue // Z closes a straight seam.
      else if (format(a.y) === format(b.y)) result += ` H ${format(b.x)}`
      else if (format(a.x) === format(b.x)) result += ` V ${format(b.y)}`
      else result += ` L ${pair(b)}`
    }
    return result + (closed ? ' Z' : '')
  }).join(' ')
}
