import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createShader, validateShader } from '../src/shaders/catalog.ts'
import { createDefaultPostProcessing, POST_PROCESSING_PRESETS } from '../src/canvas/postprocessing/presets.ts'
import { createPostProcessPass, validatePostProcessing } from '../src/canvas/postprocessing/model.ts'

test('all finishing presets validate, persist, own their parameters and survive undo/redo', () => {
  for (const preset of Object.keys(POST_PROCESSING_PRESETS)) {
    const pipeline = createDefaultPostProcessing(preset)
    validatePostProcessing(pipeline)
    const store = new SceneStore()
    store.add('rectangle', { id: 'shape' })
    const paint = { ...createShader('mesh-gradient'), postProcessing: pipeline }
    store.update('shape', 'rectangle', { style: { shader: paint } })
    pipeline.passes[0].params.intensity = 0
    const saved = store.getSnapshot().elements.shape.style.shader
    assert.notEqual(saved.postProcessing.passes[0].params.intensity, 0)
    assert.ok(Object.isFrozen(saved.postProcessing.passes[0].params))
    const document = JSON.parse(JSON.stringify(store.toJSON()))
    const restored = new SceneStore()
    restored.load(document)
    assert.deepEqual(restored.toJSON(), document)
    store.undo()
    assert.equal(store.getSnapshot().elements.shape.style.shader, null)
    store.redo()
    assert.deepEqual(store.getSnapshot().elements.shape.style.shader, saved)
  }
})

test('malformed stacks reject atomically, including pass limits, ranges and discriminants', () => {
  const store = new SceneStore()
  store.setBackgroundShader(createShader('mesh-gradient'))
  const before = store.getSnapshot()
  const valid = createDefaultPostProcessing()
  const bad = [null, {}, { ...valid, version: 2 }, { ...valid, enabled: 'yes' },
    { ...valid, passes: Array.from({ length: 9 }, () => createPostProcessPass('bloom')) },
    { ...valid, passes: [valid.passes[0], valid.passes[0]] }]
  for (const changes of [{ type: 'unknown' }, { opacity: NaN }, { opacity: '1' }, { opacity: 2 }, { enabled: 1 }, { blendMode: 'unknown' }, { params: { ...valid.passes[0].params, threshold: -1 } }, { params: {} }]) bad.push({ ...valid, passes: [{ ...valid.passes[0], ...changes }] })
  for (const postProcessing of bad) {
    const shader = { ...createShader('mesh-gradient'), postProcessing }
    assert.throws(() => store.setBackgroundShader(shader), /Invalid shader post-processing/)
    assert.equal(store.getSnapshot(), before)
  }
  validateShader(createShader('mesh-gradient')) // Legacy documents have no stack.
  const passes = ['bloom', 'film-grain', 'vignette', 'chromatic-aberration', 'color-grade', 'frosted-glass', 'procedural-grain'].map(createPostProcessPass)
  validatePostProcessing({ version: 1, enabled: true, preset: 'custom', passes })
})

test('frosted-glass post-processing pass validates parameters and pattern profiles', () => {
  const pass = createPostProcessPass('frosted-glass')
  assert.equal(pass.type, 'frosted-glass')
  assert.equal(pass.name, 'Frosted glass')
  assert.equal(pass.params.refractionIndex, 1.52)
  assert.equal(pass.params.dispersion, 0.35)
  assert.equal(pass.params.surfacePattern, 'frosted')

  // Valid pipeline with frosted glass
  const pipeline = {
    version: 1,
    enabled: true,
    preset: 'custom',
    passes: [pass],
  }
  validatePostProcessing(pipeline)

  // Pattern variations (smooth, frosted, fluted, rippled, faceted)
  for (const pattern of ['smooth', 'frosted', 'fluted', 'rippled', 'faceted']) {
    validatePostProcessing({
      ...pipeline,
      passes: [{ ...pass, params: { ...pass.params, surfacePattern: pattern } }],
    })
  }

  // Reject invalid patterns or bounds
  assert.throws(() => validatePostProcessing({
    ...pipeline,
    passes: [{ ...pass, params: { ...pass.params, surfacePattern: 'invalid-pattern' } }],
  }), /Invalid shader post-processing/)

  assert.throws(() => validatePostProcessing({
    ...pipeline,
    passes: [{ ...pass, params: { ...pass.params, refractionIndex: 0.8 } }], // below 1.0
  }), /Invalid shader post-processing/)

  assert.throws(() => validatePostProcessing({
    ...pipeline,
    passes: [{ ...pass, params: { ...pass.params, refractionIndex: 3.5 } }], // above 2.5
  }), /Invalid shader post-processing/)

  assert.throws(() => validatePostProcessing({
    ...pipeline,
    passes: [{ ...pass, params: { ...pass.params, tintColor: 'not-a-color' } }],
  }), /Invalid shader post-processing/)
})

test('procedural-grain post-processing pass validates noise generators and uniforms', () => {
  const pass = createPostProcessPass('procedural-grain')
  assert.equal(pass.type, 'procedural-grain')
  assert.equal(pass.name, 'Procedural grain')
  assert.equal(pass.params.noiseType, 'simplex')
  assert.equal(pass.params.octaves, 3)
  assert.equal(pass.params.temporal, true)

  const pipeline = {
    version: 1,
    enabled: true,
    preset: 'custom',
    passes: [pass],
  }
  validatePostProcessing(pipeline)

  // All 4 noise algorithms validate
  for (const noiseType of ['simplex', 'perlin', 'worley', 'hash']) {
    validatePostProcessing({
      ...pipeline,
      passes: [{ ...pass, params: { ...pass.params, noiseType } }],
    })
  }

  // Reject invalid noise algorithm or out-of-range octaves
  assert.throws(() => validatePostProcessing({
    ...pipeline,
    passes: [{ ...pass, params: { ...pass.params, noiseType: 'fbm-unknown' } }],
  }), /Invalid shader post-processing/)

  assert.throws(() => validatePostProcessing({
    ...pipeline,
    passes: [{ ...pass, params: { ...pass.params, octaves: 0 } }],
  }), /Invalid shader post-processing/)

  assert.throws(() => validatePostProcessing({
    ...pipeline,
    passes: [{ ...pass, params: { ...pass.params, octaves: 8 } }],
  }), /Invalid shader post-processing/)

  assert.throws(() => validatePostProcessing({
    ...pipeline,
    passes: [{ ...pass, params: { ...pass.params, intensity: -0.1 } }],
  }), /Invalid shader post-processing/)
})

test('curated frosted glass and procedural grain presets instantiate with authentic uniforms', () => {
  const targetPresets = [
    'frosted-acrylic',
    'prismatic-glass',
    'architectural-fluted',
    'procedural-paper-grain',
    'cyber-glitch-glass',
    'etched-frosted-minimal',
  ]

  for (const presetKey of targetPresets) {
    const pipeline = createDefaultPostProcessing(presetKey)
    assert.equal(pipeline.preset, presetKey)
    assert.ok(pipeline.passes.length >= 2, `${presetKey} should have at least 2 passes`)
    validatePostProcessing(pipeline)

    // Check presence of frosted-glass, procedural-grain, or chromatic-aberration in curated presets
    const hasFrostedGlass = pipeline.passes.some(p => p.type === 'frosted-glass')
    const hasProceduralGrain = pipeline.passes.some(p => p.type === 'procedural-grain')
    const hasChromatic = pipeline.passes.some(p => p.type === 'chromatic-aberration')

    assert.ok(
      hasFrostedGlass || hasProceduralGrain || hasChromatic,
      `${presetKey} must include frosted glass, procedural grain, or chromatic aberration`
    )
  }
})

