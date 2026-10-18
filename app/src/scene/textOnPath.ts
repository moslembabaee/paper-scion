import type { Bounds, Point } from '../canvas/types.ts'
import type { PathContour } from './pathGeometry.ts'
import { parsePath, pathBounds, serializePath } from './pathGeometry.ts'
import type { SceneElement, TextElement, VectorElement } from './types.ts'
import { getWorldMatrix } from './geometry.ts'

// Standard cubic Bézier constant for approximating quarter-circle arcs
const K = 0.5522847498307936

/** Point along a parameterized curve with differential geometry properties. */
export interface CurveEvaluation {
  readonly x: number
  readonly y: number
  readonly distance: number // Arc length from path origin
  readonly t: number // Parameter t along current segment (0..1)
  readonly segmentIndex: number
  readonly tangent: Point // Unit tangent vector pointing forward along curve
  readonly normal: Point // Unit normal vector pointing to the left (-Ty, Tx)
  readonly angle: number // Tangent orientation in degrees (-180..180)
  readonly angleRad: number // Tangent orientation in radians (-π..π)
  readonly normalAngle: number // Normal orientation in degrees
  readonly curvature: number // Signed curvature κ = (x'y'' - y'x'') / (x'^2 + y'^2)^(3/2)
  readonly radius: number // Radius of curvature 1 / |κ| (Infinity for zero curvature)
  offsetPoint(distance: number): Point
}

/** Cubic Bézier segment defined by four control points (P0, P1, P2, P3). */
export interface CubicBezierSegment {
  readonly p0: Point
  readonly p1: Point
  readonly p2: Point
  readonly p3: Point
  readonly length: number
  readonly startDistance: number
  readonly endDistance: number
  evaluate(t: number): CurveEvaluation
  evaluateAtDistance(distance: number): CurveEvaluation
}

/** Parameterized path with exact arc-length lookup, bounds, and geometric projection. */
export interface ParameterizedPath {
  readonly length: number
  readonly closed: boolean
  readonly contours: readonly PathContour[]
  readonly segments: readonly CubicBezierSegment[]
  readonly bounds: Bounds
  at(distance: number): CurveEvaluation
  atNormalized(t: number): CurveEvaluation
  project(point: Point): {
    readonly distance: number
    readonly point: Point
    readonly distanceAlong: number
    readonly t: number
    readonly evaluation: CurveEvaluation
  }
}

/** Individual character placement on a curve. */
export interface TextOnPathGlyph {
  readonly char: string
  readonly index: number
  readonly distance: number // Position along curve in pixels
  readonly x: number
  readonly y: number
  readonly angle: number // Tangent angle in degrees
  readonly angleRad: number // Tangent angle in radians
  readonly tangent: Point
  readonly normal: Point
  readonly width: number
  readonly visible: boolean
  readonly baselineShift: number
  readonly curvature: number
}

/** Complete text-on-path layout computation result. */
export interface TextOnPathLayout {
  readonly glyphs: readonly TextOnPathGlyph[]
  readonly pathLength: number
  readonly textLength: number
  readonly startOffset: number // in pixels
  readonly overflow: boolean
  readonly bounds: Bounds
}

/** Options for laying out text along a path. */
export interface TextOnPathLayoutOptions {
  readonly offset?: number // Start offset (percentage 0..100 or pixels)
  readonly offsetMode?: 'percent' | 'pixels'
  readonly align?: 'start' | 'center' | 'end' | 'justify'
  readonly spacing?: number // Additional tracking / letter spacing in pixels
  readonly side?: 'left' | 'right'
  readonly reverse?: boolean
  readonly baselineShift?: number // Normal offset in pixels
  readonly fontSize?: number
  readonly measureChar?: (char: string, index: number) => number
}

/** Canvas 2D styling options for text-on-path rendering. */
export interface TextCanvasStyle {
  readonly font?: string
  readonly fill?: string | null
  readonly stroke?: { color: string; width: number; dash?: readonly number[] } | null
  readonly shadow?: { color: string; x: number; y: number; blur: number } | null
  readonly opacity?: number
}

// -----------------------------------------------------------------------------
// Core Differential Geometry for Cubic Béziers
// -----------------------------------------------------------------------------

export function evalCubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  const u2 = u * u
  const u3 = u2 * u
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: u3 * p0.x + 3 * u2 * t * p1.x + 3 * u * t2 * p2.x + t3 * p3.x,
    y: u3 * p0.y + 3 * u2 * t * p1.y + 3 * u * t2 * p2.y + t3 * p3.y,
  }
}

export function evalCubicDerivative(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  const ax = 3 * (p1.x - p0.x)
  const ay = 3 * (p1.y - p0.y)
  const bx = 3 * (p2.x - p1.x)
  const by = 3 * (p2.y - p1.y)
  const cx = 3 * (p3.x - p2.x)
  const cy = 3 * (p3.y - p2.y)
  return {
    x: u * u * ax + 2 * u * t * bx + t * t * cx,
    y: u * u * ay + 2 * u * t * by + t * t * cy,
  }
}

export function evalCubicSecondDerivative(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  const ax = 6 * (p2.x - 2 * p1.x + p0.x)
  const ay = 6 * (p2.y - 2 * p1.y + p0.y)
  const bx = 6 * (p3.x - 2 * p2.x + p1.x)
  const by = 6 * (p3.y - 2 * p2.y + p1.y)
  return {
    x: u * ax + t * bx,
    y: u * ay + t * by,
  }
}

export function evalCubicSpeed(p0: Point, p1: Point, p2: Point, p3: Point, t: number): number {
  const d = evalCubicDerivative(p0, p1, p2, p3, t)
  return Math.hypot(d.x, d.y)
}

/** 5-point Gauss-Legendre quadrature weights and roots on [-1, 1] */
const GAUSS_WEIGHTS = [
  0.5688888888888889,
  0.4786286704993665,
  0.4786286704993665,
  0.2369268850561891,
  0.2369268850561891,
]
const GAUSS_ABSCISSAE = [
  0.0,
  0.5384693101056831,
  -0.5384693101056831,
  0.9061798459386640,
  -0.9061798459386640,
]

export function integrateCubicArcLength(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t0 = 0,
  t1 = 1
): number {
  if (t0 === t1) return 0
  const c1 = 0.5 * (t1 - t0)
  const c2 = 0.5 * (t1 + t0)
  let sum = 0
  for (let i = 0; i < 5; i++) {
    const t = c1 * GAUSS_ABSCISSAE[i] + c2
    sum += GAUSS_WEIGHTS[i] * evalCubicSpeed(p0, p1, p2, p3, t)
  }
  return sum * c1
}

export function computeCubicCurvature(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number
): number {
  const d1 = evalCubicDerivative(p0, p1, p2, p3, t)
  const d2 = evalCubicSecondDerivative(p0, p1, p2, p3, t)
  const speedSq = d1.x * d1.x + d1.y * d1.y
  const speed = Math.sqrt(speedSq)
  if (speed < 1e-9) return 0
  const numerator = d1.x * d2.y - d1.y * d2.x
  return numerator / (speedSq * speed)
}

// -----------------------------------------------------------------------------
// Cubic Segment Implementation with Newton-Raphson Arc-Length Inversion
// -----------------------------------------------------------------------------

const SAMPLES_PER_SEGMENT = 16

class CubicSegmentImpl implements CubicBezierSegment {
  readonly p0: Point
  readonly p1: Point
  readonly p2: Point
  readonly p3: Point
  readonly length: number
  readonly startDistance: number
  readonly endDistance: number
  readonly segmentIndex: number

  private readonly sampleLengths: Float64Array
  private readonly sampleTs: Float64Array

  constructor(p0: Point, p1: Point, p2: Point, p3: Point, startDistance: number, segmentIndex: number) {
    this.p0 = p0
    this.p1 = p1
    this.p2 = p2
    this.p3 = p3
    this.startDistance = startDistance
    this.segmentIndex = segmentIndex

    this.sampleLengths = new Float64Array(SAMPLES_PER_SEGMENT + 1)
    this.sampleTs = new Float64Array(SAMPLES_PER_SEGMENT + 1)

    let accum = 0
    this.sampleLengths[0] = 0
    this.sampleTs[0] = 0

    for (let i = 1; i <= SAMPLES_PER_SEGMENT; i++) {
      const t0 = (i - 1) / SAMPLES_PER_SEGMENT
      const t1 = i / SAMPLES_PER_SEGMENT
      accum += integrateCubicArcLength(p0, p1, p2, p3, t0, t1)
      this.sampleLengths[i] = accum
      this.sampleTs[i] = t1
    }

    this.length = accum
    this.endDistance = startDistance + accum
  }

  evaluate(t: number): CurveEvaluation {
    const clampedT = Math.max(0, Math.min(1, t))
    const pt = evalCubicPoint(this.p0, this.p1, this.p2, this.p3, clampedT)
    const deriv = evalCubicDerivative(this.p0, this.p1, this.p2, this.p3, clampedT)
    let speed = Math.hypot(deriv.x, deriv.y)

    let tx: number, ty: number
    if (speed > 1e-9) {
      tx = deriv.x / speed
      ty = deriv.y / speed
    } else {
      // Degenerate velocity: fallback to straight chord direction
      const chord = { x: this.p3.x - this.p0.x, y: this.p3.y - this.p0.y }
      const chordLen = Math.hypot(chord.x, chord.y)
      if (chordLen > 1e-9) {
        tx = chord.x / chordLen
        ty = chord.y / chordLen
      } else {
        tx = 1
        ty = 0
      }
    }

    // In screen coordinates (y pointing downward), unit normal pointing to the left of the curve is (ty, -tx)
    const nx = ty
    const ny = -tx
    const angleRad = Math.atan2(ty, tx)
    const angle = (angleRad * 180) / Math.PI
    const normalAngleRad = Math.atan2(ny, nx)
    const normalAngle = (normalAngleRad * 180) / Math.PI
    const curvature = computeCubicCurvature(this.p0, this.p1, this.p2, this.p3, clampedT)
    const radius = Math.abs(curvature) > 1e-9 ? 1 / Math.abs(curvature) : Number.POSITIVE_INFINITY

    // Partial arc-length from start of segment
    const localDistance = integrateCubicArcLength(this.p0, this.p1, this.p2, this.p3, 0, clampedT)
    const segmentIdx = this.segmentIndex

    return {
      x: pt.x,
      y: pt.y,
      distance: this.startDistance + localDistance,
      t: clampedT,
      segmentIndex: segmentIdx,
      tangent: { x: tx, y: ty },
      normal: { x: nx, y: ny },
      angle,
      angleRad,
      normalAngle,
      curvature,
      radius,
      offsetPoint(offsetDist: number) {
        return {
          x: pt.x + offsetDist * nx,
          y: pt.y + offsetDist * ny,
        }
      },
    }
  }

  evaluateAtDistance(distance: number): CurveEvaluation {
    if (this.length <= 1e-9) return this.evaluate(0)
    const localDist = Math.max(0, Math.min(this.length, distance - this.startDistance))
    if (localDist <= 0) return this.evaluate(0)
    if (localDist >= this.length) return this.evaluate(1)

    // Binary search on pre-sampled arc lengths
    let low = 0
    let high = SAMPLES_PER_SEGMENT
    while (low < high) {
      const mid = (low + high) >> 1
      if (this.sampleLengths[mid] < localDist) low = mid + 1
      else high = mid
    }
    const idx = Math.max(1, low)
    const s0 = this.sampleLengths[idx - 1]
    const s1 = this.sampleLengths[idx]
    const t0 = this.sampleTs[idx - 1]
    const t1 = this.sampleTs[idx]

    const fraction = (localDist - s0) / (s1 - s0 || 1)
    let t = t0 + (t1 - t0) * fraction

    // 2-step Newton-Raphson refinement for sub-pixel precision
    for (let step = 0; step < 2; step++) {
      const currentLen = integrateCubicArcLength(this.p0, this.p1, this.p2, this.p3, 0, t)
      const speed = evalCubicSpeed(this.p0, this.p1, this.p2, this.p3, t)
      if (speed < 1e-9) break
      const dt = (currentLen - localDist) / speed
      t = Math.max(t0, Math.min(t1, t - dt))
    }

    return this.evaluate(t)
  }
}

// -----------------------------------------------------------------------------
// Vector Node Geometry to Contours and Path Data
// -----------------------------------------------------------------------------

/** Converts a Rectangle into exact closed Bézier contours with rounded corners. */
export function rectangleToContours(width: number, height: number, cornerRadius = 0): PathContour[] {
  const w = Math.max(0, width)
  const h = Math.max(0, height)
  const r = Math.max(0, Math.min(cornerRadius, w / 2, h / 2))

  if (r <= 0) {
    return [
      {
        closed: true,
        anchors: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ],
      },
    ]
  }

  const k = r * K
  return [
    {
      closed: true,
      anchors: [
        { x: r, y: 0, in: { x: r - k, y: 0 }, out: undefined },
        { x: w - r, y: 0, in: undefined, out: { x: w - r + k, y: 0 } },
        { x: w, y: r, in: { x: w, y: r - k }, out: undefined },
        { x: w, y: h - r, in: undefined, out: { x: w, y: h - r + k } },
        { x: w - r, y: h, in: { x: w - r + k, y: h }, out: undefined },
        { x: r, y: h, in: undefined, out: { x: r - k, y: h } },
        { x: 0, y: h - r, in: { x: 0, y: h - r + k }, out: undefined },
        { x: 0, y: r, in: undefined, out: { x: 0, y: r - k } },
      ],
    },
  ]
}

/** Converts an Ellipse into exact 4-segment cubic Bézier contours. */
export function ellipseToContours(width: number, height: number): PathContour[] {
  const w = Math.max(0, width)
  const h = Math.max(0, height)
  const rx = w / 2
  const ry = h / 2
  const cx = rx
  const cy = ry
  const kx = rx * K
  const ky = ry * K

  return [
    {
      closed: true,
      anchors: [
        { x: cx, y: cy - ry, in: { x: cx - kx, y: cy - ry }, out: { x: cx + kx, y: cy - ry } },
        { x: cx + rx, y: cy, in: { x: cx + rx, y: cy - ky }, out: { x: cx + rx, y: cy + ky } },
        { x: cx, y: cy + ry, in: { x: cx + kx, y: cy + ry }, out: { x: cx - kx, y: cy + ry } },
        { x: cx - rx, y: cy, in: { x: cx - rx, y: cy + ky }, out: { x: cx - rx, y: cy - ky } },
      ],
    },
  ]
}

/** Converts any VectorElement (Path, Rectangle, Ellipse) to local PathContour array. */
export function vectorNodeToContours(node: VectorElement): PathContour[] {
  if (node.type === 'rectangle') {
    return rectangleToContours(node.width, node.height, node.cornerRadius)
  }
  if (node.type === 'ellipse') {
    return ellipseToContours(node.width, node.height)
  }
  // PathElement: parse SVG path data and scale if viewBox differs
  const contours = parsePath(node.d)
  const [vx, vy, vw, vh] = node.viewBox
  if (vw === node.width && vh === node.height && vx === 0 && vy === 0) {
    return contours
  }
  const sx = node.width / (vw || 1)
  const sy = node.height / (vh || 1)
  const mapPoint = (p: Point): Point => ({
    x: (p.x - vx) * sx,
    y: (p.y - vy) * sy,
  })
  return contours.map(contour => ({
    closed: contour.closed,
    anchors: contour.anchors.map(anchor => ({
      ...mapPoint(anchor),
      ...(anchor.in ? { in: mapPoint(anchor.in) } : {}),
      ...(anchor.out ? { out: mapPoint(anchor.out) } : {}),
    })),
  }))
}

/** Converts any VectorElement to an SVG path string `d`. */
export function vectorNodeToPathD(node: VectorElement): string {
  return serializePath(vectorNodeToContours(node))
}

/** Map any linked VectorElement (path, rectangle, ellipse) into text-local coordinate space. */
export function linkedVectorPathD(
  node: TextElement,
  target: VectorElement,
  elements: Readonly<Record<string, SceneElement>>
): string {
  const state = { elements }
  const [a, b, c, d, e, f] = getWorldMatrix(state, node.id)
  const [pa, pb, pc, pd, pe, pf] = getWorldMatrix(state, target.id)
  const det = a * d - b * c
  if (Math.abs(det) < 1e-12) return vectorNodeToPathD(target)

  const contours = vectorNodeToContours(target)
  const transform = (p: Point): Point => {
    // Target local point to world space
    const wx = pa * p.x + pc * p.y + pe
    const wy = pb * p.x + pd * p.y + pf
    // World space to text local space (inverse matrix)
    const relX = wx - e
    const relY = wy - f
    return {
      x: (d * relX - c * relY) / det,
      y: (a * relY - b * relX) / det,
    }
  }

  return serializePath(
    contours.map(contour => ({
      closed: contour.closed,
      anchors: contour.anchors.map(anchor => ({
        ...transform(anchor),
        ...(anchor.in ? { in: transform(anchor.in) } : {}),
        ...(anchor.out ? { out: transform(anchor.out) } : {}),
      })),
    }))
  )
}

// -----------------------------------------------------------------------------
// Parameterized Path Implementation
// -----------------------------------------------------------------------------

export function createCurvePath(dOrNode: string | VectorElement): ParameterizedPath {
  let contours: PathContour[]
  if (typeof dOrNode === 'string') {
    try {
      contours = parsePath(dOrNode)
    } catch {
      contours = []
    }
  } else {
    contours = vectorNodeToContours(dOrNode)
  }

  const segments: CubicBezierSegment[] = []
  let totalLength = 0
  let isClosed = false

  for (const contour of contours) {
    if (!contour.anchors.length) continue
    if (contour.closed) isClosed = true
    const count = contour.anchors.length - (contour.closed ? 0 : 1)
    for (let i = 0; i < count; i++) {
      const a = contour.anchors[i]
      const b = contour.anchors[(i + 1) % contour.anchors.length]
      const p0 = { x: a.x, y: a.y }
      const p3 = { x: b.x, y: b.y }
      const p1 = a.out
        ? { x: a.out.x, y: a.out.y }
        : (b.in ? { x: p0.x, y: p0.y } : { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 })
      const p2 = b.in
        ? { x: b.in.x, y: b.in.y }
        : (a.out ? { x: p3.x, y: p3.y } : { x: p0.x + 2 * (p3.x - p0.x) / 3, y: p0.y + 2 * (p3.y - p0.y) / 3 })

      const seg = new CubicSegmentImpl(p0, p1, p2, p3, totalLength, segments.length)
      segments.push(seg)
      totalLength += seg.length
    }
  }

  const rawBounds = pathBounds(contours, 0)
  const bounds: Bounds = {
    x: rawBounds.x,
    y: rawBounds.y,
    width: rawBounds.width,
    height: rawBounds.height,
  }

  const atDistance = (distance: number): CurveEvaluation => {
    if (segments.length === 0) {
      return {
        x: 0,
        y: 0,
        distance: 0,
        t: 0,
        segmentIndex: 0,
        tangent: { x: 1, y: 0 },
        normal: { x: 0, y: 1 },
        angle: 0,
        angleRad: 0,
        normalAngle: 90,
        curvature: 0,
        radius: Number.POSITIVE_INFINITY,
        offsetPoint: (d: number) => ({ x: 0, y: d }),
      }
    }

    const clampedDist = isClosed && totalLength > 0
      ? ((distance % totalLength) + totalLength) % totalLength
      : Math.max(0, Math.min(totalLength, distance))

    // Binary search across segments
    let low = 0
    let high = segments.length - 1
    while (low < high) {
      const mid = (low + high) >> 1
      if (segments[mid].endDistance < clampedDist) low = mid + 1
      else high = mid
    }
    const seg = segments[low]
    return seg.evaluateAtDistance(clampedDist)
  }

  return {
    length: totalLength,
    closed: isClosed,
    contours,
    segments,
    bounds,
    at: atDistance,
    atNormalized(t: number) {
      return atDistance(t * totalLength)
    },
    project(target: Point) {
      if (segments.length === 0) {
        const evalPt = atDistance(0)
        return { distance: Math.hypot(target.x, target.y), point: { x: 0, y: 0 }, distanceAlong: 0, t: 0, evaluation: evalPt }
      }

      let bestDistSq = Number.POSITIVE_INFINITY
      let bestDistAlong = 0
      let bestPt: Point = { x: 0, y: 0 }

      // Coarse sampling across segments
      const sampleCount = Math.max(32, segments.length * 8)
      for (let i = 0; i <= sampleCount; i++) {
        const s = (i / sampleCount) * totalLength
        const evalPt = atDistance(s)
        const dSq = (evalPt.x - target.x) ** 2 + (evalPt.y - target.y) ** 2
        if (dSq < bestDistSq) {
          bestDistSq = dSq
          bestDistAlong = s
          bestPt = { x: evalPt.x, y: evalPt.y }
        }
      }

      // Local refinement (golden section search)
      let step = totalLength / sampleCount
      let curr = bestDistAlong
      for (let iter = 0; iter < 8; iter++) {
        const sLeft = Math.max(0, curr - step)
        const sRight = Math.min(totalLength, curr + step)
        const evalL = atDistance(sLeft)
        const evalR = atDistance(sRight)
        const dL = (evalL.x - target.x) ** 2 + (evalL.y - target.y) ** 2
        const dR = (evalR.x - target.x) ** 2 + (evalR.y - target.y) ** 2
        if (dL < bestDistSq) {
          bestDistSq = dL
          curr = sLeft
          bestPt = { x: evalL.x, y: evalL.y }
        } else if (dR < bestDistSq) {
          bestDistSq = dR
          curr = sRight
          bestPt = { x: evalR.x, y: evalR.y }
        }
        step *= 0.5
      }

      const finalEval = atDistance(curr)
      return {
        distance: Math.sqrt(bestDistSq),
        point: bestPt,
        distanceAlong: curr,
        t: totalLength > 0 ? curr / totalLength : 0,
        evaluation: finalEval,
      }
    },
  }
}

// -----------------------------------------------------------------------------
// Text-on-Path Layout Engine
// -----------------------------------------------------------------------------

export function layoutTextOnPath(
  text: string,
  pathInput: ParameterizedPath | string | VectorElement,
  options: TextOnPathLayoutOptions = {}
): TextOnPathLayout {
  const path = typeof pathInput === 'string' || (pathInput && 'type' in pathInput)
    ? createCurvePath(pathInput as any)
    : pathInput

  const chars = Array.from(text.replace(/\n/g, ' '))
  const count = chars.length
  const fontSize = options.fontSize ?? 16
  const spacing = options.spacing ?? 0
  const baselineShift = options.baselineShift ?? 0
  const side = options.side ?? 'left'
  const align = options.align ?? 'start'

  // Character advance measurement
  const charWidths = chars.map((char, index) => {
    if (options.measureChar) return options.measureChar(char, index)
    // High-accuracy fallback character metrics table
    if (char === ' ') return fontSize * 0.28
    if (/[ijlI1.,;:'!]/.test(char)) return fontSize * 0.28
    if (/[mwMW@#%&]/.test(char)) return fontSize * 0.8
    if (/[A-Z]/.test(char)) return fontSize * 0.65
    return fontSize * 0.52
  })

  const rawTextWidth = charWidths.reduce((sum, w) => sum + w, 0)
  const totalSpacing = Math.max(0, count - 1) * spacing
  const totalTextWidth = rawTextWidth + totalSpacing
  const pathLen = path.length

  // Start offset evaluation
  let startOffsetPx = 0
  if (options.offset !== undefined) {
    if (options.offsetMode === 'pixels') {
      startOffsetPx = options.offset
    } else {
      startOffsetPx = (options.offset / 100) * pathLen
    }
  } else {
    if (align === 'center') {
      startOffsetPx = pathLen * 0.5
    } else if (align === 'end') {
      startOffsetPx = pathLen
    } else {
      startOffsetPx = 0
    }
  }

  // Alignment calculations: startOffsetPx is the anchor point on the path
  let cursor = startOffsetPx
  let effectiveSpacing = spacing

  if (align === 'center') {
    cursor = startOffsetPx - totalTextWidth / 2
  } else if (align === 'end') {
    cursor = startOffsetPx - totalTextWidth
  } else if (align === 'justify') {
    if (count > 1 && pathLen > startOffsetPx + rawTextWidth) {
      cursor = startOffsetPx
      effectiveSpacing = (pathLen - startOffsetPx - rawTextWidth) / (count - 1)
    } else {
      cursor = startOffsetPx
    }
  }

  // Normal displacement direction: left vs right side
  const normalMultiplier = side === 'right' ? -1 : 1
  const effectiveShift = baselineShift * normalMultiplier
  const reverse = options.reverse ?? false

  const glyphs: TextOnPathGlyph[] = []
  let overflow = false
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let i = 0; i < count; i++) {
    const char = chars[i]
    const w = charWidths[i]
    const centerDist = cursor + w / 2

    const isVisible = path.closed || (centerDist >= 0 && centerDist <= pathLen)
    if (!isVisible) overflow = true

    const effectiveDist = reverse ? pathLen - centerDist : centerDist
    const evaluation = path.at(effectiveDist)

    let tangent = evaluation.tangent
    let normal = evaluation.normal
    let angle = evaluation.angle
    let angleRad = evaluation.angleRad

    if (reverse) {
      tangent = { x: -tangent.x, y: -tangent.y }
      normal = { x: -normal.x, y: -normal.y }
      angle = (angle + 180) % 360
      if (angle > 180) angle -= 360
      else if (angle < -180) angle += 360
      angleRad = (angle * Math.PI) / 180
    }

    if (side === 'right') {
      angle = (angle + 180) % 360
      if (angle > 180) angle -= 360
      else if (angle < -180) angle += 360
      angleRad = (angle * Math.PI) / 180
    }

    const shiftedPt = {
      x: evaluation.x + effectiveShift * normal.x,
      y: evaluation.y + effectiveShift * normal.y,
    }

    glyphs.push({
      char,
      index: i,
      distance: centerDist,
      x: shiftedPt.x,
      y: shiftedPt.y,
      angle,
      angleRad,
      tangent,
      normal,
      width: w,
      visible: isVisible,
      baselineShift: effectiveShift,
      curvature: evaluation.curvature,
    })

    minX = Math.min(minX, shiftedPt.x - w / 2)
    minY = Math.min(minY, shiftedPt.y - fontSize / 2)
    maxX = Math.max(maxX, shiftedPt.x + w / 2)
    maxY = Math.max(maxY, shiftedPt.y + fontSize / 2)

    cursor += w + effectiveSpacing
  }

  const bounds: Bounds = count > 0 && Number.isFinite(minX)
    ? { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) }
    : { x: 0, y: 0, width: 0, height: 0 }

  return {
    glyphs,
    pathLength: pathLen,
    textLength: totalTextWidth,
    startOffset: startOffsetPx,
    overflow,
    bounds,
  }
}

// -----------------------------------------------------------------------------
// Canvas 2D Text-on-Path Rendering Engine
// -----------------------------------------------------------------------------

export function renderTextOnPathToCanvas(
  ctx: CanvasRenderingContext2D,
  layout: TextOnPathLayout,
  style: TextCanvasStyle = {}
): void {
  ctx.save()

  if (style.opacity !== undefined) {
    ctx.globalAlpha = style.opacity
  }
  if (style.font) {
    ctx.font = style.font
  }
  if (style.shadow) {
    ctx.shadowColor = style.shadow.color
    ctx.shadowOffsetX = style.shadow.x
    ctx.shadowOffsetY = style.shadow.y
    ctx.shadowBlur = style.shadow.blur
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  for (const glyph of layout.glyphs) {
    if (!glyph.visible) continue

    ctx.save()
    ctx.translate(glyph.x, glyph.y)
    ctx.rotate(glyph.angleRad)

    if (style.fill) {
      ctx.fillStyle = style.fill
      ctx.fillText(glyph.char, 0, 0)
    }

    if (style.stroke && style.stroke.width > 0) {
      ctx.strokeStyle = style.stroke.color
      ctx.lineWidth = style.stroke.width
      if (style.stroke.dash?.length) {
        ctx.setLineDash(style.stroke.dash as number[])
      }
      ctx.strokeText(glyph.char, 0, 0)
    }

    ctx.restore()
  }

  ctx.restore()
}

// -----------------------------------------------------------------------------
// SVG Text-on-Path Glyph Group Generator
// -----------------------------------------------------------------------------

export function renderTextOnPathToSvg(
  layout: TextOnPathLayout,
  options: {
    fill?: string | null
    stroke?: { color: string; width: number } | null
    fontFamily?: string
    fontSize?: number
    fontWeight?: number
    fontVariationSettings?: string
    className?: string
  } = {}
): string {
  const fill = options.fill ?? 'currentColor'
  const stroke = options.stroke?.color ?? 'none'
  const strokeWidth = options.stroke?.width ?? 0
  const styleParts: string[] = []
  if (options.fontFamily) styleParts.push(`font-family:${options.fontFamily}`)
  if (options.fontSize) styleParts.push(`font-size:${options.fontSize}px`)
  if (options.fontWeight) styleParts.push(`font-weight:${options.fontWeight}`)
  if (options.fontVariationSettings) styleParts.push(`font-variation-settings:${options.fontVariationSettings}`)
  const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : ''

  const glyphsXml = layout.glyphs
    .filter(g => g.visible)
    .map(g => {
      const transform = `translate(${g.x.toFixed(2)} ${g.y.toFixed(2)}) rotate(${g.angle.toFixed(2)})`
      const escapedChar = g.char.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return `<text transform="${transform}" text-anchor="middle" dominant-baseline="alphabetic">${escapedChar}</text>`
    })
    .join('')

  return `<g class="${options.className ?? 'scene-text-on-path-glyphs'}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${styleAttr}>${glyphsXml}</g>`
}
