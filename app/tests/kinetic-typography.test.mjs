import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from '../src/scene/elements.ts'
import { SceneStore } from '../src/scene/store.ts'
import { loadOutlineFont, shapeText, fontInstance } from '../src/scene/fontEngine.ts'
import { createBaseline, DEFAULT_KINETIC, cascadeOffset, placeGlyphs, glyphOutlines } from '../src/scene/kineticGeometry.ts'
import { parsePath } from '../src/scene/pathGeometry.ts'
import { sceneToSVG, exportBounds } from '../src/io/svg.ts'

const fontSource = `data:font/ttf;base64,${readFileSync(new URL('../public/fonts/InterVariable-latin.ttf', import.meta.url)).toString('base64')}`
const font = await loadOutlineFont(fontSource)
const text = (patch = {}) => createElement('text', { id: 'type', text: 'Paper', fontFamily: 'PaperInter', fontSource, width: 360, height: 120, ...patch })
const geometry = node => placeGlyphs(node, shapeText(font, node), font.unitsPerEm, 'M0 60 C80 0 240 120 360 60')

test('weight changes real glyph outlines and metrics, not a simulated stroke', () => {
  const light = shapeText(font, text({ variableAxes: { wght: 100 } })).lines[0]
  const black = shapeText(font, text({ variableAxes: { wght: 900 } })).lines[0]
  assert.notEqual(light.glyphs[0].d, black.glyphs[0].d)
  assert.notEqual(light.width, black.width)
  assert.equal(fontInstance(font, text({ variableAxes: { wght: 999 } })), fontInstance(font, text({ variableAxes: { wght: 900 } })))
})

test('all four requested axes clamp to font ranges, including automatic optical size', () => {
  const supported = { wght: { min: 100, max: 900 }, wdth: { min: 50, max: 150 }, slnt: { min: -12, max: 0 }, opsz: { min: 8, max: 72 } }
  let actual
  const fake = { variationAxes: supported, getVariation(axes) { actual = axes; return { unitsPerEm: 1000 } } }
  fontInstance(fake, text({ fontSize: 96, variableAxes: { wght: 999, wdth: 10, slnt: 20 } }))
  assert.deepEqual(actual, { wght: 900, opsz: 72, wdth: 50, slnt: 0 })
})

test('baseline sampling supports lines, curved tangents, arcs and zero-length curves', () => {
  const line = createBaseline('M0 0 L100 0')
  assert.equal(line.length, 100)
  assert.deepEqual(line.at(50), { x: 50, y: 0, angle: 0 })
  const curve = createBaseline('M0 0 C0 100 100 100 100 0')
  assert.ok(Math.abs(curve.length - 200) < .1)
  assert.ok(Math.abs(curve.at(curve.length / 2).x - 50) < .1)
  assert.ok(Math.abs(curve.at(curve.length / 2).y - 75) < .1)
  assert.ok(Math.abs(createBaseline('M0 0 A50 50 0 0 1 100 0').length - Math.PI * 50) < .2)
  assert.deepEqual(createBaseline('M0 0 L0 0').at(0), { x: 0, y: 0, angle: 0 })
})

test('centered glyphs follow curve normals and off-path glyphs are clipped', () => {
  const node = text({ textOnPath: { enabled: true, align: 'center', offset: 50 } })
  const glyphs = geometry(node)
  assert.equal(glyphs.length, 5)
  assert.ok(glyphs.some(glyph => Math.abs(glyph.angle) > 1))
  assert.equal(placeGlyphs(text({ textOnPath: { enabled: true, offset: 100 } }), shapeText(font, node), font.unitsPerEm, 'M0 0 L10 0').length, 0)
})

test('cascade offsets are deterministic, staggered and match animation quarter cycles', () => {
  const k = { ...DEFAULT_KINETIC, phase: .25, amplitude: 20, rotation: 10, stagger: 0 }
  assert.deepEqual(cascadeOffset(k, 0), { y: -20, angle: -10 })
  assert.deepEqual(cascadeOffset({ ...k, phase: .75 }, 0), { y: 20, angle: 10 })
  assert.notDeepEqual(cascadeOffset(DEFAULT_KINETIC, 0), cascadeOffset(DEFAULT_KINETIC, 1))
  assert.deepEqual(cascadeOffset({ ...k, enabled: false }, 1), { y: 0, angle: 0 })
})

test('outlines retain holes and bake phase into curved glyph geometry', () => {
  const node = text({ text: 'O', textOnPath: { enabled: true, align: 'center' } })
  const glyphs = geometry(node)
  const d = glyphOutlines(glyphs)
  const animated = glyphOutlines(glyphs, { ...DEFAULT_KINETIC, phase: .25 })
  assert.ok(parsePath(d).length >= 2, 'O must retain its inner contour')
  assert.notEqual(animated, d)
  assert.ok(parsePath(animated).every(contour => contour.closed))
})

test('conversion retains identity, nesting, transforms, paint order and one-step undo', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'frame', rotation: 20 })
  store.add('rectangle', { id: 'before', parentId: 'frame' })
  store.add('text', { id: 'type', fontSource, text: 'Paper', parentId: 'frame', x: 30, y: 40, rotation: 15 })
  store.add('rectangle', { id: 'after', parentId: 'frame' })
  const before = store.getSnapshot().elements.type
  store.convertTextToOutlines('type', glyphOutlines(geometry(before)))
  const converted = store.getSnapshot().elements.type
  assert.equal(converted.type, 'path')
  for (const key of ['id', 'parentId', 'x', 'y', 'width', 'height', 'rotation', 'zIndex']) assert.equal(converted[key], before[key])
  assert.deepEqual(converted.style, before.style)
  assert.deepEqual(store.getSnapshot().elements.frame.children, ['before', 'type', 'after'])
  store.undo(); assert.equal(store.getSnapshot().elements.type.type, 'text')
  store.redo(); assert.equal(store.getSnapshot().elements.type.type, 'path')
})

test('settings are immutable, survive document round trips and reject invalid values', () => {
  const store = new SceneStore()
  store.add('text', { id: 'type', kinetic: DEFAULT_KINETIC })
  assert.ok(Object.isFrozen(store.getSnapshot().elements.type.kinetic))
  for (const patch of [{ duration: 0 }, { phase: 2 }, { stagger: -1 }, { amplitude: NaN }, { playing: 'yes' }]) assert.throws(() => store.update('type', 'text', { kinetic: { ...DEFAULT_KINETIC, ...patch } }))
  const roundtrip = new SceneStore()
  roundtrip.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(roundtrip.getSnapshot().elements.type.kinetic, DEFAULT_KINETIC)
})

test('SVG uses selected-phase outlines without clipping and reserves motion bounds', () => {
  const store = new SceneStore(); const node = store.add('text', { id: 'type', fontSource, text: 'Paper', kinetic: DEFAULT_KINETIC })
  const outlines = glyphOutlines(geometry(node), node.kinetic)
  const svg = sceneToSVG(store.getSnapshot(), { scope: 'canvas', scale: 1, background: 'transparent' }, { images: new Map(), shaders: new Map(), textOutlines: new Map([['type', outlines]]) })
  assert.match(svg, /fill-rule="nonzero"/)
  assert.doesNotMatch(svg, /<text\b|clip-path=/)
  const bounds = exportBounds(store.getSnapshot(), 'canvas')
  assert.ok(bounds.width > node.width && bounds.height > node.height)
})

test('kinetic stagger modes: cascade, wave, center-out, random, and elastic', () => {
  const base = { ...DEFAULT_KINETIC, phase: 0.1, amplitude: 24, rotation: 12, stagger: 50, duration: 2.0 }
  const total = 5

  // 1. Center-out: symmetric glyphs around center have equal displacement
  const centerOutKinetic = { ...base, staggerMode: 'center-out' }
  const left = cascadeOffset(centerOutKinetic, 0, total)
  const right = cascadeOffset(centerOutKinetic, 4, total)
  assert.ok(Math.abs(left.y - right.y) < 1e-4, 'Left and right symmetric glyphs have equal y displacement')
  assert.ok(Math.abs(left.angle - right.angle) < 1e-4, 'Left and right symmetric glyphs have equal angle')

  // Midpoint glyph (index 2 in 5 glyphs) has delay = 0
  const mid = cascadeOffset(centerOutKinetic, 2, total)
  const zeroDelay = cascadeOffset({ ...base, stagger: 0 }, 0, total)
  assert.ok(Math.abs(mid.y - zeroDelay.y) < 1e-4, 'Center glyph has zero stagger delay')

  // 2. Wave stagger: sinusoidal distribution
  const waveKinetic = { ...base, staggerMode: 'wave' }
  const w0 = cascadeOffset(waveKinetic, 0, total)
  const w4 = cascadeOffset(waveKinetic, 4, total)
  // At index 0 and index (total - 1), sin(0) = 0 and sin(PI) = 0, so delays match
  assert.ok(Math.abs(w0.y - w4.y) < 1e-4, 'Wave ends have matching delay')

  // 3. Random stagger: deterministic pseudo-random distribution
  const randKinetic = { ...base, staggerMode: 'random' }
  const r0 = cascadeOffset(randKinetic, 0, total)
  const r1 = cascadeOffset(randKinetic, 1, total)
  const r0Again = cascadeOffset(randKinetic, 0, total)
  assert.deepEqual(r0, r0Again, 'Random stagger is deterministic for identical index')
  assert.notDeepEqual(r0, r1, 'Different indices produce distinct offsets in random mode')

  // 4. Elastic stagger: harmonic cosine
  const elasticKinetic = { ...base, staggerMode: 'elastic' }
  const e0 = cascadeOffset(elasticKinetic, 0, total)
  const e1 = cascadeOffset(elasticKinetic, 1, total)
  assert.notDeepEqual(e0, e1)
})

test('kinetic waveforms: triangle, sine, bounce, and spring dynamics', () => {
  const base = { ...DEFAULT_KINETIC, phase: 0.25, amplitude: 30, rotation: 15, stagger: 0, duration: 2.0 }

  // 1. Triangle waveform: at cycle = 0.25, wave = -4 * 0.25 = -1 -> y = -30
  const tri = cascadeOffset({ ...base, waveShape: 'triangle', phase: 0.25 }, 0, 1)
  assert.ok(Math.abs(tri.y - (-30)) < 1e-3)
  assert.ok(Math.abs(tri.angle - (-15)) < 1e-3)

  // 2. Sine waveform: at cycle = 0.25, wave = -sin(0.25 * 2PI) = -1 -> y = -30
  const sin = cascadeOffset({ ...base, waveShape: 'sine', phase: 0.25 }, 0, 1)
  assert.ok(Math.abs(sin.y - (-30)) < 1e-3)

  // At cycle = 0, wave = -sin(0) = 0 -> y = 0
  const sin0 = cascadeOffset({ ...base, waveShape: 'sine', phase: 0 }, 0, 1)
  assert.ok(Math.abs(sin0.y) < 1e-3)

  // 3. Bounce waveform: rectified wave
  const bounce = cascadeOffset({ ...base, waveShape: 'bounce', phase: 0.25 }, 0, 1)
  // wave = |sin(0.25 * 2PI)| * 2 - 1 = 1 * 2 - 1 = 1 -> y = 30
  assert.ok(Math.abs(bounce.y - 30) < 1e-3)

  // 4. Spring waveform: damped harmonic oscillation
  const spr = cascadeOffset({ ...base, waveShape: 'spring', phase: 0.1 }, 0, 1)
  assert.ok(Number.isFinite(spr.y))
  assert.ok(Number.isFinite(spr.angle))
})

test('variable font dynamics modulation across glyph cascade (weight, slant, scale)', () => {
  const k = {
    ...DEFAULT_KINETIC,
    phase: 0.25, // wave = -1 in triangle
    amplitude: 20,
    rotation: 5,
    stagger: 0,
    weightModulation: 200,
    slantModulation: 10,
    scaleModulation: 0.25,
  }

  const offset = cascadeOffset(k, 0, 1)
  assert.equal(offset.y, -20)
  assert.equal(offset.angle, -5)
  // wave = -1 -> weightDelta = -200, slantDelta = -10, scale = 1 + (-1 * 0.25) = 0.75
  assert.ok(Math.abs((offset.weightDelta ?? 0) - (-200)) < 1e-3)
  assert.ok(Math.abs((offset.slantDelta ?? 0) - (-10)) < 1e-3)
  assert.ok(Math.abs((offset.scale ?? 1) - 0.75) < 1e-3)

  // Inverted phase: phase = 0.75 -> wave = 1
  const kInvert = { ...k, phase: 0.75 }
  const offsetInv = cascadeOffset(kInvert, 0, 1)
  assert.ok(Math.abs((offsetInv.weightDelta ?? 0) - 200) < 1e-3)
  assert.ok(Math.abs((offsetInv.slantDelta ?? 0) - 10) < 1e-3)
  assert.ok(Math.abs((offsetInv.scale ?? 1) - 1.25) < 1e-3)

  // Vector outlines reflect scale modulation
  const node = text({ text: 'O', textOnPath: { enabled: true, align: 'center' } })
  const glyphs = geometry(node)
  const dNormal = glyphOutlines(glyphs, { ...DEFAULT_KINETIC, phase: 0.75, scaleModulation: 0 })
  const dScaled = glyphOutlines(glyphs, { ...DEFAULT_KINETIC, phase: 0.75, scaleModulation: 0.5 })
  assert.notEqual(dNormal, dScaled, 'Scale modulation affects baked glyph outline geometry')
})

test('closed-loop Bézier baseline loops seamlessly and multi-contour paths compute length', () => {
  // Closed loop: circle path M 0 0 C ... Z
  const circleD = 'M 50 0 C 100 0 100 100 50 100 C 0 100 0 0 50 0 Z'
  const closedBase = createBaseline(circleD)
  assert.ok(closedBase.closed)
  assert.ok(closedBase.length > 0)

  // Distance beyond length wraps around modulo length
  const p0 = closedBase.at(0)
  const pWrapped = closedBase.at(closedBase.length)
  const pDoubleWrapped = closedBase.at(closedBase.length * 2)
  assert.ok(Math.abs(p0.x - pWrapped.x) < 0.1)
  assert.ok(Math.abs(p0.y - pWrapped.y) < 0.1)
  assert.ok(Math.abs(p0.x - pDoubleWrapped.x) < 0.1)
  assert.ok(Math.abs(p0.y - pDoubleWrapped.y) < 0.1)

  // Multi-contour baseline: two disconnected segments
  const multiD = 'M 0 0 L 100 0 M 200 0 L 300 0'
  const multiBase = createBaseline(multiD)
  assert.ok(multiBase.length >= 200)
})

test('element validator validates and persists extended kinetic typography properties', () => {
  const store = new SceneStore()
  const validKinetic = {
    ...DEFAULT_KINETIC,
    staggerMode: 'elastic',
    waveShape: 'spring',
    weightModulation: 150,
    slantModulation: -10,
    scaleModulation: 0.4,
  }

  store.add('text', { id: 'type-advanced', kinetic: validKinetic })
  const saved = store.getSnapshot().elements['type-advanced'].kinetic
  assert.deepEqual(saved, validKinetic)

  // Reject invalid staggerMode
  assert.throws(() => store.update('type-advanced', 'text', { kinetic: { ...validKinetic, staggerMode: 'invalid' } }))
  // Reject invalid waveShape
  assert.throws(() => store.update('type-advanced', 'text', { kinetic: { ...validKinetic, waveShape: 'square' } }))
  // Reject out-of-bounds weight modulation (> 500)
  assert.throws(() => store.update('type-advanced', 'text', { kinetic: { ...validKinetic, weightModulation: 600 } }))
  // Reject out-of-bounds slant modulation (> 30)
  assert.throws(() => store.update('type-advanced', 'text', { kinetic: { ...validKinetic, slantModulation: 45 } }))
  // Reject out-of-bounds scale modulation (> 1)
  assert.throws(() => store.update('type-advanced', 'text', { kinetic: { ...validKinetic, scaleModulation: 1.5 } }))
})

