import { parseCubicContours } from '../morph/normalize.ts'
import { interpolateMorph, prepareMorph, type PreparedMorph } from '../morph/interpolate.ts'
import { SHAPE_PRESETS } from '../morph/presets.ts'
import type { MorphConfig, MorphTarget } from '../morph/types.ts'

const DEFAULT_PATH_CONFIG: MorphConfig = {
  pointCount: 32,
  equalizationStrategy: 'adaptive-arclength',
  alignmentStrategy: 'auto-distance',
  manualShiftOffset: 0,
  autoMatchWinding: true,
  interpolationMode: 'blended',
  polarBlend: 0.35,
  duration: 1000,
  easing: 'linear',
  playbackMode: 'loop',
  showTrajectories: false,
  showAnchors: false,
  showGhostA: false,
  showGhostB: false,
  showCentroid: false,
}

// Prepared morph cache keyed by `${d1}:::${d2}`
const preparedMorphCache = new Map<string, PreparedMorph>()
const MAX_CACHE_SIZE = 120

export function getPreparedPathMorph(d1: string, d2: string): PreparedMorph | null {
  if (!d1 || !d2 || d1 === d2) return null
  const key = `${d1}:::${d2}`
  const cached = preparedMorphCache.get(key)
  if (cached) return cached

  try {
    const contoursA = parseCubicContours(d1)
    const contoursB = parseCubicContours(d2)
    if (!contoursA.length || !contoursB.length) return null

    const prepared = prepareMorph(contoursA, contoursB, DEFAULT_PATH_CONFIG)
    if (preparedMorphCache.size >= MAX_CACHE_SIZE) {
      const firstKey = preparedMorphCache.keys().next().value
      if (firstKey) preparedMorphCache.delete(firstKey)
    }
    preparedMorphCache.set(key, prepared)
    return prepared
  } catch {
    return null
  }
}

/**
 * Interpolate two arbitrary SVG path d strings at a normalized progress (0..1).
 * Uses memoized contour equalization and alignment for 60fps performance.
 */
export function interpolatePathShapes(d1: string, d2: string, progress: number): string {
  const t = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
  if (t <= 0 || !d2) return d1
  if (t >= 1 || !d1) return d2
  if (d1 === d2) return d1

  const prepared = getPreparedPathMorph(d1, d2)
  if (!prepared) return t < 0.5 ? d1 : d2

  try {
    const result = interpolateMorph(prepared, t, DEFAULT_PATH_CONFIG)
    return result.d || (t < 0.5 ? d1 : d2)
  } catch {
    return t < 0.5 ? d1 : d2
  }
}

/**
 * Compute SVG stroke-dasharray and stroke-dashoffset for After Effects-style Trim Paths.
 */
export function computeStrokeTrimDash(
  totalLength: number,
  trimStartPercent: number,
  trimEndPercent: number,
  trimOffsetPercent: number,
): { strokeDasharray: string; strokeDashoffset: string } {
  const L = Math.max(1, totalLength)
  const s = Math.max(0, Math.min(100, trimStartPercent)) / 100
  const e = Math.max(0, Math.min(100, trimEndPercent)) / 100
  const o = (trimOffsetPercent % 100) / 100

  const visibleFraction = Math.max(0, e - s)
  const visibleLength = visibleFraction * L
  const gapLength = L
  const offset = -((s + o) * L)

  return {
    strokeDasharray: `${visibleLength.toFixed(2)} ${gapLength.toFixed(2)}`,
    strokeDashoffset: `${offset.toFixed(2)}`,
  }
}

export { SHAPE_PRESETS }
export type { MorphTarget }
