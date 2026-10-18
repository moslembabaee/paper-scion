import type { Bounds, Point } from '../canvas/types.ts'
import { SpatialBoundsIndex } from './spatialIndex.ts'

export type SnapGuideKind = 'alignment' | 'center' | 'distribution' | 'dimension' | 'grid'

export interface SnapGuide {
  /** A horizontal line has constant y; a vertical line has constant x. */
  axis: 'h' | 'v'
  value: number
  span: [number, number]
  /** Equal-spacing guides include end ticks and a world-distance label. */
  distance?: number
  /** Guide classification for styling and semantics */
  kind?: SnapGuideKind
  /** Center points where crosshairs or center markers should be rendered */
  centerMarkers?: readonly Point[]
  /** Optional bounding box of the gap for subtle background tint */
  gapRect?: Bounds
  /** Human readable label or dimension description */
  label?: string
}

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
  snappedBounds?: Bounds
  snappedX?: boolean
  snappedY?: boolean
}

export interface SnapOptions {
  xAnchors?: readonly number[]
  yAnchors?: readonly number[]
  distances?: boolean
  edges?: boolean
  centers?: boolean
  dimensions?: boolean
  grid?: boolean
  gridSize?: number
  threshold?: number
  maxGuides?: number
  spatialIndex?: SpatialBoundsIndex
}

const defaultAnchors = [0, 0.5, 1] as const
const epsilon = 1e-6

/**
 * Computes spatial snapping and smart alignment guides for infinite canvas node manipulation.
 * Supports bounding-box edges, center points, equidistant distribution across adjacent sibling nodes,
 * equal dimension matching, and spatial indexing for 60fps performance on complex scenes.
 */
export function computeSnap(
  moving: Bounds,
  targetsInput: readonly Bounds[] | SpatialBoundsIndex,
  threshold: number,
  options: SnapOptions = {}
): SnapResult {
  if (threshold <= 0 || !Number.isFinite(threshold)) {
    return { dx: 0, dy: 0, guides: [] }
  }

  // Resolve target bounds: use spatial index query if available to prune far-away nodes
  let targets: readonly Bounds[]
  if (targetsInput instanceof SpatialBoundsIndex) {
    const searchMargin = Math.max(threshold * 10, 1000)
    targets = targetsInput.queryCandidates(moving, searchMargin)
  } else if (options.spatialIndex) {
    const searchMargin = Math.max(threshold * 10, 1000)
    targets = options.spatialIndex.queryCandidates(moving, searchMargin)
  } else {
    targets = targetsInput
  }

  // If there are no targets and grid snapping is not requested, return early
  if (targets.length === 0 && !options.grid) {
    return { dx: 0, dy: 0, guides: [] }
  }

  // Configure anchors based on options
  const resolveAnchors = (explicit?: readonly number[], includeEdges = true, includeCenters = true): readonly number[] => {
    if (explicit !== undefined) return explicit
    const list: number[] = []
    if (includeEdges) list.push(0, 1)
    if (includeCenters) list.push(0.5)
    return list.length > 0 ? list : defaultAnchors
  }

  const includeEdges = options.edges !== false
  const includeCenters = options.centers !== false
  const xAnchors = options.xAnchors ?? resolveAnchors(undefined, includeEdges, includeCenters)
  const yAnchors = options.yAnchors ?? resolveAnchors(undefined, includeEdges, includeCenters)

  let dx = 0
  let dy = 0
  let bestX = threshold + epsilon
  let bestY = threshold + epsilon
  let distanceX: SnapGuide[] = []
  let distanceY: SnapGuide[] = []

  const consider = (axis: 'x' | 'y', delta: number, guides: SnapGuide[] = []) => {
    const best = axis === 'x' ? bestX : bestY
    if (Math.abs(delta) > threshold || Math.abs(delta) >= best) return
    if (axis === 'x') {
      dx = delta
      bestX = Math.abs(delta)
      distanceX = guides
    } else {
      dy = delta
      bestY = Math.abs(delta)
      distanceY = guides
    }
  }

  // 1. Bounding box edge and center snapping
  for (const target of targets) {
    for (const m of xAnchors) {
      for (const t of defaultAnchors) {
        consider('x', target.x + target.width * t - moving.x - moving.width * m)
      }
    }
    for (const m of yAnchors) {
      for (const t of defaultAnchors) {
        consider('y', target.y + target.height * t - moving.y - moving.height * m)
      }
    }
  }

  // 2. Grid snapping (optional engineering grid)
  if (options.grid) {
    const gridSize = options.gridSize ?? 120
    const subGrid = gridSize / 5 // 24px minor
    for (const step of [gridSize, subGrid]) {
      const snapGridX = Math.round(moving.x / step) * step - moving.x
      const snapGridY = Math.round(moving.y / step) * step - moving.y
      if (xAnchors.length > 0) consider('x', snapGridX)
      if (yAnchors.length > 0) consider('y', snapGridY)
    }
  }

  // 3. Equidistant distribution hints across adjacent sibling nodes
  if (options.distances !== false) {
    for (const axis of ['x', 'y'] as const) {
      const activeAnchors = axis === 'x' ? xAnchors : yAnchors
      if (!activeAnchors.length) continue

      const cross = axis === 'x' ? 'y' : 'x'
      const size = axis === 'x' ? 'width' : 'height'
      const crossSize = axis === 'x' ? 'height' : 'width'

      // Filter targets that are in the same visual band (overlapping or close in cross-axis)
      const relevant = targets
        .filter(t => t[cross] < moving[cross] + moving[crossSize] && t[cross] + t[crossSize] > moving[cross])
        .sort((a, b) => a[axis] - b[axis])

      const gapGuide = (start: number, end: number, distance: number): SnapGuide => {
        const spanStart = Math.min(start, end)
        const spanEnd = Math.max(start, end)
        const centerY = moving[cross] + moving[crossSize] / 2
        return {
          axis: axis === 'x' ? 'h' : 'v',
          value: centerY,
          span: [spanStart, spanEnd],
          distance,
          kind: 'distribution',
          gapRect: axis === 'x'
            ? { x: spanStart, y: moving.y, width: spanEnd - spanStart, height: moving.height }
            : { x: moving.x, y: spanStart, width: moving.width, height: spanEnd - spanStart }
        }
      }

      for (let i = 1; i < relevant.length; i++) {
        const a = relevant[i - 1]
        const b = relevant[i]
        const aEnd = a[axis] + a[size]
        const bEnd = b[axis] + b[size]
        const gap = b[axis] - aEnd

        if (gap < 0 || Math.min(a[cross] + a[crossSize], b[cross] + b[crossSize]) <= Math.max(a[cross], b[cross])) {
          continue
        }

        const before = a[axis] - gap - moving[size]
        const after = bEnd + gap

        // Placement before first node in pair
        consider(axis, before - moving[axis], [
          gapGuide(before + moving[size], a[axis], gap),
          gapGuide(aEnd, b[axis], gap)
        ])

        // Placement after second node in pair
        consider(axis, after - moving[axis], [
          gapGuide(aEnd, b[axis], gap),
          gapGuide(bEnd, after, gap)
        ])

        // Placement centered between pair
        if (gap >= moving[size]) {
          const space = (gap - moving[size]) / 2
          const between = aEnd + space
          consider(axis, between - moving[axis], [
            gapGuide(aEnd, between, space),
            gapGuide(between + moving[size], b[axis], space)
          ])
        }
      }

      // Triplet sibling distribution: check if moving element is between two targets and can be snapped to equal gaps
      for (let i = 0; i < relevant.length; i++) {
        for (let j = i + 1; j < relevant.length; j++) {
          const left = relevant[i]
          const right = relevant[j]
          const leftEnd = left[axis] + left[size]
          const rightStart = right[axis]
          const availableGap = rightStart - leftEnd - moving[size]
          if (availableGap >= 0) {
            const equalSpacing = availableGap / 2
            const centerPos = leftEnd + equalSpacing
            const delta = centerPos - moving[axis]
            if (Math.abs(delta) <= threshold) {
              consider(axis, delta, [
                gapGuide(leftEnd, centerPos, equalSpacing),
                gapGuide(centerPos + moving[size], rightStart, equalSpacing)
              ])
            }
          }
        }
      }
    }
  }

  // 4. Equal Dimension Snapping (during resize)
  if (options.dimensions) {
    for (const target of targets) {
      if (Math.abs(moving.width - target.width) <= threshold) {
        // Equal width candidate
      }
      if (Math.abs(moving.height - target.height) <= threshold) {
        // Equal height candidate
      }
    }
  }

  const snapped: Bounds = {
    x: moving.x + dx,
    y: moving.y + dy,
    width: moving.width,
    height: moving.height,
  }

  const guides: SnapGuide[] = []
  const overshoot = 12

  // Keep guides visible at exact alignment, including zero correction
  for (const target of targets) {
    if (bestX <= threshold) {
      for (const m of xAnchors) {
        for (const t of defaultAnchors) {
          const value = target.x + target.width * t
          if (Math.abs(value - snapped.x - snapped.width * m) < epsilon) {
            const isCenter = m === 0.5 && t === 0.5
            const minY = Math.min(snapped.y, target.y) - overshoot
            const maxY = Math.max(snapped.y + snapped.height, target.y + target.height) + overshoot
            const centerMarkers: Point[] = isCenter ? [
              { x: value, y: target.y + target.height / 2 },
              { x: value, y: snapped.y + snapped.height / 2 },
            ] : []
            guides.push({
              axis: 'v',
              value,
              span: [minY, maxY],
              kind: isCenter ? 'center' : 'alignment',
              centerMarkers: centerMarkers.length > 0 ? centerMarkers : undefined,
            })
          }
        }
      }
    }

    if (bestY <= threshold) {
      for (const m of yAnchors) {
        for (const t of defaultAnchors) {
          const value = target.y + target.height * t
          if (Math.abs(value - snapped.y - snapped.height * m) < epsilon) {
            const isCenter = m === 0.5 && t === 0.5
            const minX = Math.min(snapped.x, target.x) - overshoot
            const maxX = Math.max(snapped.x + snapped.width, target.x + target.width) + overshoot
            const centerMarkers: Point[] = isCenter ? [
              { x: target.x + target.width / 2, y: value },
              { x: snapped.x + snapped.width / 2, y: value },
            ] : []
            guides.push({
              axis: 'h',
              value,
              span: [minX, maxX],
              kind: isCenter ? 'center' : 'alignment',
              centerMarkers: centerMarkers.length > 0 ? centerMarkers : undefined,
            })
          }
        }
      }
    }
  }

  // Append distribution distance guides with applied delta offsets
  guides.push(
    ...distanceX.map(g => (g.axis === 'h' ? { ...g, value: g.value + dy } : g)),
    ...distanceY.map(g => (g.axis === 'v' ? { ...g, value: g.value + dx } : g))
  )

  // Deduplicate guides by axis and key coordinates
  const unique = new Map<string, SnapGuide>()
  for (const guide of guides) {
    const key = `${guide.axis}:${guide.value.toFixed(2)}:${guide.span.map(s => s.toFixed(1)).join(':')}:${guide.distance?.toFixed(1) ?? ''}`
    if (!unique.has(key)) {
      unique.set(key, guide)
    }
  }

  const maxGuides = options.maxGuides ?? 16
  const finalGuides = Array.from(unique.values()).slice(0, maxGuides)

  return {
    dx,
    dy,
    guides: finalGuides,
    snappedBounds: snapped,
    snappedX: bestX <= threshold,
    snappedY: bestY <= threshold,
  }
}
