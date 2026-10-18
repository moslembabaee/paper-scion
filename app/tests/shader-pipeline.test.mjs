import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createShader, updateShaderParameter, validateShader } from '../src/shaders/catalog.ts'
import { PIPELINE_PRESETS, createDefaultPipeline, presetKeys } from '../src/shaders/pipeline/presets.ts'
import {
  addPipelinePass,
  removePipelinePass,
  togglePipelinePass,
  reorderPipelinePasses,
  duplicatePipelinePass,
  updatePipelinePass,
  addPipelineModulator,
  updatePipelineModulator,
  removePipelineModulator,
  togglePipelineModulator,
  loadPipelinePreset,
  validatePipeline,
} from '../src/shaders/pipeline/pipelineOps.ts'
import {
  multiPassFragmentShader,
  multiPassUniforms,
  evaluateWaveform,
  computeModulatedValue,
} from '../src/shaders/pipeline/multiPassFragment.ts'
import {
  exportPipelineReact,
  exportPipelineGLSL,
  exportPipelineUniforms,
  exportShaderSource,
} from '../src/shaders/shaderExport.ts'
import { shaderSchema, validateSchema } from '../src/mcp/schema.ts'

const copy = value => JSON.parse(JSON.stringify(value))

test('creates a default multi-pass shader with complete pipeline specification', () => {
  const shader = createShader('multi-pass')
  assert.equal(shader.kind, 'multi-pass')
  assert.ok(shader.pipeline)
  assert.equal(shader.pipeline.version, 1)
  assert.ok(shader.pipeline.passes.length >= 4)
  assert.ok(shader.pipeline.modulators.length >= 1)
  assert.equal(shader.params.preset, 'prismatic-glass')
  validateShader(shader)
})

test('all pipeline presets create valid, well-formed ShaderPipelines', () => {
  assert.ok(presetKeys.length >= 7)
  for (const key of presetKeys) {
    const preset = PIPELINE_PRESETS[key]
    assert.ok(preset)
    assert.equal(preset.id, key)
    assert.ok(preset.name.length > 0)
    assert.ok(preset.description.length > 0)
    assert.ok(Array.isArray(preset.colors))

    const pipeline = preset.createPipeline()
    assert.equal(pipeline.preset, key)
    validatePipeline(pipeline)

    const shader = {
      ...createShader('multi-pass'),
      params: { ...createShader('multi-pass').params, preset: key },
      pipeline,
    }
    validateShader(shader)

    const uniforms = multiPassUniforms(shader, 1000)
    assert.ok(typeof uniforms.u_scale === 'number')
    assert.ok(typeof uniforms.u_pass_mesh_enabled === 'number')
    assert.ok(typeof uniforms.u_pass_liquid_enabled === 'number')
    assert.ok(typeof uniforms.u_pass_glass_enabled === 'number')
    assert.ok(typeof uniforms.u_pass_chromatic_enabled === 'number')
    assert.ok(typeof uniforms.u_pass_grain_enabled === 'number')
  }
})

test('pipeline operations: add, toggle, duplicate, update, and remove passes', () => {
  let shader = createShader('multi-pass')
  const initialPassCount = shader.pipeline.passes.length

  // Add custom GLSL pass
  shader = addPipelinePass(shader, 'custom-glsl')
  assert.equal(shader.pipeline.passes.length, initialPassCount + 1)
  const customPass = shader.pipeline.passes[shader.pipeline.passes.length - 1]
  assert.equal(customPass.type, 'custom-glsl')
  assert.equal(customPass.enabled, true)

  // Toggle pass
  shader = togglePipelinePass(shader, customPass.id)
  assert.equal(shader.pipeline.passes.find(p => p.id === customPass.id)?.enabled, false)
  shader = togglePipelinePass(shader, customPass.id)
  assert.equal(shader.pipeline.passes.find(p => p.id === customPass.id)?.enabled, true)

  // Duplicate pass
  shader = duplicatePipelinePass(shader, customPass.id)
  assert.equal(shader.pipeline.passes.length, initialPassCount + 2)

  // Update pass
  shader = updatePipelinePass(shader, customPass.id, pass => ({
    ...pass,
    opacity: 0.75,
    blendMode: 'color-dodge',
  }))
  const updated = shader.pipeline.passes.find(p => p.id === customPass.id)
  assert.equal(updated?.opacity, 0.75)
  assert.equal(updated?.blendMode, 'color-dodge')

  // Remove pass
  shader = removePipelinePass(shader, customPass.id)
  assert.equal(shader.pipeline.passes.length, initialPassCount + 1)
  assert.equal(shader.pipeline.passes.some(p => p.id === customPass.id), false)
})

test('pipeline reordering preserves pass configuration', () => {
  let shader = createShader('multi-pass')
  const p0 = shader.pipeline.passes[0]
  const p1 = shader.pipeline.passes[1]

  shader = reorderPipelinePasses(shader, 0, 1)
  assert.equal(shader.pipeline.passes[0].id, p1.id)
  assert.equal(shader.pipeline.passes[1].id, p0.id)
})

test('modulators: add, update, toggle, remove, and evaluate waveforms', () => {
  let shader = createShader('multi-pass')
  const liquidPass = shader.pipeline.passes.find(p => p.type === 'liquid-distortion')
  assert.ok(liquidPass)

  // Add modulator
  shader = addPipelineModulator(shader, {
    name: 'Liquid Warp LFO',
    targetPassId: liquidPass.id,
    targetParam: 'distortion',
    waveform: 'triangle',
    frequency: 1.5,
    amplitude: 0.3,
    offset: 0.25,
    enabled: true,
  })

  const newMod = shader.pipeline.modulators[shader.pipeline.modulators.length - 1]
  assert.equal(newMod.name, 'Liquid Warp LFO')
  assert.equal(newMod.waveform, 'triangle')

  // Toggle modulator
  shader = togglePipelineModulator(shader, newMod.id)
  assert.equal(shader.pipeline.modulators.find(m => m.id === newMod.id)?.enabled, false)
  shader = togglePipelineModulator(shader, newMod.id)
  assert.equal(shader.pipeline.modulators.find(m => m.id === newMod.id)?.enabled, true)

  // Update modulator
  shader = updatePipelineModulator(shader, newMod.id, m => ({
    ...m,
    frequency: 2.0,
    amplitude: 0.4,
  }))
  const modUpdated = shader.pipeline.modulators.find(m => m.id === newMod.id)
  assert.equal(modUpdated?.frequency, 2.0)
  assert.equal(modUpdated?.amplitude, 0.4)

  // Waveform evaluations across all types
  for (const wf of ['sine', 'triangle', 'sawtooth', 'pulse', 'noise']) {
    const val0 = evaluateWaveform(wf, 0)
    const val05 = evaluateWaveform(wf, 0.5)
    assert.ok(Number.isFinite(val0))
    assert.ok(Number.isFinite(val05))
    assert.ok(val0 >= -1.01 && val0 <= 1.01)
  }

  // Modulated value computation
  const modulated = computeModulatedValue(0.5, shader.pipeline.modulators, liquidPass.id, 'distortion', 1.0)
  assert.ok(Number.isFinite(modulated))

  // Remove modulator
  shader = removePipelineModulator(shader, newMod.id)
  assert.equal(shader.pipeline.modulators.some(m => m.id === newMod.id), false)
})

test('switching preset via loadPipelinePreset updates pipeline structure and synced params', () => {
  let shader = createShader('multi-pass')
  shader = loadPipelinePreset(shader, 'cyber-silk')
  assert.equal(shader.pipeline.preset, 'cyber-silk')
  assert.equal(shader.params.preset, 'cyber-silk')
  assert.deepEqual(shader.params.colors, PIPELINE_PRESETS['cyber-silk'].colors)
  assert.equal(shader.params.liquidDistortion, PIPELINE_PRESETS['cyber-silk'].liquidDistortion)
  validateShader(shader)
})

test('multiPassUniforms outputs accurate typed uniform map suitable for ShaderMount', () => {
  const shader = createShader('multi-pass')
  const uniforms = multiPassUniforms(shader, 500)

  assert.equal(typeof uniforms.u_scale, 'number')
  assert.equal(typeof uniforms.u_rotation, 'number')
  assert.ok(Array.isArray(uniforms.u_offset))
  assert.ok(Array.isArray(uniforms.u_mesh_colors))
  assert.equal(uniforms.u_mesh_colors.length, 10)
  assert.ok(Array.isArray(uniforms.u_mesh_anchors))
  assert.equal(uniforms.u_mesh_anchors.length, 10)
  assert.ok(Array.isArray(uniforms.u_glass_tint))

  assert.ok(typeof uniforms.u_mesh_turbulence === 'number')
  assert.ok(typeof uniforms.u_liquid_distortion === 'number')
  assert.ok(typeof uniforms.u_glass_refraction === 'number')
  assert.ok(typeof uniforms.u_chromatic_intensity === 'number')
  assert.ok(typeof uniforms.u_grain_intensity === 'number')
})

test('multiPassFragmentShader is a valid high-precision GLSL 3.00 ES shader', () => {
  assert.ok(multiPassFragmentShader.startsWith('#version 300 es'))
  assert.match(multiPassFragmentShader, /precision highp float;/)
  assert.match(multiPassFragmentShader, /out vec4 fragColor;/)
  assert.match(multiPassFragmentShader, /sampleMeshField/)
  assert.match(multiPassFragmentShader, /calculateLiquidFlow/)
  assert.match(multiPassFragmentShader, /calculateGlassRefraction/)
  assert.match(multiPassFragmentShader, /blendColors/)
  assert.match(multiPassFragmentShader, /void main\(\)/)
})

test('exportPipelineReact, exportPipelineGLSL, exportPipelineUniforms produce valid production code', () => {
  const shader = createShader('multi-pass')

  const reactCode = exportPipelineReact(shader)
  assert.match(reactCode, /import \{ ShaderMount \} from '@paper-design\/shaders-react'/)
  assert.match(reactCode, /const fragmentShader = `#version 300 es/)
  assert.match(reactCode, /export default function MaterialComposer\(\)/)

  const glslCode = exportPipelineGLSL()
  assert.equal(glslCode, multiPassFragmentShader)

  const uniformsCode = exportPipelineUniforms(shader)
  const parsedUniforms = JSON.parse(uniformsCode)
  assert.ok(parsedUniforms.u_scale !== undefined)
  assert.ok(parsedUniforms.u_pass_mesh_enabled !== undefined)

  const genericExport = exportShaderSource(shader)
  assert.equal(genericExport, reactCode)
})

test('multi-pass shader persists in SceneStore and survives serialization and undo/redo', () => {
  const store = new SceneStore()
  const shader = createShader('multi-pass')
  store.setBackgroundShader(shader)
  store.add('rectangle', { id: 'card', style: { shader } })

  const json = copy(store.toJSON())
  const restored = new SceneStore()
  restored.load(json)

  const restoredBg = restored.getSnapshot().backgroundShader
  assert.equal(restoredBg.kind, 'multi-pass')
  assert.equal(restoredBg.pipeline.passes.length, shader.pipeline.passes.length)
  assert.equal(restoredBg.pipeline.preset, 'prismatic-glass')

  // Parameter update via catalog
  const updatedShader = updateShaderParameter(restoredBg, 'liquidDistortion', 0.88)
  restored.update('card', 'rectangle', { style: { shader: updatedShader } })
  assert.equal(restored.getSnapshot().elements.card.style.shader.params.liquidDistortion, 0.88)
})

test('multi-pass shader conforms to MCP agent shaderSchema and rejects schema violations', () => {
  const shader = createShader('multi-pass')
  validateSchema(shader, shaderSchema)

  // Presets all validate against shaderSchema
  for (const key of presetKeys) {
    const s = loadPipelinePreset(shader, key)
    validateSchema(s, shaderSchema)
  }

  // Schema violations reject
  assert.throws(() => validateSchema({ ...shader, pipeline: { ...shader.pipeline, version: 2 } }, shaderSchema))
  assert.throws(() => validateSchema({ ...shader, pipeline: { ...shader.pipeline, passes: [{ ...shader.pipeline.passes[0], type: 'unknown-pass' }] } }, shaderSchema))
  assert.throws(() => validateSchema({ ...shader, pipeline: { ...shader.pipeline, passes: [{ ...shader.pipeline.passes[0], blendMode: 'invalid-blend' }] } }, shaderSchema))
  assert.throws(() => validateSchema({ ...shader, pipeline: { ...shader.pipeline, passes: [{ ...shader.pipeline.passes[0], opacity: 1.5 }] } }, shaderSchema))
  assert.throws(() => validateSchema({ ...shader, pipeline: { ...shader.pipeline, modulators: [{ ...shader.pipeline.modulators[0], waveform: 'invalid-wave' }] } }, shaderSchema))
})

test('pipeline validation rejects malformed structures atomically', () => {
  const shader = createShader('multi-pass')
  assert.throws(() => validatePipeline(null), /expected object/)
  assert.throws(() => validatePipeline({ ...shader.pipeline, version: 99 }), /Invalid shader pipeline version/)
  assert.throws(() => validatePipeline({ ...shader.pipeline, name: '' }), /Invalid shader pipeline name/)
  assert.throws(() => validatePipeline({ ...shader.pipeline, passes: [{ ...shader.pipeline.passes[0], type: 'bad' }] }), /Invalid pass type/)
  assert.throws(() => validatePipeline({ ...shader.pipeline, passes: [{ ...shader.pipeline.passes[0], opacity: -0.1 }] }), /Invalid pass opacity/)
  assert.throws(() => validatePipeline({ ...shader.pipeline, modulators: [{ ...shader.pipeline.modulators[0], frequency: 999 }] }), /Invalid modulator frequency/)
  assert.throws(() => validatePipeline({ ...shader.pipeline, modulators: [{ ...shader.pipeline.modulators[0], amplitude: 2.0 }] }), /Invalid modulator amplitude/)

  // Pipeline on non-multi-pass shader rejects
  assert.throws(() => validateShader({ ...createShader('neuro-noise'), pipeline: shader.pipeline }), /Invalid shader pipeline/)
})

