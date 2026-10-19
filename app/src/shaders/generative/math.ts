import { parseHexColor } from '../mesh.ts'
import type { GenerativeMaterialParams } from './types.ts'

export interface RGBColor {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

// Deterministic 2D hash
export function hash2D(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123
  return s - Math.floor(s)
}

// 2D smooth noise
export function smoothNoise2D(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy

  // Smoothstep interpolation weights
  const ux = fx * fx * (3.0 - 2.0 * fx)
  const uy = fy * fy * (3.0 - 2.0 * fy)

  const a = hash2D(ix, iy)
  const b = hash2D(ix + 1, iy)
  const c = hash2D(ix, iy + 1)
  const d = hash2D(ix + 1, iy + 1)

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

// Multi-octave fractal Brownian motion (fbm)
export function fbm2D(x: number, y: number, octaves: number = 4): number {
  let value = 0
  let amplitude = 0.5
  let freq = 1.0
  const octs = Math.max(1, Math.min(6, Math.round(octaves)))

  for (let i = 0; i < octs; i++) {
    value += amplitude * smoothNoise2D(x * freq, y * freq)
    freq *= 2.0
    amplitude *= 0.5
  }
  return value
}

// Incompressible fluid domain warping simulation
export function evaluateGenerativeField(
  x: number,
  y: number,
  params: Pick<GenerativeMaterialParams, 'fluidDistortion' | 'turbulenceSpeed' | 'frequency' | 'octaves'>,
  time: number = 0
): number {
  const t = time * 0.001 * (params.turbulenceSpeed ?? 0.65)
  const freq = params.frequency ?? 2.2
  const px = x * freq
  const py = y * freq

  const qx = fbm2D(px + t * 0.18, py, params.octaves)
  const qy = fbm2D(px + 5.2 - t * 0.14, py + 1.3, params.octaves)

  const rx = fbm2D(px + 3.2 * qx + 1.7 + t * 0.22, py + 9.2, params.octaves)
  const ry = fbm2D(px + 3.2 * qx + 8.3, py + 2.8 - t * 0.19, params.octaves)

  const distortion = params.fluidDistortion ?? 0.48
  const warpedX = px + distortion * 2.4 * rx
  const warpedY = py + distortion * 2.4 * ry

  const f = fbm2D(warpedX + qx * 1.6, warpedY + qy * 1.6, params.octaves)
  return Math.max(0, Math.min(1, f * 1.25 - 0.12))
}

// Multi-stop color stop Hermite interpolation
export function sampleColorStops(t: number, colorStops: readonly string[]): RGBColor {
  const clampedT = Math.max(0, Math.min(1, t))
  if (!colorStops || colorStops.length === 0) {
    return { r: 0, g: 0, b: 0, a: 1 }
  }
  if (colorStops.length === 1) {
    const c = parseHexColor(colorStops[0])
    return { r: c.r, g: c.g, b: c.b, a: c.a }
  }

  const scaled = clampedT * (colorStops.length - 1)
  const index = Math.floor(scaled)
  const frac = scaled - index
  // Hermite smoothstep
  const smoothFrac = frac * frac * (3.0 - 2.0 * frac)

  const c1 = parseHexColor(colorStops[index])
  const c2 = parseHexColor(colorStops[Math.min(index + 1, colorStops.length - 1)])

  return {
    r: c1.r + (c2.r - c1.r) * smoothFrac,
    g: c1.g + (c2.g - c1.g) * smoothFrac,
    b: c1.b + (c2.b - c1.b) * smoothFrac,
    a: c1.a + (c2.a - c1.a) * smoothFrac,
  }
}

// Cauchy chromatic dispersion
export function evaluateChromaticAberration(
  x: number,
  y: number,
  params: GenerativeMaterialParams,
  time: number = 0
): RGBColor {
  const strength = params.chromaticAberration ?? 0.28
  const disp = strength * 0.05
  const len = Math.hypot(x, y) || 0.0001
  const dx = (x / len) * disp
  const dy = (y / len) * disp

  const fieldR = evaluateGenerativeField(x + dx, y + dy, params, time)
  const fieldG = evaluateGenerativeField(x, y, params, time)
  const fieldB = evaluateGenerativeField(x - dx, y - dy, params, time)

  const colR = sampleColorStops(fieldR, params.colorStops)
  const colG = sampleColorStops(fieldG, params.colorStops)
  const colB = sampleColorStops(fieldB, params.colorStops)

  let r = colR.r
  let g = colG.g
  let b = colB.b
  const a = (colR.a + colG.a + colB.a) / 3

  // Contrast modulation
  const contrast = params.contrast ?? 1.15
  r = Math.max(0, Math.min(1, (r - 0.5) * contrast + 0.5))
  g = Math.max(0, Math.min(1, (g - 0.5) * contrast + 0.5))
  b = Math.max(0, Math.min(1, (b - 0.5) * contrast + 0.5))

  // Procedural grain
  const grainIntensity = params.grainIntensity ?? 0.12
  if (grainIntensity > 0.001) {
    const grain = (hash2D(x * 1000 + time, y * 1000 + time) - 0.5) * 2.0
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    const grainMask = 1.0 - 1.5 * Math.abs(lum - 0.5)
    const factor = grain * grainIntensity * 0.35 * Math.max(0.2, grainMask)
    r = Math.max(0, Math.min(1, r + factor))
    g = Math.max(0, Math.min(1, g + factor))
    b = Math.max(0, Math.min(1, b + factor))
  }

  return { r, g, b, a }
}

// Convert RGB 0..1 to hex string
export function generativeRgbToHex(c: RGBColor): string {
  const toHex = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`
}
