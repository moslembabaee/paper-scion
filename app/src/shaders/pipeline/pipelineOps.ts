import type { ShaderPaint } from '../types.ts'
import { shaderBlendModes } from '../types.ts'
import { PIPELINE_PRESETS, createDefaultPipeline } from './presets.ts'
import type {
  PipelinePass,
  PipelinePassType,
  ShaderPipeline,
  UniformModulator,
} from './types.ts'
import { modulatorWaveforms, pipelinePassTypes } from './types.ts'
import { audioSignals } from '../audio/types.ts'

const within = (val: unknown, min: number, max: number): boolean =>
  typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max

export function validatePipeline(pipeline: unknown, _paint?: ShaderPaint): void {
  if (!pipeline || typeof pipeline !== 'object') throw new Error('Invalid shader pipeline: expected object')
  const p = pipeline as ShaderPipeline
  if (p.version !== 1) throw new Error('Invalid shader pipeline version')
  if (typeof p.name !== 'string' || !p.name.trim()) throw new Error('Invalid shader pipeline name')
  if (typeof p.preset !== 'string') throw new Error('Invalid shader pipeline preset')
  if (!Array.isArray(p.passes)) throw new Error('Invalid shader pipeline passes')
  if (!Array.isArray(p.modulators)) throw new Error('Invalid shader pipeline modulators')

  for (const pass of p.passes) {
    if (!pass || typeof pass !== 'object') throw new Error('Invalid shader pipeline pass')
    if (typeof pass.id !== 'string' || !pass.id.trim()) throw new Error('Invalid pass id')
    if (!pipelinePassTypes.includes(pass.type)) throw new Error(`Invalid pass type: ${pass.type}`)
    if (typeof pass.name !== 'string') throw new Error('Invalid pass name')
    if (typeof pass.enabled !== 'boolean') throw new Error('Invalid pass enabled flag')
    if (!shaderBlendModes.includes(pass.blendMode)) throw new Error(`Invalid pass blendMode: ${pass.blendMode}`)
    if (!within(pass.opacity, 0, 1)) throw new Error('Invalid pass opacity')
    if (!pass.params || typeof pass.params !== 'object') throw new Error('Invalid pass params')
  }

  for (const mod of p.modulators) {
    if (!mod || typeof mod !== 'object') throw new Error('Invalid shader pipeline modulator')
    if (typeof mod.id !== 'string' || !mod.id.trim()) throw new Error('Invalid modulator id')
    if (typeof mod.targetPassId !== 'string') throw new Error('Invalid modulator targetPassId')
    if (typeof mod.targetParam !== 'string') throw new Error('Invalid modulator targetParam')
    if (!modulatorWaveforms.includes(mod.waveform)) throw new Error(`Invalid modulator waveform: ${mod.waveform}`)
    if (!within(mod.frequency, 0.001, 20)) throw new Error('Invalid modulator frequency')
    if (!within(mod.amplitude, 0, 1)) throw new Error('Invalid modulator amplitude')
    if (typeof mod.offset !== 'number' || !Number.isFinite(mod.offset)) throw new Error('Invalid modulator offset')
    if (typeof mod.enabled !== 'boolean') throw new Error('Invalid modulator enabled flag')
    if (mod.source !== undefined && mod.source !== 'lfo' && !audioSignals.includes(mod.source)) throw new Error('Invalid modulator source')
  }
}

export function syncPipelineToParams(paint: ShaderPaint): ShaderPaint {
  if (paint.kind !== 'multi-pass' || !paint.pipeline) return paint
  const p = paint.pipeline
  const passMap = new Map<string, PipelinePass>()
  for (const pass of p.passes) passMap.set(pass.type, pass)

  const mesh = passMap.get('mesh-gradient')
  const liquid = passMap.get('liquid-distortion')
  const glass = passMap.get('glassmorphism')
  const chromatic = passMap.get('chromatic-aberration')
  const grain = passMap.get('grain')

  const nextParams = {
    ...paint.params,
    preset: p.preset,
    colors: (mesh?.params as { colors?: readonly string[] })?.colors ?? (paint.params as { colors: readonly string[] }).colors,
    meshTurbulence: (mesh?.params as { turbulence?: number })?.turbulence ?? (paint.params as { meshTurbulence: number }).meshTurbulence,
    liquidDistortion: (liquid?.params as { distortion?: number })?.distortion ?? (paint.params as { liquidDistortion: number }).liquidDistortion,
    liquidFrequency: (liquid?.params as { frequency?: number })?.frequency ?? (paint.params as { liquidFrequency: number }).liquidFrequency,
    glassRefraction: (glass?.params as { refraction?: number })?.refraction ?? (paint.params as { glassRefraction: number }).glassRefraction,
    glassFrost: (glass?.params as { frost?: number })?.frost ?? (paint.params as { glassFrost: number }).glassFrost,
    chromaticAberration: (chromatic?.params as { intensity?: number })?.intensity ?? (paint.params as { chromaticAberration: number }).chromaticAberration,
    grainIntensity: (grain?.params as { intensity?: number })?.intensity ?? (paint.params as { grainIntensity: number }).grainIntensity,
    grainBlend: (grain?.params as { blendMode?: 'overlay' | 'soft-light' | 'multiply' | 'screen' })?.blendMode ?? (paint.params as { grainBlend: 'overlay' | 'soft-light' | 'multiply' | 'screen' }).grainBlend,
  }

  return {
    ...paint,
    params: nextParams,
  } as ShaderPaint
}

export function updatePipelinePass<T extends PipelinePassType>(
  paint: ShaderPaint,
  passId: string,
  updater: (prev: PipelinePass<T>) => PipelinePass<T>
): ShaderPaint {
  if (paint.kind !== 'multi-pass') return paint
  const pipeline = paint.pipeline ?? createDefaultPipeline()
  const nextPasses = pipeline.passes.map(pass => (pass.id === passId ? updater(pass as PipelinePass<T>) : pass))
  const nextPipeline: ShaderPipeline = {
    ...pipeline,
    preset: 'custom',
    passes: nextPasses,
  }
  return syncPipelineToParams({
    ...paint,
    pipeline: nextPipeline,
  })
}

export function togglePipelinePass(paint: ShaderPaint, passId: string): ShaderPaint {
  return updatePipelinePass(paint, passId, pass => ({ ...pass, enabled: !pass.enabled }))
}

export function reorderPipelinePasses(paint: ShaderPaint, fromIndex: number, toIndex: number): ShaderPaint {
  if (paint.kind !== 'multi-pass') return paint
  const pipeline = paint.pipeline ?? createDefaultPipeline()
  if (fromIndex < 0 || fromIndex >= pipeline.passes.length || toIndex < 0 || toIndex >= pipeline.passes.length) return paint
  const passes = [...pipeline.passes]
  const [removed] = passes.splice(fromIndex, 1)
  if (!removed) return paint
  passes.splice(toIndex, 0, removed)
  return {
    ...paint,
    pipeline: {
      ...pipeline,
      preset: 'custom',
      passes,
    },
  }
}

export function removePipelinePass(paint: ShaderPaint, passId: string): ShaderPaint {
  if (paint.kind !== 'multi-pass') return paint
  const pipeline = paint.pipeline ?? createDefaultPipeline()
  if (pipeline.passes.length <= 1) return paint
  const nextPasses = pipeline.passes.filter(pass => pass.id !== passId)
  const nextModulators = pipeline.modulators.filter(mod => mod.targetPassId !== passId)
  return syncPipelineToParams({
    ...paint,
    pipeline: {
      ...pipeline,
      preset: 'custom',
      passes: nextPasses,
      modulators: nextModulators,
    },
  })
}

export function duplicatePipelinePass(paint: ShaderPaint, passId: string): ShaderPaint {
  if (paint.kind !== 'multi-pass') return paint
  const pipeline = paint.pipeline ?? createDefaultPipeline()
  const idx = pipeline.passes.findIndex(p => p.id === passId)
  if (idx === -1) return paint
  const source = pipeline.passes[idx]
  const newPass: PipelinePass = {
    ...source,
    id: `pass-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${source.name} (Copy)`,
    params: JSON.parse(JSON.stringify(source.params)),
  }
  const nextPasses = [...pipeline.passes]
  nextPasses.splice(idx + 1, 0, newPass)
  return {
    ...paint,
    pipeline: {
      ...pipeline,
      preset: 'custom',
      passes: nextPasses,
    },
  }
}

export function addPipelinePass(paint: ShaderPaint, type: PipelinePassType): ShaderPaint {
  if (paint.kind !== 'multi-pass') return paint
  const pipeline = paint.pipeline ?? createDefaultPipeline()
  const id = `pass-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  let newPass: PipelinePass

  switch (type) {
    case 'mesh-gradient':
      newPass = {
        id,
        type: 'mesh-gradient',
        name: 'Mesh Gradient',
        enabled: true,
        blendMode: 'normal',
        opacity: 1,
        params: {
          colors: ['#edebe1', '#81adec', '#516b94', '#222222'],
          turbulence: 0.4,
          frequency: 2.5,
          swirl: 0.3,
          distortion: 0.5,
          anchors: [
            { x: 0.25, y: 0.25, radius: 0.6 },
            { x: 0.75, y: 0.35, radius: 0.7 },
            { x: 0.3, y: 0.75, radius: 0.65 },
            { x: 0.8, y: 0.8, radius: 0.6 },
          ],
        },
      }
      break
    case 'liquid-distortion':
      newPass = {
        id,
        type: 'liquid-distortion',
        name: 'Liquid Flow',
        enabled: true,
        blendMode: 'normal',
        opacity: 1,
        params: {
          distortion: 0.5,
          frequency: 2.0,
          speed: 0.6,
          swirl: 0.4,
          swirlIterations: 4,
          viscosity: 0.3,
        },
      }
      break
    case 'glassmorphism':
      newPass = {
        id,
        type: 'glassmorphism',
        name: 'Frosted Glass',
        enabled: true,
        blendMode: 'soft-light',
        opacity: 0.9,
        params: {
          refraction: 0.6,
          frost: 0.25,
          pattern: 'smooth',
          angle: 45,
          specular: 0.5,
          bevel: 0.3,
          tint: '#edebe1',
        },
      }
      break
    case 'chromatic-aberration':
      newPass = {
        id,
        type: 'chromatic-aberration',
        name: 'Chromatic Aberration',
        enabled: true,
        blendMode: 'screen',
        opacity: 1,
        params: {
          intensity: 0.45,
          spread: 0.35,
          radial: true,
          angle: 0,
        },
      }
      break
    case 'grain':
      newPass = {
        id,
        type: 'grain',
        name: 'Film Grain',
        enabled: true,
        blendMode: 'overlay',
        opacity: 0.85,
        params: {
          intensity: 0.15,
          size: 1.2,
          temporal: true,
          monochrome: true,
          blendMode: 'overlay',
        },
      }
      break
    case 'custom-glsl':
      newPass = {
        id,
        type: 'custom-glsl',
        name: 'Post-Process / GLSL',
        enabled: true,
        blendMode: 'normal',
        opacity: 1,
        params: {
          contrast: 0.1,
          brightness: 0.05,
          saturation: 0.1,
          vignette: 0.2,
          tint: '#edebe1',
          customSnippet: '// vec3 color = ...',
        },
      }
      break
  }

  return syncPipelineToParams({
    ...paint,
    pipeline: {
      ...pipeline,
      preset: 'custom',
      passes: [...pipeline.passes, newPass],
    },
  })
}

export function addPipelineModulator(
  paint: ShaderPaint,
  modulator: Omit<UniformModulator, 'id'>
): ShaderPaint {
  if (paint.kind !== 'multi-pass') return paint
  const pipeline = paint.pipeline ?? createDefaultPipeline()
  const id = `mod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const newMod: UniformModulator = { ...modulator, id }
  return {
    ...paint,
    pipeline: {
      ...pipeline,
      modulators: [...pipeline.modulators, newMod],
    },
  }
}

export function updatePipelineModulator(
  paint: ShaderPaint,
  modulatorId: string,
  updater: (prev: UniformModulator) => UniformModulator
): ShaderPaint {
  if (paint.kind !== 'multi-pass') return paint
  const pipeline = paint.pipeline ?? createDefaultPipeline()
  return {
    ...paint,
    pipeline: {
      ...pipeline,
      modulators: pipeline.modulators.map(mod => (mod.id === modulatorId ? updater(mod) : mod)),
    },
  }
}

export function removePipelineModulator(paint: ShaderPaint, modulatorId: string): ShaderPaint {
  if (paint.kind !== 'multi-pass') return paint
  const pipeline = paint.pipeline ?? createDefaultPipeline()
  return {
    ...paint,
    pipeline: {
      ...pipeline,
      modulators: pipeline.modulators.filter(mod => mod.id !== modulatorId),
    },
  }
}

export function togglePipelineModulator(paint: ShaderPaint, modulatorId: string): ShaderPaint {
  return updatePipelineModulator(paint, modulatorId, mod => ({ ...mod, enabled: !mod.enabled }))
}

export function loadPipelinePreset(paint: ShaderPaint, presetKey: string): ShaderPaint {
  if (paint.kind !== 'multi-pass') return paint
  const preset = PIPELINE_PRESETS[presetKey] ?? PIPELINE_PRESETS['prismatic-glass']
  const newPipeline = preset.createPipeline()
  const nextParams = {
    ...paint.params,
    preset: preset.id,
    colors: [...preset.colors],
    meshTurbulence: preset.meshTurbulence,
    liquidDistortion: preset.liquidDistortion,
    liquidFrequency: preset.liquidFrequency,
    glassRefraction: preset.glassRefraction,
    glassFrost: preset.glassFrost,
    chromaticAberration: preset.chromaticAberration,
    grainIntensity: preset.grainIntensity,
    grainBlend: preset.grainBlend,
    modulatorSpeed: preset.modulatorSpeed,
    modulatorDepth: preset.modulatorDepth,
  }
  return {
    ...paint,
    params: nextParams,
    pipeline: newPipeline,
  }
}
