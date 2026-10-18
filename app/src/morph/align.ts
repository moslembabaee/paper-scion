import { distance, distanceSq, lerpPoint } from './geometry.ts'
import { cycleCubicContour, reverseCubicContour } from './normalize.ts'
import type { AlignmentStrategy, CubicContour, TrajectoryLine } from './types.ts'

export interface AlignmentResult {
  alignedB: CubicContour
  optimalShift: number
  reversed: boolean
  trajectoryStrain: number
}

/** Find the cyclic shift and winding orientation of contourB that minimizes trajectory displacement */
export function findOptimalAlignment(
  contourA: CubicContour,
  contourB: CubicContour,
  autoMatchWinding = true
): { optimalShift: number; reversed: boolean; minCost: number } {
  if (!contourA.closed || !contourB.closed || contourA.segments.length <= 1) {
    return { optimalShift: 0, reversed: false, minCost: 0 }
  }

  const n = contourA.segments.length
  let bestCost = Infinity
  let bestShift = 0
  let shouldReverse = false

  const matchWinding = autoMatchWinding && Math.abs(contourA.area) > 1e-6 && Math.abs(contourB.area) > 1e-6
  const needsReverse = matchWinding && contourA.isClockwise !== contourB.isClockwise
  // Preserve compound hole winding as well as minimizing travel.
  for (let s = 0; s < n && !needsReverse; s++) {
    let cost = 0
    for (let i = 0; i < n; i++) {
      const pA = contourA.segments[i].p0
      const pB = contourB.segments[(i + s) % n].p0
      cost += distanceSq(pA, pB)
    }
    if (cost < bestCost) {
      bestCost = cost
      bestShift = s
      shouldReverse = false
    }
  }

  // Test reversed winding if autoMatchWinding is enabled
  if (autoMatchWinding && (!matchWinding || needsReverse)) {
    const reversedB = reverseCubicContour(contourB)
    for (let s = 0; s < n; s++) {
      let cost = 0
      for (let i = 0; i < n; i++) {
        const pA = contourA.segments[i].p0
        const pB = reversedB.segments[(i + s) % n].p0
        cost += distanceSq(pA, pB)
      }
      if (cost < bestCost) {
        bestCost = cost
        bestShift = s
        shouldReverse = true
      }
    }
  }

  return { optimalShift: bestShift, reversed: shouldReverse, minCost: bestCost }
}

/** Align contourB to contourA according to configuration */
export function alignContourPair(
  contourA: CubicContour,
  contourB: CubicContour,
  strategy: AlignmentStrategy = 'auto-distance',
  manualShift = 0,
  autoMatchWinding = true
): AlignmentResult {
  if (!contourA.closed || !contourB.closed || contourA.segments.length <= 1) {
    return {
      alignedB: contourB,
      optimalShift: 0,
      reversed: false,
      trajectoryStrain: 0,
    }
  }

  let alignedB = contourB
  let optimalShift = 0
  let reversed = false

  if (strategy === 'auto-distance') {
    const opt = findOptimalAlignment(contourA, contourB, autoMatchWinding)
    optimalShift = opt.optimalShift
    reversed = opt.reversed
    if (reversed) {
      alignedB = reverseCubicContour(alignedB)
    }
    alignedB = cycleCubicContour(alignedB, optimalShift)
  } else if (strategy === 'manual-shift') {
    optimalShift = manualShift
    if (autoMatchWinding && contourA.isClockwise !== contourB.isClockwise) {
      alignedB = reverseCubicContour(alignedB)
      reversed = true
    }
    alignedB = cycleCubicContour(alignedB, optimalShift)
  } else {
    // None
    if (autoMatchWinding && contourA.isClockwise !== contourB.isClockwise) {
      alignedB = reverseCubicContour(alignedB)
      reversed = true
    }
  }

  // Calculate trajectory strain
  let totalDistSq = 0
  const n = contourA.segments.length
  for (let i = 0; i < n; i++) {
    totalDistSq += distanceSq(contourA.segments[i].p0, alignedB.segments[i].p0)
  }
  const trajectoryStrain = Math.sqrt(totalDistSq / Math.max(1, n))

  return {
    alignedB,
    optimalShift,
    reversed,
    trajectoryStrain,
  }
}

/** Build trajectory correspondence lines between two aligned contours at progress t */
export function buildTrajectoryLines(
  contourA: CubicContour,
  contourB: CubicContour,
  t: number
): TrajectoryLine[] {
  const n = Math.min(contourA.segments.length, contourB.segments.length)
  const lines: TrajectoryLine[] = []

  for (let i = 0; i < n; i++) {
    const from = contourA.segments[i].p0
    const to = contourB.segments[i].p0
    const current = lerpPoint(from, to, t)
    lines.push({
      from,
      to,
      current,
      index: i,
      distance: distance(from, to),
    })
  }

  return lines
}
