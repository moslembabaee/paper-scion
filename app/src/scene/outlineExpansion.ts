import type { Point, Bounds } from '../canvas/types.ts'
import { parsePath, pathBounds, serializePath } from './pathGeometry.ts'
import type { PathContour } from './pathGeometry.ts'
import type { PathElement, VectorElement } from './types.ts'
import { vectorToContours } from './booleanGeometry.ts'
import { createElement } from './elements.ts'

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
  const cap = options.lineCap ?? 'round'
  const join = options.lineJoin ?? 'round'
  const miterLimit = options.miterLimit ?? 4
  const prec = options.precision ?? 4

  let offsetLeft = width / 2
  let offsetRight = width / 2
  if (options.offsetMode === 'outside') {
    offsetLeft = width
    offsetRight = 0
  } else if (options.offsetMode === 'inside') {
    offsetLeft = 0
    offsetRight = width
  }

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
    let startLeft = point(firstSeg.p0.x + offsetLeft * firstSeg.normal.x, firstSeg.p0.y + offsetLeft * firstSeg.normal.y)
    let startRight = point(firstSeg.p0.x - offsetRight * firstSeg.normal.x, firstSeg.p0.y - offsetRight * firstSeg.normal.y)

    if (cap === 'square') {
      const extLen = (offsetLeft + offsetRight) / 2
      const ext = { x: -firstSeg.tangent.x * extLen, y: -firstSeg.tangent.y * extLen }
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

      const n0L = s0.normal
      const n1L = s1.normal
      const cross = s0.tangent.x * s1.tangent.y - s0.tangent.y * s1.tangent.x
      const dot = n0L.x * n1L.x + n0L.y * n1L.y

      const p0L = point(pt.x + offsetLeft * n0L.x, pt.y + offsetLeft * n0L.y)
      const p1L = point(pt.x + offsetLeft * n1L.x, pt.y + offsetLeft * n1L.y)
      const p0R = point(pt.x - offsetRight * n0L.x, pt.y - offsetRight * n0L.y)
      const p1R = point(pt.x - offsetRight * n1L.x, pt.y - offsetRight * n1L.y)

      if (cross > 0) {
        // Turning left: Left side is inside/concave, Right side is outside/convex
        leftPoints.push(p0L, p1L)
        if (offsetRight < 1e-4) {
          rightPoints.push(pt)
        } else if (join === 'miter' && 1 + dot > 1e-4) {
          const scale = 2 / (1 + dot)
          const miterDist = offsetRight * Math.sqrt(scale)
          if (miterDist <= miterLimit * width) {
            const miterPt = point(
              pt.x - offsetRight * (n0L.x + n1L.x) * 0.5 * scale,
              pt.y - offsetRight * (n0L.y + n1L.y) * 0.5 * scale
            )
            rightPoints.push(miterPt)
          } else {
            rightPoints.push(p0R, p1R)
          }
        } else if (join === 'round' && offsetRight > 0.1) {
          const a0 = Math.atan2(-n0L.y, -n0L.x)
          let a1 = Math.atan2(-n1L.y, -n1L.x)
          while (a1 < a0) a1 += Math.PI * 2
          const steps = Math.max(2, Math.min(6, Math.ceil((a1 - a0) / (Math.PI / 4))))
          for (let s = 0; s <= steps; s++) {
            const angle = a0 + (a1 - a0) * (s / steps)
            rightPoints.push(point(pt.x + offsetRight * Math.cos(angle), pt.y + offsetRight * Math.sin(angle)))
          }
        } else {
          rightPoints.push(p0R, p1R)
        }
      } else {
        // Turning right: Left side is outside/convex, Right side is inside/concave
        rightPoints.push(p0R, p1R)
        if (offsetLeft < 1e-4) {
          leftPoints.push(pt)
        } else if (join === 'miter' && 1 + dot > 1e-4) {
          const scale = 2 / (1 + dot)
          const miterDist = offsetLeft * Math.sqrt(scale)
          if (miterDist <= miterLimit * width) {
            const miterPt = point(
              pt.x + offsetLeft * (n0L.x + n1L.x) * 0.5 * scale,
              pt.y + offsetLeft * (n0L.y + n1L.y) * 0.5 * scale
            )
            leftPoints.push(miterPt)
          } else {
            leftPoints.push(p0L, p1L)
          }
        } else if (join === 'round' && offsetLeft > 0.1) {
          const a0 = Math.atan2(n0L.y, n0L.x)
          let a1 = Math.atan2(n1L.y, n1L.x)
          while (a1 < a0) a1 += Math.PI * 2
          const steps = Math.max(2, Math.min(6, Math.ceil((a1 - a0) / (Math.PI / 4))))
          for (let s = 0; s <= steps; s++) {
            const angle = a0 + (a1 - a0) * (s / steps)
            leftPoints.push(point(pt.x + offsetLeft * Math.cos(angle), pt.y + offsetLeft * Math.sin(angle)))
          }
        } else {
          leftPoints.push(p0L, p1L)
        }
      }
    }

    // End point offsets
    const lastSeg = segments[segments.length - 1]
    let endLeft = point(lastSeg.p1.x + offsetLeft * lastSeg.normal.x, lastSeg.p1.y + offsetLeft * lastSeg.normal.y)
    let endRight = point(lastSeg.p1.x - offsetRight * lastSeg.normal.x, lastSeg.p1.y - offsetRight * lastSeg.normal.y)

    if (cap === 'square') {
      const extLen = (offsetLeft + offsetRight) / 2
      const ext = { x: lastSeg.tangent.x * extLen, y: lastSeg.tangent.y * extLen }
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
    const capRadius = (offsetLeft + offsetRight) / 2
    if (cap === 'round' && capRadius > 0.1) {
      d += ` A ${format(capRadius, prec)} ${format(capRadius, prec)} 0 0 0 ${pair(rightPoints[rightPoints.length - 1], prec)}`
    } else {
      d += ` L ${pair(rightPoints[rightPoints.length - 1], prec)}`
    }

    // Right points in reverse
    for (let i = rightPoints.length - 2; i >= 0; i--) {
      d += ` L ${pair(rightPoints[i], prec)}`
    }

    // Start cap
    if (cap === 'round' && capRadius > 0.1) {
      d += ` A ${format(capRadius, prec)} ${format(capRadius, prec)} 0 0 0 ${pair(leftPoints[0], prec)}`
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
      const pOuter = point(seg.p0.x + offsetLeft * seg.normal.x, seg.p0.y + offsetLeft * seg.normal.y)
      outerPoints.push(pOuter)

      if (offsetRight > 1e-4) {
        const pInner = point(seg.p0.x - offsetRight * seg.normal.x, seg.p0.y - offsetRight * seg.normal.y)
        innerPoints.push(pInner)
      }
    }

    // Outer contour
    let d = `M ${pair(outerPoints[0], prec)}`
    for (let i = 1; i < outerPoints.length; i++) {
      d += ` L ${pair(outerPoints[i], prec)}`
    }
    d += ' Z'

    // Inner contour (in reverse to maintain opposite winding for nonzero fill rule)
    if (innerPoints.length > 2 && offsetRight > 1e-4) {
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
  const bounds = pathBounds(parsedExpanded, 0)
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

/**
 * Expands any vector element (path, rectangle, ellipse) with a stroke into an outline PathElement.
 */
export function expandVectorOutline(
  node: VectorElement,
  options?: Partial<OutlineExpansionOptions>
): PathElement {
  const strokeWidth = options?.strokeWidth ?? node.style.stroke?.width ?? 2
  const opts: OutlineExpansionOptions = {
    strokeWidth,
    lineCap: options?.lineCap ?? 'round',
    lineJoin: options?.lineJoin ?? 'round',
    miterLimit: options?.miterLimit ?? 4,
    offsetMode: options?.offsetMode ?? 'center',
    precision: options?.precision ?? 4,
    ...options,
  }

  let d: string
  let localViewBox: readonly [number, number, number, number]
  if (node.type === 'path') {
    d = node.d
    localViewBox = node.viewBox
  } else {
    const contours = vectorToContours(node)
    d = serializePath(contours)
    localViewBox = [0, 0, node.width, node.height]
  }

  const expanded = expandPathOutline(d, opts)
  const fillColor = node.style.stroke?.color ?? node.style.fill ?? '#81adec'

  // Map local expanded viewBox back to scene element bounds
  const [vx, vy, vw, vh] = localViewBox
  const sx = vw > 0 ? node.width / vw : 1
  const sy = vh > 0 ? node.height / vh : 1
  const width = Math.max(0.01, expanded.bounds.width * sx)
  const height = Math.max(0.01, expanded.bounds.height * sy)
  const dx = (expanded.bounds.x - vx) * sx
  const dy = (expanded.bounds.y - vy) * sy

  return createElement('path', {
    id: crypto.randomUUID(),
    name: `${node.name} Outline`,
    parentId: node.parentId,
    x: node.x + dx,
    y: node.y + dy,
    width,
    height,
    rotation: node.rotation,
    d: expanded.d,
    viewBox: expanded.viewBox,
    fillRule: 'nonzero',
    style: {
      ...node.style,
      fill: fillColor,
      stroke: null,
    },
  })
}
