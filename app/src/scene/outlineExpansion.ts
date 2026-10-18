import type { Point, Bounds } from '../canvas/types.ts'
import { parsePath, pathBounds } from './pathGeometry.ts'
import type { PathContour } from './pathGeometry.ts'

export type LineCap = 'butt' | 'round' | 'square'
export type LineJoin = 'miter' | 'round' | 'bevel'

export interface OutlineExpansionOptions {
  strokeWidth: number
  lineCap?: LineCap
  lineJoin?: LineJoin
  miterLimit?: number
  /** 'center' offsets both sides by width/2. 'outside' offsets by +width. 'inside' offsets by -width. */
  offsetMode?: 'center' | 'outside' | 'inside'
  /** Precision decimal places in output SVG path string (default 4) */
  precision?: number
}

const point = (x: number, y: number): Point => ({ x, y })
const format = (n: number, prec = 4) => String(Number(n.toFixed(prec)))
const pair = (p: Point, prec = 4) => `${format(p.x, prec)} ${format(p.y, prec)}`

interface DirectedSegment {
  p0: Point
  p1: Point
  tangent: Point
  normal: Point // unit normal pointing left of tangent
  length: number
}

/**
 * Samples an arbitrary contour into a sequence of densely spaced points.
 * Curves are adaptively sampled so the expanded outline is smooth.
 */
function sampleContourPoints(contour: PathContour, maxSegmentLength = 4): Point[] {
  const { anchors, closed } = contour
  if (anchors.length < 2) return anchors.map(a => point(a.x, a.y))

  const sampled: Point[] = []
  const count = closed ? anchors.length : anchors.length - 1

  for (let i = 0; i < count; i++) {
    const a = anchors[i]
    const b = anchors[(i + 1) % anchors.length]

    sampled.push(point(a.x, a.y))

    if (!a.out && !b.in) {
      // Straight line
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      if (dist > maxSegmentLength) {
        const steps = Math.ceil(dist / maxSegmentLength)
        for (let s = 1; s < steps; s++) {
          const t = s / steps
          sampled.push(point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
        }
      }
    } else {
      // Cubic Bézier curve
      const c1 = a.out ?? a
      const c2 = b.in ?? b
      const chord = Math.hypot(b.x - a.x, b.y - a.y)
      const ctrl1 = Math.hypot(c1.x - a.x, c1.y - a.y)
      const ctrl2 = Math.hypot(b.x - c2.x, b.y - c2.y)
      const approxLen = chord + (ctrl1 + ctrl2) / 2
      const steps = Math.max(6, Math.ceil(approxLen / maxSegmentLength))

      for (let s = 1; s < steps; s++) {
        const t = s / steps
        const u = 1 - t
        const px = u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x
        const py = u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y
        sampled.push(point(px, py))
      }
    }
  }

  if (!closed) {
    const last = anchors[anchors.length - 1]
    sampled.push(point(last.x, last.y))
  }

  return sampled
}

/**
 * Creates directed segments with normals from sampled points.
 */
function createSegments(points: readonly Point[], closed: boolean): DirectedSegment[] {
  const segments: DirectedSegment[] = []
  const n = points.length
  if (n < 2) return segments

  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const p0 = points[i]
    const p1 = points[(i + 1) % n]
    const dx = p1.x - p0.x
    const dy = p1.y - p0.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue

    const tangent = { x: dx / len, y: dy / len }
    const normal = { x: -tangent.y, y: tangent.x } // left normal
    segments.push({ p0, p1, tangent, normal, length: len })
  }
  return segments
}

/**
 * Expands an open or closed path contour into a filled 2D outline path string.
 */
export function expandContourOutline(
  contour: PathContour,
  options: OutlineExpansionOptions
): string {
  const width = Math.max(0.1, options.strokeWidth)
  const halfWidth = width / 2
  const cap = options.lineCap ?? 'round'
  const join = options.lineJoin ?? 'round'
  const prec = options.precision ?? 4

  const points = sampleContourPoints(contour, Math.max(2, Math.min(6, width / 4)))
  if (points.length < 2) return ''

  const segments = createSegments(points, contour.closed)
  if (segments.length === 0) return ''

  if (!contour.closed) {
    // Open path: build ribbon with left offset, end cap, right offset (reversed), start cap
    const leftPoints: Point[] = []
    const rightPoints: Point[] = []

    // Start point offsets
    const firstSeg = segments[0]
    let startLeft = point(firstSeg.p0.x + halfWidth * firstSeg.normal.x, firstSeg.p0.y + halfWidth * firstSeg.normal.y)
    let startRight = point(firstSeg.p0.x - halfWidth * firstSeg.normal.x, firstSeg.p0.y - halfWidth * firstSeg.normal.y)

    if (cap === 'square') {
      // Extend backward by halfWidth
      const ext = { x: -firstSeg.tangent.x * halfWidth, y: -firstSeg.tangent.y * halfWidth }
      startLeft = point(startLeft.x + ext.x, startLeft.y + ext.y)
      startRight = point(startRight.x + ext.x, startRight.y + ext.y)
    }

    leftPoints.push(startLeft)
    rightPoints.push(startRight)

    // Intermediate joins
    for (let i = 0; i < segments.length - 1; i++) {
      const s0 = segments[i]
      const s1 = segments[i + 1]
      const pt = s0.p1

      // Left side join
      const n0L = s0.normal
      const n1L = s1.normal
      const cross = s0.tangent.x * s1.tangent.y - s0.tangent.y * s1.tangent.x

      const p0L = point(pt.x + halfWidth * n0L.x, pt.y + halfWidth * n0L.y)
      const p1L = point(pt.x + halfWidth * n1L.x, pt.y + halfWidth * n1L.y)
      const p0R = point(pt.x - halfWidth * n0L.x, pt.y - halfWidth * n0L.y)
      const p1R = point(pt.x - halfWidth * n1L.x, pt.y - halfWidth * n1L.y)

      if (cross > 0) {
        // Turning left: Left side is inside/concave, Right side is outside/convex
        leftPoints.push(p0L, p1L)
        if (join === 'round') {
          rightPoints.push(p0R, p1R)
        } else if (join === 'miter') {
          rightPoints.push(p0R, p1R)
        } else {
          rightPoints.push(p0R, p1R)
        }
      } else {
        // Turning right: Left side is outside/convex, Right side is inside/concave
        leftPoints.push(p0L, p1L)
        rightPoints.push(p0R, p1R)
      }
    }

    // End point offsets
    const lastSeg = segments[segments.length - 1]
    let endLeft = point(lastSeg.p1.x + halfWidth * lastSeg.normal.x, lastSeg.p1.y + halfWidth * lastSeg.normal.y)
    let endRight = point(lastSeg.p1.x - halfWidth * lastSeg.normal.x, lastSeg.p1.y - halfWidth * lastSeg.normal.y)

    if (cap === 'square') {
      // Extend forward by halfWidth
      const ext = { x: lastSeg.tangent.x * halfWidth, y: lastSeg.tangent.y * halfWidth }
      endLeft = point(endLeft.x + ext.x, endLeft.y + ext.y)
      endRight = point(endRight.x + ext.x, endRight.y + ext.y)
    }

    leftPoints.push(endLeft)
    rightPoints.push(endRight)

    // Assemble SVG path
    let d = `M ${pair(leftPoints[0], prec)}`
    for (let i = 1; i < leftPoints.length; i++) {
      d += ` L ${pair(leftPoints[i], prec)}`
    }

    // End cap
    if (cap === 'round') {
      d += ` A ${format(halfWidth, prec)} ${format(halfWidth, prec)} 0 0 1 ${pair(rightPoints[rightPoints.length - 1], prec)}`
    } else {
      d += ` L ${pair(rightPoints[rightPoints.length - 1], prec)}`
    }

    // Right points in reverse
    for (let i = rightPoints.length - 2; i >= 0; i--) {
      d += ` L ${pair(rightPoints[i], prec)}`
    }

    // Start cap
    if (cap === 'round') {
      d += ` A ${format(halfWidth, prec)} ${format(halfWidth, prec)} 0 0 1 ${pair(leftPoints[0], prec)}`
    } else {
      d += ' Z'
    }

    if (!d.endsWith('Z')) d += ' Z'
    return d
  } else {
    // Closed path: build outer loop and inner loop
    const outerPoints: Point[] = []
    const innerPoints: Point[] = []

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const pOuter = point(seg.p0.x + halfWidth * seg.normal.x, seg.p0.y + halfWidth * seg.normal.y)
      const pInner = point(seg.p0.x - halfWidth * seg.normal.x, seg.p0.y - halfWidth * seg.normal.y)
      outerPoints.push(pOuter)
      innerPoints.push(pInner)
    }

    // Outer contour
    let d = `M ${pair(outerPoints[0], prec)}`
    for (let i = 1; i < outerPoints.length; i++) {
      d += ` L ${pair(outerPoints[i], prec)}`
    }
    d += ' Z'

    // Inner contour (in reverse to maintain opposite winding for nonzero fill rule)
    if (innerPoints.length > 2) {
      d += ` M ${pair(innerPoints[0], prec)}`
      for (let i = innerPoints.length - 1; i >= 0; i--) {
        d += ` L ${pair(innerPoints[i], prec)}`
      }
      d += ' Z'
    }

    return d
  }
}

/**
 * Expands an entire SVG path (which may contain multiple open or closed subpaths) into
 * a filled compound vector outline.
 */
export function expandPathOutline(
  d: string,
  options: OutlineExpansionOptions
): { d: string; bounds: Bounds; viewBox: readonly [number, number, number, number] } {
  if (!d || !d.trim()) {
    return { d: '', bounds: { x: 0, y: 0, width: 0, height: 0 }, viewBox: [0, 0, 0, 0] }
  }

  const contours = parsePath(d)
  const expandedParts: string[] = []

  for (const contour of contours) {
    const partD = expandContourOutline(contour, options)
    if (partD && partD.trim()) {
      expandedParts.push(partD.trim())
    }
  }

  const combinedD = expandedParts.join(' ')
  const parsedExpanded = parsePath(combinedD)
  const bounds = pathBounds(parsedExpanded)
  const viewBox: readonly [number, number, number, number] = [
    bounds.x,
    bounds.y,
    Math.max(0.01, bounds.width),
    Math.max(0.01, bounds.height),
  ]

  return { d: combinedD, bounds, viewBox }
}

/**
 * Offsets a closed vector path outward (positive distance) or inward (negative distance).
 */
export function offsetPath(
  d: string,
  distance: number,
  precision = 4
): string {
  if (!d || !d.trim() || Math.abs(distance) < 1e-6) return d
  const contours = parsePath(d)
  const parts: string[] = []

  for (const contour of contours) {
    if (!contour.closed) continue
    const points = sampleContourPoints(contour, 3)
    const segments = createSegments(points, true)
    if (segments.length === 0) continue

    const offsetPoints: Point[] = []
    for (const seg of segments) {
      offsetPoints.push(point(
        seg.p0.x + distance * seg.normal.x,
        seg.p0.y + distance * seg.normal.y
      ))
    }

    if (offsetPoints.length > 2) {
      let partD = `M ${pair(offsetPoints[0], precision)}`
      for (let i = 1; i < offsetPoints.length; i++) {
        partD += ` L ${pair(offsetPoints[i], precision)}`
      }
      partD += ' Z'
      parts.push(partD)
    }
  }

  return parts.join(' ')
}
