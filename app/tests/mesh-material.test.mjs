import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { SceneStore } from '../src/scene/store.ts'
import { createShader, freezeShader, updateShaderParameter, validateShader } from '../src/shaders/catalog.ts'
import {
  clampUnit,
  createMeshGrid,
  createMeshMaterial,
  evaluateBicubicPatch,
  evaluateGridMesh,
  generateCornerPatchLayout,
  generateGridLayout,
  generateRadialLayout,
  generateSpiralLayout,
  generateWaveLayout,
  gridVertexPosition,
  interpolateMeshColor,
  interpolatePaletteColors,
  meshDistortionModes,
  meshGridUniforms,
  meshHarmonyModes,
  meshToSurface,
  meshUniforms,
  MESH_PALETTE_PRESETS,
  parseHexColor,
  smoothMeshColors,
  surfaceToMesh,
  synthesizeProceduralColorField,
  toHexColor,
  validateMeshGrid,
  validateMeshMaterial,
} from '../src/shaders/mesh.ts'
import {
  getMeshActiveAnchor,
  setMeshActiveAnchor,
  getMeshActiveGridVertex,
  setMeshActiveGridVertex,
  getMeshPlacementMode,
  setMeshPlacementMode,
  subscribeMeshState,
} from '../src/shaders/meshState.ts'
import { grainBlendModes, noiseGenerators } from '../src/shaders/types.ts'
import { exportMeshReact } from '../src/shaders/shaderExport.ts'
import { createProject } from '../src/io/project.ts'
import { mutateCanvas } from '../src/mcp/operations.ts'
import { projectSchema, shaderSchema, validateSchema } from '../src/mcp/schema.ts'

const clone = value => JSON.parse(JSON.stringify(value))

test('mesh edits are deeply owned, persisted, and undone as one gesture', () => {
  const store = new SceneStore()
  const input = clone(createShader('mesh-gradient'))
  store.add('rectangle', { id: 'mesh', style: { shader: input } })
  store.setBackgroundShader(input)
  input.mesh.anchors[0].x = 1
  const original = store.getSnapshot().elements.mesh.style.shader
  assert.equal(original.mesh.anchors[0].x, .5)
  assert.ok(Object.isFrozen(original.mesh.anchors[0]))
  assert.ok(Object.isFrozen(store.getSnapshot().backgroundShader.mesh.anchors))
  store.beginTransaction('Drag mesh anchor')
  for (const x of [.6, .7, .8]) store.update('mesh', 'rectangle', { style: { shader: { ...original, mesh: { ...original.mesh, turbulence: .6, chromaticAberration: .4, grainBlend: 'screen', anchors: original.mesh.anchors.map((a, i) => i === 0 ? { ...a, x } : a) } } } })
  const saved = clone(store.toJSON())
  store.endTransaction()
  store.undo()
  assert.deepEqual(store.getSnapshot().elements.mesh.style.shader, original)
  store.redo()
  assert.deepEqual(clone(store.toJSON()), saved)
  const restored = new SceneStore()
  restored.load(saved)
  assert.deepEqual(clone(restored.toJSON()), saved)
  store.beginTransaction('Cancel drag')
  store.update('mesh', 'rectangle', { style: { shader: original } })
  store.cancelTransaction()
  assert.deepEqual(clone(store.toJSON()), saved)
})

test('malformed mesh materials reject atomically and old meshes still load', () => {
  const store = new SceneStore()
  const paint = createShader('mesh-gradient')
  const before = store.getSnapshot()
  for (const changes of [{ anchors: [] }, { anchors: [null, ...paint.mesh.anchors.slice(1)] }, { anchors: paint.mesh.anchors.map(a => ({ ...a, x: NaN })) }, { anchors: paint.mesh.anchors.map(a => ({ ...a, radius: 0 })) }, { turbulence: Infinity }, { frequency: 0 }, { chromaticAberration: 2 }, { grainBlend: 'invalid' }, { extra: true }]) {
    assert.throws(() => store.setBackgroundShader({ ...paint, mesh: { ...paint.mesh, ...changes } }), /Invalid shader mesh/)
    assert.equal(store.getSnapshot(), before)
  }
  assert.throws(() => validateShader({ ...createShader('perlin-noise'), mesh: paint.mesh }), /Invalid shader mesh/)
  const legacy = clone(paint)
  delete legacy.mesh
  validateShader(legacy)
  store.setBackgroundShader(legacy)
  assert.equal(store.getSnapshot().backgroundShader.mesh, undefined)
})

test('palette edits retain existing anchor placement and allocate new stops', () => {
  const paint = createShader('mesh-gradient')
  const next = updateShaderParameter(paint, 'colors', [...paint.params.colors, '#12345680'])
  assert.equal(next.mesh.anchors.length, 5)
  assert.deepEqual(next.mesh.anchors.slice(0, 4), paint.mesh.anchors)
  assert.equal(meshUniforms(next).u_colors[4][3], 128 / 255)
  validateShader(updateShaderParameter(next, 'colors', next.params.colors.slice(0, 2)))
  assert.ok(Object.isFrozen(freezeShader(next).mesh.anchors[4]))
})

test('code bridge accepts mesh documents and custom palettes without losing anchor data', () => {
  const project = createProject(new SceneStore(), 'Mesh studio', { x: 0, y: 0, zoom: 1 }, true)
  const created = mutateCanvas(project, 'add_shader_shape', { id: 'material', shader_kind: 'mesh-gradient', params: { colors: ['#81adec', '#edebe180'] } })
  const paint = created.element.style.shader
  assert.equal(paint.mesh.anchors.length, 2)
  validateSchema(created.project, projectSchema)
  const edited = { ...paint, mesh: { ...paint.mesh, chromaticAberration: .8, grainBlend: 'soft-light', anchors: paint.mesh.anchors.map(a => ({ ...a, x: .8 })) } }
  const updated = mutateCanvas(created.project, 'update_element', { element_id: 'material', patch: { style: { shader: edited } } })
  validateSchema(updated.project, projectSchema)
  assert.deepEqual(updated.element.style.shader.mesh, edited.mesh)
  const legacy = clone(paint)
  delete legacy.mesh
  validateSchema(legacy, shaderSchema)
  assert.throws(() => validateSchema({ ...edited, mesh: { ...edited.mesh, grainBlend: 'invalid' } }, shaderSchema))
  assert.throws(() => validateSchema({ ...createShader('neuro-noise'), mesh: edited.mesh }, shaderSchema))
})

test('anchor transforms invert material scale, rotation and offset', () => {
  const paint = { ...createShader('mesh-gradient'), rotation: 127, scale: 1.7, offsetX: .1, offsetY: -.2 }
  for (const anchor of paint.mesh.anchors) {
    const point = surfaceToMesh(meshToSurface(anchor, paint), paint)
    assert.ok(Math.abs(anchor.x - point.x) < 1e-12)
    assert.ok(Math.abs(anchor.y - point.y) < 1e-12)
  }
  assert.deepEqual(surfaceToMesh({ x: -100, y: 100 }, { ...paint, rotation: 0 }), { x: 0, y: 1 })
})

test('React export is self-contained, typechecks, and preserves current material uniforms', () => {
  const paint = { ...createShader('mesh-gradient'), animated: false, frame: 42000, composite: { blendMode: 'multiply', opacity: .4 } }
  const source = exportMeshReact(paint)
  assert.match(source, /speed=\{0\}/)
  assert.match(source, /frame=\{42000\}/)
  assert.match(source, /"mixBlendMode":"multiply"/)
  assert.match(source, /"u_anchors"/)
  assert.doesNotMatch(source, /from ['"]\.\//)
  const filename = `${process.cwd()}/PaperMaterial.tsx`
  const options = { noEmit: true, strict: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2023 }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host)
  host.readFile = name => name === filename ? source : read(name)
  host.fileExists = name => name === filename || exists(name)
  const program = ts.createProgram([filename], options, host)
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
})

test('mesh color parser and hex conversion roundtrip faithfully', () => {
  const white = parseHexColor('#ffffff')
  assert.deepEqual(white, { r: 1, g: 1, b: 1, a: 1 })
  assert.equal(toHexColor(white), '#ffffff')

  const shortHex = parseHexColor('#abc')
  assert.ok(Math.abs(shortHex.r - 0xaa / 255) < 1e-4)

  const semiTrans = parseHexColor('#12345680')
  assert.ok(Math.abs(semiTrans.a - 128 / 255) < 0.01)
  const roundtripped = toHexColor(semiTrans)
  assert.ok(roundtripped.startsWith('#123456'))

  assert.equal(clampUnit(0.5), 0.5)
  assert.equal(clampUnit(-5), 0)
  assert.equal(clampUnit(10), 1)
  assert.equal(clampUnit(NaN), 0)
  assert.equal(clampUnit(Infinity), 0)
})

test('multi-point mesh RBF color interpolation smoothly samples the gradient field', () => {
  const anchors = [
    { x: 0, y: 0, radius: 0.6 },
    { x: 1, y: 1, radius: 0.6 },
  ]
  const colors = ['#ff0000', '#0000ff']

  // Exact vertex sampling should match vertex color closely
  const atFirst = interpolateMeshColor(anchors, colors, { x: 0, y: 0 })
  const parsedFirst = parseHexColor(atFirst)
  assert.ok(parsedFirst.r > 0.9, 'Color at (0,0) should be predominantly red')

  // Center point sampling should blend both colors
  const atCenter = interpolateMeshColor(anchors, colors, { x: 0.5, y: 0.5 })
  const parsedCenter = parseHexColor(atCenter)
  assert.ok(parsedCenter.r > 0.3 && parsedCenter.b > 0.3, 'Center should be a blended purple')

  // Edge cases: single color or empty anchors
  assert.equal(interpolateMeshColor([], [], { x: 0.5, y: 0.5 }), '#81adec')
  assert.equal(interpolateMeshColor([anchors[0]], ['#123456'], { x: 0.5, y: 0.5 }), '#123456')
})

test('palette spectrum interpolation maps stops across target count', () => {
  const base = ['#000000', '#ffffff']
  const expanded = interpolatePaletteColors(base, 5)
  assert.equal(expanded.length, 5)
  assert.equal(expanded[0], '#000000')
  assert.equal(expanded[4], '#ffffff')
  const mid = parseHexColor(expanded[2])
  assert.ok(Math.abs(mid.r - 0.5) < 0.05, 'Mid stop should be medium gray')

  // Empty or 1 count
  assert.deepEqual(interpolatePaletteColors([], 3), ['#81adec', '#81adec', '#81adec'])
  assert.deepEqual(interpolatePaletteColors(['#ff0000'], 2), ['#ff0000', '#ff0000'])
})

test('smoothMeshColors harmonizes color stops against surrounding vertices', () => {
  const anchors = [
    { x: 0.2, y: 0.2, radius: 0.6 },
    { x: 0.8, y: 0.2, radius: 0.6 },
    { x: 0.5, y: 0.8, radius: 0.6 },
  ]
  const colors = ['#ff0000', '#00ff00', '#0000ff']
  const smoothed = smoothMeshColors(anchors, colors)
  assert.equal(smoothed.length, 3)
  // Each color should still retain its main hue but blend with neighbors
  const c0 = parseHexColor(smoothed[0])
  assert.ok(c0.r > 0.5, 'Primary component remains dominant')
  assert.ok(c0.g > 0 || c0.b > 0, 'Neighbor colors blended in')
})

test('mesh layout generators produce balanced normalized anchor coordinates', () => {
  const grid = generateGridLayout(6)
  assert.equal(grid.length, 6)
  for (const a of grid) {
    assert.ok(a.x >= 0 && a.x <= 1, 'x coordinate within [0, 1]')
    assert.ok(a.y >= 0 && a.y <= 1, 'y coordinate within [0, 1]')
    assert.ok(a.radius > 0, 'radius is positive')
  }

  const radial = generateRadialLayout(5)
  assert.equal(radial.length, 5)
  assert.deepEqual(radial[0], { x: 0.5, y: 0.5, radius: 0.75 })
  for (const a of radial) {
    assert.ok(a.x >= 0 && a.x <= 1)
    assert.ok(a.y >= 0 && a.y <= 1)
  }

  const spiral = generateSpiralLayout(4)
  assert.equal(spiral.length, 4)

  assert.ok(MESH_PALETTE_PRESETS.length >= 4)
  for (const p of MESH_PALETTE_PRESETS) {
    assert.ok(p.name.length > 0)
    assert.ok(p.colors.length >= 4)
  }
})

test('meshState external store correctly broadcasts active vertex and placement mode changes', () => {
  let notifications = 0
  const unsubscribe = subscribeMeshState(() => {
    notifications++
  })

  setMeshActiveAnchor(2)
  assert.equal(getMeshActiveAnchor(), 2)
  assert.equal(notifications, 1)

  // Redundant set does not notify
  setMeshActiveAnchor(2)
  assert.equal(notifications, 1)

  setMeshPlacementMode(true)
  assert.equal(getMeshPlacementMode(), true)
  assert.equal(notifications, 2)

  setMeshPlacementMode(false)
  assert.equal(getMeshPlacementMode(), false)
  assert.equal(notifications, 3)

  unsubscribe()
  setMeshActiveAnchor(0)
  assert.equal(notifications, 3)
})

test('synthesizeProceduralColorField generates harmonious color stops for all harmony modes', () => {
  const base = '#81adec'
  for (const harmony of meshHarmonyModes) {
    const stops = synthesizeProceduralColorField(base, 5, harmony)
    assert.equal(stops.length, 5, `Expected 5 stops for harmony ${harmony}`)
    for (const stop of stops) {
      assert.match(stop, /^#[\da-f]{6}$/i, `Invalid hex color generated: ${stop}`)
      const parsed = parseHexColor(stop)
      assert.ok(parsed.r >= 0 && parsed.r <= 1)
      assert.ok(parsed.g >= 0 && parsed.g <= 1)
      assert.ok(parsed.b >= 0 && parsed.b <= 1)
      assert.equal(parsed.a, 1)
    }
  }

  // Edge cases: count <= 0, single stop
  assert.deepEqual(synthesizeProceduralColorField(base, 0), [])
  const single = synthesizeProceduralColorField(base, 1, 'harmonic')
  assert.equal(single.length, 1)
  assert.match(single[0], /^#[\da-f]{6}$/i)
})

test('evaluateBicubicPatch performs smooth Hermite polynomial interpolation on 2D color grids', () => {
  const grid = [
    ['#ff0000', '#00ff00'],
    ['#0000ff', '#ffffff'],
  ]

  // Corners should match exactly
  assert.equal(evaluateBicubicPatch(grid, 0, 0), '#ff0000')
  assert.equal(evaluateBicubicPatch(grid, 1, 0), '#00ff00')
  assert.equal(evaluateBicubicPatch(grid, 0, 1), '#0000ff')
  assert.equal(evaluateBicubicPatch(grid, 1, 1), '#ffffff')

  // Interior evaluation
  const center = evaluateBicubicPatch(grid, 0.5, 0.5)
  assert.match(center, /^#[\da-f]{6}$/i)
  const c = parseHexColor(center)
  assert.ok(c.r > 0.1 && c.g > 0.1 && c.b > 0.1, 'Center should blend all 4 corners')

  // Boundary checks (out of bounds clamp)
  assert.equal(evaluateBicubicPatch(grid, -0.5, 0), '#ff0000')
  assert.equal(evaluateBicubicPatch(grid, 1.5, 1.5), '#ffffff')
})

test('generateWaveLayout and generateCornerPatchLayout produce bounded coordinates', () => {
  const wave = generateWaveLayout(6)
  assert.equal(wave.length, 6)
  for (const a of wave) {
    assert.ok(a.x >= 0 && a.x <= 1, 'x within bounds')
    assert.ok(a.y >= 0 && a.y <= 1, 'y within bounds')
    assert.ok(a.radius >= 0.1 && a.radius <= 2.0, 'radius within bounds')
  }

  const patch = generateCornerPatchLayout(8)
  assert.equal(patch.length, 8)
  for (const a of patch) {
    assert.ok(a.x >= 0 && a.x <= 1, 'x within bounds')
    assert.ok(a.y >= 0 && a.y <= 1, 'y within bounds')
    assert.ok(a.radius >= 0.1 && a.radius <= 2.0, 'radius within bounds')
  }

  // 4 corners
  const four = generateCornerPatchLayout(4)
  assert.equal(four.length, 4)
  assert.deepEqual(four[0], { x: 0.15, y: 0.15, radius: 0.7 })
  assert.deepEqual(four[1], { x: 0.85, y: 0.15, radius: 0.7 })
})

test('grid mesh topology creates valid NxM patch, evaluates bicubic colors, and formats GPU uniforms', () => {
  const grid = createMeshGrid(3, 4, ['#edebe1', '#81adec', '#222222'])
  assert.equal(grid.rows, 3)
  assert.equal(grid.cols, 4)
  assert.equal(grid.vertices.length, 12)
  assert.equal(grid.topology, 'grid')
  assert.equal(grid.smoothing, 0.5)

  // Validation passes on clean grid
  validateMeshGrid(grid)

  // Vertex positions
  const corner00 = gridVertexPosition(0, 0, 3, 4)
  assert.deepEqual(corner00, { x: 0, y: 0 })
  const corner23 = gridVertexPosition(2, 3, 3, 4)
  assert.deepEqual(corner23, { x: 1, y: 1 })
  const center = gridVertexPosition(1, 1, 3, 3)
  assert.deepEqual(center, { x: 0.5, y: 0.5 })

  // Evaluate color on grid
  const sampled = evaluateGridMesh(grid, 0.5, 0.5)
  assert.match(sampled, /^#[\da-f]{6}$/i)

  // Invalid grid assertions
  assert.throws(() => validateMeshGrid({ ...grid, rows: 1 }), /Invalid mesh grid rows/)
  assert.throws(() => validateMeshGrid({ ...grid, cols: 9 }), /Invalid mesh grid cols/)
  assert.throws(() => validateMeshGrid({ ...grid, smoothing: -0.1 }), /Invalid mesh grid smoothing/)
  assert.throws(() => validateMeshGrid({ ...grid, vertices: grid.vertices.slice(0, 5) }), /Invalid mesh grid vertex count/)

  // GPU Grid Uniforms
  const paint = {
    kind: 'mesh-gradient',
    params: { colors: ['#edebe1', '#81adec', '#222222'], distortion: 0.3, swirl: 0.1, grainMixer: 0, grainOverlay: 0 },
    animated: true,
    speed: 0.2,
    frame: 500,
    scale: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    mesh: {
      ...createMeshMaterial(3),
      grid,
      fluidAdvection: 0.45,
      fluidViscosity: 0.6,
      distortionMode: 'curl-fluid',
    },
  }

  const uniforms = meshGridUniforms(paint)
  assert.equal(uniforms.u_gridMode, 1.0)
  assert.equal(uniforms.u_gridRows, 3)
  assert.equal(uniforms.u_gridCols, 4)
  assert.equal(uniforms.u_gridSmoothing, 0.5)
  assert.equal(uniforms.u_fluidAdvection, 0.45)
  assert.equal(uniforms.u_fluidViscosity, 0.6)
  assert.equal(uniforms.u_distortionMode, 0) // curl-fluid = 0
  assert.equal(uniforms.u_gridColors.length, 64)
  assert.equal(uniforms.u_gridTangents.length, 64)
})

test('mesh distortion dynamics modes support curl-fluid, domain-warp, turbulent-swirl, and simplex-flow', () => {
  for (const mode of meshDistortionModes) {
    const mesh = createMeshMaterial(3, {
      distortionMode: mode,
      fluidAdvection: 0.7,
      fluidViscosity: 0.3,
    })
    assert.equal(mesh.distortionMode, mode)
    assert.equal(mesh.fluidAdvection, 0.7)
    assert.equal(mesh.fluidViscosity, 0.3)

    const paint = {
      kind: 'mesh-gradient',
      params: { colors: ['#edebe1', '#81adec', '#222222'], distortion: 0.2, swirl: 0.1, grainMixer: 0, grainOverlay: 0 },
      animated: true,
      speed: 0.3,
      frame: 100,
      scale: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      mesh,
    }

    validateMeshMaterial(mesh, paint)
    const uniforms = meshUniforms(paint)
    assert.equal(uniforms.u_fluidAdvection, 0.7)
    assert.equal(uniforms.u_fluidViscosity, 0.3)
    const expectedModeVal = mode === 'curl-fluid' ? 0 : mode === 'domain-warp' ? 1 : mode === 'turbulent-swirl' ? 2 : 3
    assert.equal(uniforms.u_distortionMode, expectedModeVal)
  }
})

test('meshState broadcasts active grid vertex updates', () => {
  let count = 0
  const unsubscribe = subscribeMeshState(() => {
    count++
  })

  setMeshActiveGridVertex(3)
  assert.equal(getMeshActiveGridVertex(), 3)
  assert.equal(count, 1)

  // Duplicate set should not fire
  setMeshActiveGridVertex(3)
  assert.equal(count, 1)

  setMeshActiveGridVertex(0)
  assert.equal(getMeshActiveGridVertex(), 0)
  assert.equal(count, 2)

  unsubscribe()
})

test('direct scene canvas binding applies mesh gradient to elements, background, and new cards', () => {
  const store = new SceneStore()
  const paint = createShader('mesh-gradient')

  // 1. Bind to background
  store.setBackgroundShader(paint)
  assert.equal(store.getSnapshot().backgroundShader?.kind, 'mesh-gradient')

  // 2. Bind to selected element
  store.add('rectangle', { id: 'canvas-node', x: 100, y: 100, width: 240, height: 180 })
  store.beginTransaction('Bind mesh to selection')
  store.update('canvas-node', 'rectangle', { style: { shader: paint } })
  store.endTransaction()
  assert.equal(store.getSnapshot().elements['canvas-node'].style.shader?.kind, 'mesh-gradient')

  // 3. Grid mesh binding with undo/redo
  const grid = createMeshGrid(3, 3, ['#edebe1', '#81adec', '#222222'])
  const gridPaint = freezeShader({
    ...paint,
    mesh: {
      ...paint.mesh,
      grid,
    },
  })

  store.beginTransaction('Apply grid mesh to node')
  store.update('canvas-node', 'rectangle', { style: { shader: gridPaint } })
  store.endTransaction()
  assert.ok(store.getSnapshot().elements['canvas-node'].style.shader?.mesh?.grid)

  store.undo()
  assert.equal(store.getSnapshot().elements['canvas-node'].style.shader?.mesh?.grid, undefined)

  store.redo()
  assert.ok(store.getSnapshot().elements['canvas-node'].style.shader?.mesh?.grid)
})

test('grain blend modes, noise generators, and warp modulation encode correctly into GPU uniforms', () => {
  for (let idx = 0; idx < grainBlendModes.length; idx++) {
    const blendMode = grainBlendModes[idx]
    const mesh = createMeshMaterial(3, {
      grainBlend: blendMode,
      warpModulation: 0.75,
      noiseType: 'perlin',
      lacunarity: 2.5,
      octaves: 4,
      normalPerturbation: 0.3,
      grainDisplacement: 0.25,
    })
    const paint = {
      kind: 'mesh-gradient',
      params: { colors: ['#edebe1', '#81adec', '#222222'], distortion: 0.4, swirl: 0.2, grainMixer: 0.1, grainOverlay: 0.3 },
      animated: true,
      speed: 0.5,
      frame: 120,
      scale: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      mesh,
    }
    const uniforms = meshUniforms(paint)
    assert.equal(uniforms.u_grainBlend, idx, `Grain blend mode ${blendMode} should map to index ${idx}`)
    assert.equal(uniforms.u_warpModulation, 0.75)
    assert.equal(uniforms.u_noiseType, 1) // perlin = 1
    assert.equal(uniforms.u_lacunarity, 2.5)
    assert.equal(uniforms.u_octaves, 4)
    assert.equal(uniforms.u_normalPerturbation, 0.3)
    assert.equal(uniforms.u_grainDisplacement, 0.25)
  }
})

test('procedural color field synthesizer and bicubic patch evaluate smooth color transitions across all harmonies', () => {
  const seed = '#81adec'
  for (const harmony of meshHarmonyModes) {
    const stops = synthesizeProceduralColorField(seed, 4, harmony)
    const patch = [
      [stops[0], stops[1]],
      [stops[2], stops[3]],
    ]
    const center = evaluateBicubicPatch(patch, 0.5, 0.5)
    assert.match(center, /^#[\da-f]{6}$/i)
    const parsed = parseHexColor(center)
    assert.ok(parsed.r >= 0 && parsed.r <= 1)
    assert.ok(parsed.g >= 0 && parsed.g <= 1)
    assert.ok(parsed.b >= 0 && parsed.b <= 1)
  }
})


