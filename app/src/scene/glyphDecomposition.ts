import type { ShapedText } from './fontEngine.ts'
import { DEFAULT_KINETIC, placeGlyphs } from './kineticGeometry.ts'
import type { KineticStaggerMode, KineticTypography, KineticWaveShape, TextElement, VariableFontAxes } from './types.ts'

/** Point/transform for an individually decomposed glyph */
export interface DecomposedGlyph {
  readonly id: string
  readonly index: number
  readonly total: number
  readonly char: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly advance: number
  readonly origin: number
  readonly dx: number
  readonly dy: number
  readonly angle: number
  readonly scale: number
  readonly baseline: number
  readonly d?: string
  readonly initialTransforms: {
    readonly x: number
    readonly y: number
    readonly rotation: number
    readonly scale: number
  }
  readonly initialAxes: VariableFontAxes
}

export interface DecomposedGlyphRun {
  readonly text: string
  readonly glyphs: readonly DecomposedGlyph[]
  readonly bounds: { readonly width: number; readonly height: number }
  readonly baseline: number
}

export interface StaggerGeneratorOptions {
  readonly seed?: number
  readonly cycles?: number
  readonly amplitudeScale?: number
}

/** Fast, deterministic PRNG based on mulberry32 hash. */
export function pseudoRandom(index: number, seed = 42): number {
  let h = ((index + 1) * 0x6d2b79f5 ^ (seed * 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 15), h | 1)
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61)
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296
}

/** Left-to-right (cascade) staggering generator: linear progressive delay */
export function staggerLeftToRight(index: number, _total: number, staggerMs: number): number {
  return index * staggerMs
}

/** Right-to-left staggering generator: reverse progressive delay */
export function staggerRightToLeft(index: number, total: number, staggerMs: number): number {
  return Math.max(0, total - 1 - index) * staggerMs
}

/** Center-out staggering generator: delay radiates symmetrically from center */
export function staggerCenterOut(index: number, total: number, staggerMs: number): number {
  const mid = (Math.max(1, total) - 1) / 2
  return Math.abs(index - mid) * staggerMs
}

/** Wave staggering generator: harmonic sinusoidal ripple delay across glyphs */
export function staggerWave(
  index: number,
  total: number,
  staggerMs: number,
  options?: StaggerGeneratorOptions
): number {
  const norm = index / Math.max(1, total - 1)
  const cycles = options?.cycles ?? 1
  const scale = options?.amplitudeScale ?? 1.5
  return Math.sin(norm * Math.PI * cycles) * staggerMs * scale
}

/** Random delay generator: reproducible, seeded pseudo-random delay */
export function staggerRandomDelay(
  index: number,
  total: number,
  staggerMs: number,
  seed = 49297
): number {
  // Compatible with Paper deterministic LCG formula while also accepting seed
  const rnd = seed === 49297
    ? ((((index + 1) * 9301 + 49297) % 233280) / 233280)
    : pseudoRandom(index, seed)
  return rnd * staggerMs * Math.max(1, total / 2)
}

/** Elastic staggering generator: harmonic oscillating cosine pulse */
export function staggerElastic(index: number, total: number, staggerMs: number): number {
  const norm = index / Math.max(1, total - 1)
  return Math.abs(Math.cos(norm * Math.PI * 2.5)) * staggerMs * 2
}

/** Master staggering generator routing all supported modes */
export function calculateStaggerDelay(
  mode: KineticStaggerMode | undefined,
  index: number,
  total: number,
  staggerMs: number,
  options?: StaggerGeneratorOptions
): number {
  switch (mode) {
    case 'left-to-right':
    case 'cascade':
    case undefined:
      return staggerLeftToRight(index, total, staggerMs)
    case 'right-to-left':
      return staggerRightToLeft(index, total, staggerMs)
    case 'center-out':
      return staggerCenterOut(index, total, staggerMs)
    case 'wave':
      return staggerWave(index, total, staggerMs, options)
    case 'random':
      return staggerRandomDelay(index, total, staggerMs, options?.seed)
    case 'elastic':
      return staggerElastic(index, total, staggerMs)
    default:
      return staggerLeftToRight(index, total, staggerMs)
  }
}

/** Evaluate periodic waveform dynamics */
export function evaluateWaveform(cycle: number, shape: KineticWaveShape = 'triangle'): number {
  const c = ((cycle % 1) + 1) % 1
  switch (shape) {
    case 'sine':
      return -Math.sin(c * Math.PI * 2)
    case 'bounce':
      return Math.abs(Math.sin(c * Math.PI * 2)) * 2 - 1
    case 'spring':
      return -Math.sin(c * Math.PI * 3) * (1 - c * 0.7)
    case 'triangle':
    default:
      return c < 0.25 ? -4 * c : c < 0.75 ? 4 * c - 2 : 4 - 4 * c
  }
}

export interface DynamicGlyphTransform {
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly scale: number
  readonly axes: VariableFontAxes
  readonly delayMs: number
}

/** Evaluate dynamic per-glyph transform and variable axes modulation given kinetic parameters */
export function evaluateGlyphDynamics(
  glyph: DecomposedGlyph,
  kinetic: KineticTypography | undefined,
  phaseOverride?: number
): DynamicGlyphTransform {
  const k = kinetic ?? DEFAULT_KINETIC
  if (!k.enabled) {
    return {
      x: glyph.x,
      y: glyph.y,
      angle: glyph.angle,
      scale: glyph.scale,
      axes: { ...glyph.initialAxes },
      delayMs: 0,
    }
  }

  const total = Math.max(1, glyph.total)
  const delayMs = calculateStaggerDelay(k.staggerMode, glyph.index, total, k.stagger)
  const phase = phaseOverride !== undefined ? phaseOverride : k.phase
  const durationMs = Math.max(200, (k.duration || 2.4) * 1000)
  const cycle = ((phase + delayMs / durationMs) % 1 + 1) % 1
  const wave = evaluateWaveform(cycle, k.waveShape ?? 'triangle')

  const normalDisp = wave * k.amplitude
  const horizDisp = wave * (k.horizontalAmplitude ?? 0)
  const rotDelta = wave * k.rotation
  const scaleMult = k.scaleModulation ? Math.max(0.05, 1 + wave * k.scaleModulation) : 1

  // Project normal and tangent displacement according to glyph angle
  const rad = (glyph.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // Tangent is (cos, sin), normal is (-sin, cos)
  const dx = horizDisp * cos - normalDisp * sin
  const dy = horizDisp * sin + normalDisp * cos

  const baseWght = glyph.initialAxes.wght ?? 400
  const baseWdth = glyph.initialAxes.wdth ?? 100
  const baseSlnt = glyph.initialAxes.slnt ?? 0
  const baseOpsz = glyph.initialAxes.opsz ?? glyph.height

  const effWght = k.weightModulation
    ? Math.max(1, Math.min(1000, baseWght + wave * k.weightModulation))
    : baseWght
  const effWdth = k.widthModulation
    ? Math.max(25, Math.min(200, baseWdth + wave * k.widthModulation))
    : baseWdth
  const effSlnt = k.slantModulation
    ? Math.max(-20, Math.min(20, baseSlnt + wave * k.slantModulation))
    : baseSlnt
  const effOpsz = k.opticalSizeModulation
    ? Math.max(6, Math.min(144, baseOpsz + wave * k.opticalSizeModulation))
    : baseOpsz

  const axes: VariableFontAxes = {
    ...glyph.initialAxes,
    wght: Math.round(effWght * 10) / 10,
    wdth: Math.round(effWdth * 10) / 10,
    slnt: Math.round(effSlnt * 10) / 10,
    opsz: Math.round(effOpsz * 10) / 10,
  }

  return {
    x: glyph.x + dx,
    y: glyph.y + dy,
    angle: glyph.angle + rotDelta,
    scale: glyph.scale * scaleMult,
    axes,
    delayMs,
  }
}

/** Decompose text element or shaped runs into structured DecomposedGlyph list */
export function decomposeTextElement(
  node: TextElement,
  shaped?: ShapedText | null,
  fontUnitsPerEm = 1000,
  pathD = ''
): DecomposedGlyphRun {
  const fontSize = node.fontSize || 32
  const lineHeight = node.lineHeight || 1.2
  const initialAxes: VariableFontAxes = {
    wght: node.variableAxes?.wght ?? node.fontWeight ?? 400,
    wdth: 100,
    slnt: 0,
    opsz: fontSize,
    ...(node.variableAxes ?? {}),
  }

  // 1. Vector outline path placement when font outline is present
  if (shaped && shaped.lines.length > 0) {
    const placed = placeGlyphs(node, shaped, fontUnitsPerEm, pathD)
    const total = placed.length
    const glyphs: DecomposedGlyph[] = placed.map((g, index) => {
      return {
        id: `${node.id}-glyph-${index}`,
        index,
        total,
        char: node.text[index] ?? '',
        x: g.x,
        y: g.y,
        width: fontSize * 0.6,
        height: fontSize,
        advance: (fontSize / fontUnitsPerEm) * 600,
        origin: g.origin,
        dx: g.dx,
        dy: g.dy,
        angle: g.angle,
        scale: g.scale,
        baseline: shaped.baseline,
        d: g.d,
        initialTransforms: {
          x: g.x,
          y: g.y,
          rotation: g.angle,
          scale: g.scale,
        },
        initialAxes: { ...initialAxes },
      }
    })

    return {
      text: node.text,
      glyphs,
      bounds: { width: node.width, height: node.height },
      baseline: shaped.baseline,
    }
  }

  // 2. Standard typographic character decomposition for canvas/HTML
  const chars = Array.from(node.text)
  const total = Math.max(1, chars.length)
  const estAdvance = fontSize * 0.6
  const totalWidth = chars.length * estAdvance
  let startX = 0
  if (node.textAlign === 'center') startX = (node.width - totalWidth) / 2
  else if (node.textAlign === 'right') startX = node.width - totalWidth

  const baseline = fontSize * 0.8
  const glyphs: DecomposedGlyph[] = []
  let cursorX = startX

  chars.forEach((char, index) => {
    if (char === '\n') {
      cursorX = startX
      return
    }
    const glyph: DecomposedGlyph = {
      id: `${node.id}-glyph-${index}`,
      index,
      total,
      char,
      x: cursorX + estAdvance / 2,
      y: baseline,
      width: estAdvance,
      height: fontSize * lineHeight,
      advance: estAdvance,
      origin: -estAdvance / 2,
      dx: 0,
      dy: 0,
      angle: 0,
      scale: 1,
      baseline,
      initialTransforms: {
        x: cursorX + estAdvance / 2,
        y: baseline,
        rotation: 0,
        scale: 1,
      },
      initialAxes: { ...initialAxes },
    }
    glyphs.push(glyph)
    cursorX += estAdvance
  })

  return {
    text: node.text,
    glyphs,
    bounds: { width: node.width, height: node.height },
    baseline,
  }
}
