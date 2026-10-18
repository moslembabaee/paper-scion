export type ParticleColorMode =
  | 'palette'
  | 'monochrome'
  | 'velocity'
  | 'magnetic-flow'
  | 'aurora'
  | 'paper-blueprint'

export type ParticleMagneticMode =
  | 'attract'
  | 'repel'
  | 'vortex'
  | 'dipole'
  | 'cross-flow'
  | 'orbit'

export type ParticleViewMode =
  | 'field-composite'
  | 'particles-only'
  | 'flow-vectors'
  | 'magnetic-potential'
  | 'velocity-stream'
  | 'trails-only'

export type ParticlePresetId =
  | 'magnetic-vortex'
  | 'curl-streamlines'
  | 'cosmic-dust'
  | 'paper-constellation'
  | 'quantum-superfluid'
  | 'solar-flare'

export interface ParticleSimulationParams {
  /** Total number of simulated GPU particles (1024 to 65536, e.g. 16384). */
  readonly particleCount: number
  /** Physical point sprite display diameter in CSS pixels (0.5 to 12.0, e.g. 2.5). */
  readonly particleSize: number
  /** Velocity advection scaling rate along the curl vector field (0.1 to 5.0, e.g. 1.2). */
  readonly advectionSpeed: number
  /** Incompressible curl noise vorticity force amplitude (0.0 to 10.0, e.g. 3.5). */
  readonly curlStrength: number
  /** Spatial frequency scale of curl noise turbulence (0.2 to 10.0, e.g. 2.2). */
  readonly curlScale: number
  /** Number of fractal noise octaves for multi-scale eddies (1 to 5, e.g. 3). */
  readonly curlOctaves: number
  /** Particle velocity momentum damping factor per frame (0.80 to 0.999, e.g. 0.96). */
  readonly velocityDamping: number
  /** Cursor magnetic field interaction mode. */
  readonly magneticMode: ParticleMagneticMode
  /** Interactive cursor magnetic pole attraction / repulsion / vortex force (0.0 to 10.0, e.g. 3.2). */
  readonly magneticForce: number
  /** Radius of magnetic field influence relative to viewport (0.05 to 1.0, e.g. 0.35). */
  readonly magneticRadius: number
  /** Number of stationary magnetic poles positioned on the 120px grid (0 to 8, e.g. 2). */
  readonly magneticPolesCount: number
  /** Phosphorescent persistence and motion blur trail retention factor (0.70 to 0.99, e.g. 0.92). */
  readonly trailDecay: number
  /** Color palette for particle tinting and emission. */
  readonly particleColors: readonly string[]
  /** Color mapping mode across particle life, speed, or magnetic lines. */
  readonly colorMode: ParticleColorMode
  /** Diagnostic visualization mode for inspecting particle dynamics. */
  readonly viewMode: ParticleViewMode
  /** Alignment factor to Paper's 120px engineering grid lines (0.0 to 1.0, e.g. 0.4). */
  readonly gridAlignment: number
  /** Additive glowing bloom intensity around dense particle clusters (0.0 to 2.0, e.g. 0.8). */
  readonly glowIntensity: number
  /** Brownian thermal jitter for organic particle dispersion (0.0 to 1.0, e.g. 0.15). */
  readonly jitter: number
}

export interface ParticlePreset {
  readonly id: ParticlePresetId
  readonly name: string
  readonly description: string
  readonly params: ParticleSimulationParams
}
