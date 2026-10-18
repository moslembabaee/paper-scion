import type { ShaderBlendMode } from '../types.ts'
import type { AudioSignal } from '../audio/types.ts'

export type PipelinePassType =
  | 'mesh-gradient'
  | 'liquid-distortion'
  | 'glassmorphism'
  | 'grain'
  | 'chromatic-aberration'
  | 'custom-glsl'

export const pipelinePassTypes: readonly PipelinePassType[] = [
  'mesh-gradient',
  'liquid-distortion',
  'glassmorphism',
  'grain',
  'chromatic-aberration',
  'custom-glsl',
] as const

export interface MeshGradientPassParams {
  readonly colors: readonly string[]
  readonly turbulence: number
  readonly frequency: number
  readonly swirl: number
  readonly distortion: number
  readonly anchors: readonly { readonly x: number; readonly y: number; readonly radius: number }[]
}

export interface LiquidDistortionPassParams {
  readonly distortion: number
  readonly frequency: number
  readonly speed: number
  readonly swirl: number
  readonly swirlIterations: number
  readonly viscosity: number
}

export interface GlassmorphismPassParams {
  readonly refraction: number
  readonly frost: number
  readonly pattern: 'smooth' | 'fluted' | 'prism' | 'wave'
  readonly angle: number
  readonly specular: number
  readonly bevel: number
  readonly tint: string
}

export interface ChromaticAberrationPassParams {
  readonly intensity: number
  readonly spread: number
  readonly radial: boolean
  readonly angle: number
}

export interface GrainPassParams {
  readonly intensity: number
  readonly size: number
  readonly temporal: boolean
  readonly monochrome: boolean
  readonly blendMode: 'overlay' | 'soft-light' | 'multiply' | 'screen'
}

export interface CustomGLSLPassParams {
  readonly contrast: number
  readonly brightness: number
  readonly saturation: number
  readonly vignette: number
  readonly tint: string
  readonly customSnippet: string
}

export interface PipelinePassParamsMap {
  'mesh-gradient': MeshGradientPassParams
  'liquid-distortion': LiquidDistortionPassParams
  'glassmorphism': GlassmorphismPassParams
  grain: GrainPassParams
  'chromatic-aberration': ChromaticAberrationPassParams
  'custom-glsl': CustomGLSLPassParams
}

export interface PipelinePass<T extends PipelinePassType = PipelinePassType> {
  readonly id: string
  readonly type: T
  readonly name: string
  readonly enabled: boolean
  readonly blendMode: ShaderBlendMode
  readonly opacity: number
  readonly params: PipelinePassParamsMap[T]
}

export type ModulatorWaveform = 'sine' | 'triangle' | 'sawtooth' | 'noise' | 'pulse'

export const modulatorWaveforms: readonly ModulatorWaveform[] = [
  'sine',
  'triangle',
  'sawtooth',
  'noise',
  'pulse',
] as const

export interface UniformModulator {
  readonly id: string
  readonly name: string
  readonly targetPassId: string
  readonly targetParam: string
  readonly waveform: ModulatorWaveform
  readonly frequency: number
  readonly amplitude: number
  readonly offset: number
  readonly enabled: boolean
  /** Omitted by older documents: defaults to the existing LFO. */
  readonly source?: 'lfo' | AudioSignal
}

export interface ShaderPipeline {
  readonly version: 1
  readonly name: string
  readonly preset: string
  readonly passes: readonly PipelinePass[]
  readonly modulators: readonly UniformModulator[]
}

export interface MultiPassParams {
  readonly preset: string
  readonly colors: readonly string[]
  readonly meshTurbulence: number
  readonly liquidDistortion: number
  readonly liquidFrequency: number
  readonly glassRefraction: number
  readonly glassFrost: number
  readonly chromaticAberration: number
  readonly grainIntensity: number
  readonly grainBlend: 'overlay' | 'soft-light' | 'multiply' | 'screen'
  readonly modulatorSpeed: number
  readonly modulatorDepth: number
}
