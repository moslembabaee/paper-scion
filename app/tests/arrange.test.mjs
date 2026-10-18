import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { getWorldBounds } from '../src/scene/geometry.ts'
import { alignSelection, distributeSelection, nudgeSelection, orderSelection, resizeSelection } from '../src/scene/arrange.ts'
import { measureBounds, measurementHit } from '../src/scene/measurementGeometry.ts'

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≈ ${expected}`)
const canvas = { x: -100, y: -100, width: 1000, height: 800 }
const fixture = () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'a', x: 10, y: 20, width: 30, height: 40 })
  store.add('rectangle', { id: 'b', x: 110, y: 100, width: 50, height: 60 })
  store.add('rectangle', { id: 'c', x: 300, y: 250, width: 80, height: 90 })
  store.select(['a', 'b', 'c'])
  store.clearHistory()
  return store
}

test('all six alignments align world edges or centers and undo in one command', () => {
  for (const [action, coordinate, dimension, anchor] of [
    ['left', 'x', 'width', 0], ['right', 'x', 'width', 1], ['horizontal-center', 'x', 'width', .5],
    ['top', 'y', 'height', 0], ['bottom', 'y', 'height', 1], ['vertical-center', 'y', 'height', .5],
  ]) {
    const store = fixture(), before = store.getSnapshot()
    alignSelection(store, action, canvas)
    const boxes = ['a', 'b', 'c'].map(id => getWorldBounds(store.getSnapshot(), id))
    const value = box => box[coordinate] + box[dimension] * anchor
    boxes.forEach(box => close(value(box), value(boxes[0])))
    assert.equal(store.getHistorySnapshot().undoCount, 1)
    store.undo()
    assert.deepEqual(store.getSnapshot().elements, before.elements)
  }
})

test('single alignment uses parent bounds or the visible canvas', () => {
  const store = fixture()
  store.select(['a'])
  alignSelection(store, 'right', canvas)
  close(getWorldBounds(store.getSnapshot(), 'a').x, 870)
  store.add('frame', { id: 'frame', x: 500, y: 500, width: 300, height: 200 })
  store.reparent('a', 'frame')
  alignSelection(store, 'bottom', canvas)
  close(store.getSnapshot().elements.a.y, 160)
})

test('alignment and nudge work through rotated parents; selected descendants move once', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'frame', x: 200, y: 200, width: 300, height: 300, rotation: 90 })
  store.add('rectangle', { id: 'child', parentId: 'frame', x: 20, y: 30, width: 30, height: 40 })
  store.add('rectangle', { id: 'other', x: 0, y: 0, width: 20, height: 20 })
  store.select(['child', 'other'])
  alignSelection(store, 'left', canvas)
  close(getWorldBounds(store.getSnapshot(), 'child').x, 0)
  store.select(['frame', 'child'])
  const before = getWorldBounds(store.getSnapshot(), 'child')
  nudgeSelection(store, { x: 1, y: 8 })
  const after = getWorldBounds(store.getSnapshot(), 'child')
  close(after.x - before.x, 1)
  close(after.y - before.y, 8)
})

test('distribution equalizes edge gaps for unequal sizes and keeps outer layers fixed', () => {
  for (const axis of ['horizontal', 'vertical']) {
    const store = fixture(), before = store.getSnapshot()
    distributeSelection(store, axis)
    const { a, b, c } = store.getSnapshot().elements
    const p = axis === 'horizontal' ? 'x' : 'y', size = axis === 'horizontal' ? 'width' : 'height'
    close(b[p] - a[p] - a[size], c[p] - b[p] - b[size])
    assert.deepEqual(a, before.elements.a)
    assert.deepEqual(c, before.elements.c)
    assert.equal(store.getHistorySnapshot().undoCount, 1)
  }
  const store = fixture()
  store.select(['a', 'b'])
  distributeSelection(store, 'horizontal')
  assert.equal(store.getHistorySnapshot().undoCount, 0)
})

test('distribution supports negative gaps for overlapping layers', () => {
  const store = fixture()
  for (const [id, x] of [['a', 0], ['b', 10], ['c', 20]]) store.update(id, 'rectangle', { x, width: 100 })
  distributeSelection(store, 'horizontal')
  close(store.getSnapshot().elements.b.x, 10)
})

test('keyboard resizing scales a selection and clamps dimensions without moving the anchor', () => {
  const store = fixture()
  store.select(['a'])
  resizeSelection(store, { x: 8, y: -100 })
  const node = store.getSnapshot().elements.a
  assert.equal(node.width, 38)
  assert.equal(node.height, 1)
  close(node.x, 10)
  close(node.y, 20)
  store.undo()
  store.select(['a', 'b'])
  resizeSelection(store, { x: 150, y: 0 })
  close(store.getSnapshot().elements.a.x, 10)
  close(store.getSnapshot().elements.b.x, 210)
  close(store.getSnapshot().elements.a.width, 60)
})

test('depth actions preserve selection paint order across multiple parents and locked siblings', () => {
  for (const [order, expected] of [['front', ['b', 'd', 'a', 'c']], ['back', ['a', 'c', 'b', 'd']], ['forward', ['b', 'a', 'd', 'c']], ['backward', ['a', 'c', 'b', 'd']]]) {
    const store = fixture()
    store.add('rectangle', { id: 'd' })
    store.setLocked('b', true)
    store.select(['c', 'a'])
    store.clearHistory()
    orderSelection(store, order)
    assert.deepEqual(store.getSnapshot().rootIds, expected)
    assert.equal(store.getSnapshot().elements.b.locked, true)
    assert.equal(store.getHistorySnapshot().undoCount, 1)
    store.undo()
    assert.deepEqual(store.getSnapshot().rootIds, ['a', 'b', 'c', 'd'])
  }
})

test('measurements report gaps, inset distances, zero alignment, and fractional world pixels', () => {
  const selected = { x: 10, y: 10, width: 20, height: 20 }
  const gap = measureBounds(selected, { x: 45.5, y: 10, width: 20, height: 20 })
  close(gap.find(guide => guide.axis === 'horizontal').distance, 15.5)
  assert.equal(gap.filter(guide => guide.axis === 'vertical' && guide.distance === 0).length, 2)
  const inset = measureBounds(selected, { x: 0, y: 0, width: 100, height: 100 })
  assert.deepEqual(inset.map(guide => guide.distance), [10, 70, 10, 70])
  const diagonal = measureBounds(selected, { x: 40, y: 50, width: 20, height: 20 })
  assert.deepEqual(diagonal.map(guide => guide.distance), [10, 20])
})

test('nudge and alignment preserve bindings on unchanged dimensions and no-op actions keep history', () => {
  const store = fixture()
  const width = store.addToken({ type: 'spacing', name: 'layer-width', value: 30 })
  const y = store.addToken({ type: 'spacing', name: 'layer-y', value: 20 })
  store.bindToken('a', 'width', width.id)
  store.bindToken('a', 'y', y.id)
  store.select(['a'])
  nudgeSelection(store, { x: 1, y: 0 })
  assert.deepEqual(store.getSnapshot().elements.a.tokenBindings, { width: width.id, y: y.id })
  alignSelection(store, 'left', canvas)
  assert.deepEqual(store.getSnapshot().elements.a.tokenBindings, { width: width.id, y: y.id })
  store.clearHistory()
  alignSelection(store, 'left', canvas)
  assert.equal(store.getHistorySnapshot().undoCount, 0)
  resizeSelection(store, { x: 1, y: 0 })
  assert.deepEqual(store.getSnapshot().elements.a.tokenBindings, { y: y.id })
})

test('measurement hits include locked layers and honor paint order, visibility, rotation and clipping', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'f', width: 100, height: 100, x: 0, y: 0, clipContent: true })
  store.add('rectangle', { id: 'child', parentId: 'f', x: 90, y: 0, width: 50, height: 50, locked: true })
  assert.equal(measurementHit(store.getSnapshot(), { x: 95, y: 25 }), 'child')
  assert.equal(measurementHit(store.getSnapshot(), { x: 125, y: 25 }), null)
  store.update('f', 'frame', { clipContent: false, rotation: 90 })
  assert.equal(measurementHit(store.getSnapshot(), { x: 75, y: 125 }), 'child')
  store.setVisible('child', false)
  assert.equal(measurementHit(store.getSnapshot(), { x: 75, y: 125 }), null)
})
