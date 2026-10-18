import type { NoiseGenerator, ProceduralNoiseParams } from '../types.ts'
import { parseHexColor, toHexColor, clampUnit } from '../mesh.ts'

// Deterministic permutation table for 2D noise
const PERMUTATION = [
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,
  8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,
  35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,
  134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,
  55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,
  18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,
  250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,
  189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,
  172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,
  228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,
  107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,
  138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180
]

const P = new Uint8Array(512)
for (let i = 0; i < 256; i++) {
  P[i] = PERMUTATION[i]
  P[256 + i] = PERMUTATION[i]
}

// Skewing and unskewing factors for 2D Simplex
const F2 = 0.5 * (Math.sqrt(3.0) - 1.0)
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0

// Standard 2D gradient vectors for Simplex and Perlin
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
]

function fastFloor(x: number): number {
  const xi = Math.floor(x)
  return xi
}

/**
 * High-performance 2D Simplex Noise.
 * Returns normalized value in [-1, 1].
 */
export function simplex2D(xin: number, yin: number): number {
  // Skew the input space to determine which simplex cell we're in
  const s = (xin + yin) * F2
  const i = fastFloor(xin + s)
  const j = fastFloor(yin + s)

  // Unskew the cell origin back to (x, y) space
  const t = (i + j) * G2
  const X0 = i - t
  const Y0 = j - t
  const x0 = xin - X0
  const y0 = yin - Y0

  // Determine which simplex triangle we're in (upper or lower)
  let i1 = 0, j1 = 0
  if (x0 > y0) {
    i1 = 1
    j1 = 0
  } else {
    i1 = 0
    j1 = 1
  }

  // Offsets for second and third corners
  const x1 = x0 - i1 + G2
  const y1 = y0 - j1 + G2
  const x2 = x0 - 1.0 + 2.0 * G2
  const y2 = y0 - 1.0 + 2.0 * G2

  // Work out the hashed gradient indices of the three simplex corners
  const ii = i & 255
  const jj = j & 255
  const gi0 = P[ii + P[jj]] % 8
  const gi1 = P[ii + i1 + P[jj + j1]] % 8
  const gi2 = P[ii + 1 + P[jj + 1]] % 8

  // Calculate the contribution from the three corners
  let t0 = 0.5 - x0 * x0 - y0 * y0
  let n0 = 0
  if (t0 > 0) {
    t0 *= t0
    n0 = t0 * t0 * (GRAD2[gi0][0] * x0 + GRAD2[gi0][1] * y0)
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1
  let n1 = 0
  if (t1 > 0) {
    t1 *= t1
    n1 = t1 * t1 * (GRAD2[gi1][0] * x1 + GRAD2[gi1][1] * y1)
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2
  let n2 = 0
  if (t2 > 0) {
    t2 *= t2
    n2 = t2 * t2 * (GRAD2[gi2][0] * x2 + GRAD2[gi2][1] * y2)
  }

  // Scale to [-1, 1]
  return 70.0 * (n0 + n1 + n2)
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

function gradPerlin(hash: number, x: number, y: number): number {
  const h = hash & 7
  const u = h < 4 ? x : y
  const v = h < 4 ? y : x
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
}

/**
 * Classic 2D Perlin Noise with Quintic Hermite interpolation.
 * Returns value in [-1, 1].
 */
export function perlin2D(x: number, y: number): number {
  const X = fastFloor(x) & 255
  const Y = fastFloor(y) & 255

  const xf = x - fastFloor(x)
  const yf = y - fastFloor(y)

  const u = fade(xf)
  const v = fade(yf)

  const A = P[X] + Y
  const B = P[X + 1] + Y

  const g00 = gradPerlin(P[A], xf, yf)
  const g10 = gradPerlin(P[B], xf - 1, yf)
  const g01 = gradPerlin(P[A + 1], xf, yf - 1)
  const g11 = gradPerlin(P[B + 1], xf - 1, yf - 1)

  const x1 = lerp(g00, g10, u)
  const x2 = lerp(g01, g11, u)

  return lerp(x1, x2, v)
}

function hash2D(x: number, y: number): { x: number; y: number } {
  // Deterministic 2D pseudorandom hash
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  const t = Math.sin(x * 269.5 + y * 183.3) * 43758.5453123
  return {
    x: s - Math.floor(s),
    y: t - Math.floor(t),
  }
}

export interface WorleyResult {
  readonly f1: number
  readonly f2: number
  readonly diff: number
}

/**
 * 2D Worley (Cellular / Voronoi) noise generator.
 * Returns closest feature point distance (f1) and second closest (f2).
 */
export function worley2D(x: number, y: number): WorleyResult {
  const xi = fastFloor(x)
  const yi = fastFloor(y)
  const xf = x - xi
  const yf = y - yi

  let f1 = 1e6
  let f2 = 1e6

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const neighbor = hash2D(xi + dx, yi + dy)
      // Feature point inside neighbor cell relative to (xf, yf)
      const px = dx + neighbor.x - xf
      const py = dy + neighbor.y - yf
      const dist = Math.sqrt(px * px + py * py)

      if (dist < f1) {
        f2 = f1
        f1 = dist
      } else if (dist < f2) {
        f2 = dist
      }
    }
  }

  return {
    f1: Math.min(1.0, f1),
    f2: Math.min(1.0, f2),
    diff: Math.min(1.0, Math.max(0.0, f2 - f1)),
  }
}

/**
 * High-frequency micro-grain procedural hash.
 */
export function proceduralGrain(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return n - Math.floor(n)
}

export interface MultiOctaveNoiseOptions {
  readonly type: NoiseGenerator
  readonly x: number
  readonly y: number
  readonly frequency: number
  readonly octaves: number
  readonly lacunarity: number
  readonly persistence: number
  readonly turbulence: number
}

/**
 * Multi-octave procedural noise evaluator supporting Simplex, Perlin, and Worley algorithms
 * with frequency, lacunarity, persistence, and turbulence folding.
 * Returns normalized value in [-1, 1].
 */
export function sampleMultiOctaveNoise(options: MultiOctaveNoiseOptions): number {
  const { type, x, y, frequency, octaves, lacunarity, persistence, turbulence } = options
  const count = Math.max(1, Math.min(8, Math.round(octaves)))
  let total = 0
  let maxAmp = 0
  let amp = 1.0
  let freq = frequency

  for (let o = 0; o < count; o++) {
    const sx = x * freq
    const sy = y * freq
    let raw: number

    if (type === 'simplex') {
      raw = simplex2D(sx, sy)
    } else if (type === 'perlin') {
      raw = perlin2D(sx, sy)
    } else {
      // Worley cellular noise mapped to [-1, 1]
      const w = worley2D(sx, sy)
      raw = w.f1 * 2.0 - 1.0
    }

    // Turbulence folding: interpolates between smooth fBm and rectified absolute ridges
    if (turbulence > 0) {
      const turbulent = (Math.abs(raw) * 2.0 - 1.0)
      raw = raw * (1.0 - turbulence) + turbulent * turbulence
    }

    total += raw * amp
    maxAmp += amp
    amp *= persistence
    freq *= lacunarity
  }

  return maxAmp > 0 ? total / maxAmp : 0
}

export interface NormalPerturbationResult {
  /** Tangent space normal vector (normalized) */
  readonly normal: { readonly x: number; readonly y: number; readonly z: number }
  /** RGB normal map values in [0, 1] */
  readonly normalRGB: { readonly r: number; readonly g: number; readonly b: number }
  /** Height displacement value in [-1, 1] */
  readonly height: number
  /** Diffuse directional lighting intensity in [0, 1] */
  readonly diffuse: number
  /** Specular Blinn-Phong highlight intensity in [0, 1] */
  readonly specular: number
}

/**
 * Calculates finite-difference normal-map surface perturbation and lighting from procedural noise.
 */
export function evaluateNormalPerturbation(
  options: MultiOctaveNoiseOptions & {
    readonly normalPerturbation: number
    readonly displacement: number
    readonly grainDisplacement?: number
    readonly lightAngle?: number
    readonly specularStrength?: number
  }
): NormalPerturbationResult {
  const eps = 0.005
  const { x, y, displacement, normalPerturbation, lightAngle = 45, specularStrength = 0.3 } = options
  const grainDisp = options.grainDisplacement ?? 0.1

  const sampleHeight = (px: number, py: number): number => {
    const base = sampleMultiOctaveNoise({ ...options, x: px, y: py })
    const grain = (proceduralGrain(px * 100, py * 100) - 0.5) * grainDisp
    return base * displacement + grain
  }

  const hCenter = sampleHeight(x, y)
  const hRight = sampleHeight(x + eps, y)
  const hLeft = sampleHeight(x - eps, y)
  const hUp = sampleHeight(x, y + eps)
  const hDown = sampleHeight(x, y - eps)

  // Gradient derivatives
  const dhdx = (hRight - hLeft) / (2 * eps)
  const dhdy = (hUp - hDown) / (2 * eps)

  // Tangent space normal perturbation vector: (-dh/dx * bump, -dh/dy * bump, 1.0)
  const bump = normalPerturbation * 6.0
  const nx = -dhdx * bump
  const ny = -dhdy * bump
  const nz = 1.0
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0

  const normal = {
    x: nx / len,
    y: ny / len,
    z: nz / len,
  }

  // Normal map tangent space color [0, 1]
  const normalRGB = {
    r: clampUnit(normal.x * 0.5 + 0.5),
    g: clampUnit(normal.y * 0.5 + 0.5),
    b: clampUnit(normal.z * 0.5 + 0.5),
  }

  // Directional lighting
  const rad = (lightAngle * Math.PI) / 180
  const lx = Math.cos(rad)
  const ly = Math.sin(rad)
  const lz = 0.65
  const lLen = Math.sqrt(lx * lx + ly * ly + lz * lz)
  const light = { x: lx / lLen, y: ly / lLen, z: lz / lLen }

  // Halfway vector for Blinn-Phong specular
  const hx = light.x
  const hy = light.y
  const hz = light.z + 1.0
  const hLen = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1.0
  const half = { x: hx / hLen, y: hy / hLen, z: hz / hLen }

  // Diffuse Lambert term
  const nDotL = Math.max(0, normal.x * light.x + normal.y * light.y + normal.z * light.z)
  const diffuse = clampUnit(nDotL * 0.8 + 0.2)

  // Specular term
  const nDotH = Math.max(0, normal.x * half.x + normal.y * half.y + normal.z * half.z)
  const specular = clampUnit(Math.pow(nDotH, 16.0) * specularStrength)

  return {
    normal,
    normalRGB,
    height: hCenter,
    diffuse,
    specular,
  }
}

/**
 * Evaluates the full rendered procedural noise material color at normalized coordinate (u, v).
 */
export function evaluateProceduralNoiseColor(
  params: ProceduralNoiseParams,
  u: number,
  v: number
): string {
  const result = evaluateNormalPerturbation({
    type: params.noiseType,
    x: u,
    y: v,
    frequency: params.frequency,
    octaves: params.octaves,
    lacunarity: params.lacunarity,
    persistence: params.persistence,
    turbulence: params.turbulence,
    displacement: params.displacement,
    normalPerturbation: params.normalPerturbation,
    grainDisplacement: params.grainOverlay,
    lightAngle: params.lightAngle,
    specularStrength: params.specularStrength,
  })

  if (params.viewMode === 'normal-map') {
    return toHexColor({
      r: result.normalRGB.r,
      g: result.normalRGB.g,
      b: result.normalRGB.b,
      a: 1.0,
    })
  }

  if (params.viewMode === 'heightmap') {
    const val = clampUnit(result.height * 0.5 + 0.5)
    return toHexColor({ r: val, g: val, b: val, a: 1.0 })
  }

  // Shaded surface mode: blend Back -> Mid -> Front according to height & illuminated by normal perturbation
  const cBack = parseHexColor(params.colorBack)
  const cMid = parseHexColor(params.colorMid)
  const cFront = parseHexColor(params.colorFront)

  const t = clampUnit(result.height * 0.5 + 0.5)
  let baseR: number, baseG: number, baseB: number
  if (t < 0.5) {
    const factor = t * 2.0
    baseR = lerp(cBack.r, cMid.r, factor)
    baseG = lerp(cBack.g, cMid.g, factor)
    baseB = lerp(cBack.b, cMid.b, factor)
  } else {
    const factor = (t - 0.5) * 2.0
    baseR = lerp(cMid.r, cFront.r, factor)
    baseG = lerp(cMid.g, cFront.g, factor)
    baseB = lerp(cMid.b, cFront.b, factor)
  }

  // Apply diffuse lighting and specular sheen
  const litR = clampUnit(baseR * result.diffuse + result.specular)
  const litG = clampUnit(baseG * result.diffuse + result.specular)
  const litB = clampUnit(baseB * result.diffuse + result.specular)

  // Blend high-frequency grain
  const grainVal = proceduralGrain(u * 200, v * 200)
  const grainMix = (grainVal - 0.5) * params.grainMixer

  return toHexColor({
    r: clampUnit(litR + grainMix),
    g: clampUnit(litG + grainMix),
    b: clampUnit(litB + grainMix),
    a: 1.0,
  })
}

export interface ProceduralNoisePreset {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly params: ProceduralNoiseParams
}

export const PROCEDURAL_NOISE_PRESETS: readonly ProceduralNoisePreset[] = [
  {
    id: 'simplex-dunes',
    name: 'Simplex Dunes',
    description: 'Smooth harmonic sand dunes with gentle normal displacement.',
    params: {
      noiseType: 'simplex',
      frequency: 3.2,
      octaves: 3,
      lacunarity: 2.1,
      persistence: 0.45,
      turbulence: 0.15,
      displacement: 0.4,
      normalPerturbation: 0.35,
      grainMixer: 0.08,
      grainOverlay: 0.05,
      colorFront: '#edebe1',
      colorMid: '#d4c5a9',
      colorBack: '#222222',
      lightAngle: 55,
      specularStrength: 0.25,
      viewMode: 'shaded',
    },
  },
  {
    id: 'worley-basalt',
    name: 'Basalt Relief',
    description: 'Cellular rock crystals with pronounced normal-map surface perturbation.',
    params: {
      noiseType: 'worley',
      frequency: 4.5,
      octaves: 3,
      lacunarity: 2.0,
      persistence: 0.5,
      turbulence: 0.3,
      displacement: 0.55,
      normalPerturbation: 0.65,
      grainMixer: 0.12,
      grainOverlay: 0.1,
      colorFront: '#81adec',
      colorMid: '#2e4374',
      colorBack: '#080808',
      lightAngle: 120,
      specularStrength: 0.45,
      viewMode: 'shaded',
    },
  },
  {
    id: 'granite-mineral',
    name: 'Granite Mineral',
    description: 'Multi-octave Perlin noise with heavy grain displacement.',
    params: {
      noiseType: 'perlin',
      frequency: 5.0,
      octaves: 4,
      lacunarity: 2.4,
      persistence: 0.55,
      turbulence: 0.4,
      displacement: 0.35,
      normalPerturbation: 0.5,
      grainMixer: 0.18,
      grainOverlay: 0.15,
      colorFront: '#edebe1',
      colorMid: '#516b94',
      colorBack: '#1c2333',
      lightAngle: 35,
      specularStrength: 0.3,
      viewMode: 'shaded',
    },
  },
  {
    id: 'caustic-web',
    name: 'Worley Caustics',
    description: 'Shifting aquatic caustics with crisp specular crests.',
    params: {
      noiseType: 'worley',
      frequency: 6.0,
      octaves: 2,
      lacunarity: 1.8,
      persistence: 0.6,
      turbulence: 0.1,
      displacement: 0.45,
      normalPerturbation: 0.55,
      grainMixer: 0.05,
      grainOverlay: 0.03,
      colorFront: '#edebe1',
      colorMid: '#81adec',
      colorBack: '#064e3b',
      lightAngle: 75,
      specularStrength: 0.7,
      viewMode: 'shaded',
    },
  },
  {
    id: 'volcanic-magma',
    name: 'Volcanic Magma',
    description: 'High turbulence multi-octave Simplex with deep normal crevices.',
    params: {
      noiseType: 'simplex',
      frequency: 3.8,
      octaves: 5,
      lacunarity: 2.2,
      persistence: 0.65,
      turbulence: 0.75,
      displacement: 0.6,
      normalPerturbation: 0.7,
      grainMixer: 0.14,
      grainOverlay: 0.08,
      colorFront: '#fde047',
      colorMid: '#b45309',
      colorBack: '#080808',
      lightAngle: 140,
      specularStrength: 0.5,
      viewMode: 'shaded',
    },
  },
  {
    id: 'paper-fiber',
    name: 'Paper Fiber',
    description: 'Subtle textural relief mimicking handmade deckle-edge paper.',
    params: {
      noiseType: 'simplex',
      frequency: 7.5,
      octaves: 3,
      lacunarity: 2.5,
      persistence: 0.4,
      turbulence: 0.15,
      displacement: 0.2,
      normalPerturbation: 0.25,
      grainMixer: 0.15,
      grainOverlay: 0.12,
      colorFront: '#edebe1',
      colorMid: '#e4e0d4',
      colorBack: '#d5d0c2',
      lightAngle: 45,
      specularStrength: 0.12,
      viewMode: 'shaded',
    },
  },
] as const
