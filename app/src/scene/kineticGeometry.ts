import type { Point } from '../canvas/types.ts'
import { parsePath, serializePath } from './pathGeometry.ts'
import type { PathContour } from './pathGeometry.ts'
import type { ShapedText } from './fontEngine.ts'
import type { KineticTypography, TextElement } from './types.ts'
import { textAnchorForPath, textPathOffset } from './typography.ts'
import { calculateStaggerDelay, evaluateWaveform } from './glyphDecomposition.ts'
export * from './kineticPresets.ts'

export const DEFAULT_KINETIC: KineticTypography = Object.freeze({
  enabled: true,
  playing: true,
  amplitude: 18,
  rotation: 8,
  duration: 2.4,
  stagger: 70,
  phase: 0,
  staggerMode: 'cascade',
  waveShape: 'triangle',
  weightModulation: 0,
  slantModulation: 0,
  scaleModulation: 0,
  widthModulation: 0,
  horizontalAmplitude: 0,
  opticalSizeModulation: 0,
})
interface Sample extends Point { distance: number }

/** Adaptive arc-length table: handle arbitrary cubic, quadratic and SVG arc baselines. */
export function createBaseline(d: string) {
  const contours = parsePath(d)
  const samples: Sample[] = []
  let length = 0
  const append = (p: Point, connect = true) => {
    const last = samples.at(-1)
    if (last && connect) length += Math.hypot(p.x - last.x, p.y - last.y)
    samples.push({ ...p, distance: length })
  }
  const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const flatten = (a: Point, b: Point, c: Point, e: Point, depth: number) => {
    const chord = Math.hypot(e.x - a.x, e.y - a.y)
    const polygon = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(e.x - c.x, e.y - c.y)
    if (depth >= 14 || polygon - chord < .005) { append(e); return }
    const ab = middle(a, b), bc = middle(b, c), ce = middle(c, e), abc = middle(ab, bc), bce = middle(bc, ce), mid = middle(abc, bce)
    flatten(a, ab, abc, mid, depth + 1); flatten(mid, bce, ce, e, depth + 1)
  }
  const isClosed = contours[0]?.closed ?? false
  for (const contour of contours) {
    if (contour?.anchors.length) {
      append(contour.anchors[0], samples.length > 0)
      const count = contour.anchors.length - (contour.closed ? 0 : 1)
      for (let i = 0; i < count; i++) {
        const a = contour.anchors[i], b = contour.anchors[(i + 1) % contour.anchors.length]
        if (a.out || b.in) flatten(a, a.out ?? a, b.in ?? b, b, 0)
        else append(b)
      }
    }
  }
  return {
    length,
    closed: isClosed,
    at(distance: number) {
      if (samples.length < 2) return { x: samples[0]?.x ?? 0, y: samples[0]?.y ?? 0, angle: 0 }
      let low = 1, high = samples.length - 1
      const clamped = isClosed && length > 0
        ? ((distance % length) + length) % length
        : Math.max(0, Math.min(length, distance))
      while (low < high) { const mid = (low + high) >> 1; if (samples[mid].distance < clamped) low = mid + 1; else high = mid }
      const a = samples[low - 1], b = samples[low]
      const t = (clamped - a.distance) / (b.distance - a.distance || 1)
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI }
    },
  }
}

export interface GlyphPlacement { d: string; x: number; y: number; angle: number; origin: number; dx: number; dy: number; scale: number; index: number }
export function placeGlyphs(node: TextElement, shaped: ShapedText, unitsPerEm: number, pathD = ''): GlyphPlacement[] {
  const baseline = node.textOnPath?.enabled ? createBaseline(pathD) : null
  const anchor = textAnchorForPath(node.textOnPath?.align, node.textAlign)
  const shift = node.textOnPath?.baselineShift ?? 0
  const result: GlyphPlacement[] = []
  let index = 0
  shaped.lines.forEach((line, lineIndex) => {
    const startOffsetPx = node.textOnPath?.offsetMode === 'pixels' && node.textOnPath.offset !== undefined
      ? node.textOnPath.offset
      : baseline ? (baseline.length * textPathOffset(node)) / 100 : 0
    let cursor = baseline
      ? startOffsetPx - (anchor === 'middle' ? line.width / 2 : anchor === 'end' ? line.width : 0)
      : node.textAlign === 'center' ? (node.width - line.width) / 2 : node.textAlign === 'right' ? node.width - line.width : 0
    line.glyphs.forEach(glyph => {
      const center = cursor + glyph.advance / 2
      let position = baseline?.at(center) ?? { x: center, y: shaped.baseline + lineIndex * node.fontSize * node.lineHeight, angle: 0 }
      if (baseline && shift !== 0) {
        const rad = (position.angle * Math.PI) / 180
        position = {
          x: position.x - Math.sin(rad) * shift,
          y: position.y + Math.cos(rad) * shift,
          angle: position.angle,
        }
      }
      if (!baseline || (center >= 0 && center <= baseline.length) || baseline.closed) {
        result.push({ d: glyph.d, ...position, origin: -glyph.advance / 2, dx: glyph.dx, dy: glyph.dy, scale: node.fontSize / unitsPerEm, index })
      }
      index++; cursor += glyph.advance
    })
  })
  return result
}

export interface CascadeOffsetResult {
  readonly x?: number
  readonly y: number
  readonly angle: number
  readonly scale?: number
  readonly weightDelta?: number
  readonly slantDelta?: number
  readonly widthDelta?: number
  readonly opticalSizeDelta?: number
}

/** Matches the quarter-cycle CSS keyframes, with selectable stagger modes, waveforms, and axis dynamics. */
export function cascadeOffset(kinetic: KineticTypography | undefined, index: number, totalGlyphs = 1): CascadeOffsetResult {
  if (!kinetic?.enabled) return { y: 0, angle: 0 }
  const total = Math.max(1, totalGlyphs)
  const delay = calculateStaggerDelay(kinetic.staggerMode, index, total, kinetic.stagger)
  const durationMs = Math.max(200, (kinetic.duration || 2.4) * 1000)
  const cycle = ((kinetic.phase + delay / durationMs) % 1 + 1) % 1
  const wave = evaluateWaveform(cycle, kinetic.waveShape ?? 'triangle')

  const result: {
    x?: number
    y: number
    angle: number
    scale?: number
    weightDelta?: number
    slantDelta?: number
    widthDelta?: number
    opticalSizeDelta?: number
  } = {
    y: wave * kinetic.amplitude,
    angle: wave * kinetic.rotation,
  }
  if (kinetic.horizontalAmplitude && kinetic.horizontalAmplitude !== 0) {
    result.x = wave * kinetic.horizontalAmplitude
  }
  if (kinetic.scaleModulation && kinetic.scaleModulation > 0) {
    result.scale = Math.max(0.05, 1 + wave * kinetic.scaleModulation)
  }
  if (kinetic.weightModulation && kinetic.weightModulation !== 0) {
    result.weightDelta = wave * kinetic.weightModulation
  }
  if (kinetic.slantModulation && kinetic.slantModulation !== 0) {
    result.slantDelta = wave * kinetic.slantModulation
  }
  if (kinetic.widthModulation && kinetic.widthModulation !== 0) {
    result.widthDelta = wave * kinetic.widthModulation
  }
  if (kinetic.opticalSizeModulation && kinetic.opticalSizeModulation !== 0) {
    result.opticalSizeDelta = wave * kinetic.opticalSizeModulation
  }
  return result
}

/** Bake the displayed phase into native editable cubic outlines, preserving glyph holes. */
export function glyphOutlines(glyphs: readonly GlyphPlacement[], kinetic?: KineticTypography): string {
  const contours: PathContour[] = []
  for (const glyph of glyphs) {
    const offset = cascadeOffset(kinetic, glyph.index, glyphs.length)
    const angle = glyph.angle * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
    const spin = offset.angle * Math.PI / 180, sc = Math.cos(spin), ss = Math.sin(spin)
    const effectiveScale = glyph.scale * (offset.scale ?? 1)
    const slantAngle = offset.slantDelta ?? 0
    const slantShear = slantAngle !== 0 ? Math.tan((-slantAngle * Math.PI) / 180) : 0
    const transform = (point: Point): Point => {
      const gx = point.x * effectiveScale + slantShear * (-point.y * effectiveScale) + glyph.origin + glyph.dx
      const gy = -point.y * effectiveScale + glyph.dy
      const x = gx * sc - gy * ss + (offset.x ?? 0), y = gx * ss + gy * sc + offset.y
      return { x: glyph.x + x * cos - y * sin, y: glyph.y + x * sin + y * cos }
    }
    for (const contour of parsePath(glyph.d)) contours.push({ closed: contour.closed, anchors: contour.anchors.map(anchor => ({ ...transform(anchor), ...(anchor.in ? { in: transform(anchor.in) } : {}), ...(anchor.out ? { out: transform(anchor.out) } : {}) })) })
  }
  return serializePath(contours)
}
