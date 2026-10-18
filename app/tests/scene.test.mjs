import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createElement } from '../src/scene/elements.ts'
import { getWorldBounds, getWorldMatrix } from '../src/scene/geometry.ts'
import { createDemoScene } from '../src/scene/seed.ts'

const copy = value => JSON.parse(JSON.stringify(value))
const tree = () => {
  const store = new SceneStore()
  store.add('frame', { id: 'a' })
  store.add('frame', { id: 'b', x: 840 })
  store.add('frame', { id: 'inner', parentId: 'a', x: 24, y: 48 })
  store.add('rectangle', { id: 'rect', parentId: 'inner', x: 12, y: 24 })
  store.add('text', { id: 'text', parentId: 'a' })
  return store
}

function assertValid(store) {
  const reloaded = new SceneStore()
  reloaded.load(copy(store.toJSON()))
  assert.deepEqual(reloaded.toJSON(), store.toJSON())
}

test('all six element kinds produce independent, immutable defaults', () => {
  const store = new SceneStore()
  for (const type of ['frame', 'rectangle', 'ellipse', 'path', 'text', 'image']) {
    const node = store.add(type)
    assert.equal(node.type, type)
    assert.ok(Object.isFrozen(node))
    assert.ok(Object.isFrozen(node.style))
    assert.ok(node.width > 0 && node.height > 0)
  }
  assert.equal(new Set(store.getSnapshot().rootIds).size, 6)
  assertValid(store)
})

test('hierarchy and z-index stay in sync after insertion and reordering', () => {
  const store = tree()
  store.add('ellipse', { id: 'circle', parentId: 'a' }, 1)
  assert.deepEqual(store.getChildren('a'), ['inner', 'circle', 'text'])
  store.reorder('text', 0)
  assert.deepEqual(store.getChildren('a'), ['text', 'inner', 'circle'])
  assert.equal(store.getSnapshot().elements.circle.zIndex, 2)
  store.reorder('text', 999)
  assert.deepEqual(store.getChildren('a'), ['inner', 'circle', 'text'])
  assertValid(store)
})

test('reparenting updates both sibling lists, local coordinates and root order', () => {
  const store = tree()
  store.reparent('inner', 'b')
  assert.deepEqual(store.getChildren('a'), ['text'])
  assert.deepEqual(store.getChildren('b'), ['inner'])
  assert.equal(store.getSnapshot().elements.inner.x, 24)
  assert.equal(store.getSnapshot().elements.rect.parentId, 'inner')
  assertValid(store)
  store.reparent('inner', null, 1)
  assert.deepEqual(store.getChildren(null), ['a', 'inner', 'b'])
  assert.deepEqual(store.getChildren('b'), [])
  assertValid(store)
  store.reparent('inner', 'a', 0)
  assert.deepEqual(store.getChildren(null), ['a', 'b'])
  assert.deepEqual(store.getChildren('a'), ['inner', 'text'])
  assertValid(store)
})

test('cycles, missing parents and non-frame parents reject atomically', () => {
  const store = tree()
  const before = store.getSnapshot()
  assert.throws(() => store.reparent('a', 'inner'), /ancestor/)
  assert.throws(() => store.reparent('a', 'a'), /ancestor/)
  assert.throws(() => store.reparent('a', 'rect'), /Only frames/)
  assert.throws(() => store.add('text', { parentId: 'missing' }), /Unknown element/)
  assert.throws(() => store.add('text', { id: 'rect' }), /Duplicate/)
  assert.throws(() => store.reparent('rect', 'b', NaN), /Invalid sibling index/)
  assert.equal(store.getSnapshot(), before)
})

test('visibility and locking are inherited; changing flags clears invalid selection', () => {
  const store = tree()
  store.select(['rect', 'text', 'rect', 'unknown'])
  assert.deepEqual(store.getSnapshot().selection, ['rect', 'text'])
  store.setVisible('inner', false)
  assert.equal(store.isVisible('rect'), false)
  assert.deepEqual(store.getSnapshot().selection, ['text'])
  store.setVisible('inner', true)
  store.select(['rect', 'text'])
  store.setLocked('a', true)
  assert.equal(store.isLocked('rect'), true)
  assert.deepEqual(store.getSnapshot().selection, [])
  assert.throws(() => store.update('rect', 'rectangle', { x: 10 }), /locked/)
  assert.throws(() => store.remove('rect'), /locked/)
  assert.throws(() => store.reorder('rect', 0), /locked/)
  assert.throws(() => store.reparent('rect', 'b'), /locked/)
  assert.throws(() => store.add('text', { parentId: 'inner' }), /locked/)
  assert.throws(() => store.reparent('b', 'inner'), /locked/)
  store.setLocked('a', false)
  store.update('rect', 'rectangle', { x: 10 })
  assert.equal(store.isLocked('rect'), false)
})

test('removal deletes descendants and stale selections and normalizes surviving order', () => {
  const store = tree()
  store.select(['rect', 'text'])
  store.remove('inner')
  assert.equal(store.getSnapshot().elements.inner, undefined)
  assert.equal(store.getSnapshot().elements.rect, undefined)
  assert.deepEqual(store.getChildren('a'), ['text'])
  assert.deepEqual(store.getSnapshot().selection, ['text'])
  assertValid(store)
  store.remove('a')
  assert.deepEqual(store.getChildren(null), ['b'])
  assert.equal(store.getSnapshot().elements.b.zIndex, 0)
  assert.deepEqual(store.getSnapshot().selection, [])
  assertValid(store)
})

test('partial style updates preserve other styling and unrelated node references', () => {
  const store = tree()
  store.update('rect', 'rectangle', { style: { stroke: { color: '#080808', width: 2, dash: [3, 4] }, shadow: { color: '#08080833', x: 2, y: 4, blur: 12 } } })
  const before = store.getSnapshot()
  store.update('rect', 'rectangle', { style: { opacity: .5 } })
  const after = store.getSnapshot()
  assert.equal(after.elements.rect.style.opacity, .5)
  assert.deepEqual(after.elements.rect.style.stroke, before.elements.rect.style.stroke)
  assert.equal(after.elements.a, before.elements.a)
  assert.equal(after.elements.text, before.elements.text)
  assert.equal(after.rootIds, before.rootIds)
  assert.equal(after.selection, before.selection)
  assert.throws(() => { after.elements.rect.style.stroke.dash.push(1) }, TypeError)
})

test('structural edits and type mismatches cannot bypass store actions', () => {
  const store = tree()
  for (const key of ['id', 'type', 'parentId', 'children', 'zIndex']) assert.throws(() => store.update('rect', 'rectangle', { [key]: 'bad' }), /structural actions/)
  assert.throws(() => store.update('rect', 'ellipse', { width: 10 }), /type mismatch/)
  assert.throws(() => store.add('frame', { children: ['rect'] }), /managed by the store/)
})

test('invalid geometry and styling reject without publishing state', () => {
  const store = tree()
  const before = store.getSnapshot()
  for (const patch of [{ width: 0 }, { height: -5 }, { x: NaN }, { rotation: Infinity }, { cornerRadius: -1 }, { style: { opacity: 1.1 } }, { style: { shadow: { color: '#000', x: 0, y: 0, blur: -2 } } }, { style: { stroke: { color: '#000', width: 1, dash: [-1] } } }]) assert.throws(() => store.update('rect', 'rectangle', patch), /Invalid/)
  assert.equal(store.getSnapshot(), before)
  assert.throws(() => createElement('path', { viewBox: [0, 0, 0, 120] }), /Invalid path/)
  assert.throws(() => createElement('text', { fontSize: -1 }), /Invalid text/)
  assert.throws(() => createElement('image', { fit: 'invalid' }), /Invalid image/)
})

test('batches notify once with a complete scene and unsubscribe removes listeners', () => {
  const store = new SceneStore()
  const seen = []
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()))
  store.batch(() => {
    store.add('frame', { id: 'frame' })
    store.batch(() => store.add('ellipse', { id: 'ellipse', parentId: 'frame' }))
    store.select(['ellipse'])
  })
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0].selection, ['ellipse'])
  assertValid(store)
  unsubscribe()
  store.remove('ellipse')
  assert.equal(seen.length, 1)
})

test('selection and unchanged ordering do not publish redundant updates', () => {
  const store = tree()
  store.select(['rect'])
  const before = store.getSnapshot()
  store.select(['rect', 'rect'])
  store.reorder('rect', 0)
  store.setLocked('rect', false)
  store.setVisible('rect', true)
  assert.equal(store.getSnapshot(), before)
})

test('documents round-trip without transient selection; frozen records prevent mutation', () => {
  const store = tree()
  store.select(['rect'])
  const document = store.toJSON()
  assert.equal('selection' in document, false)
  const restored = new SceneStore()
  restored.load(copy(document))
  assert.deepEqual(restored.toJSON(), document)
  assert.deepEqual(restored.getSnapshot().selection, [])
  assert.throws(() => { restored.getSnapshot().elements.rect.x = 99 }, TypeError)
  assert.throws(() => { restored.getChildren('a').push('bad') }, TypeError)
})

test('malformed imports reject atomically, including unreachable and duplicate nodes', () => {
  const store = tree()
  const before = store.getSnapshot()
  const cases = [
    doc => { doc.version = 2 },
    doc => { doc.rootIds.push('a') },
    doc => { doc.rootIds.push('missing') },
    doc => { doc.elements.rect.parentId = 'b' },
    doc => { doc.elements.rect.zIndex = 3 },
    doc => { doc.elements.inner.children.push('a') },
    doc => { doc.elements.a.children = [] },
    doc => { doc.elements.rect.id = 'different' },
    doc => { doc.elements.rect.style.opacity = -1 },
  ]
  for (const mutate of cases) {
    const doc = copy(store.toJSON())
    mutate(doc)
    assert.throws(() => store.load(doc))
    assert.equal(store.getSnapshot(), before)
  }
})

test('reserved IDs and inherited object properties cannot masquerade as elements', () => {
  const store = new SceneStore()
  for (const id of ['__proto__', 'constructor', 'prototype']) assert.throws(() => store.add('rectangle', { id }), /Reserved/)
  assert.throws(() => store.update('toString', 'rectangle', { width: 10 }), /Unknown/)
  assert.equal(store.isVisible('__proto__'), false)
  assert.equal(store.isLocked('constructor'), true)
  store.select(['toString'])
  assert.deepEqual(store.getSnapshot().selection, [])
})

test('world bounds include nested offsets and center-origin rotation', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'parent', x: 100, y: 200, width: 200, height: 200, rotation: 90 })
  store.add('rectangle', { id: 'child', parentId: 'parent', x: 10, y: 20, width: 40, height: 60 })
  const bounds = getWorldBounds(store.getSnapshot(), 'child')
  assert.ok(Math.abs(bounds.x - 220) < 1e-10)
  assert.ok(Math.abs(bounds.y - 210) < 1e-10)
  assert.ok(Math.abs(bounds.width - 60) < 1e-10)
  assert.ok(Math.abs(bounds.height - 40) < 1e-10)
  assert.equal(getWorldMatrix(store.getSnapshot(), 'child').length, 6)
})

test('opening artwork is an entirely editable and serializable nested scene', () => {
  const store = createDemoScene()
  assert.equal(store.getSnapshot().rootIds.length, 3)
  assert.ok(Object.keys(store.getSnapshot().elements).length > 30)
  assertValid(store)
})
