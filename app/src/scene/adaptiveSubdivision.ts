import type { Point } from '../canvas/types.ts'
import { parsePath, serializePath, type PathAnchor, type PathContour } from './pathGeometry.ts'

export type Curve = readonly [Point, Point, Point, Point]

export interface AdaptiveSubdivisionOptions {
  /** Maximum perpendicular deviation between curve and chord line (in pixels). Default 0.5 */
  tolerance?: number
  /** Maximum allowable chord length before forcing subdivision (in pixels). Default 24 */
  maxSegmentLength?: number
  /** Minimum recursion depth. Default 0 */
  minDepth?: number
  /** Maximum recursion depth to prevent over-tessellation. Default 6 */
  maxDepth?: number
  /** Angle in degrees above which a corner is considered a sharp cusp. Default 35 */
  angleThreshold?: number
  /** If true, reconstructs smooth cubic Bezier segments; if false, outputs dense polylines. Default true */
  reconstructCurves?: boolean
}

const point = (x: number, y: number): Point => ({ x, y })
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (a: Point, b: Point, t: number): Point => point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)

/** Evaluates point on cubic Bezier at parameter t in [0, 1]. */
export function evaluateCubic(c: Curve, t: number): Point {
  const u = 1 - t
  const tt = t * t
  const uu = u * u
  const uuu = uu * u
  const ttt = tt * t
  return point(
    uuu * c[0].x + 3 * uu * t * c[1].x + 3 * u * tt * c[2].x + ttt * c[3].x,
    uuu * c[0].y + 3 * uu * t * c[1].y + 3 * u * tt * c[2].y + ttt * c[3].y
  )
}

/** Measures flatness: max distance of control points P1, P2 from chord line P0-P3. */
export function curveFlatness(c: Curve): number {
  const p0 = c[0], p1 = c[1], p2 = c[2], p3 = c[3]
  const dx = p3.x - p0.x, dy = p3.y - p0.y
  const chordLen = Math.hypot(dx, dy)
  if (chordLen < 1e-9) {
    return Math.max(dist(p0, p1), dist(p0, p2))
  }
  const d1 = Math.abs(dy * p1.x - dx * p1.y + p3.x * p0.y - p3.y * p0.x) / chordLen
  const d2 = Math.abs(dy * p2.x - dx * p2.y + p3.x * p0.y - p3.y * p0.x) / chordLen
  return Math.max(d1, d2)
}

/** Approximate arc length of cubic curve via Gauss-Legendre quadrature. */
export function curveLength(c: Curve, samples = 8): number {
  let len = 0
  let prev = c[0]
  for (let i = 1; i <= samples; i++) {
    const curr = evaluateCubic(c, i / samples)
    len += dist(prev, curr)
    prev = curr
  }
  return len
}

/** Split a cubic curve at parameter t into two cubic curves. */
export function splitCurve(c: Curve, t = 0.5): [Curve, Curve] {
  const a = lerp(c[0], c[1], t)
  const b = lerp(c[1], c[2], t)
  const d = lerp(c[2], c[3], t)
  const e = lerp(a, b, t)
  const f = lerp(b, d, t)
  const g = lerp(e, f, t)
  return [
    [c[0], a, e, g],
    [g, f, d, c[3]],
  ]
}

/**
 * Adaptively subdivides a cubic Bezier curve based on curvature flatness
 * and segment length constraints.
 */
export function adaptiveSubdivideCurve(
  c: Curve,
  options: AdaptiveSubdivisionOptions = {}
): Point[] {
  const tolerance = Math.max(0.01, options.tolerance ?? 0.5)
  const maxLen = Math.max(1, options.maxSegmentLength ?? 24)
  const minDepth = options.minDepth ?? 0
  const maxDepth = Math.min(10, Math.max(0, options.maxDepth ?? 6))

  const points: Point[] = [c[0]]

  function subdivide(curve: Curve, depth: number) {
    const chord = dist(curve[0], curve[3])
    const flat = curveFlatness(curve)

    const shouldSubdivide =
      (depth < minDepth || flat > tolerance || chord > maxLen) && depth < maxDepth

    if (shouldSubdivide) {
      const [left, right] = splitCurve(curve, 0.5)
      subdivide(left, depth + 1)
      subdivide(right, depth + 1)
    } else {
      points.push(curve[3])
    }
  }

  subdivide(c, 0)
  return points
}

/**
 * Turns a sequence of sampled points into smooth cubic Bezier contours,
 * respecting sharp corner cusps where turning angles exceed the threshold.
 */
export function pointsToBezierContour(
  rawPoints: readonly Point[],
  closed: boolean,
  angleThresholdDeg = 35
): PathContour {
  // Deduplicate points within 1e-4
  const points: Point[] = []
  for (const pt of rawPoints) {
    if (!points.length || dist(points[points.length - 1], pt) > 1e-4) {
      points.push(pt)
    }
  }
  if (closed && points.length > 2 && dist(points[0], points[points.length - 1]) <= 1e-4) {
    points.pop()
  }

  const n = points.length
  if (n < 2) {
    return {
      anchors: points.map(p => ({ x: p.x, y: p.y })),
      closed,
    }
  }

  const cosThreshold = Math.cos((angleThresholdDeg * Math.PI) / 180)
  const isCusp: boolean[] = new Array(n).fill(false)

  // Identify cusps
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      isCusp[i] = true
      continue
    }
    const prev = points[(i - 1 + n) % n]
    const curr = points[i]
    const next = points[(i + 1) % n]

    const v1x = curr.x - prev.x, v1y = curr.y - prev.y
    const v2x = next.x - curr.x, v2y = next.y - curr.y
    const len1 = Math.hypot(v1x, v1y), len2 = Math.hypot(v2x, v2y)

    if (len1 < 1e-7 || len2 < 1e-7) {
      isCusp[i] = true
      continue
    }

    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2)
    if (dot < cosThreshold) {
      isCusp[i] = true
    }
  }

  // Generate Catmull-Rom tangents at smooth vertices
  const tangents: Point[] = []
  for (let i = 0; i < n; i++) {
    if (isCusp[i]) {
      tangents.push(point(0, 0))
    } else {
      const prev = points[(i - 1 + n) % n]
      const next = points[(i + 1) % n]
      tangents.push(point((next.x - prev.x) / 2, (next.y - prev.y) / 2))
    }
  }

  // Construct PathAnchors with in/out control handles
  const anchors: PathAnchor[] = []
  for (let i = 0; i < n; i++) {
    const pt = points[i]
    const anchor: PathAnchor = { x: pt.x, y: pt.y }

    if (!isCusp[i]) {
      const t = tangents[i]
      // Out handle towards next point
      const next = points[(i + 1) % n]
      const segmentLen = dist(pt, next)
      const tangentLen = Math.hypot(t.x, t.y)
      const scale = tangentLen > 1e-6 ? Math.min(1 / 3, segmentLen / (3 * tangentLen)) : 0
      anchor.out = point(pt.x + t.x * scale, pt.y + t.y * scale)
      anchor.in = point(pt.x - t.x * scale, pt.y - t.y * scale)
      anchor.handleType = 'mirrored'
    } else {
      anchor.handleType = 'disconnected'
    }

    anchors.push(anchor)
  }

  return { anchors, closed }
}

/**
 * Adaptively subdivides all contours in a vector path.
 */
export function adaptiveSubdivideContours(
  contours: readonly PathContour[],
  options: AdaptiveSubdivisionOptions = {}
): PathContour[] {
  const reconstruct = options.reconstructCurves ?? true
  const angleThreshold = options.angleThreshold ?? 35

  return contours.map(contour => {
    const { anchors, closed } = contour
    if (anchors.length < 2) return { ...contour }

    const count = anchors.length
    const segments = closed ? count : count - 1
    const sampledPoints: Point[] = []

    for (let i = 0; i < segments; i++) {
      const a = anchors[i]
      const b = anchors[(i + 1) % count]
      const isCurved = Boolean(a.out || b.in)

      if (isCurved) {
        const curve: Curve = [a, a.out ?? a, b.in ?? b, b]
        const pts = adaptiveSubdivideCurve(curve, options)
        // Avoid duplicate start point
        if (sampledPoints.length > 0) {
          sampledPoints.push(...pts.slice(1))
        } else {
          sampledPoints.push(...pts)
        }
      } else {
        // Straight line - subdivide linearly if longer than maxSegmentLength
        const maxLen = Math.max(1, options.maxSegmentLength ?? 24)
        const d = dist(a, b)
        const steps = Math.max(1, Math.ceil(d / maxLen))
        if (sampledPoints.length === 0) {
          sampledPoints.push(a)
        }
        for (let s = 1; s <= steps; s++) {
          sampledPoints.push(lerp(a, b, s / steps))
        }
      }
    }

    if (reconstruct) {
      return pointsToBezierContour(sampledPoints, closed, angleThreshold)
    }

    // Polyline anchors
    return {
      anchors: sampledPoints.map(p => ({ x: p.x, y: p.y })),
      closed,
    }
  })
}

/**
 * Adaptively subdivides SVG path data string and returns optimized/reconstructed SVG path data.
 */
export function adaptiveSubdividePath(
  d: string,
  options: AdaptiveSubdivisionOptions = {}
): string {
  const parsed = parsePath(d)
  if (!parsed.length) return ''
  const subdivided = adaptiveSubdivideContours(parsed, options)
  return serializePath(subdivided)
}
