export type GenerativePresetId =
  | 'aurora-borealis'
  | 'cosmic-nebula'
  | 'liquid-marble'
  | 'cyber-hologram'
  | 'solar-flare'
  | 'oceanic-depth'
  | 'prismatic-opal'

export interface GenerativeMaterialParams {
  readonly preset: GenerativePresetId
  /** Array of hex color strings (2 to 8 colors) used for the generative procedural gradient */
  readonly colorStops: readonly string[]
  /** Procedural film grain intensity, 0.0 to 1.0 */
  readonly grainIntensity: number
  /** Incompressible fluid warp & domain distortion intensity, 0.0 to 1.0 */
  readonly fluidDistortion: number
  /** Spectral chromatic aberration / wavelength dispersion, 0.0 to 1.0 */
  readonly chromaticAberration: number
  /** Real-time turbulence velocity multiplier, 0.0 to 3.0 */
  readonly turbulenceSpeed: number
  /** Spatial noise & field frequency, 0.1 to 10.0 */
  readonly frequency: number
  /** Color dynamics contrast curve, 0.1 to 2.5 */
  readonly contrast: number
  /** Multi-octave fractal detail iterations (1 to 6) */
  readonly octaves: number
}

export interface GenerativePresetDefinition {
  readonly id: GenerativePresetId
  readonly name: string
  readonly description: string
  readonly params: GenerativeMaterialParams
}

export interface GenerativeUniforms {
  readonly u_grainIntensity: number
  readonly u_fluidDistortion: number
  readonly u_chromaticAberration: number
  readonly u_turbulenceSpeed: number
  readonly u_frequency: number
  readonly u_contrast: number
  readonly u_octaves: number
  readonly u_colorCount: number
  readonly u_colors: number[][]
  readonly u_mouse?: number[]
  readonly u_mouseActive?: number
  readonly [key: string]: string | boolean | number | number[] | number[][] | HTMLImageElement | undefined
}
