import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
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
  MATERIAL_PRESETS,
  MATERIAL_PRESETS_MAP,
  createDefaultMaterialParams,
  getMaterialPreset,
} from '../src/shaders/materials/presets.ts'
import {
  materialFragmentShader,
  materialUniforms,
} from '../src/shaders/materials/materialFragment.ts'
import {
  calculateBackdropBlurKernel,
  calculateCauchyIOR,
  calculateRefractionVector,
  calculateThinFilmInterference,
  curlNoise2D,
  evaluateFresnel,
  evaluateLiquidWarp,
  evaluateProceduralGrain,
  sampleBackdropScene,
  sampleMaterialPalette,
} from '../src/shaders/materials/math.ts'
import { exportMaterialReact } from '../src/shaders/materials/materialExport.ts'
import { exportShaderSource } from '../src/shaders/shaderExport.ts'
import { shaderSchema, validateSchema } from '../src/mcp/schema.ts'

const clone = val => JSON.parse(JSON.stringify(val))

test('shader-material is registered in shaderKinds and shaderCatalog with complete controls', () => {
  assert.ok(shaderKinds.includes('shader-material'), 'shader-material must be in shaderKinds')
  const def = shaderCatalog['shader-material']
  assert.ok(def, 'Definition must exist in shaderCatalog')
  assert.equal(def.label, 'Material Presets')

  const controlKeys = def.controls.map(c => c.key)
  const expectedControls = [
    'presetId',
    'refractionIndex',
    'dispersionSpread',
    'frequency',
    'mouseReactivity',
    'roughness',
    'filmThickness',
    'iridescence',
    'fluidViscosity',
    'grainScale',
    'grainIntensity',
    'colors',
    'tintColor',
    'highlightColor',
    'lightAngle',
    'specularStrength',
    'blendRatio',
  ]
  for (const exp of expectedControls) {
    assert.ok(controlKeys.includes(exp), `Catalog controls must include ${exp}`)
  }
})

test('createShader creates a valid, frozen shader-material paint with default optics', () => {
  const paint = createShader('shader-material')
  assert.equal(paint.kind, 'shader-material')
  assert.ok(paint.animated)
  assert.equal(paint.speed, 0.35)
  assert.equal(paint.scale, 1)
  assert.ok(Object.isFrozen(paint))
  assert.ok(Object.isFrozen(paint.params))
  assert.ok(Object.isFrozen(paint.params.colors))

  validateShader(paint)

  // Verify numerical optical ranges
  assert.ok(paint.params.refractionIndex >= 1.0 && paint.params.refractionIndex <= 2.8)
  assert.ok(paint.params.dispersionSpread >= 0.0 && paint.params.dispersionSpread <= 1.0)
  assert.ok(paint.params.frequency >= 0.1 && paint.params.frequency <= 20.0)
  assert.ok(paint.params.roughness >= 0.0 && paint.params.roughness <= 1.0)
  assert.ok(paint.params.filmThickness >= 100 && paint.params.filmThickness <= 1200)
  assert.ok(paint.params.iridescence >= 0.0 && paint.params.iridescence <= 1.0)
  assert.ok(paint.params.fluidViscosity >= 0.0 && paint.params.fluidViscosity <= 1.0)
  assert.ok(paint.params.grainScale >= 0.5 && paint.params.grainScale <= 10.0)
  assert.ok(paint.params.grainIntensity >= 0.0 && paint.params.grainIntensity <= 1.0)
  assert.ok(paint.params.colors.length >= 2 && paint.params.colors.length <= 8)
})

test('all 10 material presets are valid, uniquely keyed, and pass validateShader', () => {
  assert.equal(MATERIAL_PRESETS.length, 10, 'Must have exactly 10 production material presets')
  const seenIds = new Set()

  for (const preset of MATERIAL_PRESETS) {
    assert.ok(!seenIds.has(preset.id), `Duplicate preset id: ${preset.id}`)
    seenIds.add(preset.id)

    assert.ok(preset.name.length > 0, 'Preset must have a name')
    assert.ok(preset.description.length > 0, 'Preset must have a description')
    assert.ok(preset.tags.length > 0, 'Preset must have searchable tags')
    assert.ok(
      ['Optical', 'Dispersion', 'Fluid', 'Tactile', 'Atmospheric'].includes(preset.category),
      `Valid category required: ${preset.category}`
    )

    const params = createDefaultMaterialParams(preset.id)
    const paint = {
      ...createShader('shader-material'),
      params,
    }
    assert.doesNotThrow(() => validateShader(paint), `Preset ${preset.id} must pass validateShader`)

    // Verify lookup helper
    const retrieved = getMaterialPreset(preset.id)
    assert.equal(retrieved.id, preset.id)
  }

  // Fallback for unknown preset
  const fallback = getMaterialPreset('non-existent-preset')
  assert.equal(fallback.id, 'iridescent-film')
})

test('mathematical algorithms: Cauchy dispersion evaluates spectral wavelength separation', () => {
  const baseIOR = 1.52 // Crown glass
  const dispersion = 0.5

  const iorRed = calculateCauchyIOR(baseIOR, dispersion, 'r')
  const iorGreen = calculateCauchyIOR(baseIOR, dispersion, 'g')
  const iorBlue = calculateCauchyIOR(baseIOR, dispersion, 'b')

  assert.ok(iorRed < iorGreen, 'Red wavelength must refract less than Green')
  assert.ok(iorGreen < iorBlue, 'Green wavelength must refract less than Blue')
  assert.equal(iorGreen, baseIOR, 'Green reference IOR must match base IOR')

  // Zero dispersion should produce identical IOR across channels
  assert.equal(calculateCauchyIOR(1.5, 0.0, 'r'), 1.5)
  assert.equal(calculateCauchyIOR(1.5, 0.0, 'g'), 1.5)
  assert.equal(calculateCauchyIOR(1.5, 0.0, 'b'), 1.5)
})

test('mathematical algorithms: Snell-Descartes vector refraction and total internal reflection', () => {
  // Normal incidence (0, 0, 1) through glass (IOR 1.5)
  const refrNormal = calculateRefractionVector(0, 0, 1, 1.5)
  assert.ok(Math.abs(refrNormal.x) < 0.001)
  assert.ok(Math.abs(refrNormal.y) < 0.001)
  assert.ok(refrNormal.z < 0, 'Refracted ray must propagate through surface')

  // Glancing angle with total internal reflection
  const refrGlancing = calculateRefractionVector(0.99, 0, 0.1, 1.5)
  assert.ok(Number.isFinite(refrGlancing.x))
  assert.ok(Number.isFinite(refrGlancing.y))
  assert.ok(Number.isFinite(refrGlancing.z))
})

test('mathematical algorithms: Thin-film optical interference evaluates Airy formula', () => {
  for (let thickness = 100; thickness <= 1000; thickness += 150) {
    const irid = calculateThinFilmInterference(0.8, thickness, 1.45)
    assert.ok(irid.r >= 0.0 && irid.r <= 1.0, `Red interference must be in [0, 1]: ${irid.r}`)
    assert.ok(irid.g >= 0.0 && irid.g <= 1.0, `Green interference must be in [0, 1]: ${irid.g}`)
    assert.ok(irid.b >= 0.0 && irid.b <= 1.0, `Blue interference must be in [0, 1]: ${irid.b}`)
  }
})

test('mathematical algorithms: Schlick Fresnel reflectance', () => {
  const ior = 1.5
  // Grazing angle (cosTheta -> 0) -> reflectance -> 1.0
  const grazing = evaluateFresnel(0.0, ior)
  assert.ok(Math.abs(grazing - 1.0) < 0.001, 'Grazing angle reflectance must approach 1.0')

  // Normal incidence (cosTheta = 1.0) -> f0 = ((1.5-1)/(1.5+1))^2 = (0.5/2.5)^2 = 0.04
  const normal = evaluateFresnel(1.0, ior)
  assert.ok(Math.abs(normal - 0.04) < 0.001, 'Normal incidence reflectance must equal f0')
})

test('mathematical algorithms: Curl noise and liquid warp distortion field', () => {
  const curl = curlNoise2D(1.5, 2.5)
  assert.ok(Number.isFinite(curl.x), 'Curl noise x must be finite')
  assert.ok(Number.isFinite(curl.y), 'Curl noise y must be finite')

  const warpLowVisc = evaluateLiquidWarp(0.5, 0.5, 10.0, 2.0, 0.1)
  const warpHighVisc = evaluateLiquidWarp(0.5, 0.5, 10.0, 2.0, 0.9)

  assert.ok(Number.isFinite(warpLowVisc.dx) && Number.isFinite(warpLowVisc.dy))
  assert.ok(Number.isFinite(warpHighVisc.dx) && Number.isFinite(warpHighVisc.dy))

  // Higher viscosity dampens fluid wave amplitude
  const ampLow = Math.hypot(warpLowVisc.dx, warpLowVisc.dy)
  const ampHigh = Math.hypot(warpHighVisc.dx, warpHighVisc.dy)
  assert.ok(ampHigh <= ampLow + 0.001, 'High viscosity must dampen fluid displacement')
})

test('mathematical algorithms: Procedural grain and Poisson-disc backdrop blur kernel', () => {
  const grain = evaluateProceduralGrain(100, 200, 1.0, 2.0, 0.5)
  assert.ok(Number.isFinite(grain))
  assert.ok(Math.abs(grain) <= 0.5 * 0.35 + 0.001, 'Grain amplitude must be bounded by intensity')

  const kernel = calculateBackdropBlurKernel(0.05, 16)
  assert.equal(kernel.length, 16)
  const sumWeights = kernel.reduce((acc, t) => acc + t.weight, 0)
  assert.ok(Math.abs(sumWeights - 1.0) < 0.001, 'Kernel weights must sum to 1.0')

  for (const tap of kernel) {
    assert.ok(Number.isFinite(tap.offset[0]))
    assert.ok(Number.isFinite(tap.offset[1]))
    assert.ok(tap.weight > 0)
  }
})

test('mathematical algorithms: Backdrop scene and smooth palette interpolation', () => {
  const sceneSample = sampleBackdropScene(0.5, 0.5)
  assert.ok(sceneSample.r >= 0 && sceneSample.r <= 1)
  assert.ok(sceneSample.g >= 0 && sceneSample.g <= 1)
  assert.ok(sceneSample.b >= 0 && sceneSample.b <= 1)

  const colors = ['#080808', '#81adec', '#edebe1']
  const startColor = sampleMaterialPalette(colors, 0.0)
  const midColor = sampleMaterialPalette(colors, 0.5)
  const endColor = sampleMaterialPalette(colors, 1.0)

  assert.ok(startColor.r < midColor.r)
  assert.ok(endColor.r > startColor.r)
})

test('materialUniforms produces valid WebGL uniforms for shader-material', () => {
  const paint = createShader('shader-material')
  const uniforms = materialUniforms(paint)

  assert.equal(uniforms.u_scale, 1)
  assert.equal(uniforms.u_rotation, 0)
  assert.deepEqual(uniforms.u_offset, [0, 0])
  assert.equal(uniforms.u_refractionIndex, paint.params.refractionIndex)
  assert.equal(uniforms.u_dispersionSpread, paint.params.dispersionSpread)
  assert.equal(uniforms.u_frequency, paint.params.frequency)
  assert.equal(uniforms.u_mouseReactivity, paint.params.mouseReactivity)
  assert.equal(uniforms.u_roughness, paint.params.roughness)
  assert.equal(uniforms.u_filmThickness, paint.params.filmThickness)
  assert.equal(uniforms.u_iridescence, paint.params.iridescence)
  assert.equal(uniforms.u_fluidViscosity, paint.params.fluidViscosity)
  assert.equal(uniforms.u_grainScale, paint.params.grainScale)
  assert.equal(uniforms.u_grainIntensity, paint.params.grainIntensity)
  assert.equal(uniforms.u_lightAngle, paint.params.lightAngle)
  assert.equal(uniforms.u_specularStrength, paint.params.specularStrength)
  assert.equal(uniforms.u_blendRatio, paint.params.blendRatio)

  assert.equal(uniforms.u_colorCount, paint.params.colors.length)
  assert.equal(uniforms.u_colors.length, 8)
  assert.equal(uniforms.u_tintColor.length, 3)
  assert.equal(uniforms.u_highlightColor.length, 3)
})

test('exportMaterialReact generates production TypeScript component that compiles cleanly', () => {
  const paint = createShader('shader-material')
  const code = exportMaterialReact(paint)

  assert.ok(code.includes("import { ShaderMount } from '@paper-design/shaders-react'"))
  assert.ok(code.includes('IridescentFilmMaterial'))
  assert.ok(code.includes('fragmentShader'))
  assert.ok(code.includes('initialUniforms'))

  // Verify generic exporter dispatch
  const exported = exportShaderSource(paint)
  assert.equal(exported, code)

  // Verify TypeScript compilation
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.ok(transpiled.outputText.length > 500, 'Compiled output must contain valid JavaScript code')
  assert.equal(transpiled.diagnostics?.length ?? 0, 0, 'Must compile with zero TypeScript diagnostics')
})

test('SceneStore integrates shader-material on layers and background with undo/redo and JSON persistence', () => {
  const store = new SceneStore()
  const paint = createShader('shader-material')
  store.setBackgroundShader(paint)

  const rect = store.add('rectangle', {
    id: 'mat-card',
    x: 40,
    y: 40,
    width: 200,
    height: 160,
    style: { shader: paint },
  })

  const doc = clone(store.toJSON())
  const restored = new SceneStore()
  restored.load(doc)

  assert.deepEqual(restored.toJSON(), doc)
  const bgShader = restored.getSnapshot().backgroundShader
  assert.equal(bgShader.kind, 'shader-material')
  assert.equal(bgShader.params.presetId, 'iridescent-film')
  assert.ok(Object.isFrozen(bgShader.params))

  // Test parameter updates
  store.beginTransaction('Update frequency')
  const updated = updateShaderParameter(paint, 'frequency', 5.5)
  store.update('mat-card', 'rectangle', { style: { shader: updated } })
  store.endTransaction()

  assert.equal(store.getSnapshot().elements['mat-card'].style.shader.params.frequency, 5.5)

  store.undo()
  assert.equal(store.getSnapshot().elements['mat-card'].style.shader.params.frequency, paint.params.frequency)

  store.redo()
  assert.equal(store.getSnapshot().elements['mat-card'].style.shader.params.frequency, 5.5)

  // Test preset switching
  const caustics = updateShaderParameter(paint, 'presetId', 'liquid-caustics')
  assert.equal(caustics.params.presetId, 'liquid-caustics')
  assert.equal(caustics.params.refractionIndex, 1.33)
  validateShader(caustics)
})

test('validateShader strictly rejects out-of-range parameters and malformed inputs', () => {
  const base = createShader('shader-material')

  // Non-finite values
  assert.throws(() => validateShader({ ...base, params: { ...base.params, frequency: NaN } }))
  assert.throws(() => validateShader({ ...base, params: { ...base.params, refractionIndex: Infinity } }))

  // Out of range values
  assert.throws(() => validateShader({ ...base, params: { ...base.params, refractionIndex: 0.5 } })) // min is 1.0
  assert.throws(() => validateShader({ ...base, params: { ...base.params, refractionIndex: 3.5 } })) // max is 2.8
  assert.throws(() => validateShader({ ...base, params: { ...base.params, dispersionSpread: -0.1 } }))
  assert.throws(() => validateShader({ ...base, params: { ...base.params, dispersionSpread: 1.5 } }))
  assert.throws(() => validateShader({ ...base, params: { ...base.params, roughness: 1.2 } }))

  // Invalid colors
  assert.throws(() => validateShader({ ...base, params: { ...base.params, tintColor: 'red' } }))
  assert.throws(() => validateShader({ ...base, params: { ...base.params, colors: ['#edebe1'] } })) // min 2 colors
  assert.throws(() => validateShader({ ...base, params: { ...base.params, colors: Array(9).fill('#edebe1') } })) // max 8 colors

  // Invalid parameter count
  assert.throws(() => validateShader({ ...base, params: { ...base.params, extraParam: 123 } }))
})

test('mcp schema accepts and validates shader-material paint specifications', () => {
  const paint = createShader('shader-material')
  assert.doesNotThrow(() => validateSchema(shaderSchema, paint))
})
