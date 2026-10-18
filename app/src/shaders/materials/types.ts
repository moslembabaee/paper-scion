export type MaterialPresetId =
  | 'iridescent-film'
  | 'chromatic-dispersion'
  | 'frosted-liquid-acrylic'
  | 'reactive-grain'
  | 'liquid-caustics'
  | 'holographic-foil'
  | 'velvet-aurora'
  | 'frosted-obsidian'
  | 'prismatic-flare'
  | 'analog-risograph'

export type MaterialCategory = 'Optical' | 'Dispersion' | 'Fluid' | 'Tactile' | 'Atmospheric'

export interface MaterialPresetParams {
  readonly presetId: MaterialPresetId
  /** Refraction Index (η), e.g. 1.00 - 2.80 (Air: 1.0, Water: 1.33, Acrylic: 1.49, Glass: 1.52, Flint: 1.66, Diamond: 2.42) */
  readonly refractionIndex: number
  /** Chromatic dispersion spread (Cauchy spectral splitting), 0.0 - 1.0 */
  readonly dispersionSpread: number
  /** Spatial ripple / turbulence / noise frequency, 0.1 - 20.0 */
  readonly frequency: number
  /** Mouse interaction reactivity strength, 0.0 - 1.0 */
  readonly mouseReactivity: number
  /** Microfacet surface roughness / frost diffusion, 0.0 - 1.0 */
  readonly roughness: number
  /** Thin film interference thickness in nanometers, 100 - 1200 nm */
  readonly filmThickness: number
  /** Interference sheen strength, 0.0 - 1.0 */
  readonly iridescence: number
  /** Fluid viscosity dampening factor, 0.0 - 1.0 */
  readonly fluidViscosity: number
  /** Film grain / stipple frequency scale, 0.1 - 10.0 */
  readonly grainScale: number
  /** Film grain / stipple intensity, 0.0 - 1.0 */
  readonly grainIntensity: number
  /** Directional specular light angle in degrees, 0 - 360 */
  readonly lightAngle: number
  /** Specular highlight reflection glint, 0.0 - 1.0 */
  readonly specularStrength: number
  /** Palette colors for multi-tone gradient / dispersion (hex codes) */
  readonly colors: readonly string[]
  /** Base tint color (hex) */
  readonly tintColor: string
  /** Specular highlight tint color (hex) */
  readonly highlightColor: string
  /** Blend ratio with background / layer, 0.0 - 1.0 */
  readonly blendRatio: number
}

export interface MaterialPresetDefinition {
  readonly id: MaterialPresetId
  readonly name: string
  readonly category: MaterialCategory
  readonly description: string
  readonly tags: readonly string[]
  readonly params: MaterialPresetParams
}
