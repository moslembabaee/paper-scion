import type { MeshAnchor, MeshDistortionMode, MeshGridConfig, MeshGridVertex, MeshInterpolationMode, MeshMaterial, NoiseGenerator, ShaderPaint } from './types.ts'
import { grainBlendModes, meshDistortionModes, meshInterpolationModes, meshTopologies, noiseGenerators } from './types.ts'
export { grainBlendModes, meshDistortionModes, meshInterpolationModes, meshTopologies, noiseGenerators }
export type { MeshDistortionMode }

export const clampUnit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

export function defaultMeshAnchor(index: number): MeshAnchor {
  const angle = index * 2.3999632297 - Math.PI / 2
  return {
    x: .5 + Math.cos(angle) * .34,
    y: .5 + Math.sin(angle) * .34,
    radius: .65,
    alpha: 1,
    tx: 0,
    ty: 0,
    tension: 1,
  }
}

export function createMeshMaterial(
  count: number | readonly unknown[],
  options?: {
    turbulence?: number
    frequency?: number
    chromaticAberration?: number
    grainBlend?: (typeof grainBlendModes)[number]
    interpolation?: MeshInterpolationMode
    warpModulation?: number
    noiseType?: NoiseGenerator
    lacunarity?: number
    octaves?: number
    normalPerturbation?: number
    grainDisplacement?: number
    fluidAdvection?: number
    fluidViscosity?: number
    distortionMode?: MeshDistortionMode
    viewMode?: 'shaded' | 'normal-map' | 'displacement'
  }
): MeshMaterial {
  const length = typeof count === 'number' ? count : count.length
  return {
    anchors: Array.from({ length }, (_, index) => defaultMeshAnchor(index)),
    turbulence: options?.turbulence ?? .15,
    frequency: options?.frequency ?? 3,
    chromaticAberration: options?.chromaticAberration ?? 0,
    grainBlend: options?.grainBlend ?? 'overlay',
    interpolation: options?.interpolation ?? 'bicubic',
    warpModulation: options?.warpModulation ?? 0.25,
    noiseType: options?.noiseType ?? 'simplex',
    lacunarity: options?.lacunarity ?? 2.0,
    octaves: options?.octaves ?? 3,
    normalPerturbation: options?.normalPerturbation ?? 0.2,
    grainDisplacement: options?.grainDisplacement ?? 0.15,
    fluidAdvection: options?.fluidAdvection ?? 0.35,
    fluidViscosity: options?.fluidViscosity ?? 0.5,
    distortionMode: options?.distortionMode ?? 'curl-fluid',
    viewMode: options?.viewMode ?? 'shaded',
  }
}

const allowedMeshKeys = new Set([
  'anchors',
  'turbulence',
  'frequency',
  'chromaticAberration',
  'grainBlend',
  'interpolation',
  'warpModulation',
  'noiseType',
  'lacunarity',
  'octaves',
  'normalPerturbation',
  'grainDisplacement',
  'fluidAdvection',
  'fluidViscosity',
  'distortionMode',
  'grid',
  'viewMode',
])

export function validateMeshMaterial(mesh: MeshMaterial, paint: ShaderPaint) {
  const within = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

  const allowedAnchorKeys = new Set(['x', 'y', 'radius', 'alpha', 'tx', 'ty', 'tension'])

  if (
    paint.kind !== 'mesh-gradient' ||
    !mesh ||
    typeof mesh !== 'object' ||
    !Array.isArray(mesh.anchors) ||
    mesh.anchors.length !== paint.params.colors.length ||
    !within(mesh.turbulence, 0, 1) ||
    !within(mesh.frequency, 1, 12) ||
    !within(mesh.chromaticAberration, 0, 1) ||
    !grainBlendModes.includes(mesh.grainBlend) ||
    mesh.anchors.some(
      anchor =>
        !anchor ||
        Object.keys(anchor).some(k => !allowedAnchorKeys.has(k)) ||
        !within(anchor.x, 0, 1) ||
        !within(anchor.y, 0, 1) ||
        !within(anchor.radius, 0.1, 2) ||
        (anchor.alpha !== undefined && !within(anchor.alpha, 0, 1)) ||
        (anchor.tx !== undefined && !within(anchor.tx, -1, 1)) ||
        (anchor.ty !== undefined && !within(anchor.ty, -1, 1)) ||
        (anchor.tension !== undefined && !within(anchor.tension, 0, 2))
    )
  ) {
    throw new Error('Invalid shader mesh material')
  }

  // Ensure no unexpected unknown keys exist
  for (const key of Object.keys(mesh)) {
    if (!allowedMeshKeys.has(key)) throw new Error('Invalid shader mesh material')
  }

  if (mesh.interpolation !== undefined && !meshInterpolationModes.includes(mesh.interpolation)) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.warpModulation !== undefined && !within(mesh.warpModulation, 0, 1)) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.noiseType !== undefined && !noiseGenerators.includes(mesh.noiseType)) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.lacunarity !== undefined && !within(mesh.lacunarity, 1, 5)) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.octaves !== undefined && (!within(mesh.octaves, 1, 8) || !Number.isInteger(mesh.octaves))) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.normalPerturbation !== undefined && !within(mesh.normalPerturbation, 0, 1)) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.grainDisplacement !== undefined && !within(mesh.grainDisplacement, 0, 1)) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.fluidAdvection !== undefined && !within(mesh.fluidAdvection, 0, 1)) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.fluidViscosity !== undefined && !within(mesh.fluidViscosity, 0, 1)) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.distortionMode !== undefined && !meshDistortionModes.includes(mesh.distortionMode)) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.viewMode !== undefined && !['shaded', 'normal-map', 'displacement'].includes(mesh.viewMode)) {
    throw new Error('Invalid shader mesh material')
  }
  if (mesh.grid !== undefined) {
    validateMeshGrid(mesh.grid)
  }
}

export interface MeshDisplacementPreset {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly noiseType: NoiseGenerator
  readonly octaves: number
  readonly lacunarity: number
  readonly turbulence: number
  readonly frequency: number
  readonly normalPerturbation: number
  readonly grainDisplacement: number
}

export const MESH_DISPLACEMENT_PRESETS: readonly MeshDisplacementPreset[] = [
  {
    id: 'subtle-grain',
    name: 'Subtle Grain',
    description: 'Fine microscopic grain displacement with gentle surface bump.',
    noiseType: 'simplex',
    octaves: 2,
    lacunarity: 2.0,
    turbulence: 0.1,
    frequency: 3.5,
    normalPerturbation: 0.15,
    grainDisplacement: 0.1,
  },
  {
    id: 'silk-wave',
    name: 'Silk Wave',
    description: 'Harmonic 2D Simplex wave displacement with smooth normal sheen.',
    noiseType: 'simplex',
    octaves: 3,
    lacunarity: 2.2,
    turbulence: 0.2,
    frequency: 4.0,
    normalPerturbation: 0.35,
    grainDisplacement: 0.12,
  },
  {
    id: 'granite-sheen',
    name: 'Granite Sheen',
    description: 'Multi-octave Perlin noise with pronounced textural normal perturbation.',
    noiseType: 'perlin',
    octaves: 4,
    lacunarity: 2.4,
    turbulence: 0.35,
    frequency: 5.0,
    normalPerturbation: 0.5,
    grainDisplacement: 0.22,
  },
  {
    id: 'basalt-relief',
    name: 'Basalt Relief',
    description: 'Cellular Worley crystals with crisp faceted normal map displacement.',
    noiseType: 'worley',
    octaves: 3,
    lacunarity: 2.0,
    turbulence: 0.4,
    frequency: 4.5,
    normalPerturbation: 0.65,
    grainDisplacement: 0.18,
  },
  {
    id: 'volcanic-magma',
    name: 'Volcanic Magma',
    description: 'High-turbulence Simplex ridges with deep normal crevices and fissures.',
    noiseType: 'simplex',
    octaves: 5,
    lacunarity: 2.5,
    turbulence: 0.75,
    frequency: 4.2,
    normalPerturbation: 0.8,
    grainDisplacement: 0.25,
  },
  {
    id: 'caustic-crest',
    name: 'Caustic Crest',
    description: 'Cellular Voronoi webbing with sharp specular normal crests.',
    noiseType: 'worley',
    octaves: 2,
    lacunarity: 1.8,
    turbulence: 0.15,
    frequency: 6.0,
    normalPerturbation: 0.6,
    grainDisplacement: 0.08,
  },
] as const

/** Same transform as the fragment shader; handles stay aligned through material transforms. */
export function meshToSurface(anchor: Pick<MeshAnchor, 'x' | 'y'>, paint: ShaderPaint) {
  const angle = paint.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  const x = (anchor.x - .5) * paint.scale, y = (anchor.y - .5) * paint.scale
  return { x: .5 + c * x - s * y + paint.offsetX, y: .5 + s * x + c * y + paint.offsetY }
}

export function surfaceToMesh(point: Pick<MeshAnchor, 'x' | 'y'>, paint: ShaderPaint) {
  const angle = -paint.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  const x = point.x - .5 - paint.offsetX, y = point.y - .5 - paint.offsetY
  return { x: clampUnit(.5 + (c * x - s * y) / paint.scale), y: clampUnit(.5 + (s * x + c * y) / paint.scale) }
}

export function meshUniforms(paint: Extract<ShaderPaint, { kind: 'mesh-gradient' }>) {
  const mesh = paint.mesh ?? createMeshMaterial(paint.params.colors.length)
  const grid = mesh.grid
  const colors = paint.params.colors.map(hex => {
    const c = parseHexColor(hex)
    return [c.r, c.g, c.b, c.a]
  })
  const interpMode = mesh.interpolation ?? 'bicubic'
  const interpolationValue = interpMode === 'bicubic' ? 0 : interpMode === 'gaussian-rbf' ? 1 : 2
  const warpModulation = mesh.warpModulation ?? 0.25
  const noiseType = mesh.noiseType ?? 'simplex'
  const noiseTypeValue = noiseType === 'simplex' ? 0 : noiseType === 'perlin' ? 1 : 2
  const lacunarity = mesh.lacunarity ?? 2.0
  const octaves = mesh.octaves ?? 3
  const normalPerturbation = mesh.normalPerturbation ?? 0.2
  const grainDisplacement = mesh.grainDisplacement ?? 0.15
  const fluidAdvection = mesh.fluidAdvection ?? 0.35
  const fluidViscosity = mesh.fluidViscosity ?? 0.5
  const distortionMode = mesh.distortionMode ?? 'curl-fluid'
  const distortionModeValue = distortionMode === 'curl-fluid' ? 0 : distortionMode === 'domain-warp' ? 1 : distortionMode === 'turbulent-swirl' ? 2 : 3
  const viewMode = mesh.viewMode ?? 'shaded'
  const viewModeValue = viewMode === 'normal-map' ? 1.0 : viewMode === 'displacement' ? 2.0 : 0.0

  const gridUniforms = grid ? {
    u_gridMode: 1.0,
    u_gridRows: grid.rows,
    u_gridCols: grid.cols,
    u_gridSmoothing: grid.smoothing,
    u_gridColors: Array.from({ length: 64 }, (_, i) => {
      if (i < grid.vertices.length) {
        const v = grid.vertices[i]
        const c = parseHexColor(v.color)
        const alpha = v.alpha !== undefined ? v.alpha : c.a
        return [c.r, c.g, c.b, alpha]
      }
      return [0, 0, 0, 1]
    }),
    u_gridTangents: Array.from({ length: 64 }, (_, i) =>
      i < grid.vertices.length ? [grid.vertices[i].tx, grid.vertices[i].ty, grid.vertices[i].tension ?? 1.0] : [0, 0, 1.0]
    ),
  } : {
    u_gridMode: 0.0,
    u_gridRows: 0,
    u_gridCols: 0,
    u_gridSmoothing: 0,
    u_gridColors: Array.from({ length: 64 }, () => [0, 0, 0, 1]),
    u_gridTangents: Array.from({ length: 64 }, () => [0, 0, 1.0]),
  }

  return {
    u_count: colors.length,
    u_colors: Array.from({ length: 10 }, (_, i) => colors[i] ?? [0, 0, 0, 1]),
    u_anchors: Array.from({ length: 10 }, (_, i) => {
      const a = mesh.anchors[i] ?? defaultMeshAnchor(i)
      return [a.x, a.y, a.radius, a.alpha ?? 1.0]
    }),
    u_anchorTangents: Array.from({ length: 10 }, (_, i) => {
      const a = mesh.anchors[i] ?? defaultMeshAnchor(i)
      return [a.tx ?? 0.0, a.ty ?? 0.0, a.tension ?? 1.0]
    }),
    u_interpolation: interpolationValue,
    u_warpModulation: warpModulation,
    u_noiseType: noiseTypeValue,
    u_lacunarity: lacunarity,
    u_octaves: octaves,
    u_normalPerturbation: normalPerturbation,
    u_grainDisplacement: grainDisplacement,
    u_fluidAdvection: fluidAdvection,
    u_fluidViscosity: fluidViscosity,
    u_distortionMode: distortionModeValue,
    u_viewMode: viewModeValue,
    u_turbulence: mesh.turbulence,
    u_frequency: mesh.frequency,
    u_chromatic: mesh.chromaticAberration,
    u_grainBlend: grainBlendModes.indexOf(mesh.grainBlend),
    u_distortion: paint.params.distortion,
    u_swirl: paint.params.swirl,
    u_grainMixer: paint.params.grainMixer,
    u_grainOverlay: paint.params.grainOverlay,
    u_scale: paint.scale,
    u_rotation: paint.rotation * Math.PI / 180,
    u_offset: [paint.offsetX, paint.offsetY],
    ...gridUniforms,
  }
}

export interface RGBAColor {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

export function parseHexColor(hex: string): RGBAColor {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  if (clean.length === 3 || clean.length === 4) {
    const r = parseInt(clean[0] + clean[0], 16) / 255
    const g = parseInt(clean[1] + clean[1], 16) / 255
    const b = parseInt(clean[2] + clean[2], 16) / 255
    const a = clean.length === 4 ? parseInt(clean[3] + clean[3], 16) / 255 : 1
    return { r: Number.isFinite(r) ? r : 0, g: Number.isFinite(g) ? g : 0, b: Number.isFinite(b) ? b : 0, a: Number.isFinite(a) ? a : 1 }
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const a = clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1
  return {
    r: Number.isFinite(r) ? r : 0,
    g: Number.isFinite(g) ? g : 0,
    b: Number.isFinite(b) ? b : 0,
    a: Number.isFinite(a) ? a : 1,
  }
}

export function toHexColor(color: RGBAColor): string {
  const r = Math.round(clampUnit(color.r) * 255).toString(16).padStart(2, '0')
  const g = Math.round(clampUnit(color.g) * 255).toString(16).padStart(2, '0')
  const b = Math.round(clampUnit(color.b) * 255).toString(16).padStart(2, '0')
  if (color.a < 0.999) {
    const a = Math.round(clampUnit(color.a) * 255).toString(16).padStart(2, '0')
    return `#${r}${g}${b}${a}`
  }
  return `#${r}${g}${b}`
}

/**
 * Calculates the exact interpolated color at normalized coordinate (x, y)
 * based on the GPU mesh fragment shader's bicubic spline or Gaussian RBF field.
 */
export function interpolateMeshColor(
  anchors: readonly MeshAnchor[],
  colors: readonly string[],
  point: { x: number; y: number },
  interpolation: MeshInterpolationMode = 'bicubic'
): string {
  if (colors.length === 0) return '#81adec'
  if (anchors.length === 0 || anchors.length !== colors.length) return colors[0] ?? '#81adec'

  let totalWeight = 0
  let r = 0, g = 0, b = 0, a = 0

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]
    const color = parseHexColor(colors[i])
    const vertexAlpha = anchor.alpha !== undefined ? anchor.alpha : 1.0
    const effAlpha = color.a * vertexAlpha

    // Tangential curve tension offset
    const tx = anchor.tx ?? 0
    const ty = anchor.ty ?? 0
    const tension = anchor.tension ?? 1.0
    const tangentOffsetX = tx * tension * 0.18
    const tangentOffsetY = ty * tension * 0.18

    const dx = point.x - (anchor.x + tangentOffsetX)
    const dy = point.y - (anchor.y + tangentOffsetY)
    const radius = Math.max(0.1, anchor.radius)
    let weight = 0

    if (interpolation === 'bicubic') {
      // Smooth bicubic Hermite tensor spline
      const sx = Math.min(1, Math.abs(dx) / radius)
      const sy = Math.min(1, Math.abs(dy) / radius)
      const hx = (1 - sx) * (1 - sx) * (1 + 2 * sx)
      const hy = (1 - sy) * (1 - sy) * (1 + 2 * sy)
      const distSq = dx * dx + dy * dy
      const rad = Math.min(1, Math.sqrt(distSq) / radius)
      const hRad = (1 - rad) * (1 - rad) * (1 + 2 * rad)
      weight = (hx * hy * 0.7 + hRad * 0.3) + 0.00001
    } else if (interpolation === 'catmull-rom') {
      // Catmull-Rom cubic spline
      const sx = Math.min(1, Math.abs(dx) / radius)
      const sy = Math.min(1, Math.abs(dy) / radius)
      const crX = Math.max(0, 1 - 2.5 * sx * sx + 1.5 * sx * sx * sx)
      const crY = Math.max(0, 1 - 2.5 * sy * sy + 1.5 * sy * sy * sy)
      weight = crX * crY + 0.00001
    } else {
      // Gaussian RBF
      const distSq = dx * dx + dy * dy
      weight = Math.exp(-distSq * 8.0 / (radius * radius)) + 0.00001
    }

    r += color.r * effAlpha * weight
    g += color.g * effAlpha * weight
    b += color.b * effAlpha * weight
    a += effAlpha * weight
    totalWeight += weight
  }

  if (totalWeight <= 0) return colors[0]
  const finalA = a / totalWeight
  const safeA = Math.max(0.0001, finalA)
  return toHexColor({
    r: (r / totalWeight) / safeA,
    g: (g / totalWeight) / safeA,
    b: (b / totalWeight) / safeA,
    a: finalA,
  })
}

/**
 * Evaluates a 2D bicubic patch of colors using bicubic polynomial basis functions.
 * Useful for regular grid mesh topologies.
 */
export function evaluateBicubicPatch(
  gridColors: readonly (readonly string[])[],
  u: number,
  v: number
): string {
  const rows = gridColors.length
  if (rows === 0) return '#81adec'
  const cols = gridColors[0].length
  if (cols === 0) return '#81adec'
  if (rows === 1 && cols === 1) return gridColors[0][0]

  const clampedU = clampUnit(u)
  const clampedV = clampUnit(v)

  const uPos = clampedU * (cols - 1)
  const vPos = clampedV * (rows - 1)

  const colIdx = Math.min(Math.floor(uPos), cols - 2)
  const rowIdx = Math.min(Math.floor(vPos), rows - 2)

  const s = uPos - colIdx
  const t = vPos - rowIdx

  // Cubic Hermite smoothstep basis
  const su = s * s * (3 - 2 * s)
  const sv = t * t * (3 - 2 * t)

  const c00 = parseHexColor(gridColors[rowIdx][colIdx])
  const c10 = parseHexColor(gridColors[rowIdx][colIdx + 1])
  const c01 = parseHexColor(gridColors[rowIdx + 1][colIdx])
  const c11 = parseHexColor(gridColors[rowIdx + 1][colIdx + 1])

  const topR = c00.r + (c10.r - c00.r) * su
  const topG = c00.g + (c10.g - c00.g) * su
  const topB = c00.b + (c10.b - c00.b) * su
  const topA = c00.a + (c10.a - c00.a) * su

  const botR = c01.r + (c11.r - c01.r) * su
  const botG = c01.g + (c11.g - c01.g) * su
  const botB = c01.b + (c11.b - c01.b) * su
  const botA = c01.a + (c11.a - c01.a) * su

  return toHexColor({
    r: topR + (botR - topR) * sv,
    g: topG + (botG - topG) * sv,
    b: topB + (botB - topB) * sv,
    a: topA + (botA - topA) * sv,
  })
}

export const meshHarmonyModes = [
  'harmonic',
  'analogous',
  'complementary',
  'split-complementary',
  'triadic',
  'tetradic',
  'vibrant',
  'monochrome',
  'duotone',
] as const
export type MeshHarmonyMode = typeof meshHarmonyModes[number]

/**
 * Procedural Color Field Synthesizer: converts base color into harmonious color field stops.
 */
export function synthesizeProceduralColorField(
  baseHex: string,
  count: number,
  harmony: MeshHarmonyMode = 'harmonic'
): string[] {
  if (count <= 0) return []
  const base = parseHexColor(baseHex)

  // Convert RGB to HSL
  const max = Math.max(base.r, base.g, base.b)
  const min = Math.min(base.r, base.g, base.b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case base.r: h = ((base.g - base.b) / d + (base.g < base.b ? 6 : 0)) / 6; break
      case base.g: h = ((base.b - base.r) / d + 2) / 6; break
      case base.b: h = ((base.r - base.g) / d + 4) / 6; break
    }
  }

  const hslToRgb = (hVal: number, sVal: number, lVal: number): RGBAColor => {
    const hue2rgb = (p: number, q: number, t: number) => {
      let tNorm = t
      if (tNorm < 0) tNorm += 1
      if (tNorm > 1) tNorm -= 1
      if (tNorm < 1 / 6) return p + (q - p) * 6 * tNorm
      if (tNorm < 1 / 2) return q
      if (tNorm < 2 / 3) return p + (q - p) * (2 / 3 - tNorm) * 6
      return p
    }

    if (sVal === 0) return { r: lVal, g: lVal, b: lVal, a: base.a }
    const q = lVal < 0.5 ? lVal * (1 + sVal) : lVal + sVal - lVal * sVal
    const p = 2 * lVal - q
    return {
      r: hue2rgb(p, q, hVal + 1 / 3),
      g: hue2rgb(p, q, hVal),
      b: hue2rgb(p, q, hVal - 1 / 3),
      a: base.a,
    }
  }

  const results: string[] = []
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0
    let stopH = h
    let stopS = s
    let stopL = l

    if (harmony === 'analogous') {
      stopH = (h + (t - 0.5) * 0.25 + 1) % 1
      stopL = Math.max(0.15, Math.min(0.85, l + (t - 0.5) * 0.3))
    } else if (harmony === 'complementary') {
      stopH = (h + t * 0.5 + 1) % 1
      stopS = Math.max(0.3, Math.min(0.9, s + (1 - t) * 0.1))
      stopL = Math.max(0.2, Math.min(0.8, l + (t - 0.5) * 0.4))
    } else if (harmony === 'split-complementary') {
      const splitOffset = i % 2 === 0 ? 0.42 : 0.58
      stopH = (h + (t === 0 ? 0 : splitOffset + (t - 0.5) * 0.1) + 1) % 1
      stopS = Math.max(0.35, Math.min(0.9, s + (1 - t) * 0.15))
      stopL = Math.max(0.2, Math.min(0.8, l + (t - 0.5) * 0.35))
    } else if (harmony === 'triadic') {
      stopH = (h + t * (2 / 3) + 1) % 1
      stopL = Math.max(0.2, Math.min(0.8, l + (t - 0.5) * 0.25))
    } else if (harmony === 'tetradic') {
      const quadStep = (i % 4) * 0.25
      stopH = (h + quadStep + (t - 0.5) * 0.05 + 1) % 1
      stopS = Math.max(0.3, Math.min(0.85, s))
      stopL = Math.max(0.2, Math.min(0.8, l + (t - 0.5) * 0.3))
    } else if (harmony === 'vibrant') {
      stopH = (h + t * 0.8 + 1) % 1
      stopS = 0.88
      stopL = Math.max(0.3, Math.min(0.7, 0.4 + t * 0.3))
    } else if (harmony === 'monochrome') {
      stopH = h
      stopS = Math.max(0.08, Math.min(0.9, s * (0.6 + t * 0.4)))
      stopL = Math.max(0.12, Math.min(0.88, 0.15 + t * 0.7))
    } else if (harmony === 'duotone') {
      const accentH = (h + 0.55 + 1) % 1
      stopH = t < 0.5 ? h : accentH
      stopS = Math.max(0.3, Math.min(0.9, s * 0.8 + 0.2))
      stopL = Math.max(0.15, Math.min(0.85, 0.2 + t * 0.6))
    } else {
      // harmonic (Paper aesthetic balance)
      stopH = (h + (t - 0.5) * 0.18 + (i % 2 === 0 ? 0 : 0.05) + 1) % 1
      stopS = Math.max(0.2, Math.min(0.85, s * 0.9 + 0.1))
      stopL = Math.max(0.1, Math.min(0.9, l + (t - 0.5) * 0.45))
    }

    results.push(toHexColor(hslToRgb(stopH, stopS, stopL)))
  }

  return results
}

/**
 * Interpolates an array of palette colors to targetCount colors evenly along the spectrum.
 */
export function interpolatePaletteColors(colors: readonly string[], targetCount: number): string[] {
  if (targetCount <= 0) return []
  if (colors.length === 0) return Array.from({ length: targetCount }, () => '#81adec')
  if (colors.length === 1 || targetCount === 1) return Array.from({ length: targetCount }, () => colors[0])

  const parsed = colors.map(parseHexColor)
  const result: string[] = []

  for (let i = 0; i < targetCount; i++) {
    const t = i / (targetCount - 1)
    const pos = t * (parsed.length - 1)
    const idx = Math.min(Math.floor(pos), parsed.length - 2)
    const frac = pos - idx
    const c1 = parsed[idx]
    const c2 = parsed[idx + 1]

    result.push(toHexColor({
      r: c1.r + (c2.r - c1.r) * frac,
      g: c1.g + (c2.g - c1.g) * frac,
      b: c1.b + (c2.b - c1.b) * frac,
      a: c1.a + (c2.a - c1.a) * frac,
    }))
  }

  return result
}

/**
 * Harmonizes and smooths color stops based on each anchor's position relative to all other stops.
 */
export function smoothMeshColors(anchors: readonly MeshAnchor[], colors: readonly string[]): string[] {
  if (anchors.length <= 2 || anchors.length !== colors.length) return [...colors]
  return anchors.map((anchor, i) => {
    const others = anchors.filter((_, idx) => idx !== i)
    const otherColors = colors.filter((_, idx) => idx !== i)
    const fieldColor = parseHexColor(interpolateMeshColor(others, otherColors, anchor))
    const selfColor = parseHexColor(colors[i])
    // Blend 60% self + 40% surrounding field
    return toHexColor({
      r: selfColor.r * 0.6 + fieldColor.r * 0.4,
      g: selfColor.g * 0.6 + fieldColor.g * 0.4,
      b: selfColor.b * 0.6 + fieldColor.b * 0.4,
      a: selfColor.a * 0.6 + fieldColor.a * 0.4,
    })
  })
}

/**
 * Distributes count anchors in a balanced Cartesian grid within [0.15, 0.85].
 */
export function generateGridLayout(count: number): MeshAnchor[] {
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  return Array.from({ length: count }, (_, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const x = clampUnit(0.18 + (cols > 1 ? (c / (cols - 1)) * 0.64 : 0.32))
    const y = clampUnit(0.18 + (rows > 1 ? (r / (rows - 1)) * 0.64 : 0.32))
    return { x, y, radius: 0.65 }
  })
}

/**
 * Distributes count anchors in a circular radial pattern with center vertex.
 */
export function generateRadialLayout(count: number): MeshAnchor[] {
  if (count <= 1) return [{ x: 0.5, y: 0.5, radius: 0.75 }]
  const anchors: MeshAnchor[] = [{ x: 0.5, y: 0.5, radius: 0.75 }]
  const outer = count - 1
  for (let i = 0; i < outer; i++) {
    const angle = (i * 2 * Math.PI) / outer - Math.PI / 2
    anchors.push({
      x: clampUnit(0.5 + Math.cos(angle) * 0.36),
      y: clampUnit(0.5 + Math.sin(angle) * 0.36),
      radius: 0.6,
    })
  }
  return anchors
}

/**
 * Spiral distribution (default Paper anchor placement).
 */
export function generateSpiralLayout(count: number): MeshAnchor[] {
  return Array.from({ length: count }, (_, i) => defaultMeshAnchor(i))
}

/**
 * Wave layout: distributes vertices along an S-curve harmonic wave.
 */
export function generateWaveLayout(count: number): MeshAnchor[] {
  if (count <= 1) return [{ x: 0.5, y: 0.5, radius: 0.7 }]
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const x = clampUnit(0.18 + t * 0.64)
    const y = clampUnit(0.5 + Math.sin(t * Math.PI * 2) * 0.28)
    return { x, y, radius: 0.65 }
  })
}

/**
 * 4-Corner Bicubic Patch Layout: anchors placed at boundary corners and interior points.
 */
export function generateCornerPatchLayout(count: number): MeshAnchor[] {
  if (count <= 4) {
    const corners = [
      { x: 0.15, y: 0.15, radius: 0.7 },
      { x: 0.85, y: 0.15, radius: 0.7 },
      { x: 0.85, y: 0.85, radius: 0.7 },
      { x: 0.15, y: 0.85, radius: 0.7 },
    ]
    return corners.slice(0, count)
  }

  const base = [
    { x: 0.15, y: 0.15, radius: 0.7 },
    { x: 0.85, y: 0.15, radius: 0.7 },
    { x: 0.85, y: 0.85, radius: 0.7 },
    { x: 0.15, y: 0.85, radius: 0.7 },
    { x: 0.50, y: 0.50, radius: 0.75 },
    { x: 0.50, y: 0.15, radius: 0.65 },
    { x: 0.85, y: 0.50, radius: 0.65 },
    { x: 0.50, y: 0.85, radius: 0.65 },
    { x: 0.15, y: 0.50, radius: 0.65 },
    { x: 0.50, y: 0.50, radius: 0.6 },
  ]
  return base.slice(0, count)
}

export const MESH_PALETTE_PRESETS = [
  { name: 'Paper Warm', colors: ['#edebe1', '#81adec', '#516b94', '#222222'] },
  { name: 'Paper Dark', colors: ['#080808', '#1c2333', '#2e4374', '#81adec', '#edebe1'] },
  { name: 'Velvet Dusk', colors: ['#080808', '#4338ca', '#81adec', '#f43f5e', '#edebe1'] },
  { name: 'Ethereal Sky', colors: ['#080808', '#2563eb', '#60a5fa', '#81adec', '#edebe1'] },
  { name: 'Solar Flare', colors: ['#222222', '#b45309', '#f59e0b', '#fde047', '#edebe1'] },
  { name: 'Cyber Neon', colors: ['#080808', '#06b6d4', '#81adec', '#ec4899', '#edebe1'] },
  { name: 'Forest Mist', colors: ['#080808', '#064e3b', '#10b981', '#81adec', '#edebe1'] },
  { name: 'Monochrome', colors: ['#080808', '#222222', '#555555', '#999999', '#edebe1'] },
] as const

export function validateMeshGrid(grid: MeshGridConfig): void {
  if (!grid || typeof grid !== 'object') throw new Error('Invalid mesh grid')
  if (grid.topology !== 'grid') throw new Error('Invalid mesh grid topology')
  if (!Number.isInteger(grid.rows) || grid.rows < 2 || grid.rows > 8) throw new Error('Invalid mesh grid rows')
  if (!Number.isInteger(grid.cols) || grid.cols < 2 || grid.cols > 8) throw new Error('Invalid mesh grid cols')
  if (!Number.isFinite(grid.smoothing) || grid.smoothing < 0 || grid.smoothing > 1) throw new Error('Invalid mesh grid smoothing')
  if (!Array.isArray(grid.vertices) || grid.vertices.length !== grid.rows * grid.cols) throw new Error('Invalid mesh grid vertex count')
  for (const v of grid.vertices) {
    if (!v || typeof v !== 'object') throw new Error('Invalid mesh grid vertex')
    if (typeof v.color !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(v.color)) throw new Error('Invalid mesh grid vertex color')
    if (!Number.isFinite(v.tx) || v.tx < -1 || v.tx > 1) throw new Error('Invalid mesh grid vertex tangent x')
    if (!Number.isFinite(v.ty) || v.ty < -1 || v.ty > 1) throw new Error('Invalid mesh grid vertex tangent y')
    if (v.alpha !== undefined && (!Number.isFinite(v.alpha) || v.alpha < 0 || v.alpha > 1)) throw new Error('Invalid mesh grid vertex alpha')
    if (v.tension !== undefined && (!Number.isFinite(v.tension) || v.tension < 0 || v.tension > 2)) throw new Error('Invalid mesh grid vertex tension')
  }
}

export function createMeshGrid(rows: number, cols: number, colors?: readonly string[]): MeshGridConfig {
  const count = rows * cols
  const baseColors = colors ?? ['#edebe1', '#81adec', '#516b94', '#222222']
  const palette = interpolatePaletteColors(baseColors, count)
  const vertices: MeshGridVertex[] = Array.from({ length: count }, (_, i) => ({
    color: palette[i],
    tx: 0,
    ty: 0,
  }))
  return { topology: 'grid', rows, cols, vertices, smoothing: 0.5 }
}

export function gridVertexPosition(row: number, col: number, rows: number, cols: number): { x: number; y: number } {
  return {
    x: cols > 1 ? col / (cols - 1) : 0.5,
    y: rows > 1 ? row / (rows - 1) : 0.5,
  }
}

export function evaluateGridMesh(
  grid: MeshGridConfig,
  u: number,
  v: number,
): string {
  const cu = clampUnit(u)
  const cv = clampUnit(v)
  const { rows, cols, vertices, smoothing } = grid
  if (rows < 2 || cols < 2) return vertices[0]?.color ?? '#81adec'

  const uPos = cu * (cols - 1)
  const vPos = cv * (rows - 1)
  const colIdx = Math.min(Math.floor(uPos), cols - 2)
  const rowIdx = Math.min(Math.floor(vPos), rows - 2)
  const s = uPos - colIdx
  const t = vPos - rowIdx

  const su = s * s * (3 - 2 * s)
  const sv = t * t * (3 - 2 * t)
  const blendS = s + (su - s) * smoothing
  const blendT = t + (sv - t) * smoothing

  const v00 = vertices[rowIdx * cols + colIdx]
  const v10 = vertices[rowIdx * cols + colIdx + 1]
  const v01 = vertices[(rowIdx + 1) * cols + colIdx]
  const v11 = vertices[(rowIdx + 1) * cols + colIdx + 1]

  const tangentS = Math.max(0, Math.min(1, blendS + (v00.tx * (v00.tension ?? 1) * (1 - blendS) + v10.tx * (v10.tension ?? 1) * blendS) * 0.18))
  const tangentT = Math.max(0, Math.min(1, blendT + (v00.ty * (v00.tension ?? 1) * (1 - blendT) + v01.ty * (v01.tension ?? 1) * blendT) * 0.18))

  const c00 = parseHexColor(v00.color)
  const c10 = parseHexColor(v10.color)
  const c01 = parseHexColor(v01.color)
  const c11 = parseHexColor(v11.color)

  const a00 = v00.alpha !== undefined ? v00.alpha : c00.a
  const a10 = v10.alpha !== undefined ? v10.alpha : c10.a
  const a01 = v01.alpha !== undefined ? v01.alpha : c01.a
  const a11 = v11.alpha !== undefined ? v11.alpha : c11.a

  const topR = c00.r * a00 + (c10.r * a10 - c00.r * a00) * tangentS
  const topG = c00.g * a00 + (c10.g * a10 - c00.g * a00) * tangentS
  const topB = c00.b * a00 + (c10.b * a10 - c00.b * a00) * tangentS
  const topA = a00 + (a10 - a00) * tangentS

  const botR = c01.r * a01 + (c11.r * a11 - c01.r * a01) * tangentS
  const botG = c01.g * a01 + (c11.g * a11 - c01.g * a01) * tangentS
  const botB = c01.b * a01 + (c11.b * a11 - c01.b * a01) * tangentS
  const botA = a01 + (a11 - a01) * tangentS

  const finalR = topR + (botR - topR) * tangentT
  const finalG = topG + (botG - topG) * tangentT
  const finalB = topB + (botB - topB) * tangentT
  const finalA = Math.max(0, Math.min(1, topA + (botA - topA) * tangentT))
  const safeA = Math.max(0.0001, finalA)

  return toHexColor({
    r: finalR / safeA,
    g: finalG / safeA,
    b: finalB / safeA,
    a: finalA,
  })
}

export function meshGridUniforms(paint: Extract<ShaderPaint, { kind: 'mesh-gradient' }>) {
  const mesh = paint.mesh ?? createMeshMaterial(paint.params.colors.length)
  const grid = mesh.grid
  if (!grid) return null

  const { rows, cols, vertices, smoothing } = grid
  const gridColors = Array.from({ length: 64 }, (_, i) => {
    if (i < vertices.length) {
      const v = vertices[i]
      const c = parseHexColor(v.color)
      const alpha = v.alpha !== undefined ? v.alpha : c.a
      return [c.r, c.g, c.b, alpha]
    }
    return [0, 0, 0, 1]
  })
  const tangents = Array.from({ length: 64 }, (_, i) =>
    i < vertices.length ? [vertices[i].tx, vertices[i].ty, vertices[i].tension ?? 1.0] : [0, 0, 1.0]
  )

  return {
    u_gridMode: 1.0,
    u_gridRows: rows,
    u_gridCols: cols,
    u_gridSmoothing: smoothing,
    u_gridColors: gridColors,
    u_gridTangents: tangents,
    u_turbulence: mesh.turbulence,
    u_frequency: mesh.frequency,
    u_chromatic: mesh.chromaticAberration,
    u_grainBlend: grainBlendModes.indexOf(mesh.grainBlend),
    u_warpModulation: mesh.warpModulation ?? 0.25,
    u_noiseType: (mesh.noiseType ?? 'simplex') === 'simplex' ? 0 : (mesh.noiseType ?? 'simplex') === 'perlin' ? 1 : 2,
    u_lacunarity: mesh.lacunarity ?? 2.0,
    u_octaves: mesh.octaves ?? 3,
    u_normalPerturbation: mesh.normalPerturbation ?? 0.2,
    u_grainDisplacement: mesh.grainDisplacement ?? 0.15,
    u_fluidAdvection: mesh.fluidAdvection ?? 0.35,
    u_fluidViscosity: mesh.fluidViscosity ?? 0.5,
    u_distortionMode: (mesh.distortionMode ?? 'curl-fluid') === 'curl-fluid' ? 0 : (mesh.distortionMode ?? 'curl-fluid') === 'domain-warp' ? 1 : (mesh.distortionMode ?? 'curl-fluid') === 'turbulent-swirl' ? 2 : 3,
    u_distortion: paint.params.distortion,
    u_swirl: paint.params.swirl,
    u_grainMixer: paint.params.grainMixer,
    u_grainOverlay: paint.params.grainOverlay,
    u_scale: paint.scale,
    u_rotation: paint.rotation * Math.PI / 180,
    u_offset: [paint.offsetX, paint.offsetY],
  }
}
