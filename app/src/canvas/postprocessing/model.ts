import type { CanvasPostProcessingPipeline, PostProcessPass, PostProcessPassType } from './types.ts'

export const MAX_POST_PROCESS_PASSES = 8
type Control = { label: string } & (
  | { kind: 'number'; min: number; max: number; step: number }
  | { kind: 'boolean' }
  | { kind: 'color' }
  | { kind: 'select'; options: readonly string[] }
)
const number = (label: string, min = 0, max = 1, step = .01): Control => ({ label, kind: 'number', min, max, step })
const boolean = (label: string): Control => ({ label, kind: 'boolean' })
const select = (label: string, options: readonly string[]): Control => ({ label, kind: 'select', options })
export const postProcessDefinitions: Record<PostProcessPassType, { name: string; defaults: PostProcessPass['params']; controls: Record<string, Control> }> = {
  bloom: {
    name: 'Bloom', defaults: { threshold: .62, intensity: 1.35, radius: .65, knee: .25 },
    controls: { threshold: number('Threshold'), intensity: number('Intensity', 0, 3), radius: number('Radius', 0, 2), knee: number('Soft knee') },
  },
  'chromatic-aberration': {
    name: 'Chromatic aberration', defaults: { intensity: .35, spread: .4, radial: true, angle: 0 },
    controls: { intensity: number('Intensity'), spread: number('Spread'), radial: boolean('Radial dispersion'), angle: number('Angle', 0, 360, 1) },
  },
  'film-grain': {
    name: 'Film grain', defaults: { intensity: .14, size: 1.2, speed: 1, temporal: true, monochrome: true },
    controls: { intensity: number('Intensity'), size: number('Size', .5, 5, .1), speed: number('Speed', 0, 3), temporal: boolean('Animated grain'), monochrome: boolean('Monochrome') },
  },
  vignette: {
    name: 'Vignette', defaults: { intensity: .38, radius: .82, smoothness: .48, roundness: 1, color: '#080808' },
    controls: { intensity: number('Intensity'), radius: number('Radius', 0, 1.5), smoothness: number('Feather'), roundness: number('Roundness', 0, 1), color: { label: 'Shadow tint', kind: 'color' } },
  },
  'color-grade': {
    name: 'Color grade', defaults: { contrast: 1, brightness: 0, saturation: 1, exposure: 0, tint: '#ffffff' },
    controls: { contrast: number('Contrast', 0, 2), brightness: number('Brightness', -1, 1), saturation: number('Saturation', 0, 2), exposure: number('Exposure', -2, 2), tint: { label: 'Tint', kind: 'color' } },
  },
  'frosted-glass': {
    name: 'Frosted glass',
    defaults: {
      refractionIndex: 1.52,
      dispersion: 0.35,
      roughness: 0.45,
      blurRadius: 0.65,
      surfacePattern: 'frosted',
      patternScale: 1.8,
      frostIntensity: 0.55,
      bevelWidth: 0.4,
      tintColor: '#edebe1',
      tintOpacity: 0.25,
      lightAngle: 45,
      specularStrength: 0.75,
    },
    controls: {
      refractionIndex: number('Refraction (IOR)', 1.0, 2.5, 0.01),
      dispersion: number('Dispersion', 0, 1, 0.01),
      roughness: number('Roughness', 0, 1, 0.01),
      blurRadius: number('Frost blur', 0, 2, 0.01),
      surfacePattern: select('Pattern', ['smooth', 'frosted', 'fluted', 'rippled', 'faceted']),
      patternScale: number('Pattern scale', 0.2, 5, 0.1),
      frostIntensity: number('Frost intensity', 0, 1, 0.01),
      bevelWidth: number('Bevel width', 0, 1, 0.01),
      tintColor: { label: 'Tint color', kind: 'color' },
      tintOpacity: number('Tint opacity', 0, 1, 0.01),
      lightAngle: number('Light angle', 0, 360, 1),
      specularStrength: number('Specular', 0, 2, 0.01),
    },
  },
  'procedural-grain': {
    name: 'Procedural grain',
    defaults: {
      intensity: 0.22,
      size: 1.2,
      frequency: 4.0,
      noiseType: 'simplex',
      octaves: 3,
      turbulence: 0.25,
      speed: 1.0,
      temporal: true,
      monochrome: true,
    },
    controls: {
      intensity: number('Intensity', 0, 1, 0.01),
      size: number('Grain size', 0.5, 10, 0.1),
      frequency: number('Frequency', 0.5, 20, 0.1),
      noiseType: select('Noise generator', ['simplex', 'perlin', 'worley', 'hash']),
      octaves: number('Octaves', 1, 6, 1),
      turbulence: number('Turbulence', 0, 1, 0.01),
      speed: number('Speed', 0, 3, 0.1),
      temporal: boolean('Animated grain'),
      monochrome: boolean('Monochrome'),
    },
  },
  'ambient-occlusion': {
    name: 'Ambient occlusion',
    defaults: {
      intensity: 0.55,
      radius: 14,
      bias: 0.15,
      power: 1.8,
      color: '#080808',
    },
    controls: {
      intensity: number('Intensity', 0, 1, 0.01),
      radius: number('Radius', 1, 40, 0.5),
      bias: number('Edge bias', 0, 1, 0.01),
      power: number('Contrast curve', 0.5, 4, 0.1),
      color: { label: 'Crevice tint', kind: 'color' },
    },
  },
}

export function createPostProcessPass(type: PostProcessPassType): PostProcessPass {
  return { id: crypto.randomUUID(), type, name: postProcessDefinitions[type].name, enabled: true, opacity: 1, blendMode: 'normal', params: { ...postProcessDefinitions[type].defaults } } as PostProcessPass
}

/** Reject malformed imports before they can allocate GPU resources or enter history. */
export function validatePostProcessing(value: unknown): asserts value is CanvasPostProcessingPipeline {
  const fail = (): never => { throw new Error('Invalid shader post-processing pipeline') }
  if (!value || typeof value !== 'object') fail()
  const pipeline = value as CanvasPostProcessingPipeline
  if (pipeline.version !== 1 || typeof pipeline.enabled !== 'boolean' || typeof pipeline.preset !== 'string' || !Array.isArray(pipeline.passes) || pipeline.passes.length > MAX_POST_PROCESS_PASSES) fail()
  const ids = new Set<string>()
  for (const pass of pipeline.passes) {
    if (!pass || typeof pass !== 'object' || typeof pass.type !== 'string' || !Object.hasOwn(postProcessDefinitions, pass.type) || typeof pass.id !== 'string' || !pass.id || ids.has(pass.id) || typeof pass.name !== 'string' || typeof pass.enabled !== 'boolean' || typeof pass.opacity !== 'number' || !Number.isFinite(pass.opacity) || pass.opacity < 0 || pass.opacity > 1 || !['normal', 'screen', 'multiply', 'overlay'].includes(pass.blendMode)) fail()
    ids.add(pass.id)
    const controls = postProcessDefinitions[pass.type].controls
    if (!pass.params || typeof pass.params !== 'object' || Object.keys(pass.params).length !== Object.keys(controls).length) fail()
    for (const [key, control] of Object.entries(controls)) {
      const param = (pass.params as unknown as Record<string, unknown>)[key]
      if (control.kind === 'number' ? typeof param !== 'number' || !Number.isFinite(param) || param < control.min || param > control.max
        : control.kind === 'boolean' ? typeof param !== 'boolean'
        : control.kind === 'select' ? typeof param !== 'string' || !control.options.includes(param)
        : typeof param !== 'string' || !/^#[\da-f]{6}$/i.test(param)) fail()
    }
  }
}

export function freezePostProcessing(pipeline: CanvasPostProcessingPipeline): CanvasPostProcessingPipeline {
  return Object.freeze({ ...pipeline, passes: Object.freeze(pipeline.passes.map(pass => Object.freeze({ ...pass, params: Object.freeze({ ...pass.params }) }) as PostProcessPass)) })
}
