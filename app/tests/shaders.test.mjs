import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createShader, shaderKinds, updateShaderParameter, validateShader } from '../src/shaders/catalog.ts'
import { shaderBlendModes } from '../src/shaders/types.ts'
import { sceneToSVG } from '../src/io/svg.ts'

const copy = value => JSON.parse(JSON.stringify(value))

test('every shader persists on every element kind and the canvas, including deterministic static frames', () => {
  for (const kind of shaderKinds) {
    const store = new SceneStore()
    const shader = { ...createShader(kind), animated: false, frame: 36000 }
    validateShader(shader)
    store.setBackgroundShader(shader)
    for (const type of ['frame', 'rectangle', 'ellipse', 'path', 'text', 'image']) store.add(type, { style: { shader } })
    const document = copy(store.toJSON())
    const restored = new SceneStore()
    restored.load(document)
    assert.deepEqual(restored.toJSON(), document)
    assert.equal(restored.getSnapshot().backgroundShader.frame, 36000)
    assert.ok(Object.isFrozen(restored.getSnapshot().backgroundShader.params))
  }
})

test('live parameter updates retain geometry, strokes and unrelated layers; removing a shader restores the solid fill', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'shape', style: { fill: '#edebe1', shader: createShader('mesh-gradient'), stroke: { color: '#080808', width: 2, dash: [] } } })
  store.add('ellipse', { id: 'other' })
  const before = store.getSnapshot()
  const next = updateShaderParameter(before.elements.shape.style.shader, 'swirl', .8)
  store.update('shape', 'rectangle', { style: { shader: next } })
  assert.equal(store.getSnapshot().elements.shape.style.shader.params.swirl, .8)
  assert.equal(store.getSnapshot().elements.other, before.elements.other)
  assert.deepEqual(store.getSnapshot().elements.shape.style.stroke, before.elements.shape.style.stroke)
  store.update('shape', 'rectangle', { x: 48 })
  assert.equal(store.getSnapshot().elements.shape.style.shader, next)
  store.update('shape', 'rectangle', { style: { shader: null } })
  assert.equal(store.getSnapshot().elements.shape.style.fill, '#edebe1')
})

test('shader data is deeply owned and immutable after insertion', () => {
  const store = new SceneStore()
  const input = copy(createShader('mesh-gradient'))
  store.setBackgroundShader(input)
  store.add('rectangle', { id: 'shape', style: { shader: input } })
  input.params.colors[0] = '#ff0000'
  const saved = store.getSnapshot().elements.shape.style.shader
  assert.equal(saved.params.colors[0], '#edebe1')
  assert.equal(store.getSnapshot().backgroundShader.params.colors[0], '#edebe1')
  assert.throws(() => { saved.params.colors.push('#080808') }, TypeError)
  assert.throws(() => { saved.params.swirl = .9 }, TypeError)
})

test('invalid shader edits and imports reject atomically', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'shape', style: { shader: createShader('mesh-gradient') } })
  const before = store.getSnapshot()
  const invalid = [
    { ...createShader('mesh-gradient'), kind: 'unknown' },
    { ...createShader('mesh-gradient'), speed: Infinity },
    { ...createShader('mesh-gradient'), scale: 0 },
    { ...createShader('mesh-gradient'), animated: 'yes' },
    { ...createShader('mesh-gradient'), params: { colors: ['#080808'] } },
    { ...createShader('dithering'), params: { ...createShader('dithering').params, shape: 'unknown' } },
    { ...createShader('halftone-cmyk'), params: { ...createShader('halftone-cmyk').params, image: 'javascript:alert(1)' } },
  ]
  for (const shader of invalid) {
    assert.throws(() => store.setBackgroundShader(shader), /Invalid shader/)
    assert.throws(() => store.update('shape', 'rectangle', { style: { shader } }), /Invalid shader/)
    assert.throws(() => store.load({ ...copy(store.toJSON()), backgroundShader: shader }), /Invalid shader/)
    assert.equal(store.getSnapshot(), before)
  }
  assert.throws(() => updateShaderParameter(createShader('mesh-gradient'), 'swirl', 2), /Invalid shader/)
})

test('legacy documents load; background edits batch once, survive element edits and reset on load', () => {
  const store = new SceneStore()
  store.load({ version: 1, elements: {}, rootIds: [] })
  assert.equal(store.getSnapshot().backgroundShader, null)
  let notifications = 0
  store.subscribe(() => notifications++)
  store.batch(() => {
    store.setBackgroundShader(createShader('neuro-noise'))
    store.add('ellipse')
    store.select(store.getSnapshot().rootIds)
  })
  assert.equal(notifications, 1)
  assert.equal(store.toJSON().backgroundShader.kind, 'neuro-noise')
  store.load({ version: 1, elements: {}, rootIds: [] })
  assert.equal(store.getSnapshot().backgroundShader, null)
  assert.equal(notifications, 2)
})

test('compositing round-trips, is deeply owned, and preserves legacy paints', () => {
  const store = new SceneStore()
  for (const blendMode of shaderBlendModes) {
    const input = { ...copy(createShader('liquid-distortion')), composite: { blendMode, opacity: .42 } }
    store.add('ellipse', { id: blendMode, style: { shader: input } })
    input.composite.opacity = 0
    const saved = store.getSnapshot().elements[blendMode].style.shader
    assert.equal(saved.composite.opacity, .42)
    assert.ok(Object.isFrozen(saved.composite))
    assert.deepEqual(updateShaderParameter(saved, 'distortion', .7).composite, saved.composite)
  }
  const restored = new SceneStore()
  restored.load(copy(store.toJSON()))
  assert.deepEqual(restored.toJSON(), store.toJSON())
  const legacy = copy(createShader('mesh-gradient'))
  delete legacy.composite
  validateShader(legacy)
  restored.setBackgroundShader(legacy)
  assert.equal(restored.getSnapshot().backgroundShader.composite, undefined)
})

test('invalid composites and fractional iteration counts reject atomically', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'shape' })
  const before = store.getSnapshot()
  for (const composite of [null, {}, { blendMode: 'unsupported', opacity: .5 }, { blendMode: 'multiply', opacity: -1 }, { blendMode: 'normal', opacity: 1.01 }, { blendMode: 'normal', opacity: NaN }, { blendMode: 'normal', opacity: '1' }, { blendMode: 'normal', opacity: .5, extra: true }]) {
    const shader = { ...createShader('perlin-noise'), composite }
    assert.throws(() => store.update('shape', 'rectangle', { style: { shader } }), /Invalid shader composite/)
    assert.throws(() => store.load({ ...copy(store.toJSON()), backgroundShader: shader }), /Invalid shader composite/)
    assert.equal(store.getSnapshot(), before)
  }
  assert.throws(() => updateShaderParameter(createShader('perlin-noise'), 'octaveCount', 2.5), /Invalid shader/)
  assert.throws(() => updateShaderParameter(createShader('liquid-distortion'), 'swirlIterations', 5.5), /Invalid shader/)
})

test('glass uses image layer sources and validates refraction uniforms', () => {
  const glass = createShader('glass-refraction', '/my-image.png')
  assert.equal(glass.params.image, '/my-image.png')
  assert.equal(glass.animated, false)
  validateShader(glass)
  for (const [key, value] of [['distortionShape', 'unknown'], ['image', 'javascript:alert(1)'], ['angle', 181], ['shift', -2]]) {
    assert.throws(() => updateShaderParameter(glass, key, value), /Invalid shader/)
  }
})

test('material changes form one undo checkpoint and restore composition', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'shape', style: { shader: createShader('liquid-distortion') } })
  const before = store.getSnapshot().elements.shape
  store.beginTransaction('Adjust material')
  for (const opacity of [.8, .6, .4]) store.update('shape', 'rectangle', { style: { shader: { ...before.style.shader, composite: { blendMode: 'screen', opacity } } } })
  store.endTransaction()
  store.undo()
  assert.deepEqual(store.getSnapshot().elements.shape, before)
  store.redo()
  assert.deepEqual(store.getSnapshot().elements.shape.style.shader.composite, { blendMode: 'screen', opacity: .4 })
})

test('SVG composites captured shaders over clipped base paint and images, below strokes', () => {
  const store = new SceneStore()
  const shader = { ...createShader('glass-refraction'), composite: { blendMode: 'multiply', opacity: .4 } }
  store.add('image', { id: 'image', src: '/source.png', fit: 'cover', cornerRadius: 12, style: { fill: '#81adec', shader, stroke: { color: '#080808', width: 2, dash: [] } } })
  store.select(['image'])
  const svg = sceneToSVG(store.getSnapshot(), { scope: 'selection', scale: 1, background: 'transparent' }, { images: new Map([['image', 'data:image/png;base64,BASE']]), shaders: new Map([['image', 'data:image/png;base64,SHADER']]) })
  assert.match(svg, /isolation:isolate/)
  assert.match(svg, /opacity="0.4" style="mix-blend-mode:multiply"/)
  assert.match(svg, /rx="12"/)
  assert.ok(svg.indexOf('fill="#81adec"') < svg.indexOf('base64,BASE'))
  assert.ok(svg.indexOf('base64,BASE') < svg.indexOf('base64,SHADER'))
  assert.ok(svg.indexOf('base64,SHADER') < svg.indexOf('stroke="#080808"'))
  assert.equal((svg.match(/fill="#81adec"/g) ?? []).length, 1)
  assert.doesNotMatch(svg, /\/source.png/)
})
