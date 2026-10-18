import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { frameMask, maskPathData, shapeContainsWorldPoint } from '../src/scene/maskGeometry.ts'
import { getWorldMatrix } from '../src/scene/geometry.ts'
import { measurementHit } from '../src/scene/measurementGeometry.ts'
import { sceneToSVG } from '../src/io/svg.ts'
import { buildReactComponent } from '../src/tokens/codegen.ts'
import { createShader } from '../src/shaders/catalog.ts'

const fixture = () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'behind', width: 200, height: 200 })
  store.add('frame', { id: 'group', width: 200, height: 200, clipContent: false, style: { fill: null } })
  store.add('rectangle', { id: 'content', parentId: 'group', width: 200, height: 200 })
  store.add('path', { id: 'mask', parentId: 'group', width: 100, height: 100, viewBox: [0, 0, 100, 100], d: 'M0 0H100V100H0Z M25 25H75V75H25Z', fillRule: 'evenodd' })
  store.setMask('mask', true)
  store.clearHistory()
  return store
}
const hit = (store, x, y) => measurementHit(store.getSnapshot(), { x, y }, true)
const options = { scope: 'canvas', scale: 1, background: 'transparent' }

test('mask holes and clipped-away areas pass through to lower paint layers', () => {
  const store = fixture()
  assert.equal(hit(store, 10, 10), 'content')
  assert.equal(hit(store, 50, 50), 'behind')
  assert.equal(hit(store, 150, 50), 'behind')
  store.setLocked('content', true)
  assert.equal(hit(store, 10, 10), 'group')
  assert.equal(measurementHit(store.getSnapshot(), { x: 10, y: 10 }), 'content')
})

test('live path and parameter edits invalidate cached clipping geometry with undo', () => {
  const store = fixture(), before = maskPathData(store.getSnapshot().elements.mask)
  store.update('mask', 'path', { x: 100, d: 'M0 0H100V100H0Z' })
  assert.equal(hit(store, 10, 10), 'behind')
  assert.equal(hit(store, 150, 50), 'content')
  assert.notEqual(maskPathData(store.getSnapshot().elements.mask), before)
  store.undo()
  assert.equal(maskPathData(store.getSnapshot().elements.mask), before)
  assert.equal(hit(store, 50, 50), 'behind')
})

test('disable, visibility, outline and release preserve editable geometry and history', () => {
  const store = fixture(), before = store.getSnapshot()
  store.setMaskOutline('mask', true)
  assert.ok(Object.isFrozen(store.getSnapshot().elements.mask.mask))
  store.setMask('mask', false)
  assert.equal(hit(store, 150, 50), 'content')
  assert.equal(hit(store, 10, 10), 'mask')
  store.undo(); assert.equal(hit(store, 150, 50), 'behind')
  store.setVisible('mask', false)
  assert.equal(hit(store, 150, 50), 'content')
  store.undo()
  store.setMask('mask', null)
  assert.equal(store.getSnapshot().elements.mask.mask, undefined)
  store.undo(); store.undo()
  assert.equal(store.getSnapshot(), before)
})

test('group selected siblings atomically and retain world transforms inside rotated parents', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'parent', x: 50, y: 70, rotation: 35 })
  store.add('rectangle', { id: 'content', parentId: 'parent', x: 15, y: 25, width: 160, rotation: 15 })
  store.add('ellipse', { id: 'mask', parentId: 'parent', x: 70, y: 40, width: 80, height: 100, rotation: -25 })
  store.select(['mask', 'content']); store.clearHistory()
  const before = store.getSnapshot(), matrices = ['content', 'mask'].map(id => getWorldMatrix(before, id))
  const group = store.maskSelection()
  assert.equal(frameMask(store.getSnapshot().elements, group).id, 'mask')
  for (const [i, id] of ['content', 'mask'].entries()) getWorldMatrix(store.getSnapshot(), id).forEach((value, j) => assert.ok(Math.abs(value - matrices[i][j]) < 1e-8))
  assert.equal(store.getHistorySnapshot().undoCount, 1)
  store.undo(); assert.equal(store.getSnapshot(), before)
  store.redo(); assert.equal(store.getSnapshot().elements.mask.parentId, group.id)
})

test('nested masks intersect their ancestor clips including rotated rounded frame sources', () => {
  const store = fixture()
  store.add('frame', { id: 'inner', parentId: 'group', width: 100, height: 100, clipContent: false, style: { fill: null } })
  store.add('rectangle', { id: 'nested-content', parentId: 'inner', width: 100, height: 100 })
  store.add('frame', { id: 'frame-mask', parentId: 'inner', x: 0, y: 0, width: 30, height: 30, cornerRadius: 10, rotation: 90 })
  store.setMask('frame-mask', true)
  assert.equal(hit(store, 10, 10), 'nested-content')
  assert.equal(hit(store, 50, 50), 'behind')
  assert.equal(hit(store, 2, 2), 'content')
  store.update('frame-mask', 'frame', { x: 100 })
  assert.equal(hit(store, 10, 10), 'content')
})

test('boolean outlines can be masks; source edits recompute the clip without flattening', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'group', width: 200, height: 200, clipContent: false, style: { fill: null } })
  store.add('rectangle', { id: 'content', parentId: 'group', width: 200, height: 200 })
  store.add('rectangle', { id: 'base', parentId: 'group', width: 100, height: 100 })
  store.add('ellipse', { id: 'cut', parentId: 'group', x: 25, y: 25, width: 50, height: 50 })
  const compound = store.booleanSelection('subtract', false, ['base', 'cut'])
  store.setMask(compound.id, true)
  assert.equal(hit(store, 10, 10), 'content')
  assert.equal(hit(store, 50, 50), null)
  assert.throws(() => store.releaseBoolean(compound.id), /Release the mask/)
  store.updateBooleanOperand(compound.id, 'cut', { x: 125 })
  assert.equal(hit(store, 50, 50), 'content')
  assert.ok(store.getSnapshot().elements[compound.id].boolean)
  store.flattenBoolean(compound.id)
  assert.equal(store.getSnapshot().elements[compound.id].mask.enabled, true)
})

test('documents, components, SVG and React handoff retain clipping and exclude mask paint/chrome', () => {
  const store = fixture()
  store.setMaskOutline('mask', true)
  const document = JSON.parse(JSON.stringify(store.toJSON()))
  const restored = new SceneStore(); restored.load(document)
  assert.equal(hit(restored, 50, 50), 'behind')
  const svg = sceneToSVG(restored.getSnapshot(), options)
  assert.match(svg, /clip-rule="evenodd"/)
  assert.doesNotMatch(svg, /<title>Vector path<\/title>|stroke-dasharray="4 3"/)
  restored.select(['content'])
  assert.match(sceneToSVG(restored.getSnapshot(), { ...options, scope: 'selection' }), /clip-rule="evenodd"/)
  assert.match(buildReactComponent(restored.getSnapshot().elements.group, [], undefined, restored.getSnapshot().elements), /clipPathUnits="userSpaceOnUse"/)
  store.createComponent('group')
  const instance = store.createComponentInstance('group', { x: 300, y: 0 })
  const instanceMask = frameMask(store.getSnapshot().elements, instance)
  assert.notEqual(instanceMask.id, 'mask')
  assert.equal(shapeContainsWorldPoint(store.getSnapshot(), instanceMask, { x: 350, y: 50 }), false)
  store.update('mask', 'path', { d: 'M0 0H100V100H0Z' })
  assert.equal(shapeContainsWorldPoint(store.getSnapshot(), store.getSnapshot().elements[instanceMask.id], { x: 350, y: 50 }), true)
})

test('reject invalid mask structure atomically and replace sibling roles in one history step', () => {
  const store = fixture()
  store.add('ellipse', { id: 'other', parentId: 'group' })
  const before = store.getSnapshot()
  assert.throws(() => store.load({ ...store.toJSON(), elements: { ...before.elements, other: { ...before.elements.other, mask: { enabled: true, showOutline: false } } } }), /only one mask/)
  assert.equal(store.getSnapshot(), before)
  assert.throws(() => store.update('mask', 'path', { mask: null }), /structural/)
  store.setMask('other', true)
  assert.equal(store.getSnapshot().elements.mask.mask, undefined)
  store.undo(); assert.equal(store.getSnapshot(), before)
  store.setLocked('mask', true)
  const locked = store.getSnapshot()
  assert.throws(() => store.setMask('other', true), /Unlock/)
  assert.equal(store.getSnapshot(), locked)
})

test('auto layout flows content while the mask source stays in its own position', () => {
  const store = fixture()
  store.update('group', 'frame', { layout: { direction: 'horizontal', gap: 10, padding: { top: 10, right: 10, bottom: 10, left: 10 }, justify: 'start', align: 'start' } })
  assert.equal(store.getSnapshot().elements.content.x, 10)
  assert.equal(store.getSnapshot().elements.mask.x, 0)
})

test('inverted vector clipping inverts visible region and passes through to lower layers', () => {
  const store = fixture()
  // Before invert: (10, 10) is inside mask path -> hits 'content'; (150, 50) is outside mask -> hits 'behind'
  assert.equal(hit(store, 10, 10), 'content')
  assert.equal(hit(store, 150, 50), 'behind')

  // Invert mask
  store.setMaskInverted('mask', true)
  assert.equal(store.getSnapshot().elements.mask.mask.inverted, true)

  // After invert: (10, 10) is now clipped away -> hits 'behind'; (150, 50) is now visible -> hits 'content'
  assert.equal(hit(store, 10, 10), 'behind')
  assert.equal(hit(store, 150, 50), 'content')

  // Undo restores original clipping
  store.undo()
  assert.equal(store.getSnapshot().elements.mask.mask.inverted, false)
  assert.equal(hit(store, 10, 10), 'content')
  assert.equal(hit(store, 150, 50), 'behind')
})

test('alpha and inverted alpha mask evaluate opacity and transparency channel', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'behind', width: 200, height: 200 })
  store.add('frame', { id: 'group', width: 200, height: 200, clipContent: false, style: { fill: null } })
  store.add('rectangle', { id: 'content', parentId: 'group', width: 200, height: 200 })
  store.add('rectangle', { id: 'mask', parentId: 'group', width: 100, height: 100, style: { fill: '#ffffff', opacity: 1 } })
  store.setMask('mask', true)
  store.setMaskMode('mask', 'alpha')

  assert.equal(store.getSnapshot().elements.mask.mask.mode, 'alpha')
  assert.equal(hit(store, 50, 50), 'content')
  assert.equal(hit(store, 150, 50), 'behind')

  // When mask fill is 'none', alpha is 0 -> content clipped away
  store.update('mask', 'rectangle', { style: { fill: null, opacity: 0 } })
  assert.equal(hit(store, 50, 50), 'behind')

  // Inverting alpha mask makes transparent area visible
  store.setMaskInverted('mask', true)
  assert.equal(hit(store, 50, 50), 'content')
})

test('luminance-based gradient mask evaluates color luminance and thresholding', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'behind', width: 200, height: 200 })
  store.add('frame', { id: 'group', width: 200, height: 200, clipContent: false, style: { fill: null } })
  store.add('rectangle', { id: 'content', parentId: 'group', width: 200, height: 200 })
  // Mask with white fill (luminance = 1.0)
  store.add('rectangle', { id: 'mask', parentId: 'group', width: 100, height: 100, style: { fill: '#ffffff' } })
  store.setMask('mask', true)
  store.setMaskMode('mask', 'luminance')
  store.setMaskLuminanceThreshold('mask', 0.5)

  assert.equal(store.getSnapshot().elements.mask.mask.mode, 'luminance')
  assert.equal(store.getSnapshot().elements.mask.mask.luminanceThreshold, 0.5)
  assert.equal(hit(store, 50, 50), 'content')

  // Dark black fill (luminance = 0.0 < 0.5 threshold) -> clipped away
  store.update('mask', 'rectangle', { style: { fill: '#000000' } })
  assert.equal(hit(store, 50, 50), 'behind')

  // Inverted luminance: black passes!
  store.setMaskInverted('mask', true)
  assert.equal(hit(store, 50, 50), 'content')

  // Multi-stop gradient mask: linear from #ffffff (left, x=0) to #000000 (right, x=100)
  store.setMaskInverted('mask', false)
  store.update('mask', 'rectangle', {
    style: {
      fill: '#ffffff',
      gradient: {
        type: 'linear',
        angle: 0,
        origin: { x: 0.5, y: 0.5 },
        focalLength: 0,
        spread: 1,
        stops: [
          { id: 's1', offset: 0, color: '#ffffff', opacity: 1 },
          { id: 's2', offset: 1, color: '#000000', opacity: 1 },
        ],
      },
    },
  })
  // Left half (x=10) has high luminance (>= 0.5) -> passes to content
  assert.equal(hit(store, 10, 50), 'content')
  // Right half (x=90) has low luminance (< 0.5) -> clipped to behind
  assert.equal(hit(store, 90, 50), 'behind')
})

test('on-canvas mask isolation controls and state methods', () => {
  const store = fixture()
  assert.equal(store.getIsolatedMaskId(), null)

  // Isolate mask
  store.setMaskIsolated('mask', true)
  assert.equal(store.getSnapshot().elements.mask.mask.isolated, true)
  assert.equal(store.getIsolatedMaskId(), 'mask')

  // Toggle isolation off
  store.toggleMaskIsolation('mask')
  assert.equal(store.getSnapshot().elements.mask.mask.isolated, false)
  assert.equal(store.getIsolatedMaskId(), null)

  // Toggle back on
  store.toggleMaskIsolation('mask')
  assert.equal(store.getIsolatedMaskId(), 'mask')
  store.undo()
  assert.equal(store.getIsolatedMaskId(), null)
})

test('masking across WebGL shader surfaces and SVG export fidelity', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'group', width: 200, height: 200, clipContent: false, style: { fill: null } })
  // Node with WebGL shader paint
  store.add('rectangle', {
    id: 'shader-layer',
    parentId: 'group',
    width: 200,
    height: 200,
    style: {
      fill: '#81adec',
      shader: {
        ...createShader('procedural-noise'),
        animated: false,
      },
    },
  })
  store.add('ellipse', { id: 'mask-shape', parentId: 'group', width: 100, height: 100, style: { fill: '#ffffff' } })
  store.setMask('mask-shape', true)
  store.setMaskMode('mask-shape', 'luminance')
  store.setMaskInverted('mask-shape', true)

  const snap = store.getSnapshot()
  assert.equal(snap.elements['mask-shape'].mask.mode, 'luminance')
  assert.equal(snap.elements['mask-shape'].mask.inverted, true)

  const svg = sceneToSVG(snap, options, { shaders: new Map([['shader-layer', 'data:image/png;base64,SHADER']]) })
  assert.match(svg, /mask="url\(#paper-export-/)
  assert.match(svg, /mask-type="luminance"|<mask/)
})

