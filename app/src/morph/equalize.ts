import type { Point } from '../canvas/types.ts'
import {
  contourArea,
  contourBounds,
  contourCentroid,
  cubicArcLength,
  cubicCurvature,
  cubicParameterAtDistance,
  splitCubic,
} from './geometry.ts'
import type { CubicContour, CubicSegment, EqualizationStrategy } from './types.ts'

/** Subdivide a contour until it has exactly targetCount segments */
export function equalizeContourSegments(
  contour: CubicContour,
  targetCount: number,
  strategy: EqualizationStrategy = 'adaptive-arclength'
): CubicContour {
  targetCount = Number.isFinite(targetCount) ? Math.max(0, Math.ceil(targetCount)) : 0
  const currentCount = contour.segments.length
  if (currentCount >= targetCount) return contour
  if (currentCount === 0) return contour

  let segments = [...contour.segments]

  if (strategy === 'adaptive-arclength') {
    // Priority-based subdivision: repeatedly split the longest segment
    while (segments.length < targetCount) {
      // Find segment with maximum arc length
      let maxLen = -1
      let maxIdx = 0

      for (let i = 0; i < segments.length; i++) {
        const len = cubicArcLength(segments[i])
        if (len > maxLen) {
          maxLen = len
          maxIdx = i
        }
      }

      // Split at midpoint of arc length
      const segToSplit = segments[maxIdx]
      const tMid = cubicParameterAtDistance(segToSplit, 0.5)
      const [left, right] = splitCubic(segToSplit, tMid)

      segments.splice(maxIdx, 1, left, right)
    }
  } else if (strategy === 'curvature') {
    // Priority-based subdivision: weighted by segment length * mean curvature
    while (segments.length < targetCount) {
      let maxScore = -1
      let maxIdx = 0

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const len = cubicArcLength(seg)
        const k0 = cubicCurvature(seg, 0.1)
        const k1 = cubicCurvature(seg, 0.5)
        const k2 = cubicCurvature(seg, 0.9)
        const meanCurvature = (k0 + 2 * k1 + k2) / 4
        // Score balances length and curvature
        const score = len * (1 + meanCurvature * 25)

        if (score > maxScore) {
          maxScore = score
          maxIdx = i
        }
      }

      const segToSplit = segments[maxIdx]
      const tMid = cubicParameterAtDistance(segToSplit, 0.5)
      const [left, right] = splitCubic(segToSplit, tMid)

      segments.splice(maxIdx, 1, left, right)
    }
  } else {
    // Uniform subdivision: evenly subdivide each segment
    const newSegments: CubicSegment[] = []

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      // Determine how many pieces this segment needs
      const remainingSegments = segments.length - i
      const remainingTarget = targetCount - newSegments.length
      const countForThis = Math.max(1, Math.round(remainingTarget / remainingSegments))

      if (countForThis <= 1) {
        newSegments.push(seg)
      } else {
        let currentSeg = seg
        for (let j = 0; j < countForThis; j++) {
          const fraction = 1 / (countForThis - j)
          if (j === countForThis - 1) {
            newSegments.push(currentSeg)
          } else {
            const [left, right] = splitCubic(currentSeg, fraction)
            newSegments.push(left)
            currentSeg = right
          }
        }
      }
    }
    segments = newSegments
  }

  // Ensure exact target count
  while (segments.length < targetCount) {
    const last = segments[segments.length - 1]
    const [left, right] = splitCubic(last, 0.5)
    segments.splice(segments.length - 1, 1, left, right)
  }

  const segmentLengths = segments.map(seg => cubicArcLength(seg))
  const arcLength = segmentLengths.reduce((sum, len) => sum + len, 0)
  const bounds = contourBounds(segments)
  const centroid = contourCentroid(segments)
  const area = contourArea(segments)

  return {
    segments,
    closed: contour.closed,
    arcLength,
    segmentLengths,
    centroid,
    area,
    isClockwise: contour.isClockwise,
    bounds,
  }
}

/** Create a degenerate zero-area contour at a specific point */
export function createDegenerateContour(center: Point, segmentCount: number, closed = true): CubicContour {
  const segments: CubicSegment[] = []
  for (let i = 0; i < segmentCount; i++) {
    segments.push({
      p0: { ...center },
      p1: { ...center },
      p2: { ...center },
      p3: { ...center },
    })
  }

  return {
    segments,
    closed,
    arcLength: 0,
    segmentLengths: new Array(segmentCount).fill(0),
    centroid: { ...center },
    area: 0,
    isClockwise: true,
    bounds: { minX: center.x, minY: center.y, maxX: center.x, maxY: center.y, width: 0, height: 0 },
  }
}

/** Equalize two shapes so they have the exact same number of contours and segments */
export function equalizeShapes(
  contoursA: readonly CubicContour[],
  contoursB: readonly CubicContour[],
  minPointCount = 0,
  strategy: EqualizationStrategy = 'adaptive-arclength'
): { equalizedA: CubicContour[]; equalizedB: CubicContour[] } {
  if (!contoursA.length && !contoursB.length) {
    return { equalizedA: [], equalizedB: [] }
  }

  minPointCount = Number.isFinite(minPointCount) ? Math.max(0, Math.min(256, Math.ceil(minPointCount))) : 0

  // Determine target contour count
  const maxContours = Math.max(contoursA.length, contoursB.length)
  const bySize = (a: CubicContour, b: CubicContour) => Math.abs(b.area) - Math.abs(a.area) || b.arcLength - a.arcLength
  const listA = [...contoursA].sort(bySize)
  const remaining = [...contoursB].sort(bySize)
  const listB: CubicContour[] = []
  for (const a of listA) {
    if (!remaining.length) break
    let best = 0, bestCost = Infinity
    remaining.forEach((b, i) => {
      const cost = Math.hypot(a.centroid.x - b.centroid.x, a.centroid.y - b.centroid.y)
        + Math.abs(Math.sqrt(Math.abs(a.area)) - Math.sqrt(Math.abs(b.area))) * 2
        + (a.closed === b.closed ? 0 : 1000)
      if (cost < bestCost) { best = i; bestCost = cost }
    })
    listB.push(remaining.splice(best, 1)[0])
  }
  listB.push(...remaining)

  // If one shape has fewer contours, create degenerate contours at the centroid of the other
  while (listA.length < maxContours) {
    const counterpart = listB[listA.length]
    listA.push(createDegenerateContour(counterpart.centroid, counterpart.segments.length, counterpart.closed))
  }
  while (listB.length < maxContours) {
    const counterpart = listA[listB.length]
    listB.push(createDegenerateContour(counterpart.centroid, counterpart.segments.length, counterpart.closed))
  }

  // For each matched contour pair, equalize their segment counts
  const equalizedA: CubicContour[] = []
  const equalizedB: CubicContour[] = []

  for (let i = 0; i < maxContours; i++) {
    const cA = listA[i]
    const cB = listB[i]

    const targetSegments = Math.max(cA.segments.length, cB.segments.length, minPointCount)

    equalizedA.push(equalizeContourSegments(cA, targetSegments, strategy))
    equalizedB.push(equalizeContourSegments(cB, targetSegments, strategy))
  }

  return { equalizedA, equalizedB }
}
