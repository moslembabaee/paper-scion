import type {
  ParticleColorMode,
  ParticleMagneticMode,
  ParticleSimulationParams,
  ParticleViewMode,
} from './types.ts'

export interface RgbColor {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** Parses hex color (#RRGGBB or #RGB) into normalized RGB float [0, 1]. */
export function parseColorToRgb(hex: string): RgbColor {
  const clean = hex.replace('#', '').trim()
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255
    const g = parseInt(clean[1] + clean[1], 16) / 255
    const b = parseInt(clean[2] + clean[2], 16) / 255
    return { r: isNaN(r) ? 0 : r, g: isNaN(g) ? 0 : g, b: isNaN(b) ? 0 : b }
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255
    const g = parseInt(clean.slice(2, 4), 16) / 255
    const b = parseInt(clean.slice(4, 6), 16) / 255
    return { r: isNaN(r) ? 0 : r, g: isNaN(g) ? 0 : g, b: isNaN(b) ? 0 : b }
  }
  return { r: 0.929, g: 0.922, b: 0.882 } // Fallback to Paper #edebe1
}

/** Converts normalized RGB back to hex string. */
export function rgbToHex(rgb: RgbColor): string {
  const toHex = (c: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(c * 255)))
    return clamped.toString(16).padStart(2, '0')
  }
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

/**
 * Validates particle simulation parameters.
 * Throws an Error if any parameter is out of bounds or invalid.
 */
export function validateParticleParams(params: unknown): asserts params is ParticleSimulationParams {
  if (!params || typeof params !== 'object') {
    throw new Error('Particle simulation parameters must be an object')
  }

  const p = params as Record<string, unknown>

  const rangeChecks: Array<[keyof ParticleSimulationParams, number, number, boolean]> = [
    ['particleCount', 1024, 65536, true],
    ['particleSize', 0.5, 12.0, false],
    ['advectionSpeed', 0.1, 5.0, false],
    ['curlStrength', 0.0, 10.0, false],
    ['curlScale', 0.2, 10.0, false],
    ['curlOctaves', 1, 5, true],
    ['velocityDamping', 0.80, 0.999, false],
    ['magneticForce', 0.0, 10.0, false],
    ['magneticRadius', 0.05, 1.0, false],
    ['magneticPolesCount', 0, 8, true],
    ['trailDecay', 0.70, 0.99, false],
    ['gridAlignment', 0.0, 1.0, false],
    ['glowIntensity', 0.0, 2.0, false],
    ['jitter', 0.0, 1.0, false],
  ]

  for (const [key, min, max, integer] of rangeChecks) {
    const val = p[key]
    if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) {
      throw new Error(`Invalid particle parameter ${key}: expected number between ${min} and ${max}, got ${String(val)}`)
    }
    if (integer && !Number.isInteger(val)) {
      throw new Error(`Invalid particle parameter ${key}: expected integer, got ${String(val)}`)
    }
  }

  const validMagneticModes: readonly ParticleMagneticMode[] = [
    'attract',
    'repel',
    'vortex',
    'dipole',
    'cross-flow',
    'orbit',
  ]
  if (typeof p.magneticMode !== 'string' || !validMagneticModes.includes(p.magneticMode as ParticleMagneticMode)) {
    throw new Error(`Invalid particle magneticMode: ${String(p.magneticMode)}`)
  }

  const validColorModes: readonly ParticleColorMode[] = [
    'palette',
    'monochrome',
    'velocity',
    'magnetic-flow',
    'aurora',
    'paper-blueprint',
  ]
  if (typeof p.colorMode !== 'string' || !validColorModes.includes(p.colorMode as ParticleColorMode)) {
    throw new Error(`Invalid particle colorMode: ${String(p.colorMode)}`)
  }

  const validViewModes: readonly ParticleViewMode[] = [
    'field-composite',
    'particles-only',
    'flow-vectors',
    'magnetic-potential',
    'velocity-stream',
    'trails-only',
  ]
  if (typeof p.viewMode !== 'string' || !validViewModes.includes(p.viewMode as ParticleViewMode)) {
    throw new Error(`Invalid particle viewMode: ${String(p.viewMode)}`)
  }

  if (
    !Array.isArray(p.particleColors) ||
    p.particleColors.length < 2 ||
    p.particleColors.length > 8 ||
    !p.particleColors.every(c => typeof c === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(c))
  ) {
    throw new Error('Invalid particleColors: expected array of 2-8 hex colors')
  }
}

/** Calculates grid texture dimensions for a given particle count (e.g. 16384 -> 128x128). */
export function calculateParticleTextureSize(count: number): { width: number; height: number; count: number } {
  const side = Math.ceil(Math.sqrt(Math.max(1024, Math.min(65536, count))))
  // Power of 2 preferred for WebGL texture tiling
  const pow2 = Math.min(256, Math.max(32, Math.pow(2, Math.ceil(Math.log2(side)))))
  const actualCount = pow2 * pow2
  return {
    width: pow2,
    height: pow2,
    count: actualCount,
  }
}
