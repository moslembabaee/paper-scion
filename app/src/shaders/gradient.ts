import type { ShaderMountProps } from '@paper-design/shaders-react'
import type { GradientColorStop, GradientPaint, GradientType } from '../scene/types.ts'
import type { MultiStopGradientParams, ShaderPaint } from './types.ts'
import { parseHexColor, toHexColor } from './mesh.ts'
import { freezeShader } from './catalog.ts'

export const DEFAULT_GRADIENT_STOPS: readonly GradientColorStop[] = [
  { id: 'stop-0', offset: 0, color: '#edebe1', opacity: 1 },
  { id: 'stop-1', offset: 0.5, color: '#81adec', opacity: 1 },
  { id: 'stop-2', offset: 1, color: '#222222', opacity: 1 },
]

export function createDefaultGradient(type: GradientType = 'linear'): GradientPaint {
  return {
    type,
    stops: DEFAULT_GRADIENT_STOPS,
    angle: 90,
    origin: { x: 0.5, y: 0.5 },
    focalLength: 0.0,
    spread: 1.0,
    dither: 0.25,
    smoothness: 0.5,
    linkToShader: false,
    enabled: true,
  }
}

/**
 * Validates a GradientPaint object against document schema constraints.
 */
export function validateGradient(value: unknown): asserts value is GradientPaint {
  if (!value || typeof value !== 'object') throw new Error('Invalid gradient configuration')
  const g = value as GradientPaint
  if (!['linear', 'radial', 'angular'].includes(g.type)) throw new Error('Invalid gradient type')
  if (!Array.isArray(g.stops) || g.stops.length < 2 || g.stops.length > 16) throw new Error('Gradient must contain between 2 and 16 color stops')
  for (const s of g.stops) {
    if (!s || typeof s.id !== 'string' || typeof s.color !== 'string') throw new Error('Invalid gradient stop')
    if (typeof s.offset !== 'number' || !Number.isFinite(s.offset) || s.offset < 0 || s.offset > 1) throw new Error('Gradient stop offset must be between 0 and 1')
    if (s.opacity !== undefined && (!Number.isFinite(s.opacity) || s.opacity < 0 || s.opacity > 1)) throw new Error('Gradient stop opacity must be between 0 and 1')
  }
  if (!Number.isFinite(g.angle)) throw new Error('Invalid gradient angle')
  if (!g.origin || !Number.isFinite(g.origin.x) || !Number.isFinite(g.origin.y)) throw new Error('Invalid gradient origin')
  if (!Number.isFinite(g.focalLength) || g.focalLength < 0 || g.focalLength > 2) throw new Error('Invalid focal length')
  if (!Number.isFinite(g.spread) || g.spread < 0.01 || g.spread > 5) throw new Error('Invalid gradient spread')
}

/**
 * Freezes a GradientPaint immutably.
 */
export function freezeGradient(gradient: GradientPaint): GradientPaint {
  if (
    Object.isFrozen(gradient) &&
    Object.isFrozen(gradient.stops) &&
    gradient.stops.every(Object.isFrozen) &&
    Object.isFrozen(gradient.origin)
  ) {
    return gradient
  }

  const frozenStops = Object.freeze(
    gradient.stops.map(s => Object.freeze({
      id: s.id,
      offset: Number(Math.max(0, Math.min(1, s.offset)).toFixed(4)),
      color: s.color,
      opacity: s.opacity !== undefined ? Number(Math.max(0, Math.min(1, s.opacity)).toFixed(3)) : 1,
    }))
  )

  return Object.freeze({
    type: gradient.type,
    stops: frozenStops,
    angle: Number(((gradient.angle % 360 + 360) % 360).toFixed(2)),
    origin: Object.freeze({
      x: Number(Math.max(0, Math.min(1, gradient.origin.x)).toFixed(4)),
      y: Number(Math.max(0, Math.min(1, gradient.origin.y)).toFixed(4)),
    }),
    focalLength: Number(Math.max(0, Math.min(2, gradient.focalLength)).toFixed(3)),
    spread: Number(Math.max(0.1, Math.min(3, gradient.spread)).toFixed(3)),
    dither: gradient.dither !== undefined ? Number(Math.max(0, Math.min(1, gradient.dither)).toFixed(2)) : 0.25,
    smoothness: gradient.smoothness !== undefined ? Number(Math.max(0, Math.min(1, gradient.smoothness)).toFixed(2)) : 0.5,
    linkToShader: !!gradient.linkToShader,
    enabled: gradient.enabled !== false,
  })
}

/**
 * Converts a hex color and optional opacity into CSS rgba() notation.
 */
export function colorToRGBA(hex: string, opacity = 1): string {
  const { r, g, b, a } = parseHexColor(hex)
  const finalAlpha = Math.max(0, Math.min(1, a * opacity))
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${finalAlpha.toFixed(3)})`
}

/**
 * Generates standards-compliant CSS gradient string.
 */
export function gradientToCSS(gradient: GradientPaint): string {
  const sortedStops = [...gradient.stops].sort((a, b) => a.offset - b.offset)
  const stopsCss = sortedStops
    .map(s => `${colorToRGBA(s.color, s.opacity ?? 1)} ${(s.offset * 100).toFixed(1)}%`)
    .join(', ')

  switch (gradient.type) {
    case 'linear':
      return `linear-gradient(${gradient.angle}deg, ${stopsCss})`
    case 'radial': {
      const cx = (gradient.origin.x * 100).toFixed(1)
      const cy = (gradient.origin.y * 100).toFixed(1)
      const spreadPct = (gradient.spread * 100).toFixed(0)
      return `radial-gradient(${spreadPct}% ${spreadPct}% at ${cx}% ${cy}%, ${stopsCss})`
    }
    case 'angular': {
      const cx = (gradient.origin.x * 100).toFixed(1)
      const cy = (gradient.origin.y * 100).toFixed(1)
      return `conic-gradient(from ${gradient.angle}deg at ${cx}% ${cy}%, ${stopsCss})`
    }
  }
}

/**
 * Prepares WebGL 300 ES uniforms for ShaderMount.
 */
export function gradientUniforms(paint: Extract<ShaderPaint, { kind: 'multi-stop-gradient' }>): NonNullable<ShaderMountProps['uniforms']> {
  const params = paint.params
  const stops = (paint.gradient?.stops && paint.gradient.stops.length >= 2)
    ? [...paint.gradient.stops].sort((a, b) => a.offset - b.offset)
    : params.colors.map((color, idx, arr) => ({
        id: `s-${idx}`,
        offset: arr.length > 1 ? idx / (arr.length - 1) : 0,
        color,
        opacity: 1,
      }))

  const typeValue = params.gradientType === 'linear' ? 0.0 : params.gradientType === 'radial' ? 1.0 : 2.0
  const angleRad = (params.angle * Math.PI) / 180

  const offsets = Array.from({ length: 16 }, (_, i) => i < stops.length ? stops[i].offset : 1.0)
  const colors = Array.from({ length: 16 }, (_, i) => {
    if (i < stops.length) {
      const parsed = parseHexColor(stops[i].color)
      const alpha = (stops[i].opacity ?? 1) * parsed.a
      return [parsed.r, parsed.g, parsed.b, alpha]
    }
    return [0, 0, 0, 1]
  })

  return {
    u_gradientType: typeValue,
    u_stopCount: stops.length,
    u_stopOffsets: offsets,
    u_stopColors: colors,
    u_angle: angleRad,
    u_origin: [params.originX, params.originY],
    u_focalLength: params.focalLength,
    u_spread: params.spread,
    u_dither: params.dither,
    u_smoothness: params.smoothness,
    u_speed: paint.speed,
    u_animated: paint.animated ? 1.0 : 0.0,
  }
}

/**
 * Bridges GradientPaint into a WebGL ShaderPaint for hardware-accelerated rendering.
 */
export function gradientToShaderPaint(gradient: GradientPaint, existing?: Partial<ShaderPaint>): ShaderPaint {
  const sortedStops = [...gradient.stops].sort((a, b) => a.offset - b.offset)
  const colors = sortedStops.map(s => s.color)

  const params: MultiStopGradientParams = {
    gradientType: gradient.type,
    colors,
    angle: gradient.angle,
    originX: gradient.origin.x,
    originY: gradient.origin.y,
    focalLength: gradient.focalLength,
    spread: gradient.spread,
    dither: gradient.dither ?? 0.25,
    smoothness: gradient.smoothness ?? 0.5,
  }

  const shader: ShaderPaint = {
    kind: 'multi-stop-gradient',
    params,
    gradient: freezeGradient(gradient),
    animated: existing?.animated ?? false,
    speed: existing?.speed ?? 0.5,
    frame: existing?.frame ?? 12000,
    scale: existing?.scale ?? 1,
    rotation: existing?.rotation ?? 0,
    offsetX: existing?.offsetX ?? 0,
    offsetY: existing?.offsetY ?? 0,
    composite: existing?.composite ?? { blendMode: 'normal', opacity: 1 },
  }

  return freezeShader(shader)
}

/**
 * Samples and interpolates color at a given offset (0 to 1) along multi-stop gradient.
 */
export function interpolateGradientColor(stops: readonly GradientColorStop[], offset: number): string {
  if (stops.length === 0) return '#81adec'
  if (stops.length === 1) return stops[0].color

  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  const clamped = Math.max(0, Math.min(1, offset))

  if (clamped <= sorted[0].offset) return sorted[0].color
  if (clamped >= sorted[sorted.length - 1].offset) return sorted[sorted.length - 1].color

  for (let i = 0; i < sorted.length - 1; i++) {
    const s0 = sorted[i]
    const s1 = sorted[i + 1]
    if (clamped >= s0.offset && clamped <= s1.offset) {
      const range = s1.offset - s0.offset
      const f = range > 0.0001 ? (clamped - s0.offset) / range : 0
      const c0 = parseHexColor(s0.color)
      const c1 = parseHexColor(s1.color)
      return toHexColor({
        r: c0.r + (c1.r - c0.r) * f,
        g: c0.g + (c1.g - c0.g) * f,
        b: c0.b + (c1.b - c0.b) * f,
        a: c0.a + (c1.a - c0.a) * f,
      })
    }
  }

  return sorted[0].color
}

export interface GradientPreset {
  readonly id: string
  readonly name: string
  readonly type: GradientType
  readonly angle: number
  readonly stops: readonly { readonly offset: number; readonly color: string }[]
}

export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  {
    id: 'paper-mono',
    name: 'Paper Monochrome',
    type: 'linear',
    angle: 90,
    stops: [
      { offset: 0, color: '#edebe1' },
      { offset: 1, color: '#222222' },
    ],
  },
  {
    id: 'horizon-glow',
    name: 'Horizon Glow',
    type: 'linear',
    angle: 45,
    stops: [
      { offset: 0, color: '#080808' },
      { offset: 0.5, color: '#81adec' },
      { offset: 1, color: '#edebe1' },
    ],
  },
  {
    id: 'cyber-blueprint',
    name: 'Cyber Blueprint',
    type: 'linear',
    angle: 135,
    stops: [
      { offset: 0, color: '#81adec' },
      { offset: 0.48, color: '#1e3a8a' },
      { offset: 1, color: '#080808' },
    ],
  },
  {
    id: 'sunset-iris',
    name: 'Sunset Iris',
    type: 'radial',
    angle: 0,
    stops: [
      { offset: 0, color: '#f472b6' },
      { offset: 0.55, color: '#818cf8' },
      { offset: 1, color: '#38bdf8' },
    ],
  },
  {
    id: 'emerald-abyss',
    name: 'Emerald Abyss',
    type: 'radial',
    angle: 45,
    stops: [
      { offset: 0, color: '#34d399' },
      { offset: 0.5, color: '#059669' },
      { offset: 1, color: '#064e3b' },
    ],
  },
  {
    id: 'prismatic-conic',
    name: 'Prismatic Angle',
    type: 'angular',
    angle: 0,
    stops: [
      { offset: 0, color: '#edebe1' },
      { offset: 0.33, color: '#81adec' },
      { offset: 0.66, color: '#a78bfa' },
      { offset: 1, color: '#edebe1' },
    ],
  },
  {
    id: 'dark-obsidian',
    name: 'Dark Obsidian',
    type: 'linear',
    angle: 180,
    stops: [
      { offset: 0, color: '#262626' },
      { offset: 1, color: '#080808' },
    ],
  },
]

export function reverseGradientStops(gradient: GradientPaint): GradientPaint {
  const reversed = gradient.stops.map(s => ({
    ...s,
    offset: Number((1 - s.offset).toFixed(4)),
  })).sort((a, b) => a.offset - b.offset)
  return freezeGradient({
    ...gradient,
    stops: reversed,
  })
}

export function addGradientStop(gradient: GradientPaint, offset: number, color?: string): { gradient: GradientPaint; newStopId: string } {
  if (gradient.stops.length >= 16) return { gradient, newStopId: gradient.stops[0].id }
  const clampedOffset = Math.max(0, Math.min(1, Number(offset.toFixed(4))))
  const interpolated = color ?? interpolateGradientColor(gradient.stops, clampedOffset)
  const newStopId = `stop-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  const newStop: GradientColorStop = {
    id: newStopId,
    offset: clampedOffset,
    color: interpolated,
    opacity: 1,
  }
  const nextStops = [...gradient.stops, newStop].sort((a, b) => a.offset - b.offset)
  return {
    gradient: freezeGradient({
      ...gradient,
      stops: nextStops,
    }),
    newStopId,
  }
}

export function removeGradientStop(gradient: GradientPaint, stopId: string): GradientPaint {
  if (gradient.stops.length <= 2) return gradient
  const nextStops = gradient.stops.filter(s => s.id !== stopId)
  return freezeGradient({
    ...gradient,
    stops: nextStops,
  })
}

export function updateGradientStop(gradient: GradientPaint, stopId: string, updates: Partial<GradientColorStop>): GradientPaint {
  const nextStops = gradient.stops.map(s => {
    if (s.id !== stopId) return s
    return {
      ...s,
      ...updates,
      ...(updates.offset !== undefined ? { offset: Math.max(0, Math.min(1, updates.offset)) } : {}),
      ...(updates.opacity !== undefined ? { opacity: Math.max(0, Math.min(1, updates.opacity)) } : {}),
    }
  }).sort((a, b) => a.offset - b.offset)
  return freezeGradient({
    ...gradient,
    stops: nextStops,
  })
}

