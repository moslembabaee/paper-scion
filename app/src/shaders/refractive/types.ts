import type { ShaderComposite, ShaderMotion } from '../types.ts'

export type GlassSurfacePattern = 'smooth' | 'frosted' | 'fluted' | 'rippled' | 'faceted'
export const glassSurfacePatterns: readonly GlassSurfacePattern[] = [
  'smooth',
  'frosted',
  'fluted',
  'rippled',
  'faceted',
] as const

export interface GlassmorphismParams {
  /** Index of Refraction (IOR η), typically 1.0 (air) to 2.5 (diamond). Crown glass is 1.52. */
  readonly refractionIndex: number
  /** Chromatic dispersion intensity (spectral wavelength separation via Cauchy equation). */
  readonly dispersion: number
  /** Surface microfacet roughness (diffuse scattering & normal perturbation). */
  readonly roughness: number
  /** Dynamic backdrop blurring radius. */
  readonly blurRadius: number
  /** Surface normal geometric pattern. */
  readonly surfacePattern: GlassSurfacePattern
  /** Geometric scale of fluted ribs, waves or facets. */
  readonly patternScale: number
  /** Micro-grain frosted glass etching intensity. */
  readonly frostIntensity: number
  /** Base glass internal volume absorption tint (hex color). */
  readonly tintColor: string
  /** Internal absorption depth opacity. */
  readonly tintOpacity: number
  /** Specular glint and edge Fresnel highlight color (hex color). */
  readonly highlightColor: string
  /** Directional specular reflection strength. */
  readonly specularStrength: number
  /** Angle of key directional studio light in degrees (0 to 360). */
  readonly lightAngle: number
  /** Bevel edge thickness and internal reflection scattering. */
  readonly bevelWidth: number
  /** Radial chromatic shift offset. */
  readonly chromaticShift: number
}

export type ChromeEnvironmentStyle = 'studio' | 'horizon' | 'aurora' | 'cyber' | 'monochrome'
export const chromeEnvironmentStyles: readonly ChromeEnvironmentStyle[] = [
  'studio',
  'horizon',
  'aurora',
  'cyber',
  'monochrome',
] as const

export interface LiquidChromeParams {
  /** Metallic conductor reflectivity and glossiness. */
  readonly metallicSheen: number
  /** Thin-film interference optical rainbow iridescence intensity. */
  readonly iridescence: number
  /** Thin-film optical thickness in nanometers (100 to 1000 nm). */
  readonly filmThickness: number
  /** Surface micro-roughness perturbation (mirror vs satin platinum). */
  readonly roughness: number
  /** Fluid viscosity dampening and wave resistance. */
  readonly fluidViscosity: number
  /** Fluid wave propagation and swirl speed. */
  readonly flowSpeed: number
  /** Frequency detail of fluid ripples and liquid curl noise. */
  readonly rippleFrequency: number
  /** Chromatic dispersion on specular highlights and refractive edges. */
  readonly dispersion: number
  /** Underlying metal body color (hex color). */
  readonly baseColor: string
  /** Metallic highlight reflection tint (hex color). */
  readonly sheenColor: string
  /** Key studio light angle in degrees (0 to 360). */
  readonly lightAngle: number
  /** Procedural HDR studio reflection map style. */
  readonly environmentStyle: ChromeEnvironmentStyle
  /** Liquid surface bump and curl wave displacement intensity. */
  readonly normalPerturbation: number
  /** Micro-grain dither overlay to eliminate 8-bit banding. */
  readonly grainMixer: number
}

export interface RefractivePreset<T> {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly params: T
}

export interface GlassmorphismPaint extends ShaderMotion {
  readonly kind: 'glassmorphism'
  readonly params: GlassmorphismParams
  readonly composite?: ShaderComposite
  readonly mesh?: unknown
  readonly pipeline?: unknown
  readonly postProcessing?: unknown
  readonly gradient?: unknown
}

export interface LiquidChromePaint extends ShaderMotion {
  readonly kind: 'liquid-chrome'
  readonly params: LiquidChromeParams
  readonly composite?: ShaderComposite
  readonly mesh?: unknown
  readonly pipeline?: unknown
  readonly postProcessing?: unknown
  readonly gradient?: unknown
}

export type RefractivePaint = GlassmorphismPaint | LiquidChromePaint

