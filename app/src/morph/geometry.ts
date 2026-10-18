import type { Point } from '../canvas/types.ts'
import type { CubicContour, CubicSegment } from './types.ts'

export const point = (x: number, y: number): Point => ({ x, y })

export const addPoints = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
export const subPoints = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
export const scalePoint = (p: Point, s: number): Point => ({ x: p.x * s, y: p.y * s })
export const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

export const distanceSq = (a: Point, b: Point): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Evaluate cubic Bezier at parameter t in [0, 1] */
export function pointOnCubic(seg: CubicSegment, t: number): Point {
  const u = 1 - t
  const tt = t * t
  const uu = u * u
  const uuu = uu * u
  const ttt = tt * t

  return {
    x: uuu * seg.p0.x + 3 * uu * t * seg.p1.x + 3 * u * tt * seg.p2.x + ttt * seg.p3.x,
    y: uuu * seg.p0.y + 3 * uu * t * seg.p1.y + 3 * u * tt * seg.p2.y + ttt * seg.p3.y,
  }
}

/** First derivative (velocity / tangent vector) of cubic Bezier at parameter t */
export function cubicTangent(seg: CubicSegment, t: number): Point {
  const u = 1 - t
  return {
    x: 3 * u * u * (seg.p1.x - seg.p0.x) + 6 * u * t * (seg.p2.x - seg.p1.x) + 3 * t * t * (seg.p3.x - seg.p2.x),
    y: 3 * u * u * (seg.p1.y - seg.p0.y) + 6 * u * t * (seg.p2.y - seg.p1.y) + 3 * t * t * (seg.p3.y - seg.p2.y),
  }
}

/** Second derivative (acceleration) of cubic Bezier at parameter t */
export function cubicAcceleration(seg: CubicSegment, t: number): Point {
  const u = 1 - t
  return {
    x: 6 * u * (seg.p2.x - 2 * seg.p1.x + seg.p0.x) + 6 * t * (seg.p3.x - 2 * seg.p2.x + seg.p1.x),
    y: 6 * u * (seg.p2.y - 2 * seg.p1.y + seg.p0.y) + 6 * t * (seg.p3.y - 2 * seg.p2.y + seg.p1.y),
  }
}

/** Curvature kappa = |x' y'' - y' x''| / (x'^2 + y'^2)^(3/2) */
export function cubicCurvature(seg: CubicSegment, t: number): number {
  const v = cubicTangent(seg, t)
  const a = cubicAcceleration(seg, t)
  const num = Math.abs(v.x * a.y - v.y * a.x)
  const denom = Math.pow(v.x * v.x + v.y * v.y, 1.5)
  if (denom < 1e-9) return 0
  return num / denom
}

/** Split a cubic segment at parameter t into two cubic segments via De Casteljau */
export function splitCubic(seg: CubicSegment, t: number): [CubicSegment, CubicSegment] {
  const clampedT = Math.max(1e-5, Math.min(1 - 1e-5, t))
  const p01 = lerpPoint(seg.p0, seg.p1, clampedT)
  const p12 = lerpPoint(seg.p1, seg.p2, clampedT)
  const p23 = lerpPoint(seg.p2, seg.p3, clampedT)

  const p012 = lerpPoint(p01, p12, clampedT)
  const p123 = lerpPoint(p12, p23, clampedT)

  const p0123 = lerpPoint(p012, p123, clampedT)

  return [
    { p0: seg.p0, p1: p01, p2: p012, p3: p0123 },
    { p0: p0123, p1: p123, p2: p23, p3: seg.p3 },
  ]
}

// Gauss-Legendre 5-point quadrature weights and abscissae for integral from 0 to 1
const GAUSS_T = [
  0.046910077030668,
  0.230765344947158,
  0.500000000000000,
  0.769234655052842,
  0.953089922969332,
]
const GAUSS_W = [
  0.118463442528095,
  0.239314335249683,
  0.284444444444444,
  0.239314335249683,
  0.118463442528095,
]

/** Highly accurate arc length of a cubic Bezier segment via numerical quadrature */
export function cubicArcLength(seg: CubicSegment): number {
  // If control points are nearly collinear with anchors, use straight line distance
  const chord = distance(seg.p0, seg.p3)
  const polyLength = distance(seg.p0, seg.p1) + distance(seg.p1, seg.p2) + distance(seg.p2, seg.p3)
  if (Math.abs(polyLength - chord) < 1e-4) return chord

  let length = 0
  for (let i = 0; i < 5; i++) {
    const v = cubicTangent(seg, GAUSS_T[i])
    const speed = Math.hypot(v.x, v.y)
    length += GAUSS_W[i] * speed
  }
  return length
}

/** Find parameter t on cubic segment corresponding to fractional arc distance s in [0, 1] */
export function cubicParameterAtDistance(seg: CubicSegment, targetFraction: number): number {
  if (targetFraction <= 0) return 0
  if (targetFraction >= 1) return 1

  const totalLength = cubicArcLength(seg)
  if (totalLength < 1e-6) return targetFraction
  const targetDist = totalLength * targetFraction

  // Bisection + Newton-Raphson refinement
  let low = 0
  let high = 1
  let t = targetFraction

  for (let iter = 0; iter < 12; iter++) {
    const [left] = splitCubic(seg, t)
    const currentDist = cubicArcLength(left)
    const error = currentDist - targetDist
    if (Math.abs(error) < 1e-4) break

    if (error > 0) {
      high = t
    } else {
      low = t
    }
    t = (low + high) / 2
  }
  return t
}

/** Compute bounding box of a cubic Bezier segment */
export function cubicBounds(seg: CubicSegment): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Math.min(seg.p0.x, seg.p3.x)
  let maxX = Math.max(seg.p0.x, seg.p3.x)
  let minY = Math.min(seg.p0.y, seg.p3.y)
  let maxY = Math.max(seg.p0.y, seg.p3.y)

  // Find extrema where derivative is zero: at^2 + bt + c = 0
  const findExtrema = (p0: number, p1: number, p2: number, p3: number): number[] => {
    const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3)
    const b = 6 * (p0 - 2 * p1 + p2)
    const c = 3 * (p1 - p0)
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) > 1e-9) {
        const t = -c / b
        return t > 0 && t < 1 ? [t] : []
      }
      return []
    }
    const discr = b * b - 4 * a * c
    if (discr < 0) return []
    const root = Math.sqrt(discr)
    const t1 = (-b - root) / (2 * a)
    const t2 = (-b + root) / (2 * a)
    const res: number[] = []
    if (t1 > 0 && t1 < 1) res.push(t1)
    if (t2 > 0 && t2 < 1) res.push(t2)
    return res
  }

  for (const t of findExtrema(seg.p0.x, seg.p1.x, seg.p2.x, seg.p3.x)) {
    const pt = pointOnCubic(seg, t)
    minX = Math.min(minX, pt.x)
    maxX = Math.max(maxX, pt.x)
  }
  for (const t of findExtrema(seg.p0.y, seg.p1.y, seg.p2.y, seg.p3.y)) {
    const pt = pointOnCubic(seg, t)
    minY = Math.min(minY, pt.y)
    maxY = Math.max(maxY, pt.y)
  }

  return { minX, minY, maxX, maxY }
}

/** Compute total contour bounding box */
export function contourBounds(segments: readonly CubicSegment[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
} {
  if (!segments.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const seg of segments) {
    const b = cubicBounds(seg)
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1e-4, maxX - minX),
    height: Math.max(1e-4, maxY - minY),
  }
}

/** Compute signed area of closed contour using Green's theorem on cubic segments */
export function contourArea(segments: readonly CubicSegment[]): number {
  let area = 0
  // The integrand is degree five: five-point quadrature is exact for cubics.
  for (const seg of segments) for (let i = 0; i < GAUSS_T.length; i++) {
    const p = pointOnCubic(seg, GAUSS_T[i]), v = cubicTangent(seg, GAUSS_T[i])
    area += GAUSS_W[i] * (p.x * v.y - p.y * v.x) / 2
  }
  return area
}

/** Compute geometric centroid of contour */
export function contourCentroid(segments: readonly CubicSegment[]): Point {
  if (!segments.length) return { x: 0, y: 0 }
  const total = segments.length
  let sumX = 0
  let sumY = 0

  // Sample each segment to compute centroid
  for (const seg of segments) {
    sumX += (seg.p0.x + seg.p1.x + seg.p2.x + seg.p3.x) / 4
    sumY += (seg.p0.y + seg.p1.y + seg.p2.y + seg.p3.y) / 4
  }

  return { x: sumX / total, y: sumY / total }
}

/** Shortest angular difference between two angles in radians (-pi to pi) */
export function shortestAngleDiff(fromAngle: number, toAngle: number): number {
  let diff = (toAngle - fromAngle) % (2 * Math.PI)
  if (diff > Math.PI) diff -= 2 * Math.PI
  if (diff < -Math.PI) diff += 2 * Math.PI
  return diff
}

/** Convert a point to polar coordinates (radius, angle) relative to a given center */
export function toPolar(p: Point, center: Point): { r: number; theta: number } {
  const dx = p.x - center.x
  const dy = p.y - center.y
  return {
    r: Math.hypot(dx, dy),
    theta: Math.atan2(dy, dx),
  }
}

/** Convert polar coordinates back to Cartesian relative to a center */
export function fromPolar(r: number, theta: number, center: Point): Point {
  return {
    x: center.x + r * Math.cos(theta),
    y: center.y + r * Math.sin(theta),
  }
}

/** Serialize cubic segments into valid SVG path 'd' string */
export function serializeCubicSegments(segments: readonly CubicSegment[], closed: boolean): string {
  if (!segments.length) return ''
  const format = (n: number) => Number(n.toFixed(3))
  const pStr = (p: Point) => `${format(p.x)} ${format(p.y)}`

  let d = `M ${pStr(segments[0].p0)}`
  for (const seg of segments) {
    d += ` C ${pStr(seg.p1)} ${pStr(seg.p2)} ${pStr(seg.p3)}`
  }
  if (closed) {
    d += ' Z'
  }
  return d
}

/** Serialize complete contour list to SVG path string */
export function serializeCubicContours(contours: readonly CubicContour[]): string {
  return contours
    .map(c => serializeCubicSegments(c.segments, c.closed))
    .filter(Boolean)
    .join(' ')
}
