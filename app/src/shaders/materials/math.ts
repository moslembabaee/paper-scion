// Mathematical algorithms and physics utilities for the Interactive WebGL Shader FX Material System
import { parseHexColor } from '../mesh.ts'

export const TWO_PI = 2 * Math.PI

/**
 * Physical Cauchy dispersion formula:
 * Computes spectral Index of Refraction (IOR) for specific RGB wavelengths:
 * - Red (650 nm): refracts least (n - dispOffset)
 * - Green (532 nm): base reference IOR (n)
 * - Blue (450 nm): refracts most (n + dispOffset)
 */
export function calculateCauchyIOR(
  baseIOR: number,
  dispersionSpread: number,
  channel: 'r' | 'g' | 'b'
): number {
  const ior = Math.max(1.0, baseIOR)
  const dispOffset = dispersionSpread * 0.14
  switch (channel) {
    case 'r':
      return Math.max(1.0, ior - dispOffset)
    case 'g':
      return ior
    case 'b':
      return ior + dispOffset
  }
}

/**
 * Snell-Descartes vector refraction calculation for orthographic incident rays:
 * Incident ray V = (0, 0, 1), normal N = (nx, ny, nz)
 */
export function calculateRefractionVector(
  nx: number,
  ny: number,
  nz: number,
  ior: number
): { x: number; y: number; z: number } {
  const eta = 1.0 / Math.max(1.0, ior)
  // Incident V = (0, 0, 1) -> -V = (0, 0, -1)
  const dotNV = nz // dot(N, V)
  const k = 1.0 - eta * eta * (1.0 - dotNV * dotNV)
  if (k < 0.0) {
    // Total internal reflection -> reflect(-V, N)
    return {
      x: -2.0 * dotNV * nx,
      y: -2.0 * dotNV * ny,
      z: 1.0 - 2.0 * dotNV * nz,
    }
  }
  const factor = eta * dotNV + Math.sqrt(k)
  return {
    x: -factor * nx,
    y: -factor * ny,
    z: -eta - factor * nz,
  }
}

/**
 * Thin-film optical interference simulation via Airy formula:
 * Evaluates spectral phase shift across RGB wavelengths (650nm, 532nm, 450nm)
 */
export function calculateThinFilmInterference(
  cosTheta: number,
  thicknessNm: number,
  ior: number
): { r: number; g: number; b: number } {
  const sin2Theta = Math.max(0.0, 1.0 - cosTheta * cosTheta)
  const cosThetaT = Math.sqrt(Math.max(0.0, 1.0 - sin2Theta / (ior * ior)))
  const opd = 2.0 * ior * thicknessNm * cosThetaT

  const wlR = 650.0
  const wlG = 532.0
  const wlB = 450.0

  const phiR = (TWO_PI * opd) / wlR
  const phiG = (TWO_PI * opd) / wlG
  const phiB = (TWO_PI * opd) / wlB

  return {
    r: Math.max(0.0, Math.min(1.0, 0.5 + 0.5 * Math.cos(phiR))),
    g: Math.max(0.0, Math.min(1.0, 0.5 + 0.5 * Math.cos(phiG))),
    b: Math.max(0.0, Math.min(1.0, 0.5 + 0.5 * Math.cos(phiB))),
  }
}

/**
 * Schlick Fresnel reflectance approximation for dielectrics
 */
export function evaluateFresnel(cosTheta: number, ior: number): number {
  const f0 = Math.pow((ior - 1.0) / (ior + 1.0), 2.0)
  const clampedCos = Math.max(0.0, Math.min(1.0, cosTheta))
  return f0 + (1.0 - f0) * Math.pow(1.0 - clampedCos, 4.0)
}

/**
 * Simple 2D hash for pseudo-random gradient noise
 */
function hash12(x: number, y: number): number {
  let px = (x * 0.1031) % 1.0
  let py = (y * 0.1031) % 1.0
  let pz = (x * 0.1031) % 1.0
  if (px < 0) px += 1.0
  if (py < 0) py += 1.0
  if (pz < 0) pz += 1.0

  const dotVal = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33)
  px = (px + dotVal) % 1.0
  py = (py + dotVal) % 1.0
  pz = (pz + dotVal) % 1.0
  const result = ((px + py) * pz) % 1.0
  return result < 0 ? result + 1.0 : result
}

function noise2D(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy

  const u = fx * fx * (3.0 - 2.0 * fx)
  const v = fy * fy * (3.0 - 2.0 * fy)

  const a = hash12(ix, iy)
  const b = hash12(ix + 1.0, iy)
  const c = hash12(ix, iy + 1.0)
  const d = hash12(ix + 1.0, iy + 1.0)

  return (a * (1.0 - u) + b * u) * (1.0 - v) + (c * (1.0 - u) + d * u) * v
}

/**
 * Curl noise vector calculation for incompressible fluid flow
 */
export function curlNoise2D(x: number, y: number): { x: number; y: number } {
  const eps = 0.01
  const n1 = noise2D(x, y + eps)
  const n2 = noise2D(x, y - eps)
  const n3 = noise2D(x + eps, y)
  const n4 = noise2D(x - eps, y)
  return {
    x: (n1 - n2) / (2.0 * eps),
    y: -(n3 - n4) / (2.0 * eps),
  }
}

/**
 * Analytical liquid warp distortion field
 */
export function evaluateLiquidWarp(
  x: number,
  y: number,
  time: number,
  frequency: number,
  viscosity: number
): { dx: number; dy: number } {
  const viscFactor = 1.0 - Math.max(0.0, Math.min(0.9, viscosity)) * 0.6
  const t = time * 0.1 * viscFactor
  const curl = curlNoise2D(x * frequency * 0.7 + t * 0.15, y * frequency * 0.7 + t * 0.15)
  const waveX = Math.sin(x * frequency * 1.8 + curl.y * 3.0 + t * 0.6)
  const waveY = Math.cos(y * frequency * 1.8 + curl.x * 3.0 - t * 0.4)
  return {
    dx: waveX * 0.5 * 0.35 * viscFactor,
    dy: waveY * 0.5 * 0.35 * viscFactor,
  }
}

/**
 * Procedural grain / stipple calculation
 */
export function evaluateProceduralGrain(
  x: number,
  y: number,
  time: number,
  scale: number,
  intensity: number
): number {
  const s = scale * 0.45
  const gx = x * s + Math.sin(time * 10.0)
  const gy = y * s + Math.cos(time * 10.0)
  const rawNoise = hash12(gx, gy)
  return (rawNoise - 0.5) * (intensity * 0.35)
}

/**
 * Multi-tap golden-angle spiral Poisson-disc backdrop blur kernel generator
 */
export function calculateBackdropBlurKernel(
  blurRadius: number,
  tapCount = 12
): Array<{ offset: [number, number]; weight: number }> {
  const taps: Array<{ offset: [number, number]; weight: number }> = []
  let totalWeight = 0

  for (let i = 0; i < tapCount; i++) {
    const angle = i * 2.39996323 // Golden angle
    const r = Math.sqrt((i + 1.0) / tapCount) * blurRadius
    const ox = Math.cos(angle) * r
    const oy = Math.sin(angle) * r
    const weight = Math.exp(-2.2 * (r / Math.max(0.001, blurRadius)) * (r / Math.max(0.001, blurRadius)))
    taps.push({ offset: [ox, oy], weight })
    totalWeight += weight
  }

  const safeTotal = Math.max(0.0001, totalWeight)
  return taps.map(t => ({ offset: t.offset, weight: t.weight / safeTotal }))
}

/**
 * Sample procedural Paper design system backdrop scene
 */
export function sampleBackdropScene(x: number, y: number): { r: number; g: number; b: number } {
  const cream = { r: 0.929, g: 0.922, b: 0.882 }
  const blue = { r: 0.506, g: 0.678, b: 0.925 }
  const slate = { r: 0.318, g: 0.42, b: 0.58 }
  const charcoal = { r: 0.133, g: 0.133, b: 0.133 }

  const diag = Math.max(0, Math.min(1, x * 0.6 + y * 0.4))
  const cardDist = Math.hypot(x - 0.35, y - 0.45)
  const cardGlow = Math.max(0, Math.min(1, (0.5 - cardDist) / 0.5))
  const spotDist = Math.hypot(x - 0.75, y - 0.8)
  const spotGlow = Math.max(0, Math.min(1, (0.7 - spotDist) / 0.6))

  // Interpolate base
  let r = cream.r * (1 - diag) + charcoal.r * diag
  let g = cream.g * (1 - diag) + charcoal.g * diag
  let b = cream.b * (1 - diag) + charcoal.b * diag

  r = r * (1 - cardGlow * 0.65) + blue.r * cardGlow * 0.65
  g = g * (1 - cardGlow * 0.65) + blue.g * cardGlow * 0.65
  b = b * (1 - cardGlow * 0.65) + blue.b * cardGlow * 0.65

  r = r * (1 - spotGlow * 0.5) + slate.r * spotGlow * 0.5
  g = g * (1 - spotGlow * 0.5) + slate.g * spotGlow * 0.5
  b = b * (1 - spotGlow * 0.5) + slate.b * spotGlow * 0.5

  return {
    r: Math.min(1.0, r),
    g: Math.min(1.0, g),
    b: Math.min(1.0, b),
  }
}

/**
 * Smoothstep multi-stop palette color interpolation
 */
export function sampleMaterialPalette(
  colors: readonly string[],
  t: number
): { r: number; g: number; b: number } {
  if (!colors || colors.length === 0) return { r: 0.93, g: 0.92, b: 0.88 }
  if (colors.length === 1) {
    const c = parseHexColor(colors[0])
    return { r: c.r, g: c.g, b: c.b }
  }

  const count = colors.length
  const clampedT = Math.max(0.0, Math.min(0.9999, t)) * (count - 1)
  const idx = Math.floor(clampedT)
  const fract = clampedT - idx
  const smoothF = fract * fract * (3.0 - 2.0 * fract)

  const cA = parseHexColor(colors[idx])
  const cB = parseHexColor(colors[Math.min(count - 1, idx + 1)])

  return {
    r: cA.r * (1.0 - smoothF) + cB.r * smoothF,
    g: cA.g * (1.0 - smoothF) + cB.g * smoothF,
    b: cA.b * (1.0 - smoothF) + cB.b * smoothF,
  }
}
