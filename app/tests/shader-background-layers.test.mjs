import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createShader, freezeShader, updateShaderParameter, validateShader } from '../src/shaders/catalog.ts'
import {
  clampUnit,
  createMeshMaterial,
  defaultMeshAnchor,
  generateGridLayout,
  generateRadialLayout,
  generateWaveLayout,
  interpolateMeshColor,
  smoothMeshColors,
  synthesizeProceduralColorField,
  validateMeshMaterial,
} from '../src/shaders/mesh.ts'
import {
  sampleMultiOctaveNoise,
  evaluateNormalPerturbation,
  evaluateProceduralNoiseColor,
  PROCEDURAL_NOISE_PRESETS,
} from '../src/shaders/noise/proceduralNoise.ts'
import { proceduralNoiseUniforms } from '../src/shaders/noise/noiseFragment.ts'
import { meshUniforms } from '../src/shaders/mesh.ts'
import { shaderBlendModes, grainBlendModes, noiseGenerators } from '../src/shaders/types.ts'
import { sceneToSVG } from '../src/io/svg.ts'

const clone = value => JSON.parse(JSON.stringify(value))

test('canvas background layers can be added, updated, reordered, and removed in SceneStore', () => {
  const store = new SceneStore()
  assert.equal(store.getSnapshot().backgroundShader, null)
  assert.equal(Boolean(store.getSnapshot().backgroundLayers?.length), false)

  const meshPaint = createShader('mesh-gradient')
  const noisePaint = createShader('procedural-noise')

  // 1. Add mesh gradient layer
  store.addBackgroundLayer(meshPaint)
  let snap = store.getSnapshot()
  assert.equal(snap.backgroundLayers?.length, 1)
  assert.equal(snap.backgroundLayers?.[0].kind, 'mesh-gradient')
  assert.equal(snap.backgroundShader?.kind, 'mesh-gradient')

  // 2. Add procedural noise layer with overlay blend mode
  const noiseWithBlend = {
    ...noisePaint,
    composite: { blendMode: 'overlay', opacity: 0.6 },
  }
  store.addBackgroundLayer(noiseWithBlend)
  snap = store.getSnapshot()
  assert.equal(snap.backgroundLayers?.length, 2)
  assert.equal(snap.backgroundLayers?.[0].kind, 'mesh-gradient')
  assert.equal(snap.backgroundLayers?.[1].kind, 'procedural-noise')
  assert.equal(snap.backgroundLayers?.[1].composite?.blendMode, 'overlay')
  assert.equal(snap.backgroundLayers?.[1].composite?.opacity, 0.6)

  // 3. Reorder layers
  store.reorderBackgroundLayer(0, 1)
  snap = store.getSnapshot()
  assert.equal(snap.backgroundLayers?.[0].kind, 'procedural-noise')
  assert.equal(snap.backgroundLayers?.[1].kind, 'mesh-gradient')
  assert.equal(snap.backgroundShader?.kind, 'procedural-noise')

  // 4. Update a background layer
  const updatedNoise = {
    ...noiseWithBlend,
    params: {
      ...noiseWithBlend.params,
      frequency: 6.5,
      turbulence: 0.75,
    },
  }
  store.updateBackgroundLayer(0, updatedNoise)
  snap = store.getSnapshot()
  assert.equal(snap.backgroundLayers?.[0].params.frequency, 6.5)
  assert.equal(snap.backgroundLayers?.[0].params.turbulence, 0.75)

  // 5. Remove a background layer
  store.removeBackgroundLayer(0)
  snap = store.getSnapshot()
  assert.equal(snap.backgroundLayers?.length, 1)
  assert.equal(snap.backgroundLayers?.[0].kind, 'mesh-gradient')
  assert.equal(snap.backgroundShader?.kind, 'mesh-gradient')

  // 6. Remove remaining layer
  store.removeBackgroundLayer(0)
  snap = store.getSnapshot()
  assert.equal(Boolean(snap.backgroundLayers?.length), false)
  assert.equal(snap.backgroundShader, null)
})

test('multi-stop mesh gradient layer supports color stop positioning, influence radius, and tensions', () => {
  const store = new SceneStore()
  const baseMesh = createShader('mesh-gradient')
  assert.ok(baseMesh.mesh)

  // Modify color stops and anchor positions
  const colors = ['#1a1a2e', '#16213e', '#0f3460', '#e94560', '#f8b500']
  const anchors = [
    { x: 0.1, y: 0.1, radius: 0.7, tx: 0.2, ty: -0.1, tension: 1.2 },
    { x: 0.9, y: 0.1, radius: 0.6, tx: -0.1, ty: 0.3, tension: 0.9 },
    { x: 0.5, y: 0.5, radius: 0.8, tx: 0.0, ty: 0.0, tension: 1.0 },
    { x: 0.1, y: 0.9, radius: 0.5, tx: 0.3, ty: -0.2, tension: 1.1 },
    { x: 0.9, y: 0.9, radius: 0.75, tx: -0.2, ty: -0.1, tension: 1.3 },
  ]

  const customMesh = {
    ...baseMesh,
    params: { ...baseMesh.params, colors },
    mesh: {
      ...baseMesh.mesh,
      anchors,
      turbulence: 0.45,
      frequency: 2.8,
      chromaticAberration: 0.15,
      grainBlend: 'soft-light',
    },
  }
  validateShader(customMesh)

  store.setBackgroundLayers([customMesh])
  const saved = store.getSnapshot().backgroundLayers?.[0]
  assert.ok(saved?.mesh)
  assert.equal(saved.params.colors.length, 5)
  assert.equal(saved.mesh.anchors.length, 5)
  assert.equal(saved.mesh.anchors[0].x, 0.1)
  assert.equal(saved.mesh.anchors[0].y, 0.1)
  assert.equal(saved.mesh.anchors[0].tension, 1.2)
  assert.equal(saved.mesh.turbulence, 0.45)
  assert.equal(saved.mesh.grainBlend, 'soft-light')

  // Sample interpolated color at center (0.5, 0.5)
  const sampled = interpolateMeshColor(saved.mesh.anchors, saved.params.colors, { x: 0.5, y: 0.5 })
  assert.ok(/^#[0-9a-f]{6}$/i.test(sampled), `Interpolated color should be valid hex: ${sampled}`)

  // Harmonize colors
  const harmonized = smoothMeshColors(saved.mesh.anchors, saved.params.colors)
  assert.equal(harmonized.length, 5)
  assert.ok(harmonized.every(c => /^#[0-9a-f]{6}$/i.test(c)))

  // Generate layouts
  const gridAnchors = generateGridLayout(5)
  assert.equal(gridAnchors.length, 5)
  assert.ok(gridAnchors.every(a => a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1))

  const radialAnchors = generateRadialLayout(5)
  assert.equal(radialAnchors.length, 5)
  assert.ok(radialAnchors.every(a => a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1))

  const waveAnchors = generateWaveLayout(5)
  assert.equal(waveAnchors.length, 5)
  assert.ok(waveAnchors.every(a => a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1))
})

test('procedural noise background layer controls frequency, octaves, turbulence, displacement, and view modes', () => {
  const store = new SceneStore()
  const baseNoise = createShader('procedural-noise')

  for (const gen of noiseGenerators) {
    for (const viewMode of ['shaded', 'normal-map', 'heightmap']) {
      const noisePaint = {
        ...baseNoise,
        params: {
          ...baseNoise.params,
          noiseType: gen,
          frequency: 4.2,
          octaves: 4,
          lacunarity: 2.3,
          persistence: 0.55,
          turbulence: 0.4,
          displacement: 0.3,
          normalPerturbation: 0.35,
          viewMode,
        },
        composite: { blendMode: 'soft-light', opacity: 0.75 },
      }
      validateShader(noisePaint)

      // Test uniform generation for WebGL pipeline
      const uniforms = proceduralNoiseUniforms(noisePaint)
      assert.equal(uniforms.u_frequency, 4.2)
      assert.equal(uniforms.u_octaves, 4)
      assert.equal(uniforms.u_turbulence, 0.4)
      assert.equal(uniforms.u_displacement, 0.3)
      assert.equal(uniforms.u_normalPerturbation, 0.35)
      assert.equal(uniforms.u_noiseType, gen === 'simplex' ? 0.0 : gen === 'perlin' ? 1.0 : 2.0)
      assert.equal(uniforms.u_viewMode, viewMode === 'normal-map' ? 1.0 : viewMode === 'heightmap' ? 2.0 : 0.0)

      // Test evaluation of multi-octave noise math
      const sample = sampleMultiOctaveNoise({
        type: gen,
        x: 0.5,
        y: 0.5,
        frequency: 4.2,
        octaves: 4,
        lacunarity: 2.3,
        persistence: 0.55,
        turbulence: 0.4,
      })
      assert.ok(Number.isFinite(sample), `Noise sample should be finite: ${sample}`)
    }
  }

  // Set as background layer
  store.setBackgroundLayers([baseNoise])
  assert.equal(store.getSnapshot().backgroundLayers?.[0].kind, 'procedural-noise')
})

test('compositing blend modes cover all 16 modes with layer opacity for background layers', () => {
  const store = new SceneStore()
  const baseMesh = createShader('mesh-gradient')

  for (const blendMode of shaderBlendModes) {
    const layer = {
      ...baseMesh,
      composite: { blendMode, opacity: 0.85 },
    }
    validateShader(layer)
    store.setBackgroundLayers([layer])
    const current = store.getSnapshot().backgroundLayers?.[0]
    assert.equal(current?.composite?.blendMode, blendMode)
    assert.equal(current?.composite?.opacity, 0.85)
  }
})

test('canvas background layers serialize to JSON and restore faithfully with deep immutability', () => {
  const store = new SceneStore()
  const meshLayer = {
    ...createShader('mesh-gradient'),
    composite: { blendMode: 'normal', opacity: 1 },
  }
  const noiseLayer = {
    ...createShader('procedural-noise'),
    composite: { blendMode: 'overlay', opacity: 0.5 },
  }

  store.setBackgroundLayers([meshLayer, noiseLayer])
  const doc = clone(store.toJSON())
  assert.ok(Array.isArray(doc.backgroundLayers))
  assert.equal(doc.backgroundLayers.length, 2)
  assert.equal(doc.backgroundLayers[0].kind, 'mesh-gradient')
  assert.equal(doc.backgroundLayers[1].kind, 'procedural-noise')
  assert.equal(doc.backgroundShader.kind, 'mesh-gradient')

  const restored = new SceneStore()
  restored.load(doc)
  assert.deepEqual(restored.toJSON(), doc)
  assert.equal(restored.getSnapshot().backgroundLayers?.length, 2)
  assert.ok(Object.isFrozen(restored.getSnapshot().backgroundLayers))
  assert.ok(Object.isFrozen(restored.getSnapshot().backgroundLayers[0]))
  assert.ok(Object.isFrozen(restored.getSnapshot().backgroundLayers[1]))
})

test('background layer edits record in command history and support undo and redo', () => {
  const store = new SceneStore()
  const mesh = createShader('mesh-gradient')
  const noise = createShader('procedural-noise')

  store.setBackgroundLayers([mesh])
  assert.equal(store.getSnapshot().backgroundLayers?.length, 1)

  store.addBackgroundLayer(noise)
  assert.equal(store.getSnapshot().backgroundLayers?.length, 2)

  store.undo()
  assert.equal(store.getSnapshot().backgroundLayers?.length, 1)
  assert.equal(store.getSnapshot().backgroundLayers?.[0].kind, 'mesh-gradient')

  store.redo()
  assert.equal(store.getSnapshot().backgroundLayers?.length, 2)
  assert.equal(store.getSnapshot().backgroundLayers?.[1].kind, 'procedural-noise')
})

test('SVG export renders canvas background layers when scope is canvas', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'card', x: 0, y: 0, width: 200, height: 200 })

  const mesh = createShader('mesh-gradient')
  const noise = {
    ...createShader('procedural-noise'),
    composite: { blendMode: 'overlay', opacity: 0.5 },
  }
  store.setBackgroundLayers([mesh, noise])

  // Single captured background shader in assets
  const singleSvg = sceneToSVG(
    store.getSnapshot(),
    { scope: 'canvas', scale: 1, background: null },
    { shaders: new Map([['paper:background', 'data:image/png;base64,BG']]) }
  )
  assert.match(singleSvg, /href="data:image\/png;base64,BG"/)

  // Multi-layer captured background shaders in assets
  const multiSvg = sceneToSVG(
    store.getSnapshot(),
    { scope: 'canvas', scale: 1, background: null },
    {
      shaders: new Map([
        ['paper:background-0', 'data:image/png;base64,LAYER0'],
        ['paper:background-1', 'data:image/png;base64,LAYER1'],
      ]),
    }
  )
  assert.match(multiSvg, /href="data:image\/png;base64,LAYER0"/)
  assert.match(multiSvg, /href="data:image\/png;base64,LAYER1"/)
  assert.match(multiSvg, /mix-blend-mode:overlay/)
})
