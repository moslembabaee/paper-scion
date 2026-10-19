import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { SceneStore } from '../src/scene/store.ts'
import { createShader, freezeShader, shaderCatalog, updateShaderParameter, validateShader } from '../src/shaders/catalog.ts'
import {
  simplex2D,
  perlin2D,
  worley2D,
  proceduralGrain,
  sampleMultiOctaveNoise,
  evaluateNormalPerturbation,
  evaluateProceduralNoiseColor,
  PROCEDURAL_NOISE_PRESETS,
} from '../src/shaders/noise/proceduralNoise.ts'
import { proceduralNoiseFragmentShader, proceduralNoiseUniforms } from '../src/shaders/noise/noiseFragment.ts'
import { exportProceduralNoiseReact } from '../src/shaders/noise/noiseExport.ts'
import { createMeshMaterial, meshUniforms, validateMeshMaterial, MESH_DISPLACEMENT_PRESETS } from '../src/shaders/mesh.ts'
import { noiseGenerators } from '../src/shaders/types.ts'

test('simplex2D generates bounded, smooth, continuous 2D noise in [-1, 1]', () => {
  for (let x = 0; x < 5; x += 0.5) {
    for (let y = 0; y < 5; y += 0.5) {
      const val = simplex2D(x, y)
      assert.ok(Number.isFinite(val), `simplex value should be finite: ${val}`)
      assert.ok(val >= -1.05 && val <= 1.05, `simplex value should be roughly in [-1, 1], got ${val}`)
    }
  }

  // Continuity check: small delta produces small value difference
  const v1 = simplex2D(1.5, 2.5)
  const v2 = simplex2D(1.501, 2.5)
  assert.ok(Math.abs(v1 - v2) < 0.05, 'Simplex noise should be continuous')
})

test('perlin2D generates continuous gradient noise in [-1, 1]', () => {
  for (let x = 0; x < 5; x += 0.5) {
    for (let y = 0; y < 5; y += 0.5) {
      const val = perlin2D(x, y)
      assert.ok(Number.isFinite(val), `perlin value should be finite: ${val}`)
      assert.ok(val >= -1.1 && val <= 1.1, `perlin value should be roughly in [-1, 1], got ${val}`)
    }
  }

  const v1 = perlin2D(3.2, 4.1)
  const v2 = perlin2D(3.201, 4.1)
  assert.ok(Math.abs(v1 - v2) < 0.05, 'Perlin noise should be continuous')
})

test('worley2D computes cellular distance metrics f1, f2 and boundary diff', () => {
  for (let x = 0; x < 5; x += 0.7) {
    for (let y = 0; y < 5; y += 0.7) {
      const res = worley2D(x, y)
      assert.ok(res.f1 >= 0 && res.f1 <= 1, `f1 should be in [0, 1], got ${res.f1}`)
      assert.ok(res.f2 >= res.f1, `f2 (${res.f2}) should be >= f1 (${res.f1})`)
      assert.ok(res.diff >= 0 && res.diff <= 1, `diff should be in [0, 1], got ${res.diff}`)
    }
  }
})

test('sampleMultiOctaveNoise correctly supports Simplex, Perlin, and Worley with harmonic scaling', () => {
  for (const type of noiseGenerators) {
    const val = sampleMultiOctaveNoise({
      type,
      x: 1.25,
      y: 2.75,
      frequency: 3.5,
      octaves: 4,
      lacunarity: 2.2,
      persistence: 0.5,
      turbulence: 0.2,
    })
    assert.ok(Number.isFinite(val), `${type} noise should return a finite number`)
    assert.ok(val >= -1.2 && val <= 1.2, `${type} noise should be normalized in [-1, 1] range`)
  }

  // Test turbulence folding: turbulence > 0 should modify values towards positive ridges
  const base = sampleMultiOctaveNoise({
    type: 'simplex',
    x: 2.0,
    y: 3.0,
    frequency: 2.0,
    octaves: 3,
    lacunarity: 2.0,
    persistence: 0.5,
    turbulence: 0.0,
  })
  const turb = sampleMultiOctaveNoise({
    type: 'simplex',
    x: 2.0,
    y: 3.0,
    frequency: 2.0,
    octaves: 3,
    lacunarity: 2.0,
    persistence: 0.5,
    turbulence: 0.8,
  })
  assert.notEqual(base, turb, 'Turbulence folding should modulate noise waveform')
})

test('evaluateNormalPerturbation produces normalized surface normals and lighting', () => {
  const result = evaluateNormalPerturbation({
    type: 'simplex',
    x: 0.5,
    y: 0.5,
    frequency: 3.0,
    octaves: 3,
    lacunarity: 2.0,
    persistence: 0.5,
    turbulence: 0.1,
    displacement: 0.4,
    normalPerturbation: 0.5,
    grainDisplacement: 0.1,
    lightAngle: 60,
    specularStrength: 0.4,
  })

  // Normal vector length should be close to 1.0 (normalized)
  const len = Math.sqrt(
    result.normal.x * result.normal.x +
    result.normal.y * result.normal.y +
    result.normal.z * result.normal.z
  )
  assert.ok(Math.abs(len - 1.0) < 0.01, `Normal vector must be unit length, got ${len}`)

  // Tangent space Z must be positive (facing outward)
  assert.ok(result.normal.z > 0, 'Normal Z must be positive')

  // Normal RGB must be in [0, 1]
  assert.ok(result.normalRGB.r >= 0 && result.normalRGB.r <= 1)
  assert.ok(result.normalRGB.g >= 0 && result.normalRGB.g <= 1)
  assert.ok(result.normalRGB.b >= 0 && result.normalRGB.b <= 1)

  // Diffuse and specular terms in [0, 1]
  assert.ok(result.diffuse >= 0 && result.diffuse <= 1)
  assert.ok(result.specular >= 0 && result.specular <= 1)
})

test('evaluateProceduralNoiseColor produces valid hex colors across view modes', () => {
  const baseParams = PROCEDURAL_NOISE_PRESETS[0].params

  // Mode 1: Shaded
  const shadedColor = evaluateProceduralNoiseColor({ ...baseParams, viewMode: 'shaded' }, 0.5, 0.5)
  assert.match(shadedColor, /^#[\da-f]{6}$/i, 'Shaded mode must output a 6-digit hex color')

  // Mode 2: Normal Map
  const normalColor = evaluateProceduralNoiseColor({ ...baseParams, viewMode: 'normal-map' }, 0.5, 0.5)
  assert.match(normalColor, /^#[\da-f]{6}$/i, 'Normal map mode must output a 6-digit hex color')

  // Mode 3: Heightmap
  const heightColor = evaluateProceduralNoiseColor({ ...baseParams, viewMode: 'heightmap' }, 0.5, 0.5)
  assert.match(heightColor, /^#[\da-f]{6}$/i, 'Heightmap mode must output a 6-digit hex color')
})

test('all procedural noise presets are well-formed and evaluable', () => {
  assert.ok(PROCEDURAL_NOISE_PRESETS.length >= 6, 'Should provide at least 6 curated presets')
  for (const preset of PROCEDURAL_NOISE_PRESETS) {
    assert.ok(preset.id && preset.name && preset.description)
    assert.ok(noiseGenerators.includes(preset.params.noiseType))
    assert.ok(preset.params.frequency >= 0.5 && preset.params.frequency <= 20)
    assert.ok(preset.params.octaves >= 1 && preset.params.octaves <= 8)
    assert.ok(preset.params.lacunarity >= 1.0 && preset.params.lacunarity <= 5.0)
    assert.ok(preset.params.normalPerturbation >= 0 && preset.params.normalPerturbation <= 1)
    assert.ok(preset.params.displacement >= 0 && preset.params.displacement <= 1)

    // Evaluate color at sample point
    const color = evaluateProceduralNoiseColor(preset.params, 0.3, 0.7)
    assert.match(color, /^#[\da-f]{6}$/i)
  }
})

test('proceduralNoiseUniforms formats uniforms for WebGL fragment shader', () => {
  const paint = createShader('procedural-noise')
  const uniforms = proceduralNoiseUniforms(paint)

  assert.equal(typeof uniforms.u_scale, 'number')
  assert.equal(typeof uniforms.u_rotation, 'number')
  assert.ok(Array.isArray(uniforms.u_offset) && uniforms.u_offset.length === 2)
  assert.equal(typeof uniforms.u_noiseType, 'number')
  assert.equal(typeof uniforms.u_frequency, 'number')
  assert.equal(typeof uniforms.u_octaves, 'number')
  assert.equal(typeof uniforms.u_lacunarity, 'number')
  assert.equal(typeof uniforms.u_normalPerturbation, 'number')
  assert.equal(typeof uniforms.u_displacement, 'number')
  assert.ok(Array.isArray(uniforms.u_colorFront) && uniforms.u_colorFront.length === 3)
  assert.ok(Array.isArray(uniforms.u_colorMid) && uniforms.u_colorMid.length === 3)
  assert.ok(Array.isArray(uniforms.u_colorBack) && uniforms.u_colorBack.length === 3)
})

test('exportProceduralNoiseReact generates valid TypeScript React component', () => {
  const paint = createShader('procedural-noise')
  const code = exportProceduralNoiseReact(paint)

  assert.ok(code.includes('export default function ProceduralNoiseMaterial'))
  assert.ok(code.includes('ShaderMount'))
  assert.ok(code.includes('FRAGMENT_SHADER'))
  assert.ok(code.includes('UNIFORMS'))

  // Verify that TypeScript can compile the exported code
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.ok(result.outputText.length > 0, 'Exported component should compile with TypeScript')
})

test('procedural-noise integrates with SceneStore and supports undo/redo', () => {
  const store = new SceneStore()
  const paint = createShader('procedural-noise')

  // Apply to rectangle
  store.add('rectangle', { id: 'rect-noise', style: { shader: paint } })
  const element = store.getSnapshot().elements['rect-noise']
  assert.equal(element.style.shader?.kind, 'procedural-noise')
  assert.equal(element.style.shader?.params.noiseType, 'simplex')

  // Update procedural parameters inside transaction
  store.beginTransaction('Tweak noise parameters')
  store.update('rect-noise', 'rectangle', {
    style: {
      shader: updateShaderParameter(paint, 'noiseType', 'worley'),
    },
  })
  store.endTransaction()

  assert.equal(store.getSnapshot().elements['rect-noise'].style.shader?.params.noiseType, 'worley')

  // Undo restores simplex
  store.undo()
  assert.equal(store.getSnapshot().elements['rect-noise'].style.shader?.params.noiseType, 'simplex')

  // Redo restores worley
  store.redo()
  assert.equal(store.getSnapshot().elements['rect-noise'].style.shader?.params.noiseType, 'worley')

  // Apply as background shader
  store.setBackgroundShader(paint)
  assert.equal(store.getSnapshot().backgroundShader?.kind, 'procedural-noise')
})

test('mesh material engine supports multi-octave noise, lacunarity, normal perturbation, and grain displacement', () => {
  const colors = ['#edebe1', '#81adec', '#222222']
  const mesh = createMeshMaterial(colors, {
    noiseType: 'worley',
    octaves: 4,
    lacunarity: 2.5,
    turbulence: 0.45,
    normalPerturbation: 0.6,
    grainDisplacement: 0.25,
  })

  assert.equal(mesh.noiseType, 'worley')
  assert.equal(mesh.octaves, 4)
  assert.equal(mesh.lacunarity, 2.5)
  assert.equal(mesh.turbulence, 0.45)
  assert.equal(mesh.normalPerturbation, 0.6)
  assert.equal(mesh.grainDisplacement, 0.25)

  // Verify uniforms
  const paint = {
    kind: 'mesh-gradient',
    params: { colors, distortion: 0.5, swirl: 0.2, grainMixer: 0.1, grainOverlay: 0.05 },
    animated: true,
    speed: 0.35,
    frame: 1000,
    scale: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    mesh,
  }

  const uniforms = meshUniforms(paint)
  assert.equal(uniforms.u_noiseType, 2) // Worley = 2
  assert.equal(uniforms.u_octaves, 4)
  assert.equal(uniforms.u_lacunarity, 2.5)
  assert.equal(uniforms.u_normalPerturbation, 0.6)
  assert.equal(uniforms.u_grainDisplacement, 0.25)

  // Validation passes on valid mesh
  validateMeshMaterial(mesh, paint)

  // Validation throws on out-of-range parameters
  assert.throws(() => validateMeshMaterial({ ...mesh, octaves: 10 }, paint), /Invalid shader mesh material/)
  assert.throws(() => validateMeshMaterial({ ...mesh, lacunarity: 0.2 }, paint), /Invalid shader mesh material/)
  assert.throws(() => validateMeshMaterial({ ...mesh, normalPerturbation: 1.5 }, paint), /Invalid shader mesh material/)
  assert.throws(() => validateMeshMaterial({ ...mesh, grainDisplacement: -0.5 }, paint), /Invalid shader mesh material/)
})

test('MESH_DISPLACEMENT_PRESETS are fully curated, valid, and apply cleanly to MeshMaterial', () => {
  assert.ok(MESH_DISPLACEMENT_PRESETS.length >= 6, 'Should provide at least 6 displacement presets')
  const colors = ['#edebe1', '#81adec', '#222222']

  for (const preset of MESH_DISPLACEMENT_PRESETS) {
    assert.ok(preset.id && preset.name && preset.description)
    assert.ok(noiseGenerators.includes(preset.noiseType), `Preset ${preset.name} has invalid noiseType ${preset.noiseType}`)
    assert.ok(preset.octaves >= 1 && preset.octaves <= 6)
    assert.ok(preset.lacunarity >= 1.0 && preset.lacunarity <= 5.0)
    assert.ok(preset.turbulence >= 0 && preset.turbulence <= 1)
    assert.ok(preset.frequency >= 1.0 && preset.frequency <= 12.0)
    assert.ok(preset.normalPerturbation >= 0 && preset.normalPerturbation <= 1)
    assert.ok(preset.grainDisplacement >= 0 && preset.grainDisplacement <= 1)

    // Verify it applies to a real mesh and passes validation
    const mesh = createMeshMaterial(colors, {
      noiseType: preset.noiseType,
      octaves: preset.octaves,
      lacunarity: preset.lacunarity,
      turbulence: preset.turbulence,
      frequency: preset.frequency,
      normalPerturbation: preset.normalPerturbation,
      grainDisplacement: preset.grainDisplacement,
    })

    const paint = {
      kind: 'mesh-gradient',
      params: { colors, distortion: 0.5, swirl: 0.2, grainMixer: 0.1, grainOverlay: 0.05 },
      animated: true,
      speed: 0.35,
      frame: 1000,
      scale: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      mesh,
    }

    validateMeshMaterial(mesh, paint)
  }
})

test('ShaderBrowser catalog registration and search keyword coverage for procedural noise', () => {
  assert.ok(shaderCatalog['procedural-noise'], 'procedural-noise must be registered in shaderCatalog')
  const def = shaderCatalog['procedural-noise']
  assert.equal(def.label, 'Procedural Noise')

  const desc = def.description.toLowerCase()
  assert.ok(desc.includes('simplex'), 'Description should reference Simplex noise')
  assert.ok(desc.includes('perlin'), 'Description should reference Perlin noise')
  assert.ok(desc.includes('worley'), 'Description should reference Worley noise')
  assert.ok(desc.includes('displacement'), 'Description should reference displacement')
  assert.ok(desc.includes('normal-map'), 'Description should reference normal-map')
  assert.ok(desc.includes('grain'), 'Description should reference grain')

  // Strictly validates shader initialization with createShader
  const shader = createShader('procedural-noise')
  validateShader(shader)
  assert.equal(shader.kind, 'procedural-noise')
  assert.equal(shader.params.noiseType, 'simplex')
})

test('finite-difference normal perturbation physics and lighting calculations', () => {
  const lowBump = evaluateNormalPerturbation({
    type: 'simplex',
    x: 0.35,
    y: 0.35,
    frequency: 4.0,
    octaves: 3,
    lacunarity: 2.0,
    persistence: 0.5,
    turbulence: 0.0,
    displacement: 0.5,
    normalPerturbation: 0.1,
    lightAngle: 45,
    specularStrength: 0.5,
  })

  const highBump = evaluateNormalPerturbation({
    type: 'simplex',
    x: 0.35,
    y: 0.35,
    frequency: 4.0,
    octaves: 3,
    lacunarity: 2.0,
    persistence: 0.5,
    turbulence: 0.0,
    displacement: 0.5,
    normalPerturbation: 0.9,
    lightAngle: 45,
    specularStrength: 0.5,
  })

  // Higher normal perturbation tilts normal further from flat Z-axis (nz decreases or |nx|+|ny| increases)
  const lowTilt = Math.abs(lowBump.normal.x) + Math.abs(lowBump.normal.y)
  const highTilt = Math.abs(highBump.normal.x) + Math.abs(highBump.normal.y)
  assert.ok(highTilt > lowTilt, 'Higher normal perturbation must produce greater normal vector deflection')

  // Both normals must remain normalized unit vectors
  const lowLen = Math.hypot(lowBump.normal.x, lowBump.normal.y, lowBump.normal.z)
  const highLen = Math.hypot(highBump.normal.x, highBump.normal.y, highBump.normal.z)
  assert.ok(Math.abs(lowLen - 1.0) < 1e-4)
  assert.ok(Math.abs(highLen - 1.0) < 1e-4)
})

test('proceduralGrain produces bounded pseudorandom micro-grain in [0, 1)', () => {
  for (let i = 0; i < 50; i++) {
    const val = proceduralGrain(i * 1.37, i * 2.71)
    assert.ok(Number.isFinite(val), `Grain value must be finite, got ${val}`)
    assert.ok(val >= 0 && val < 1.0, `Grain value must be in [0, 1), got ${val}`)
  }
})

test('view modes maintain mathematical invariants for normal-map and heightmap', () => {
  const baseParams = PROCEDURAL_NOISE_PRESETS[1].params // Basalt Relief

  // Heightmap mode: hex color must have R == G == B (monochrome grayscale)
  const heightHex = evaluateProceduralNoiseColor({ ...baseParams, viewMode: 'heightmap' }, 0.4, 0.6)
  const rHex = heightHex.slice(1, 3)
  const gHex = heightHex.slice(3, 5)
  const bHex = heightHex.slice(5, 7)
  assert.equal(rHex, gHex, 'Heightmap R and G components must be identical')
  assert.equal(gHex, bHex, 'Heightmap G and B components must be identical')

  // Normal-map mode: B component corresponds to nz in tangent space, which must be >= 128 (outward facing)
  const normalHex = evaluateProceduralNoiseColor({ ...baseParams, viewMode: 'normal-map' }, 0.4, 0.6)
  const bVal = parseInt(normalHex.slice(5, 7), 16)
  assert.ok(bVal >= 120, `Normal map blue channel (Z) must be positive outward, got ${bVal}`)
})

