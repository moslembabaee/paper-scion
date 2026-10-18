import type { Point } from '../canvas/types.ts'
import {
  contourArea,
  contourBounds,
  contourCentroid,
  cubicArcLength,
  fromPolar,
  lerpPoint,
  serializeCubicContours,
  shortestAngleDiff,
  toPolar,
} from './geometry.ts'
import { alignContourPair, buildTrajectoryLines } from './align.ts'
import { equalizeShapes } from './equalize.ts'
import { buildNormalizedShape } from './normalize.ts'
import type {
  CubicContour,
  CubicSegment,
  MorphConfig,
  MorphEasing,
  MorphResult,
  NormalizedShape,
} from './types.ts'

/** Evaluate easing curves */
export function evaluateEasing(easing: MorphEasing, t: number): number {
  const clamped = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0
  if (clamped === 0 || clamped === 1) return clamped
  switch (easing) {
    case 'linear':
      return clamped
    case 'easeInOutCubic':
      return clamped < 0.5
        ? 4 * clamped * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 3) / 2
    case 'easeInQuad':
      return clamped * clamped
    case 'easeOutQuad':
      return 1 - (1 - clamped) * (1 - clamped)
    case 'easeInOutQuad':
      return clamped < 0.5
        ? 2 * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 2) / 2
    case 'anticipate': {
      const c1 = 1.70158
      const c2 = c1 * 1.525
      return clamped < 0.5
        ? (Math.pow(2 * clamped, 2) * ((c2 + 1) * 2 * clamped - c2)) / 2
        : (Math.pow(2 * clamped - 2, 2) * ((c2 + 1) * (clamped * 2 - 2) + c2) + 2) / 2
    }
    case 'easeOutBack': {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(clamped - 1, 3) + c1 * Math.pow(clamped - 1, 2)
    }
    case 'spring': {
      // Damped harmonic oscillator
      const omega = 14
      const zeta = 0.65
      const decay = Math.exp(-zeta * omega * clamped)
      return 1 - decay * Math.cos(omega * Math.sqrt(1 - zeta * zeta) * clamped)
    }
    case 'elastic': {
      const c4 = (2 * Math.PI) / 3
      return clamped === 0
        ? 0
        : clamped === 1
        ? 1
        : Math.pow(2, -10 * clamped) * Math.sin((clamped * 10 - 0.75) * c4) + 1
    }
    case 'bounce': {
      const n1 = 7.5625
      const d1 = 2.75
      let x = clamped
      if (x < 1 / d1) {
        return n1 * x * x
      } else if (x < 2 / d1) {
        x -= 1.5 / d1
        return n1 * x * x + 0.75
      } else if (x < 2.5 / d1) {
        x -= 2.25 / d1
        return n1 * x * x + 0.9375
      } else {
        x -= 2.625 / d1
        return n1 * x * x + 0.984375
      }
    }
  }
}

/** Interpolate two points using Cartesian, Polar, or Blended coordinates */
export function interpolatePoint(
  pA: Point,
  pB: Point,
  t: number,
  mode: 'cartesian' | 'polar' | 'blended',
  blend: number,
  centerA: Point,
  centerB: Point
): Point {
  const pCartesian = lerpPoint(pA, pB, t)
  if (mode === 'cartesian' || (mode === 'blended' && blend <= 1e-4)) {
    return pCartesian
  }

  // Polar interpolation
  const centerT = lerpPoint(centerA, centerB, t)
  const polarA = toPolar(pA, centerA)
  const polarB = toPolar(pB, centerB)

  const diffTheta = shortestAngleDiff(polarA.theta, polarB.theta)
  const thetaT = polarA.theta + t * diffTheta
  const rT = polarA.r + (polarB.r - polarA.r) * t

  const pPolar = fromPolar(rT, thetaT, centerT)

  if (mode === 'polar') {
    return pPolar
  }

  // Blended
  return lerpPoint(pCartesian, pPolar, blend)
}

/** Interpolate a single cubic segment */
export function interpolateSegment(
  segA: CubicSegment,
  segB: CubicSegment,
  t: number,
  mode: 'cartesian' | 'polar' | 'blended',
  blend: number,
  centerA: Point,
  centerB: Point
): CubicSegment {
  return {
    p0: interpolatePoint(segA.p0, segB.p0, t, mode, blend, centerA, centerB),
    p1: interpolatePoint(segA.p1, segB.p1, t, mode, blend, centerA, centerB),
    p2: interpolatePoint(segA.p2, segB.p2, t, mode, blend, centerA, centerB),
    p3: interpolatePoint(segA.p3, segB.p3, t, mode, blend, centerA, centerB),
  }
}

/** Interpolate a single cubic contour */
export function interpolateContour(
  contourA: CubicContour,
  contourB: CubicContour,
  t: number,
  mode: 'cartesian' | 'polar' | 'blended' = 'blended',
  blend = 0.35
): CubicContour {
  const n = Math.min(contourA.segments.length, contourB.segments.length)
  const segments: CubicSegment[] = []

  const centerA = contourA.centroid
  const centerB = contourB.centroid

  for (let i = 0; i < n; i++) {
    segments.push(
      interpolateSegment(contourA.segments[i], contourB.segments[i], t, mode, blend, centerA, centerB)
    )
  }

  const segmentLengths = segments.map(seg => cubicArcLength(seg))
  const arcLength = segmentLengths.reduce((sum, len) => sum + len, 0)
  const bounds = contourBounds(segments)
  const centroid = contourCentroid(segments)
  const area = contourArea(segments)

  return {
    segments,
    closed: contourA.closed && contourB.closed,
    arcLength,
    segmentLengths,
    centroid,
    area,
    isClockwise: area >= 0,
    bounds,
  }
}

/** Expensive correspondence work, shared by playback and all export frames. */
export interface PreparedMorph {
  readonly shapeA: NormalizedShape
  readonly shapeB: NormalizedShape
  readonly trajectoryStrain: number
}

export function prepareMorph(
  rawContoursA: readonly CubicContour[],
  rawContoursB: readonly CubicContour[],
  config: MorphConfig
): PreparedMorph {
  const { equalizedA, equalizedB } = equalizeShapes(
    rawContoursA, rawContoursB, config.pointCount, config.equalizationStrategy
  )
  let totalStrain = 0
  const alignedB = equalizedB.map((contour, i) => {
    const result = alignContourPair(equalizedA[i], contour, config.alignmentStrategy,
      config.manualShiftOffset, config.autoMatchWinding)
    totalStrain += result.trajectoryStrain
    return result.alignedB
  })
  return {
    shapeA: buildNormalizedShape(equalizedA),
    shapeB: buildNormalizedShape(alignedB),
    trajectoryStrain: totalStrain / Math.max(1, equalizedA.length),
  }
}

/** Linear work per frame; subdivision and alignment never run in this loop. */
export function interpolateMorph(prepared: PreparedMorph, progress: number, config: MorphConfig): MorphResult {
  const rawProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  const easedProgress = evaluateEasing(config.easing, rawProgress)
  const { shapeA, shapeB, trajectoryStrain } = prepared
  const contours = shapeA.contours.map((contour, i) => interpolateContour(
    contour, shapeB.contours[i], easedProgress, config.interpolationMode, config.polarBlend
  ))
  let index = 0
  const trajectories = shapeA.contours.flatMap((contour, ci) =>
    buildTrajectoryLines(contour, shapeB.contours[ci], easedProgress).map((line, si) => ({
      ...line, index: index++, current: contours[ci].segments[si].p0,
    }))
  )
  return {
    d: serializeCubicContours(contours), shapeA, shapeB,
    interpolatedShape: buildNormalizedShape(contours), trajectories,
    trajectoryStrain, easedProgress, rawProgress,
  }
}

export function computeMorph(
  rawContoursA: readonly CubicContour[], rawContoursB: readonly CubicContour[],
  progress: number, config: MorphConfig
): MorphResult {
  return interpolateMorph(prepareMorph(rawContoursA, rawContoursB, config), progress, config)
}
