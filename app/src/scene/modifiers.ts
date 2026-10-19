import type { Bounds, Point } from '../canvas/types.ts'
import {
  parsePath,
  serializePath,
  type PathAnchor,
  type PathContour,
} from './pathGeometry.ts'
import type { SceneElement, VectorElement } from './types.ts'
import {
  adaptiveSubdivideContours,
} from './adaptiveSubdivision.ts'
import {
  computePathCSG,
  type CSGOperation,
} from './csgEngine.ts'
import { vectorPathData } from './booleanGeometry.ts'
import { optimizeSvgBezierData } from './bezierOptimization.ts'

export type VectorModifierType =
  | 'csg'
  | 'subdivide'
  | 'fillet'
  | 'offset'
  | 'simplify'
  | 'smooth'
  | 'mirror'
  | 'wave'
  | 'twist'

export interface BaseModifier {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly type: VectorModifierType
}

export interface CSGModifier extends BaseModifier {
  readonly type: 'csg'
  readonly operation: CSGOperation
  /** Layer ID in the scene for live cross-layer boolean evaluation */
  readonly targetLayerId?: string | null
  /** Custom embedded SVG path operand if not referencing a scene layer */
  readonly operandD?: string
  readonly operandName?: string
  readonly adaptiveSubdivision?: boolean
  readonly tolerance?: number
}

export interface SubdivideModifier extends BaseModifier {
  readonly type: 'subdivide'
  readonly flatness: number
  readonly maxSegmentLength: number
  readonly maxDepth: number
  readonly angleThreshold: number
  readonly reconstructCurves: boolean
}

export interface FilletModifier extends BaseModifier {
  readonly type: 'fillet'
  readonly radius: number
  readonly smoothing: number
  readonly chamfer: boolean
}

export interface OffsetModifier extends BaseModifier {
  readonly type: 'offset'
  readonly distance: number
  readonly join: 'round' | 'miter' | 'bevel'
  readonly miterLimit: number
}

export interface SimplifyModifier extends BaseModifier {
  readonly type: 'simplify'
  readonly tolerance: number
  readonly preserveEndpoints: boolean
}

export interface SmoothModifier extends BaseModifier {
  readonly type: 'smooth'
  readonly strength: number
  readonly iterations: number
}

export interface MirrorModifier extends BaseModifier {
  readonly type: 'mirror'
  readonly axis: 'x' | 'y'
  readonly offset: number
  readonly weld: boolean
}

export interface WaveModifier extends BaseModifier {
  readonly type: 'wave'
  readonly amplitude: number
  readonly frequency: number
  readonly phase: number
  readonly axis: 'x' | 'y' | 'radial'
}

export interface TwistModifier extends BaseModifier {
  readonly type: 'twist'
  readonly angle: number
  readonly radius: number
}

export type VectorModifier =
  | CSGModifier
  | SubdivideModifier
  | FilletModifier
  | OffsetModifier
  | SimplifyModifier
  | SmoothModifier
  | MirrorModifier
  | WaveModifier
  | TwistModifier

export interface ModifierEvaluationContext {
  elements: Readonly<Record<string, SceneElement>>
  currentElementId: string
}

export interface ModifierEvaluationResult {
  d: string
  viewBox: readonly [number, number, number, number]
  bounds: Bounds
  fillRule: 'nonzero' | 'evenodd'
  activeModifierCount: number
  totalModifierCount: number
  error?: string
}

const point = (x: number, y: number): Point => ({ x, y })
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Calculates the bounding box of a list of PathContours. */
export function boundsOfContours(contours: readonly PathContour[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of contours) {
    for (const a of c.anchors) {
      minX = Math.min(minX, a.x, a.in?.x ?? a.x, a.out?.x ?? a.x)
      minY = Math.min(minY, a.y, a.in?.y ?? a.y, a.out?.y ?? a.y)
      maxX = Math.max(maxX, a.x, a.in?.x ?? a.x, a.out?.x ?? a.x)
      maxY = Math.max(maxY, a.y, a.in?.y ?? a.y, a.out?.y ?? a.y)
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 100, height: 100 }
  return {
    x: minX,
    y: minY,
    width: Math.max(0.1, maxX - minX),
    height: Math.max(0.1, maxY - minY),
  }
}

/** Creates default settings for any modifier type */
export function createDefaultModifier(type: VectorModifierType, name?: string): VectorModifier {
  const id = `mod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  switch (type) {
    case 'csg':
      return {
        id,
        name: name ?? 'CSG Boolean',
        enabled: true,
        type: 'csg',
        operation: 'difference',
        targetLayerId: null,
        adaptiveSubdivision: true,
        tolerance: 0.5,
      }
    case 'subdivide':
      return {
        id,
        name: name ?? 'Adaptive Subdivide',
        enabled: true,
        type: 'subdivide',
        flatness: 0.5,
        maxSegmentLength: 24,
        maxDepth: 5,
        angleThreshold: 35,
        reconstructCurves: true,
      }
    case 'fillet':
      return {
        id,
        name: name ?? 'Round Corners',
        enabled: true,
        type: 'fillet',
        radius: 8,
        smoothing: 0.5,
        chamfer: false,
      }
    case 'offset':
      return {
        id,
        name: name ?? 'Path Offset',
        enabled: true,
        type: 'offset',
        distance: 4,
        join: 'round',
        miterLimit: 4,
      }
    case 'simplify':
      return {
        id,
        name: name ?? 'Simplify Curves',
        enabled: true,
        type: 'simplify',
        tolerance: 1.0,
        preserveEndpoints: true,
      }
    case 'smooth':
      return {
        id,
        name: name ?? 'Laplacian Smooth',
        enabled: true,
        type: 'smooth',
        strength: 0.35,
        iterations: 2,
      }
    case 'mirror':
      return {
        id,
        name: name ?? 'Symmetry Mirror',
        enabled: true,
        type: 'mirror',
        axis: 'x',
        offset: 0,
        weld: true,
      }
    case 'wave':
      return {
        id,
        name: name ?? 'Procedural Wave',
        enabled: true,
        type: 'wave',
        amplitude: 8,
        frequency: 3,
        phase: 0,
        axis: 'y',
      }
    case 'twist':
      return {
        id,
        name: name ?? 'Vortex Twist',
        enabled: true,
        type: 'twist',
        angle: 45,
        radius: 80,
      }
  }
}

// -------------------------------------------------------------
// Modifier Application Functions
// -------------------------------------------------------------

function applyFillet(contours: PathContour[], mod: FilletModifier): PathContour[] {
  if (mod.radius <= 0) return contours
  const r = mod.radius

  return contours.map(c => {
    const { anchors, closed } = c
    const n = anchors.length
    if (n < 2) return c

    const result: PathAnchor[] = []

    for (let i = 0; i < n; i++) {
      const curr = anchors[i]
      if (!closed && (i === 0 || i === n - 1)) {
        result.push({ ...curr })
        continue
      }
      const prev = anchors[(i - 1 + n) % n]
      const next = anchors[(i + 1) % n]

      // If already a smooth curve handle, skip or reduce
      const hasHandles = Boolean(curr.in || curr.out)
      if (hasHandles) {
        result.push({ ...curr })
        continue
      }

      const v1x = prev.x - curr.x, v1y = prev.y - curr.y
      const v2x = next.x - curr.x, v2y = next.y - curr.y
      const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y)

      if (l1 < 1e-6 || l2 < 1e-6) {
        result.push({ ...curr })
        continue
      }

      const u1 = point(v1x / l1, v1y / l1)
      const u2 = point(v2x / l2, v2y / l2)
      const cosAngle = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y))
      const angle = Math.acos(cosAngle)

      if (angle < 0.05 || Math.PI - angle < 0.05) {
        result.push({ ...curr })
        continue
      }

      const halfAngle = angle / 2
      const tanHalf = Math.tan(halfAngle)
      const maxTrim = Math.min(l1 / 2, l2 / 2)
      const trim = Math.min(r / tanHalf, maxTrim)
      const actualRadius = trim * tanHalf

      const entry = point(curr.x + u1.x * trim, curr.y + u1.y * trim)
      const exit = point(curr.x + u2.x * trim, curr.y + u2.y * trim)

      if (mod.chamfer) {
        result.push({ x: entry.x, y: entry.y }, { x: exit.x, y: exit.y })
      } else {
        const handleLen = (4 / 3) * Math.tan((Math.PI - angle) / 4) * actualRadius
        result.push(
          {
            x: entry.x,
            y: entry.y,
            out: point(entry.x - u1.x * handleLen, entry.y - u1.y * handleLen),
            handleType: 'disconnected',
          },
          {
            x: exit.x,
            y: exit.y,
            in: point(exit.x - u2.x * handleLen, exit.y - u2.y * handleLen),
            handleType: 'disconnected',
          }
        )
      }
    }

    return { anchors: result, closed }
  })
}

function applyOffset(contours: PathContour[], mod: OffsetModifier): PathContour[] {
  if (Math.abs(mod.distance) < 1e-4) return contours
  const d = mod.distance

  return contours.map(c => {
    const { anchors, closed } = c
    const n = anchors.length
    if (n < 2) return c

    const offsetAnchors: PathAnchor[] = []
    for (let i = 0; i < n; i++) {
      const prev = anchors[(i - 1 + n) % n]
      const curr = anchors[i]
      const next = anchors[(i + 1) % n]

      let dirX = next.x - prev.x, dirY = next.y - prev.y
      if (!closed) {
        if (i === 0) { dirX = next.x - curr.x; dirY = next.y - curr.y }
        else if (i === n - 1) { dirX = curr.x - prev.x; dirY = curr.y - prev.y }
      }
      const len = Math.hypot(dirX, dirY)
      if (len < 1e-7) {
        offsetAnchors.push({ ...curr })
        continue
      }
      // Normal vector pointing to the left of traversal
      const nx = -dirY / len, ny = dirX / len
      const offsetP = point(curr.x + nx * d, curr.y + ny * d)

      const outHandle = curr.out ? point(curr.out.x + nx * d, curr.out.y + ny * d) : undefined
      const inHandle = curr.in ? point(curr.in.x + nx * d, curr.in.y + ny * d) : undefined

      offsetAnchors.push({
        x: offsetP.x,
        y: offsetP.y,
        in: inHandle,
        out: outHandle,
        handleType: curr.handleType,
      })
    }

    return { anchors: offsetAnchors, closed }
  })
}

function rdpSimplify(points: PathAnchor[], tolerance: number): PathAnchor[] {
  if (points.length <= 2) return points
  let maxDist = 0, index = 0
  const p0 = points[0], p1 = points[points.length - 1]
  const dx = p1.x - p0.x, dy = p1.y - p0.y
  const chordLen = Math.hypot(dx, dy)

  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    let d = 0
    if (chordLen < 1e-8) {
      d = dist(p, p0)
    } else {
      d = Math.abs(dy * p.x - dx * p.y + p1.x * p0.y - p1.y * p0.x) / chordLen
    }
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }

  if (maxDist > tolerance) {
    const left = rdpSimplify(points.slice(0, index + 1), tolerance)
    const right = rdpSimplify(points.slice(index), tolerance)
    return [...left.slice(0, -1), ...right]
  }
  return [p0, p1]
}

function applySimplify(contours: PathContour[], mod: SimplifyModifier): PathContour[] {
  if (mod.tolerance <= 0) return contours
  return contours.map(c => {
    if (c.anchors.length <= 3) return c
    const simplified = rdpSimplify(c.anchors, mod.tolerance)
    return { anchors: simplified, closed: c.closed }
  })
}

function applySmooth(contours: PathContour[], mod: SmoothModifier): PathContour[] {
  const factor = Math.max(0, Math.min(1, mod.strength))
  const iters = Math.max(1, Math.min(10, mod.iterations))
  if (factor < 1e-4) return contours

  let current: PathContour[] = contours.map(c => ({
    closed: c.closed,
    anchors: c.anchors.map(a => ({ ...a, in: a.in ? { ...a.in } : undefined, out: a.out ? { ...a.out } : undefined })),
  }))

  for (let it = 0; it < iters; it++) {
    current = current.map(c => {
      const n = c.anchors.length
      if (n < 3) return c
      const nextAnchors: PathAnchor[] = []
      for (let i = 0; i < n; i++) {
        if (!c.closed && (i === 0 || i === n - 1)) {
          nextAnchors.push({ ...c.anchors[i] })
          continue
        }
        const prev = c.anchors[(i - 1 + n) % n]
        const curr = c.anchors[i]
        const next = c.anchors[(i + 1) % n]

        const avgX = (prev.x + next.x) / 2
        const avgY = (prev.y + next.y) / 2
        const smoothX = curr.x + (avgX - curr.x) * factor
        const smoothY = curr.y + (avgY - curr.y) * factor
        const dx = smoothX - curr.x, dy = smoothY - curr.y

        nextAnchors.push({
          x: smoothX,
          y: smoothY,
          in: curr.in ? point(curr.in.x + dx, curr.in.y + dy) : undefined,
          out: curr.out ? point(curr.out.x + dx, curr.out.y + dy) : undefined,
          handleType: curr.handleType,
        })
      }
      return { anchors: nextAnchors, closed: c.closed }
    })
  }

  return current
}

function applyMirror(contours: PathContour[], mod: MirrorModifier, bounds: Bounds): PathContour[] {
  const isX = mod.axis === 'x'
  const mirrorCoord = isX ? bounds.x + bounds.width / 2 + mod.offset : bounds.y + bounds.height / 2 + mod.offset

  const mirroredContours: PathContour[] = contours.map(c => {
    const reflected = c.anchors.map(a => {
      const rx = isX ? 2 * mirrorCoord - a.x : a.x
      const ry = isX ? a.y : 2 * mirrorCoord - a.y
      const rIn = a.out ? point(isX ? 2 * mirrorCoord - a.out.x : a.out.x, isX ? a.out.y : 2 * mirrorCoord - a.out.y) : undefined
      const rOut = a.in ? point(isX ? 2 * mirrorCoord - a.in.x : a.in.x, isX ? a.in.y : 2 * mirrorCoord - a.in.y) : undefined
      return {
        x: rx,
        y: ry,
        in: rIn,
        out: rOut,
        handleType: a.handleType,
      }
    })
    // Reverse order to preserve correct winding direction
    return {
      anchors: reflected.reverse(),
      closed: c.closed,
    }
  })

  return [...contours, ...mirroredContours]
}

function applyWave(contours: PathContour[], mod: WaveModifier, bounds: Bounds): PathContour[] {
  const amp = mod.amplitude
  const freq = mod.frequency
  const phaseRad = (mod.phase * Math.PI) / 180
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2

  const deformPoint = (p: Point): Point => {
    if (mod.axis === 'y') {
      const normY = (p.y - bounds.y) / Math.max(1, bounds.height)
      const offset = amp * Math.sin(normY * 2 * Math.PI * freq + phaseRad)
      return point(p.x + offset, p.y)
    }
    if (mod.axis === 'x') {
      const normX = (p.x - bounds.x) / Math.max(1, bounds.width)
      const offset = amp * Math.sin(normX * 2 * Math.PI * freq + phaseRad)
      return point(p.x, p.y + offset)
    }
    // Radial
    const d = Math.hypot(p.x - cx, p.y - cy)
    const angle = Math.atan2(p.y - cy, p.x - cx)
    const radialOffset = amp * Math.sin(d * 0.05 * freq + phaseRad)
    return point(p.x + radialOffset * Math.cos(angle), p.y + radialOffset * Math.sin(angle))
  }

  return contours.map(c => ({
    closed: c.closed,
    anchors: c.anchors.map(a => ({
      x: deformPoint(a).x,
      y: deformPoint(a).y,
      in: a.in ? deformPoint(a.in) : undefined,
      out: a.out ? deformPoint(a.out) : undefined,
      handleType: a.handleType,
    })),
  }))
}

function applyTwist(contours: PathContour[], mod: TwistModifier, bounds: Bounds): PathContour[] {
  const maxAngleRad = (mod.angle * Math.PI) / 180
  const R = Math.max(1, mod.radius)
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2

  const twistPoint = (p: Point): Point => {
    const d = Math.hypot(p.x - cx, p.y - cy)
    if (d >= R) return p
    const decay = (1 - d / R) ** 2
    const angle = maxAngleRad * decay
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const dx = p.x - cx, dy = p.y - cy
    return point(cx + cos * dx - sin * dy, cy + sin * dx + cos * dy)
  }

  return contours.map(c => ({
    closed: c.closed,
    anchors: c.anchors.map(a => ({
      x: twistPoint(a).x,
      y: twistPoint(a).y,
      in: a.in ? twistPoint(a.in) : undefined,
      out: a.out ? twistPoint(a.out) : undefined,
      handleType: a.handleType,
    })),
  }))
}

// -------------------------------------------------------------
// Main Modifier Stack Evaluation Pipeline
// -------------------------------------------------------------

/**
 * Sequentially evaluates a chain of modifiers on a vector element.
 * Fully non-destructive and reversible.
 */
export function evaluateModifierStack(
  baseElement: VectorElement & { readonly baseD?: string },
  modifiers: readonly VectorModifier[],
  context: ModifierEvaluationContext
): ModifierEvaluationResult {
  const baseD = baseElement.type === 'path' ? (baseElement.baseD ?? baseElement.d) : vectorPathData(baseElement)
  let currentD = baseD || (baseElement.type === 'path' ? baseElement.d : vectorPathData(baseElement))
  let currentViewBox: readonly [number, number, number, number] =
    baseElement.type === 'path' ? baseElement.viewBox : [0, 0, baseElement.width, baseElement.height]

  const totalModifierCount = modifiers.length
  let activeModifierCount = 0
  let evaluationError: string | undefined

  if (!modifiers.length) {
    const parsed = parsePath(currentD)
    const bounds = boundsOfContours(parsed)
    return {
      d: currentD,
      viewBox: currentViewBox,
      bounds,
      fillRule: baseElement.type === 'path' ? baseElement.fillRule : 'nonzero',
      activeModifierCount: 0,
      totalModifierCount: 0,
    }
  }

  for (const mod of modifiers) {
    if (!mod.enabled) continue
    activeModifierCount++

    try {
      if (mod.type === 'csg') {
        let operandD = mod.operandD
        if (mod.targetLayerId && context.elements[mod.targetLayerId]) {
          const target = context.elements[mod.targetLayerId]
          if (target && ['rectangle', 'ellipse', 'path'].includes(target.type)) {
            const targetVec = target as VectorElement
            const targetParsedD = targetVec.type === 'path' ? targetVec.d : vectorPathData(targetVec)
            operandD = targetParsedD || operandD
          }
        }
        if (operandD) {
          const csgRes = computePathCSG(currentD, operandD, mod.operation, {
            adaptiveSubdivision: mod.adaptiveSubdivision,
            tolerance: mod.tolerance,
          })
          currentD = csgRes.d
          currentViewBox = csgRes.viewBox
        }
      } else if (mod.type === 'subdivide') {
        const parsed = parsePath(currentD)
        const subdivided = adaptiveSubdivideContours(parsed, {
          tolerance: mod.flatness,
          maxSegmentLength: mod.maxSegmentLength,
          maxDepth: mod.maxDepth,
          angleThreshold: mod.angleThreshold,
          reconstructCurves: mod.reconstructCurves,
        })
        currentD = serializePath(subdivided)
      } else {
        const parsed = parsePath(currentD)
        const currentBounds = boundsOfContours(parsed)
        let modifiedContours: PathContour[]

        switch (mod.type) {
          case 'fillet':
            modifiedContours = applyFillet(parsed, mod)
            break
          case 'offset':
            modifiedContours = applyOffset(parsed, mod)
            break
          case 'simplify':
            modifiedContours = applySimplify(parsed, mod)
            break
          case 'smooth':
            modifiedContours = applySmooth(parsed, mod)
            break
          case 'mirror':
            modifiedContours = applyMirror(parsed, mod, currentBounds)
            break
          case 'wave':
            modifiedContours = applyWave(parsed, mod, currentBounds)
            break
          case 'twist':
            modifiedContours = applyTwist(parsed, mod, currentBounds)
            break
          default:
            modifiedContours = parsed
            break
        }

        currentD = serializePath(modifiedContours)
      }
    } catch (err) {
      evaluationError = err instanceof Error ? err.message : String(err)
      // Keep previous valid shape so rendering does not break
    }
  }

  const finalParsed = parsePath(currentD)
  const finalBounds = boundsOfContours(finalParsed)
  const optimizedD = optimizeSvgBezierData(currentD, { precision: 4 })

  return {
    d: optimizedD || currentD,
    viewBox: [finalBounds.x, finalBounds.y, finalBounds.width, finalBounds.height],
    bounds: finalBounds,
    fillRule: baseElement.type === 'path' ? baseElement.fillRule : 'nonzero',
    activeModifierCount,
    totalModifierCount,
    error: evaluationError,
  }
}

/** Validates modifier configuration */
export function validateModifier(modifier: VectorModifier): void {
  if (!modifier || typeof modifier.id !== 'string' || !modifier.id) throw new Error('Invalid modifier id')
  if (typeof modifier.name !== 'string' || !modifier.name) throw new Error('Invalid modifier name')
  if (typeof modifier.enabled !== 'boolean') throw new Error('Invalid modifier enabled flag')
  if (![
    'csg',
    'subdivide',
    'fillet',
    'offset',
    'simplify',
    'smooth',
    'mirror',
    'wave',
    'twist',
  ].includes(modifier.type)) {
    throw new Error('Invalid modifier type')
  }

  if (modifier.type === 'csg') {
    if (!['union', 'difference', 'intersection', 'exclusion'].includes(modifier.operation)) {
      throw new Error('Invalid CSG operation')
    }
  } else if (modifier.type === 'subdivide') {
    if (!Number.isFinite(modifier.flatness) || modifier.flatness <= 0) throw new Error('Invalid subdivision flatness')
    if (!Number.isFinite(modifier.maxSegmentLength) || modifier.maxSegmentLength <= 0) throw new Error('Invalid max segment length')
  } else if (modifier.type === 'fillet') {
    if (!Number.isFinite(modifier.radius) || modifier.radius < 0) throw new Error('Invalid fillet radius')
  } else if (modifier.type === 'offset') {
    if (!Number.isFinite(modifier.distance)) throw new Error('Invalid offset distance')
  } else if (modifier.type === 'simplify') {
    if (!Number.isFinite(modifier.tolerance) || modifier.tolerance < 0) throw new Error('Invalid simplify tolerance')
  } else if (modifier.type === 'smooth') {
    if (!Number.isFinite(modifier.strength) || modifier.strength < 0 || modifier.strength > 1) throw new Error('Invalid smooth strength')
  }
}
