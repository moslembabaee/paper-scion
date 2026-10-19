import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import {
  createShader,
  freezeShader,
  shaderCatalog,
  shaderKinds,
  updateShaderParameter,
  validateShader,
} from '../src/shaders/catalog.ts'
import {
  GENERATIVE_PRESETS,
  createDefaultGenerativeParams,
  getGenerativePreset,
  generativePresetKeys,
} from '../src/shaders/generative/presets.ts'
import {
  generativeFragmentShader,
  generativeUniforms,
} from '../src/shaders/generative/generativeFragment.ts'
import {
  evaluateChromaticAberration,
  evaluateGenerativeField,
  fbm2D,
  sampleColorStops,
  smoothNoise2D,
} from '../src/shaders/generative/math.ts'
import { exportGenerativeGLSL, exportGenerativeReact } from '../src/shaders/generative/generativeExport.ts'
import { exportShaderSource } from '../src/shaders/shaderExport.ts'
import { shaderSchema, validateSchema } from '../src/mcp/schema.ts'

const clone = val => JSON.parse(JSON.stringify(val))

test('generative-material is registered in shaderKinds and shaderCatalog with exact required controls', () => {
  assert.ok(shaderKinds.includes('generative-material'), 'generative-material must be in shaderKinds')
  const def = shaderCatalog['generative-material']
  assert.ok(def, 'Definition must exist in shaderCatalog')
  assert.equal(def.label, 'Generative Material')

  const controlKeys = def.controls.map(c => c.key)
  const required = ['grainIntensity', 'fluidDistortion', 'chromaticAberration', 'turbulenceSpeed', 'colorStops']
  for (const req of required) {
    assert.ok(controlKeys.includes(req), `Catalog controls must include ${req}`)
  }
})

test('createShader creates a valid, frozen generative-material paint with defaults', () => {
  const paint = createShader('generative-material')
  assert.equal(paint.kind, 'generative-material')
  assert.ok(paint.animated)
  assert.equal(paint.speed, 0.35)
  assert.equal(paint.scale, 1)
  assert.ok(Object.isFrozen(paint))
  assert.ok(Object.isFrozen(paint.params))
  assert.ok(Object.isFrozen(paint.params.colorStops))

  validateShader(paint)
  assert.ok(paint.params.colorStops.length >= 2, 'Default color stops must have at least 2 colors')
  assert.ok(paint.params.grainIntensity >= 0 && paint.params.grainIntensity <= 1)
  assert.ok(paint.params.fluidDistortion >= 0 && paint.params.fluidDistortion <= 1)
  assert.ok(paint.params.chromaticAberration >= 0 && paint.params.chromaticAberration <= 1)
  assert.ok(paint.params.turbulenceSpeed >= 0 && paint.params.turbulenceSpeed <= 3)
})

test('all generative presets are valid and can be instantiated', () => {
  for (const presetKey of generativePresetKeys) {
    const preset = getGenerativePreset(presetKey)
    assert.ok(preset, `Preset ${presetKey} must exist`)
    assert.equal(preset.id, presetKey)
    assert.ok(preset.name.length > 0)
    assert.ok(preset.params.colorStops.length >= 2)

    const params = createDefaultGenerativeParams(presetKey)
    const paint = {
      ...createShader('generative-material'),
      params,
    }
    assert.doesNotThrow(() => validateShader(paint), `Preset ${presetKey} must pass validateShader`)
  }
})

test('updateShaderParameter cleanly updates preset and parameters with validation', () => {
  const paint = createShader('generative-material')
  const updatedPreset = updateShaderParameter(paint, 'preset', 'cosmic-nebula')
  assert.equal(updatedPreset.params.preset, 'cosmic-nebula')
  assert.deepEqual(updatedPreset.params.colorStops, getGenerativePreset('cosmic-nebula').params.colorStops)
  validateShader(updatedPreset)

  const updatedGrain = updateShaderParameter(updatedPreset, 'grainIntensity', 0.85)
  assert.equal(updatedGrain.params.grainIntensity, 0.85)
  validateShader(updatedGrain)

  const updatedDistortion = updateShaderParameter(updatedGrain, 'fluidDistortion', 0.95)
  assert.equal(updatedDistortion.params.fluidDistortion, 0.95)
  validateShader(updatedDistortion)

  const updatedAberration = updateShaderParameter(updatedDistortion, 'chromaticAberration', 0.72)
  assert.equal(updatedAberration.params.chromaticAberration, 0.72)
  validateShader(updatedAberration)

  const updatedTurbulence = updateShaderParameter(updatedAberration, 'turbulenceSpeed', 2.4)
  assert.equal(updatedTurbulence.params.turbulenceSpeed, 2.4)
  validateShader(updatedTurbulence)

  const newColors = ['#ff0055', '#7700ff', '#00ffff']
  const updatedColors = updateShaderParameter(updatedTurbulence, 'colorStops', newColors)
  assert.deepEqual(updatedColors.params.colorStops, newColors)
  validateShader(updatedColors)
})

test('invalid parameters and boundary violations reject atomically', () => {
  const paint = createShader('generative-material')

  // Grain intensity out of bounds
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, grainIntensity: -0.1 } }), /Invalid shader grainIntensity/)
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, grainIntensity: 1.5 } }), /Invalid shader grainIntensity/)
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, grainIntensity: NaN } }), /Invalid shader grainIntensity/)

  // Fluid distortion out of bounds
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, fluidDistortion: -0.01 } }), /Invalid shader fluidDistortion/)
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, fluidDistortion: 1.2 } }), /Invalid shader fluidDistortion/)

  // Chromatic aberration out of bounds
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, chromaticAberration: -0.5 } }), /Invalid shader chromaticAberration/)
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, chromaticAberration: 2.0 } }), /Invalid shader chromaticAberration/)

  // Turbulence speed out of bounds
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, turbulenceSpeed: -1 } }), /Invalid shader turbulenceSpeed/)
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, turbulenceSpeed: 3.5 } }), /Invalid shader turbulenceSpeed/)

  // Color stops violations
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, colorStops: ['#ff0000'] } }), /Invalid shader colorStops/) // < 2 colors
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, colorStops: ['not-a-hex', '#00ff00'] } }), /Invalid shader colorStops/)
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, colorStops: Array(9).fill('#ffffff') } }), /Invalid shader colorStops/) // > 8 colors

  // Octaves integer requirement
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, octaves: 3.5 } }), /Invalid shader octaves/)

  // Unknown preset
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, preset: 'unknown-preset' } }), /Invalid shader preset/)

  // Missing or extra parameter
  const withoutOctaves = { ...paint.params }
  delete withoutOctaves.octaves
  assert.throws(() => validateShader({ ...paint, params: withoutOctaves }), /Invalid shader parameter count/)
  assert.throws(() => validateShader({ ...paint, params: { ...paint.params, extraParam: 123 } }), /Invalid shader parameter count/)
})

test('scene store serializes, loads and restores generative-material paints', () => {
  const store = new SceneStore()
  const shader = createShader('generative-material')
  store.setBackgroundShader(shader)
  const rect = store.add('rectangle', { id: 'card', style: { shader } })
  const ellipse = store.add('ellipse', { id: 'circle', style: { shader } })

  const json = clone(store.toJSON())
  const restored = new SceneStore()
  restored.load(json)

  assert.equal(restored.getSnapshot().backgroundShader.kind, 'generative-material')
  assert.deepEqual(restored.getSnapshot().backgroundShader.params, shader.params)
  assert.equal(restored.getSnapshot().elements.card.style.shader.kind, 'generative-material')
  assert.equal(restored.getSnapshot().elements.circle.style.shader.kind, 'generative-material')

  // Verify deep immutability
  assert.ok(Object.isFrozen(restored.getSnapshot().elements.card.style.shader.params))
  assert.ok(Object.isFrozen(restored.getSnapshot().elements.card.style.shader.params.colorStops))
})

test('generative shader supports undo, redo, and transactions seamlessly', () => {
  const store = new SceneStore()
  const baseShader = createShader('generative-material')
  store.add('rectangle', { id: 'hero', style: { shader: baseShader } })

  const initial = store.getSnapshot().elements.hero.style.shader

  store.beginTransaction('Update generative parameters')
  const nextShader = updateShaderParameter(baseShader, 'grainIntensity', 0.5)
  store.update('hero', 'rectangle', { style: { shader: nextShader } })
  store.endTransaction()

  assert.equal(store.getSnapshot().elements.hero.style.shader.params.grainIntensity, 0.5)

  store.undo()
  assert.equal(store.getSnapshot().elements.hero.style.shader.params.grainIntensity, initial.params.grainIntensity)

  store.redo()
  assert.equal(store.getSnapshot().elements.hero.style.shader.params.grainIntensity, 0.5)
})

test('math module evaluates smooth noise, fbm, and fluid warping deterministically', () => {
  for (let x = 0; x < 5; x += 0.8) {
    for (let y = 0; y < 5; y += 0.8) {
      const n = smoothNoise2D(x, y)
      assert.ok(n >= 0 && n <= 1, `smoothNoise2D should be in [0, 1], got ${n}`)
      const f = fbm2D(x, y, 4)
      assert.ok(f >= 0 && f <= 1, `fbm2D should be in [0, 1], got ${f}`)
    }
  }

  const params = createDefaultGenerativeParams('aurora-borealis')
  const field1 = evaluateGenerativeField(0.5, 0.5, params, 1000)
  const field2 = evaluateGenerativeField(0.5, 0.5, params, 1000)
  assert.equal(field1, field2, 'evaluateGenerativeField must be deterministic given identical inputs')
  assert.ok(field1 >= 0 && field1 <= 1, `field value must be in [0, 1], got ${field1}`)

  // Color stop sampling
  const colors = ['#000000', '#ffffff']
  const atZero = sampleColorStops(0, colors)
  assert.equal(atZero.r, 0)
  assert.equal(atZero.g, 0)
  assert.equal(atZero.b, 0)

  const atOne = sampleColorStops(1, colors)
  assert.equal(atOne.r, 1)
  assert.equal(atOne.g, 1)
  assert.equal(atOne.b, 1)

  const atMid = sampleColorStops(0.5, colors)
  assert.ok(Math.abs(atMid.r - 0.5) < 0.05, `Midpoint should be ~0.5, got ${atMid.r}`)

  // Chromatic aberration evaluation
  const ca = evaluateChromaticAberration(0.5, 0.5, params, 500)
  assert.ok(ca.r >= 0 && ca.r <= 1)
  assert.ok(ca.g >= 0 && ca.g <= 1)
  assert.ok(ca.b >= 0 && ca.b <= 1)
  assert.ok(ca.a >= 0 && ca.a <= 1)
})

test('generativeFragmentShader and generativeUniforms build valid GLSL uniforms', () => {
  assert.ok(generativeFragmentShader.includes('#version 300 es'), 'Shader must be GLSL 3.00 ES')
  assert.ok(generativeFragmentShader.includes('uniform float u_grainIntensity;'))
  assert.ok(generativeFragmentShader.includes('uniform float u_fluidDistortion;'))
  assert.ok(generativeFragmentShader.includes('uniform float u_chromaticAberration;'))
  assert.ok(generativeFragmentShader.includes('uniform float u_turbulenceSpeed;'))
  assert.ok(generativeFragmentShader.includes('uniform vec4 u_colors[8];'))

  const paint = createShader('generative-material')
  const uniforms = generativeUniforms(paint, { x: 0.3, y: 0.7, active: true })

  assert.equal(uniforms.u_grainIntensity, paint.params.grainIntensity)
  assert.equal(uniforms.u_fluidDistortion, paint.params.fluidDistortion)
  assert.equal(uniforms.u_chromaticAberration, paint.params.chromaticAberration)
  assert.equal(uniforms.u_turbulenceSpeed, paint.params.turbulenceSpeed)
  assert.equal(uniforms.u_octaves, paint.params.octaves)
  assert.equal(uniforms.u_colorCount, paint.params.colorStops.length)
  assert.equal(uniforms.u_colors.length, 8, 'u_colors uniform array must have length 8')
  assert.deepEqual(uniforms.u_mouse, [0.3, 0.7])
  assert.equal(uniforms.u_mouseActive, 1.0)
})

test('code export outputs standalone React and GLSL packages', () => {
  const paint = createShader('generative-material')
  const reactCode = exportShaderSource(paint)
  assert.ok(reactCode.includes('@paper-design/shaders-react'), 'Export must import from @paper-design/shaders-react')
  assert.ok(reactCode.includes('ShaderMount'), 'Export must utilize ShaderMount')
  assert.ok(reactCode.includes('u_grainIntensity'), 'Exported uniforms must contain u_grainIntensity')

  const standaloneReact = exportGenerativeReact(paint)
  assert.ok(standaloneReact.includes('export default function'))
  assert.ok(standaloneReact.includes('ShaderMount'))

  const standaloneGLSL = exportGenerativeGLSL()
  assert.ok(standaloneGLSL.includes('sampleGenerativeField'))
  assert.ok(standaloneGLSL.includes('#version 300 es'))
})

test('mcp shaderSchema validates generative-material payloads', () => {
  const paint = createShader('generative-material')
  assert.doesNotThrow(() => validateSchema(paint, shaderSchema))
})
