export type FluidColorMode = 'palette' | 'rainbow' | 'monochrome' | 'fire' | 'velocity'

export type FluidViewMode =
  | 'fluid-composite'
  | 'dye-only'
  | 'velocity'
  | 'pressure'
  | 'normal-map'
  | 'refraction-only'

export type FluidPresetId =
  | 'ink-in-water'
  | 'liquid-mercury'
  | 'neon-vapor'
  | 'paper-ripples'
  | 'deep-ocean'

export interface FluidSimulationParams {
  /** Rate at which dye concentration dissipates per second (0 to 1, e.g. 0.985). */
  readonly densityDissipation: number
  /** Rate at which velocity dampens over time (0 to 1, e.g. 0.98). */
  readonly velocityDissipation: number
  /** Number of Jacobi solver iterations for the pressure Poisson equation (4 to 64, e.g. 24). */
  readonly pressureIterations: number
  /** Fluid kinematic viscosity diffusion coefficient (0 to 1, e.g. 0.25). */
  readonly viscosity: number
  /** Vorticity confinement scale to preserve small turbulent swirls and eddies (0 to 50, e.g. 18.0). */
  readonly curlStrength: number
  /** Radial Gaussian radius of pointer / emitter impulses (0.005 to 0.1, e.g. 0.025). */
  readonly splatRadius: number
  /** Velocity impulse force magnitude (100 to 10000, e.g. 3500). */
  readonly splatForce: number
  /** Color palette for fluid dye emission. */
  readonly dyeColors: readonly string[]
  /** Color mapping mode for injected dye. */
  readonly colorMode: FluidColorMode
  /** Gentle autonomous procedural drift when pointer is idle (0 to 2, e.g. 0.25). */
  readonly ambientFlow: number
  /** Optical refractive index for normal-mapped surface refraction (1.0 to 2.5, e.g. 1.33). */
  readonly refractionIndex: number
  /** Cauchy spectral chromatic dispersion between R, G, and B bands (0 to 1, e.g. 0.25). */
  readonly dispersion: number
  /** Surface ripple tension and wave restoration factor (0 to 1, e.g. 0.35). */
  readonly surfaceTension: number
  /** Surface normal-map perturbation intensity derived from dye gradient (0 to 1, e.g. 0.6). */
  readonly normalPerturbation: number
  /** Specular highlight reflection glint strength (0 to 2, e.g. 0.8). */
  readonly specularStrength: number
  /** Key directional light angle in degrees (0 to 360, e.g. 45). */
  readonly lightAngle: number
  /** Diagnostic visualization mode for inspecting fluid dynamics. */
  readonly viewMode: FluidViewMode
  /** Grid simulation resolution dimension (64 to 512, e.g. 128). */
  readonly gridResolution: number
}

export interface FluidPreset {
  readonly id: FluidPresetId
  readonly name: string
  readonly description: string
  readonly params: FluidSimulationParams
}
