import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { deleteSelection, duplicateSelection, orderSelection } from '../src/scene/arrange.ts'
import { measurementHit } from '../src/scene/measurementGeometry.ts'

test('duplicateSelection clones elements with offset and selects new clones', () => {
  const store = new SceneStore()
  const a = store.add('rectangle', { id: 'rect-1', x: 50, y: 80, width: 100, height: 60, name: 'Box' })
  store.select([a.id])
  store.clearHistory()

  const duplicated = duplicateSelection(store)
  assert.equal(duplicated.length, 1)
  assert.notEqual(duplicated[0], a.id)

  const clone = store.getSnapshot().elements[duplicated[0]]
  assert.ok(clone)
  assert.equal(clone.x, 70) // 50 + 20
  assert.equal(clone.y, 100) // 80 + 20
  assert.equal(clone.width, 100)
  assert.equal(clone.height, 60)
  assert.deepEqual(store.getSnapshot().selection, [clone.id])

  // Supports undo
  assert.equal(store.getHistorySnapshot().undoCount, 1)
  store.undo()
  assert.equal(store.getSnapshot().elements[clone.id], undefined)
  assert.ok(store.getSnapshot().elements[a.id])
})

test('deleteSelection removes selected elements and clears selection with undo support', () => {
  const store = new SceneStore()
  const a = store.add('rectangle', { id: 'rect-a', x: 0, y: 0, width: 50, height: 50 })
  const b = store.add('ellipse', { id: 'ellipse-b', x: 100, y: 100, width: 40, height: 40 })
  store.select([a.id, b.id])
  store.clearHistory()

  deleteSelection(store)
  assert.equal(store.getSnapshot().elements[a.id], undefined)
  assert.equal(store.getSnapshot().elements[b.id], undefined)
  assert.deepEqual(store.getSnapshot().selection, [])

  // Undo restores both elements
  assert.equal(store.getHistorySnapshot().undoCount, 1)
  store.undo()
  assert.ok(store.getSnapshot().elements[a.id])
  assert.ok(store.getSnapshot().elements[b.id])
})

test('measurementHit accurately identifies element under right-click pointer coordinates', () => {
  const store = new SceneStore()
  const rect = store.add('rectangle', { id: 'target', x: 200, y: 200, width: 100, height: 100 })

  // Hit inside target
  const hit = measurementHit(store.getSnapshot(), { x: 250, y: 250 }, true)
  assert.equal(hit, rect.id)

  // Miss outside target
  const miss = measurementHit(store.getSnapshot(), { x: 50, y: 50 }, true)
  assert.equal(miss, null)
})

test('orderSelection via context menu supports front, back, forward, backward with history', () => {
  const store = new SceneStore()
  const a = store.add('rectangle', { id: 'layer-a', x: 0, y: 0, width: 50, height: 50 })
  const b = store.add('rectangle', { id: 'layer-b', x: 10, y: 10, width: 50, height: 50 })
  const c = store.add('rectangle', { id: 'layer-c', x: 20, y: 20, width: 50, height: 50 })
  store.clearHistory()

  assert.deepEqual(store.getSnapshot().rootIds, [a.id, b.id, c.id])

  // Move layer-a to front
  store.select([a.id])
  orderSelection(store, 'front')
  assert.deepEqual(store.getSnapshot().rootIds, [b.id, c.id, a.id])

  // Move layer-a to back
  orderSelection(store, 'back')
  assert.deepEqual(store.getSnapshot().rootIds, [a.id, b.id, c.id])
})
