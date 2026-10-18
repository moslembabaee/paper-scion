import type { Point } from '../canvas/types.ts'
import { parsePath, type PathContour, type PathNodes } from '../scene/pathGeometry.ts'
import {
  contourArea,
  contourBounds,
  contourCentroid,
  cubicArcLength,
  lerpPoint,
} from './geometry.ts'
import type { CubicContour, CubicSegment, NormalizedShape, MorphTarget } from './types.ts'

/** Convert PathContour to CubicContour where every segment is a cubic Bezier */
export function pathToCubicContour(pathContour: PathContour): CubicContour {
  const anchors = pathContour.anchors
  const closed = pathContour.closed
  const segments: CubicSegment[] = []
  const count = closed ? anchors.length : anchors.length - 1

  for (let i = 0; i < count; i++) {
    const a = anchors[i]
    const b = anchors[(i + 1) % anchors.length]

    const p0: Point = { x: a.x, y: a.y }
    const p3: Point = { x: b.x, y: b.y }

    // If out handle exists, use it; otherwise 1/3 along the straight line
    const p1: Point = a.out ? { ...a.out } : b.in ? p0 : lerpPoint(p0, p3, 1 / 3)
    // If in handle exists, use it; otherwise 2/3 along the straight line
    const p2: Point = b.in ? { ...b.in } : a.out ? p3 : lerpPoint(p0, p3, 2 / 3)

    segments.push({ p0, p1, p2, p3 })
  }

  const segmentLengths = segments.map(seg => cubicArcLength(seg))
  const arcLength = segmentLengths.reduce((sum, len) => sum + len, 0)
  const bounds = contourBounds(segments)
  const centroid = contourCentroid(segments)
  const area = contourArea(segments)
  const isClockwise = area >= 0

  return {
    segments,
    closed,
    arcLength,
    segmentLengths,
    centroid,
    area,
    isClockwise,
    bounds,
  }
}

/** Parse an SVG path `d` string into a list of normalized CubicContours */
export function parseCubicContours(d: string): CubicContour[] {
  if (!d || !d.trim()) return []
  try {
    const rawContours = parsePath(d)
    return rawContours
      .filter(c => c.anchors.length >= 2)
      .map(pathToCubicContour)
  } catch {
    return []
  }
}

/** Convert PathNodes list directly to CubicContours */
export function nodesToCubicContours(nodes: readonly PathNodes[]): CubicContour[] {
  return nodes.map(n => pathToCubicContour({ anchors: [...n.anchors], closed: n.closed }))
}

/** Build a NormalizedShape from cubic contours */
export function buildNormalizedShape(contours: readonly CubicContour[]): NormalizedShape {
  const totalSegments = contours.reduce((sum, c) => sum + c.segments.length, 0)
  const totalArcLength = contours.reduce((sum, c) => sum + c.arcLength, 0)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const c of contours) {
    minX = Math.min(minX, c.bounds.minX)
    minY = Math.min(minY, c.bounds.minY)
    maxX = Math.max(maxX, c.bounds.maxX)
    maxY = Math.max(maxY, c.bounds.maxY)
  }

  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
    maxX = 120
    maxY = 120
  }

  const width = Math.max(1e-4, maxX - minX)
  const height = Math.max(1e-4, maxY - minY)

  // Weighted centroid by arc length
  let cx = 0
  let cy = 0
  if (totalArcLength > 1e-6) {
    for (const c of contours) {
      cx += c.centroid.x * c.arcLength
      cy += c.centroid.y * c.arcLength
    }
    cx /= totalArcLength
    cy /= totalArcLength
  } else {
    cx = (minX + maxX) / 2
    cy = (minY + maxY) / 2
  }

  return {
    contours,
    totalSegments,
    totalArcLength,
    bounds: { minX, minY, maxX, maxY, width, height },
    centroid: { x: cx, y: cy },
  }
}

/** Reverse contour trajectory direction (inverts segment order and control handles) */
export function reverseCubicContour(contour: CubicContour): CubicContour {
  const reversedSegments: CubicSegment[] = []
  const count = contour.segments.length

  for (let i = count - 1; i >= 0; i--) {
    const seg = contour.segments[i]
    reversedSegments.push({
      p0: { ...seg.p3 },
      p1: { ...seg.p2 },
      p2: { ...seg.p1 },
      p3: { ...seg.p0 },
    })
  }

  const segmentLengths = [...contour.segmentLengths].reverse()
  const area = -contour.area

  return {
    segments: reversedSegments,
    closed: contour.closed,
    arcLength: contour.arcLength,
    segmentLengths,
    centroid: { ...contour.centroid },
    area,
    isClockwise: !contour.isClockwise,
    bounds: { ...contour.bounds },
  }
}

/** Rotate contour around a center point by angle in degrees */
export function rotateCubicContour(contour: CubicContour, angleDeg: number, center: Point = contour.centroid): CubicContour {
  const rad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const rot = (p: Point): Point => ({
    x: center.x + (p.x - center.x) * cos - (p.y - center.y) * sin,
    y: center.y + (p.x - center.x) * sin + (p.y - center.y) * cos,
  })

  const segments = contour.segments.map(seg => ({
    p0: rot(seg.p0),
    p1: rot(seg.p1),
    p2: rot(seg.p2),
    p3: rot(seg.p3),
  }))

  const bounds = contourBounds(segments)
  return {
    ...contour,
    segments,
    centroid: rot(contour.centroid),
    bounds,
  }
}

/** Flip contour horizontally or vertically around center */
export function flipCubicContour(
  contour: CubicContour,
  horizontal: boolean,
  vertical: boolean,
  center: Point = contour.centroid
): CubicContour {
  const flip = (p: Point): Point => ({
    x: horizontal ? center.x - (p.x - center.x) : p.x,
    y: vertical ? center.y - (p.y - center.y) : p.y,
  })

  const segments = contour.segments.map(seg => ({
    p0: flip(seg.p0), p1: flip(seg.p1), p2: flip(seg.p2), p3: flip(seg.p3),
  }))
  const area = horizontal !== vertical ? -contour.area : contour.area
  const isClockwise = area >= 0

  const bounds = contourBounds(segments)
  return {
    ...contour,
    segments,
    bounds,
    area,
    isClockwise,
  }
}

/** Shift the start segment index of a closed contour circularly */
export function cycleCubicContour(contour: CubicContour, offset: number): CubicContour {
  if (!contour.closed || contour.segments.length <= 1) return contour
  const n = contour.segments.length
  const shift = ((offset % n) + n) % n
  if (shift === 0) return contour

  const segments = [...contour.segments.slice(shift), ...contour.segments.slice(0, shift)]
  const segmentLengths = [...contour.segmentLengths.slice(shift), ...contour.segmentLengths.slice(0, shift)]

  return {
    ...contour,
    segments,
    segmentLengths,
  }
}

/** Fit and center a contour inside a target viewBox [0, 0, targetW, targetH] */
export function fitContourToViewBox(
  contour: CubicContour,
  targetW = 120,
  targetH = 120,
  padding = 10
): CubicContour {
  const b = contour.bounds
  const availW = targetW - padding * 2
  const availH = targetH - padding * 2

  const scale = Math.min(availW / Math.max(1, b.width), availH / Math.max(1, b.height))
  const scaledW = b.width * scale
  const scaledH = b.height * scale

  const offsetX = (targetW - scaledW) / 2 - b.minX * scale
  const offsetY = (targetH - scaledH) / 2 - b.minY * scale

  const transform = (p: Point): Point => ({
    x: p.x * scale + offsetX,
    y: p.y * scale + offsetY,
  })

  const segments = contour.segments.map(seg => ({
    p0: transform(seg.p0),
    p1: transform(seg.p1),
    p2: transform(seg.p2),
    p3: transform(seg.p3),
  }))

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

/** Preserve a whole compound's proportions and subpath positions in the 120 px workspace. */
export function parseMorphTarget(target: MorphTarget): CubicContour[] {
  const [x, y, width, height] = target.viewBox
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return []
  const scale = 120 / Math.max(width, height)
  const map = (p: Point): Point => ({
    x: (p.x - x - width / 2) * scale + 60,
    y: (p.y - y - height / 2) * scale + 60,
  })
  return parseCubicContours(target.d).map(contour => {
    const segments = contour.segments.map(seg => ({ p0: map(seg.p0), p1: map(seg.p1), p2: map(seg.p2), p3: map(seg.p3) }))
    return { ...contour, segments, segmentLengths: contour.segmentLengths.map(n => n * scale),
      arcLength: contour.arcLength * scale, centroid: map(contour.centroid),
      area: contour.area * scale * scale, bounds: contourBounds(segments) }
  })
}
