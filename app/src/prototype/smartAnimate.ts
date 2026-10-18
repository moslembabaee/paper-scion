import type { SceneDocument, SceneElement } from '../scene/types.ts'
import { parsePath, type PathContour } from '../scene/pathGeometry.ts'
import { pathToCubicContour } from '../morph/normalize.ts'
import { prepareMorph, interpolateMorph, type PreparedMorph } from '../morph/interpolate.ts'
import { DEFAULT_MORPH_CONFIG } from '../morph/presets.ts'
import type { CubicContour, MorphConfig } from '../morph/types.ts'
import type { PrototypeTransition, SpringParameters } from './types.ts'
import { DEFAULT_SPRING, springDuration, springProgress, springState } from './spring.ts'
import { easeProgress, easingCurve, matchedLayers } from './model.ts'

export interface LayoutDiff {
  readonly dx: number
  readonly dy: number
  readonly dWidth: number
  readonly dHeight: number
  readonly dRotation: number
  readonly dCornerRadius: number
  readonly dOpacity: number
  readonly hasLayoutChanged: boolean
}

export interface StyleDiff {
  readonly fromFill: string | null
  readonly toFill: string | null
  readonly fromStroke: string | null
  readonly toStroke: string | null
  readonly fromStrokeWidth: number
  readonly toStrokeWidth: number
  readonly hasStyleChanged: boolean
}

export interface GeometryDiff {
  readonly isVector: boolean
  readonly isMorphable: boolean
  readonly fromD: string | null
  readonly toD: string | null
  readonly hasGeometryChanged: boolean
  readonly preparedMorph: PreparedMorph | null
  readonly segmentCount: number
}

export interface SmartMatchedPair {
  readonly from: SceneElement
  readonly to: SceneElement
  readonly layoutDiff: LayoutDiff
  readonly styleDiff: StyleDiff
  readonly geometryDiff: GeometryDiff
}

export interface ScreenDiffSummary {
  readonly totalMatched: number
  readonly layoutDiffCount: number
  readonly geometryDiffCount: number
  readonly styleDiffCount: number
  readonly enteringCount: number
  readonly exitingCount: number
  readonly morphablePathCount: number
}

export interface ScreenDiff {
  readonly fromFrameId: string
  readonly toFrameId: string
  readonly fromFrameName: string
  readonly toFrameName: string
  readonly matched: readonly SmartMatchedPair[]
  readonly entering: readonly SceneElement[]
  readonly exiting: readonly SceneElement[]
  readonly summary: ScreenDiffSummary
}

const KAPPA = 0.5522847498

/** Generate cubic SVG path data for a rectangle, supporting corner radii */
export function rectToCubicPath(width: number, height: number, cornerRadius = 0): string {
  const w = Math.max(1, width), h = Math.max(1, height)
  const r = Math.max(0, Math.min(cornerRadius, w / 2, h / 2))
  if (r <= 0) {
    return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`
  }
  const k = KAPPA * r
  return `M ${r} 0 ` +
    `L ${w - r} 0 C ${w - r + k} 0 ${w} ${r - k} ${w} ${r} ` +
    `L ${w} ${h - r} C ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h} ` +
    `L ${r} ${h} C ${r - k} ${h} 0 ${h - r + k} 0 ${h - r} ` +
    `L 0 ${r} C 0 ${r - k} ${r - k} 0 ${r} 0 Z`
}

/** Generate cubic SVG path data for an ellipse */
export function ellipseToCubicPath(width: number, height: number): string {
  const w = Math.max(1, width), h = Math.max(1, height)
  const rx = w / 2, ry = h / 2, cx = rx, cy = ry
  const kx = rx * KAPPA, ky = ry * KAPPA
  return `M ${cx} ${cy - ry} ` +
    `C ${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy} ` +
    `C ${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry} ` +
    `C ${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy} ` +
    `C ${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry} Z`
}

/** Extract or synthesize SVG path representation from any supported scene element */
export function elementToSvgPath(element: SceneElement): { d: string; viewBox: readonly [number, number, number, number] } | null {
  if (element.type === 'path') {
    return { d: element.d, viewBox: element.viewBox }
  }
  if (element.type === 'rectangle') {
    return {
      d: rectToCubicPath(element.width, element.height, element.cornerRadius),
      viewBox: [0, 0, element.width, element.height],
    }
  }
  if (element.type === 'ellipse') {
    return {
      d: ellipseToCubicPath(element.width, element.height),
      viewBox: [0, 0, element.width, element.height],
    }
  }
  return null
}

/** Safely parse path contours into cubic contours for morphing */
export function elementToCubicContours(element: SceneElement): CubicContour[] | null {
  const svg = elementToSvgPath(element)
  if (!svg || !svg.d.trim()) return null
  try {
    const contours: PathContour[] = parsePath(svg.d)
    if (!contours.length) return null
    return contours.map(pathToCubicContour)
  } catch {
    return null
  }
}

/** Compute numeric layout differences between two matched elements */
export function computeLayoutDiff(from: SceneElement, to: SceneElement): LayoutDiff {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dWidth = to.width - from.width
  const dHeight = to.height - from.height
  const rawRot = (to.rotation - from.rotation) % 360
  const dRotation = rawRot > 180 ? rawRot - 360 : rawRot < -180 ? rawRot + 360 : rawRot
  const fromR = 'cornerRadius' in from && typeof from.cornerRadius === 'number' ? from.cornerRadius : 0
  const toR = 'cornerRadius' in to && typeof to.cornerRadius === 'number' ? to.cornerRadius : 0
  const dCornerRadius = toR - fromR
  const dOpacity = to.style.opacity - from.style.opacity

  const hasLayoutChanged = Math.abs(dx) > 0.01 ||
    Math.abs(dy) > 0.01 ||
    Math.abs(dWidth) > 0.01 ||
    Math.abs(dHeight) > 0.01 ||
    Math.abs(dRotation) > 0.01 ||
    Math.abs(dCornerRadius) > 0.01 ||
    Math.abs(dOpacity) > 0.01

  return {
    dx,
    dy,
    dWidth,
    dHeight,
    dRotation,
    dCornerRadius,
    dOpacity,
    hasLayoutChanged,
  }
}

/** Compute style differences between two matched elements */
export function computeStyleDiff(from: SceneElement, to: SceneElement): StyleDiff {
  const fromFill = from.style.fill
  const toFill = to.style.fill
  const fromStroke = from.style.stroke?.color ?? null
  const toStroke = to.style.stroke?.color ?? null
  const fromStrokeWidth = from.style.stroke?.width ?? 0
  const toStrokeWidth = to.style.stroke?.width ?? 0

  const hasStyleChanged = fromFill !== toFill ||
    fromStroke !== toStroke ||
    Math.abs(fromStrokeWidth - toStrokeWidth) > 0.01

  return {
    fromFill,
    toFill,
    fromStroke,
    toStroke,
    fromStrokeWidth,
    toStrokeWidth,
    hasStyleChanged,
  }
}

/** Compute Bézier path and vector geometry diff, preparing morph when shapes differ */
export function computeGeometryDiff(from: SceneElement, to: SceneElement, config: MorphConfig = DEFAULT_MORPH_CONFIG): GeometryDiff {
  const fromSvg = elementToSvgPath(from)
  const toSvg = elementToSvgPath(to)

  if (!fromSvg || !toSvg) {
    return {
      isVector: false,
      isMorphable: false,
      fromD: null,
      toD: null,
      hasGeometryChanged: false,
      preparedMorph: null,
      segmentCount: 0,
    }
  }

  const fromD = fromSvg.d
  const toD = toSvg.d
  const isIdentical = fromD === toD && from.type === to.type &&
    ('cornerRadius' in from ? from.cornerRadius : 0) === ('cornerRadius' in to ? to.cornerRadius : 0)

  if (isIdentical) {
    return {
      isVector: true,
      isMorphable: false,
      fromD,
      toD,
      hasGeometryChanged: false,
      preparedMorph: null,
      segmentCount: 0,
    }
  }

  // Attempt to prepare morph
  try {
    const rawA = elementToCubicContours(from)
    const rawB = elementToCubicContours(to)
    if (rawA && rawB && rawA.length && rawB.length) {
      const preparedMorph = prepareMorph(rawA, rawB, config)
      const segmentCount = preparedMorph.shapeA.contours.reduce((sum, c) => sum + c.segments.length, 0)
      return {
        isVector: true,
        isMorphable: true,
        fromD,
        toD,
        hasGeometryChanged: true,
        preparedMorph,
        segmentCount,
      }
    }
  } catch {
    // If complex parse fails, fallback to non-morphable vector
  }

  return {
    isVector: true,
    isMorphable: false,
    fromD,
    toD,
    hasGeometryChanged: true,
    preparedMorph: null,
    segmentCount: 0,
  }
}

/** Compute complete screen diff between two prototype frames */
export function computeScreenDiff(
  elements: SceneDocument['elements'],
  fromFrameId: string,
  toFrameId: string,
  morphConfig: MorphConfig = DEFAULT_MORPH_CONFIG
): ScreenDiff {
  const fromFrame = elements[fromFrameId]
  const toFrame = elements[toFrameId]

  const pairs = matchedLayers(elements, fromFrameId, toFrameId)
  const matchedFromIds = new Set(pairs.map(p => p.from.id))
  const matchedToIds = new Set(pairs.map(p => p.to.id))

  // Collect descendants in fromFrame
  const collectDescendants = (rootId: string): SceneElement[] => {
    const result: SceneElement[] = []
    const visit = (id: string) => {
      const node = elements[id]
      if (!node || !node.visible) return
      result.push(node)
      if (node.type === 'frame') {
        for (const childId of node.children) visit(childId)
      }
    }
    visit(rootId)
    return result
  }

  const fromElements = collectDescendants(fromFrameId)
  const toElements = collectDescendants(toFrameId)

  const exiting = fromElements.filter(el => !matchedFromIds.has(el.id))
  const entering = toElements.filter(el => !matchedToIds.has(el.id))

  let layoutDiffCount = 0
  let geometryDiffCount = 0
  let styleDiffCount = 0
  let morphablePathCount = 0

  const matched: SmartMatchedPair[] = pairs.map(pair => {
    const layoutDiff = computeLayoutDiff(pair.from, pair.to)
    const styleDiff = computeStyleDiff(pair.from, pair.to)
    const geometryDiff = computeGeometryDiff(pair.from, pair.to, morphConfig)

    if (layoutDiff.hasLayoutChanged) layoutDiffCount++
    if (geometryDiff.hasGeometryChanged) geometryDiffCount++
    if (styleDiff.hasStyleChanged) styleDiffCount++
    if (geometryDiff.isMorphable) morphablePathCount++

    return {
      from: pair.from,
      to: pair.to,
      layoutDiff,
      styleDiff,
      geometryDiff,
    }
  })

  return {
    fromFrameId,
    toFrameId,
    fromFrameName: fromFrame?.name ?? 'Screen A',
    toFrameName: toFrame?.name ?? 'Screen B',
    matched,
    entering,
    exiting,
    summary: {
      totalMatched: matched.length,
      layoutDiffCount,
      geometryDiffCount,
      styleDiffCount,
      enteringCount: entering.length,
      exitingCount: exiting.length,
      morphablePathCount,
    },
  }
}

/** Interpolate a prepared Bézier morph path at a given progress t [0, 1] */
export function interpolateSmartPath(
  preparedMorph: PreparedMorph | null,
  progress: number,
  config: MorphConfig = DEFAULT_MORPH_CONFIG
): string | null {
  if (!preparedMorph) return null
  const clampedProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  const result = interpolateMorph(preparedMorph, clampedProgress, { ...config, easing: 'linear' })
  return result.d
}

/** Compute spring-interpolated progress for transition */
export function smartTransitionProgress(
  rawProgress: number,
  transition: PrototypeTransition,
  duration = transitionDuration(transition)
): number {
  if (transition.easing === 'spring') {
    const spring = transition.spring ?? DEFAULT_SPRING
    return springProgress(rawProgress, spring, duration)
  }
  return easeProgress(rawProgress, easingCurve(transition))
}

function transitionDuration(t: PrototypeTransition): number {
  return t.kind === 'instant' ? 0 : t.easing === 'spring' ? springDuration(t.spring) : t.duration
}

/** Evaluate 2D transformation matrix at scrub or interpolated progress t */
export function evaluateSmartMatrix(
  from: SceneElement,
  to: SceneElement,
  t: number,
  parent?: { from: SceneElement; to: SceneElement },
  fitRatio = 1,
  scrollOffset = 0,
  scrollLeft = 0
): string {
  const root = !parent
  const radiansFrom = (root ? 0 : from.rotation) * Math.PI / 180
  const radiansTo = (root ? 0 : to.rotation) * Math.PI / 180

  const cosFrom = Math.cos(radiansFrom), sinFrom = Math.sin(radiansFrom)
  const cosTo = Math.cos(radiansTo), sinTo = Math.sin(radiansTo)

  const cxFrom = from.width / 2, cyFrom = from.height / 2
  const cxTo = to.width / 2, cyTo = to.height / 2

  const xFrom = root ? 0 : from.x + cxFrom - cosFrom * cxFrom + sinFrom * cyFrom
  const yFrom = root ? 0 : from.y + cyFrom - sinFrom * cxFrom - cosFrom * cyFrom

  const xTo = root ? 0 : to.x + cxTo - cosTo * cxTo + sinTo * cyTo
  const yTo = root ? 0 : to.y + cyTo - sinTo * cxTo - cosTo * cyTo

  const pxFrom = parent ? parent.to.width / parent.from.width : fitRatio
  const pyFrom = parent ? parent.to.height / parent.from.height : fitRatio
  const pxTo = 1
  const pyTo = 1

  const wRatioFrom = from.width / to.width
  const hRatioFrom = from.height / to.height

  // Start matrix components
  const a0 = cosFrom * wRatioFrom * pxFrom
  const b0 = sinFrom * wRatioFrom * pyFrom
  const c0 = -sinFrom * hRatioFrom * pxFrom
  const d0 = cosFrom * hRatioFrom * pyFrom
  const tx0 = xFrom * pxFrom - (root ? scrollLeft : to.x)
  const ty0 = yFrom * pyFrom - (root ? scrollOffset : to.y)

  // End matrix components
  const a1 = cosTo * 1 * pxTo
  const b1 = sinTo * 1 * pyTo
  const c1 = -sinTo * 1 * pxTo
  const d1 = cosTo * 1 * pyTo
  const tx1 = xTo * pxTo - (root ? 0 : to.x)
  const ty1 = yTo * pyTo - (root ? 0 : to.y)

  // Interpolated components (supports spring overshoot where t > 1 or t < 0)
  const a = a0 + (a1 - a0) * t
  const b = b0 + (b1 - b0) * t
  const c = c0 + (c1 - c0) * t
  const d = d0 + (d1 - d0) * t
  const tx = tx0 + (tx1 - tx0) * t
  const ty = ty0 + (ty1 - ty0) * t

  return `matrix(${Number(a.toFixed(6))},${Number(b.toFixed(6))},${Number(c.toFixed(6))},${Number(d.toFixed(6))},${Number(tx.toFixed(4))},${Number(ty.toFixed(4))})`
}

/** Linear color interpolation helper */
export function interpolateColor(colorA: string | null, colorB: string | null, t: number): string {
  if (!colorA && !colorB) return 'transparent'
  if (!colorA) return colorB!
  if (!colorB) return colorA

  const parse = (c: string) => {
    if (c.startsWith('#')) {
      const hex = c.slice(1)
      if (hex.length === 3) {
        return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), 1]
      }
      if (hex.length === 6) {
        return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1]
      }
      if (hex.length === 8) {
        return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8), 16) / 255]
      }
    }
    const match = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
    if (match) {
      return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] !== undefined ? Number(match[4]) : 1]
    }
    return [0, 0, 0, 1]
  }

  const [r0, g0, b0, a0] = parse(colorA)
  const [r1, g1, b1, a1] = parse(colorB)
  const clampedT = Math.max(0, Math.min(1, t))

  const r = Math.round(r0 + (r1 - r0) * clampedT)
  const g = Math.round(g0 + (g1 - g0) * clampedT)
  const b = Math.round(b0 + (b1 - b0) * clampedT)
  const a = Number((a0 + (a1 - a0) * clampedT).toFixed(3))

  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** Calculate spring physics analytics: frequency, damping ratio, settling time, overshoot */
export function springPhysicsMetrics(spring: SpringParameters = DEFAULT_SPRING): {
  duration: number
  dampingRatio: number
  undampedFrequency: number
  dampedFrequency: number
  overshootPercent: number
  isUnderdamped: boolean
} {
  const duration = springDuration(spring)
  const m = spring.mass, k = spring.stiffness, c = spring.damping
  const omega0 = Math.sqrt(k / m)
  const zeta = c / (2 * Math.sqrt(k * m))
  const isUnderdamped = zeta < 1
  const omegaD = isUnderdamped ? omega0 * Math.sqrt(1 - zeta * zeta) : 0

  let maxPosition = 1
  for (let t = 0; t <= duration; t += 5) {
    const s = springState(t, spring)
    if (s.position > maxPosition) maxPosition = s.position
  }
  const overshootPercent = Math.max(0, (maxPosition - 1) * 100)

  return {
    duration,
    dampingRatio: Number(zeta.toFixed(3)),
    undampedFrequency: Number(omega0.toFixed(2)),
    dampedFrequency: Number(omegaD.toFixed(2)),
    overshootPercent: Number(overshootPercent.toFixed(1)),
    isUnderdamped,
  }
}
