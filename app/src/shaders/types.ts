import type { DitheringParams, DotOrbitParams, FlutedGlassParams, GrainGradientParams, HalftoneCmykParams, MeshGradientParams, MetaballsParams, NeuroNoiseParams, PerlinNoiseParams, WarpParams } from '@paper-design/shaders-react'
import type { MultiPassParams, ShaderPipeline } from './pipeline/types.ts'
import type { CanvasPostProcessingPipeline } from '../canvas/postprocessing/types.ts'
import type { GradientPaint } from '../scene/types.ts'
import type { GlassmorphismParams, LiquidChromeParams } from './refractive/types.ts'
import type { MaterialPresetParams } from './materials/types.ts'
import type { FluidSimulationParams } from './fluid/types.ts'
import type { ParticleSimulationParams } from './particle/types.ts'
import type { VectorExtrusionParams } from './extrusion/types.ts'
import type { GenerativeMaterialParams } from './generative/types.ts'

export type { MultiPassParams, ShaderPipeline } from './pipeline/types.ts'
export type { PipelinePass, PipelinePassType, UniformModulator } from './pipeline/types.ts'
export type { GradientPaint, GradientType, GradientColorStop } from '../scene/types.ts'
export type {
  GlassmorphismParams,
  LiquidChromeParams,
  GlassSurfacePattern,
  ChromeEnvironmentStyle,
  GlassmorphismPaint,
  LiquidChromePaint,
  RefractivePaint,
} from './refractive/types.ts'
export type {
  MaterialPresetParams,
  MaterialPresetId,
  MaterialPresetDefinition,
  MaterialCategory,
} from './materials/types.ts'
export type {
  FluidSimulationParams,
  FluidColorMode,
  FluidViewMode,
  FluidPresetId,
  FluidPreset,
} from './fluid/types.ts'
export type {
  ParticleSimulationParams,
  ParticleColorMode,
  ParticleMagneticMode,
  ParticleViewMode,
  ParticlePresetId,
  ParticlePreset,
} from './particle/types.ts'
export type {
  VectorExtrusionParams,
  ExtrusionBevelProfile,
  ExtrusionViewMode,
  ExtrusionPreset,
} from './extrusion/types.ts'
export type {
  GenerativeMaterialParams,
  GenerativePresetId,
  GenerativePresetDefinition,
  GenerativeUniforms,
} from './generative/types.ts'

export interface MultiStopGradientParams {
  readonly gradientType: 'linear' | 'radial' | 'angular'
  readonly colors: readonly string[]
  readonly angle: number
  readonly originX: number
  readonly originY: number
  readonly focalLength: number
  readonly spread: number
  readonly dither: number
  readonly smoothness: number
}

type Controls<T> = Readonly<Required<Omit<T, 'speed' | 'frame' | 'scale' | 'rotation' | 'offsetX' | 'offsetY' | 'fit' | 'originX' | 'originY' | 'worldWidth' | 'worldHeight'>>>
type Palette<T> = Omit<Controls<T>, 'colors'> & { readonly colors: readonly string[] }

export interface ShaderParams {
  'mesh-gradient': Palette<MeshGradientParams>
  'dot-orbit': Palette<DotOrbitParams>
  'grain-gradient': Palette<GrainGradientParams>
  'halftone-cmyk': Omit<Controls<HalftoneCmykParams>, 'image'> & { readonly image: string }
  'neuro-noise': Controls<NeuroNoiseParams>
  gooey: Palette<MetaballsParams>
  dithering: Controls<DitheringParams>
  'perlin-noise': Controls<PerlinNoiseParams>
  'liquid-distortion': Palette<WarpParams>
  'glass-refraction': Omit<Controls<FlutedGlassParams>, 'image' | 'margin'> & { readonly image: string }
  'multi-pass': MultiPassParams
  'procedural-noise': ProceduralNoiseParams
  'multi-stop-gradient': MultiStopGradientParams
  glassmorphism: GlassmorphismParams
  'liquid-chrome': LiquidChromeParams
  'shader-material': MaterialPresetParams
  'fluid-simulation': FluidSimulationParams
  'particle-simulation': ParticleSimulationParams
  'vector-extrusion': VectorExtrusionParams
  'generative-material': GenerativeMaterialParams
}
export type ShaderKind = keyof ShaderParams
export interface ShaderMotion {
  readonly animated: boolean
  readonly speed: number
  /** Deterministic starting time in milliseconds; also the static frame. */
  readonly frame: number
  readonly scale: number
  readonly rotation: number
  readonly offsetX: number
  readonly offsetY: number
}
export const shaderBlendModes = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'darken', 'lighten', 'color-dodge', 'color-burn', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const
export type ShaderBlendMode = typeof shaderBlendModes[number]
export interface ShaderComposite {
  readonly blendMode: ShaderBlendMode
  /** Material opacity is independent of the layer's opacity. */
  readonly opacity: number
}
export interface MeshAnchor {
  readonly x: number
  readonly y: number
  readonly radius: number
  /** Individual alpha/opacity anchor for this vertex [0, 1] (defaults to 1) */
  readonly alpha?: number
  /** Tangential curve tension handle horizontal displacement [-1, 1] */
  readonly tx?: number
  /** Tangential curve tension handle vertical displacement [-1, 1] */
  readonly ty?: number
  /** Tangential curve tension intensity [0, 2] (defaults to 1) */
  readonly tension?: number
}
export const meshInterpolationModes = ['bicubic', 'gaussian-rbf', 'catmull-rom'] as const
export type MeshInterpolationMode = typeof meshInterpolationModes[number]

export const noiseGenerators = ['simplex', 'perlin', 'worley'] as const
export type NoiseGenerator = typeof noiseGenerators[number]

export const meshDistortionModes = ['curl-fluid', 'domain-warp', 'turbulent-swirl', 'simplex-flow'] as const
export type MeshDistortionMode = typeof meshDistortionModes[number]

export const grainBlendModes = ['overlay', 'soft-light', 'multiply', 'screen', 'linear-dodge', 'color-dodge'] as const
export const meshTopologies = ['freeform', 'grid'] as const
export type MeshTopology = typeof meshTopologies[number]

export interface MeshGridVertex {
  readonly color: string
  readonly tx: number
  readonly ty: number
  /** Individual alpha/opacity anchor for this grid vertex [0, 1] (defaults to 1) */
  readonly alpha?: number
  /** Tangential curve tension intensity [0, 2] (defaults to 1) */
  readonly tension?: number
}

export interface MeshGridConfig {
  readonly topology: 'grid'
  readonly rows: number
  readonly cols: number
  readonly vertices: readonly MeshGridVertex[]
  readonly smoothing: number
}

export interface MeshMaterial {
  /** One normalized, top-left-origin anchor per palette color. */
  readonly anchors: readonly MeshAnchor[]
  readonly turbulence: number
  readonly frequency: number
  readonly chromaticAberration: number
  readonly grainBlend: typeof grainBlendModes[number]
  /** 2D field interpolation algorithm (defaults to 'bicubic') */
  readonly interpolation?: MeshInterpolationMode
  /** Multi-octave domain warp distortion modulation intensity (0 to 1) */
  readonly warpModulation?: number
  /** Multi-octave procedural noise generator type (defaults to 'simplex') */
  readonly noiseType?: NoiseGenerator
  /** Frequency multiplier per octave (defaults to 2.0) */
  readonly lacunarity?: number
  /** Multi-octave iteration count (1 to 6, defaults to 3) */
  readonly octaves?: number
  /** Normal-map surface perturbation intensity (0 to 1, defaults to 0.2) */
  readonly normalPerturbation?: number
  /** Micro-grain displacement intensity (0 to 1, defaults to 0.15) */
  readonly grainDisplacement?: number
  /** Incompressible curl-noise fluid advection velocity (0 to 1, defaults to 0.35) */
  readonly fluidAdvection?: number
  /** Fluid viscosity dampening factor (0 to 1, defaults to 0.5) */
  readonly fluidViscosity?: number
  /** Fluid distortion dynamics mode (defaults to 'curl-fluid') */
  readonly distortionMode?: MeshDistortionMode
  /** Grid-based mesh topology for NxM bicubic patch control */
  readonly grid?: MeshGridConfig
  /** Surface inspection view mode: shaded, normal-map, displacement (defaults to 'shaded') */
  readonly viewMode?: 'shaded' | 'normal-map' | 'displacement'
}

export interface ProceduralNoiseParams {
  readonly noiseType: NoiseGenerator
  readonly frequency: number
  readonly octaves: number
  readonly lacunarity: number
  readonly persistence: number
  readonly turbulence: number
  readonly displacement: number
  readonly normalPerturbation: number
  readonly grainMixer: number
  readonly grainOverlay: number
  readonly colorFront: string
  readonly colorMid: string
  readonly colorBack: string
  readonly lightAngle: number
  readonly specularStrength: number
  readonly viewMode: 'shaded' | 'normal-map' | 'heightmap'
}
export type ShaderPaint = { [K in ShaderKind]: ShaderMotion & { readonly kind: K; readonly params: ShaderParams[K]; readonly composite?: ShaderComposite; readonly mesh?: MeshMaterial; readonly pipeline?: ShaderPipeline; readonly postProcessing?: CanvasPostProcessingPipeline; readonly gradient?: GradientPaint } }[ShaderKind]
export type ShaderValue = number | string | readonly string[]
export type ShaderControl =
  | { readonly key: string; readonly label: string; readonly type: 'number'; readonly min: number; readonly max: number; readonly step: number; readonly integer?: boolean }
  | { readonly key: string; readonly label: string; readonly type: 'select'; readonly options: readonly string[] }
  | { readonly key: string; readonly label: string; readonly type: 'color' }
  | { readonly key: string; readonly label: string; readonly type: 'image' }
  | { readonly key: string; readonly label: string; readonly type: 'palette'; readonly max: number }
export interface ShaderDefinition<K extends ShaderKind = ShaderKind> {
  readonly label: string
  readonly description: string
  readonly defaults: ShaderParams[K]
  readonly controls: readonly ShaderControl[]
}
