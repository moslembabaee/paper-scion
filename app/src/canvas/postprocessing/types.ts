export type PostProcessPassType =
  | 'bloom'
  | 'chromatic-aberration'
  | 'film-grain'
  | 'vignette'
  | 'color-grade'
  | 'frosted-glass'
  | 'procedural-grain'
  | 'ambient-occlusion'

export const postProcessPassTypes: readonly PostProcessPassType[] = [
  'bloom',
  'chromatic-aberration',
  'film-grain',
  'vignette',
  'color-grade',
  'frosted-glass',
  'procedural-grain',
  'ambient-occlusion',
] as const

export interface BloomPassParams {
  /** Luminance cutoff threshold below which pixels do not bleed (0 to 1). */
  readonly threshold: number
  /** Strength multiplier of the blurred glow composite (0 to 3). */
  readonly intensity: number
  /** Kernel spread radius of the bloom blur (0 to 2). */
  readonly radius: number
  /** Softness knee for gradual threshold falloff (0 to 1). */
  readonly knee: number
}

export interface FilmGrainPassParams {
  /** Opacity / amplitude of procedural film stock noise (0 to 1). */
  readonly intensity: number
  /** Grain particle physical scale in canvas pixels (0.5 to 5). */
  readonly size: number
  /** Animation speed of temporal jitter (0 to 3). */
  readonly speed: number
  /** Whether the grain updates dynamically at 60fps or stays fixed. */
  readonly temporal: boolean
  /** Single-channel luminance grain vs tri-color RGB grain. */
  readonly monochrome: boolean
}

export interface ChromaticAberrationPassParams {
  /** Channel offset distance multiplier (0 to 1). */
  readonly intensity: number
  /** Relative spectral spread between R, G, and B bands (0 to 1). */
  readonly spread: number
  /** True for radial dispersion from viewport center; false for directional angle. */
  readonly radial: boolean
  /** Angle in degrees when directional mode is active (0 to 360). */
  readonly angle: number
}

export interface VignettePassParams {
  /** Darkness attenuation at outer corners (0 to 1). */
  readonly intensity: number
  /** Normalized radius where falloff starts (0 to 1.5). */
  readonly radius: number
  /** Feather softness of the gradient edge (0 to 1). */
  readonly smoothness: number
  /** Aspect ratio compensation (1.0 = circular, <1.0 = elliptical). */
  readonly roundness: number
  /** Hex color tint for shadow falloff (defaults to #080808). */
  readonly color: string
}

export interface ColorGradePassParams {
  readonly contrast: number
  readonly brightness: number
  readonly saturation: number
  readonly exposure: number
  readonly tint: string
}

export type FrostedGlassPattern = 'smooth' | 'frosted' | 'fluted' | 'rippled' | 'faceted'

export interface FrostedGlassPassParams {
  /** Index of refraction (1.0 to 2.5). Optical glass is ~1.52. */
  readonly refractionIndex: number
  /** Cauchy spectral chromatic dispersion (0 to 1). */
  readonly dispersion: number
  /** Surface microfacet roughness (0 to 1). */
  readonly roughness: number
  /** Golden-angle blur spread radius (0 to 2). */
  readonly blurRadius: number
  /** Surface pattern profile: smooth lens, frosted etched, fluted ribs, organic ripple, faceted crystal. */
  readonly surfacePattern: FrostedGlassPattern
  /** Spatial frequency / scale of surface patterns (0.2 to 5). */
  readonly patternScale: number
  /** Relief depth of frosted etch texture (0 to 1). */
  readonly frostIntensity: number
  /** Edge bevel highlight feather (0 to 1). */
  readonly bevelWidth: number
  /** Hex color tint for volume absorption (e.g. #edebe1 or #81adec). */
  readonly tintColor: string
  /** Opacity of volume tint (0 to 1). */
  readonly tintOpacity: number
  /** Key light angle in degrees (0 to 360). */
  readonly lightAngle: number
  /** Specular highlight reflection strength (0 to 2). */
  readonly specularStrength: number
}

export type ProceduralGrainNoiseType = 'simplex' | 'perlin' | 'worley' | 'hash'

export interface ProceduralGrainPassParams {
  /** Opacity / amplitude of procedural grain (0 to 1). */
  readonly intensity: number
  /** Physical grain particle scale / size (0.5 to 10). */
  readonly size: number
  /** Spatial frequency of noise generator (0.5 to 20). */
  readonly frequency: number
  /** Noise algorithm: simplex, perlin, worley, or hash. */
  readonly noiseType: ProceduralGrainNoiseType
  /** Multi-octave detail layers (1 to 6). */
  readonly octaves: number
  /** Harmonic roughness / turbulence (0 to 1). */
  readonly turbulence: number
  /** Animation speed of temporal jitter (0 to 3). */
  readonly speed: number
  /** Whether the noise updates dynamically at 60fps or stays fixed. */
  readonly temporal: boolean
  /** Single-channel luminance grain vs tri-color RGB spectral grain. */
  readonly monochrome: boolean
}

export interface AmbientOcclusionPassParams {
  /** Darkening occlusion intensity factor (0 to 1). */
  readonly intensity: number
  /** Sampling search radius in screen pixels (1 to 40). */
  readonly radius: number
  /** Geometric edge bias to prevent self-occlusion / flat surface darkening (0 to 1). */
  readonly bias: number
  /** Power exponent / contrast curve of ambient occlusion (0.5 to 4). */
  readonly power: number
  /** Hex color tint for ambient crevices and occluded corners (defaults to #080808). */
  readonly color: string
}

export interface PostProcessPassParamsMap {
  bloom: BloomPassParams
  'chromatic-aberration': ChromaticAberrationPassParams
  'film-grain': FilmGrainPassParams
  vignette: VignettePassParams
  'color-grade': ColorGradePassParams
  'frosted-glass': FrostedGlassPassParams
  'procedural-grain': ProceduralGrainPassParams
  'ambient-occlusion': AmbientOcclusionPassParams
}

export type PostProcessPass<T extends PostProcessPassType = PostProcessPassType> = { [K in T]: {
  readonly id: string
  readonly type: K
  readonly name: string
  readonly enabled: boolean
  readonly opacity: number
  readonly blendMode: 'normal' | 'screen' | 'multiply' | 'overlay'
  readonly params: PostProcessPassParamsMap[K]
} }[T]

export interface CanvasPostProcessingPipeline {
  readonly version: 1
  readonly enabled: boolean
  readonly preset: string
  readonly passes: readonly PostProcessPass[]
}

export interface PostProcessingPreset {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly createPipeline: () => CanvasPostProcessingPipeline
}
