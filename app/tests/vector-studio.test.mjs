import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { sceneVertexIndex, VertexIndex } from '../src/scene/vertexSnapping.ts'

test('vertex snapping measures an eight pixel radius at every zoom and chooses the nearest vertex', () => {
  const index = new VertexIndex([{ x: 10, y: 20, label: 'near' }, { x: 15, y: 20, label: 'far' }])
  assert.equal(index.nearest({ x: 3, y: 20 }, 1)?.label, 'near')
  assert.equal(index.nearest({ x: 3, y: 20 }, 2), null)
  assert.equal(index.nearest({ x: -5, y: 20 }, .5)?.label, 'near')
  assert.equal(index.nearest({ x: -7, y: 20 }, .5), null)
  assert.equal(index.nearest({ x: 10, y: 28.1 }, 1), null)
  assert.equal(index.nearest({ x: 14, y: 20 }, 1)?.label, 'far')
  assert.equal(new VertexIndex([]).nearest({ x: 0, y: 0 }, 1), null)
})

test('scene vertices follow parent rotation, path viewBox scaling and element rotation', () => {
  const store = new SceneStore()
  const frame = store.add('frame', { id: 'parent', x: 100, y: 200, width: 200, height: 200, rotation: 90 })
  store.add('path', { id: 'path', name: 'Curve', parentId: frame.id, x: 10, y: 20, width: 40, height: 80, viewBox: [10, 20, 20, 40], d: 'M10 20C15 25 25 55 30 60' })
  const index = sceneVertexIndex(store.getSnapshot(), frame.id)
  assert.deepEqual(index.nearest({ x: 280, y: 210 }, 4), { x: 280, y: 210, label: 'Curve' })
  assert.deepEqual(index.nearest({ x: 200, y: 250 }, 4), { x: 200, y: 250, label: 'Curve' })
  // Tangent controls are not anchor snap targets.
  assert.equal(index.nearest({ x: 270, y: 220 }, 4), null)
  const ownExcluded = sceneVertexIndex(store.getSnapshot(), 'path')
  assert.equal(ownExcluded.nearest({ x: 280, y: 210 }, 4), null)
})

test('hidden or locked ancestors remove vertices, while immutable geometry updates refresh the index', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'parent', x: 1000, y: 1000, width: 200, height: 200 })
  store.add('rectangle', { id: 'rect', name: 'Rectangle', parentId: 'parent', x: 20, y: 30, width: 50, height: 50 })
  const at = { x: 1020, y: 1030 }
  assert.equal(sceneVertexIndex(store.getSnapshot(), null).nearest(at, 4)?.label, 'Rectangle')
  store.setVisible('parent', false)
  assert.equal(sceneVertexIndex(store.getSnapshot(), null).nearest(at, 4), null)
  store.setVisible('parent', true); store.setLocked('parent', true)
  assert.equal(sceneVertexIndex(store.getSnapshot(), null).nearest(at, 4), null)
  store.setLocked('parent', false)
  store.update('rect', 'rectangle', { x: 60 })
  assert.equal(sceneVertexIndex(store.getSnapshot(), null).nearest(at, 4), null)
  assert.equal(sceneVertexIndex(store.getSnapshot(), null).nearest({ x: 1060, y: 1030 }, 4)?.label, 'Rectangle')
})

test('rounded rectangle and ellipse snap targets follow the stroked SVG boundary', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'round', name: 'Round', width: 100, height: 80, cornerRadius: 20, style: { stroke: { width: 4, color: '#080808', dash: [] } } })
  store.add('ellipse', { id: 'ellipse', name: 'Ellipse', x: 200, width: 100, height: 80, style: { stroke: { width: 4, color: '#080808', dash: [] } } })
  const index = sceneVertexIndex(store.getSnapshot(), null)
  assert.equal(index.nearest({ x: 0, y: 0 }, 4), null)
  assert.equal(index.nearest({ x: 22, y: 2 }, 4)?.label, 'Round')
  assert.equal(index.nearest({ x: 250, y: 2 }, 4)?.label, 'Ellipse')
})

test('changing subtraction source order recomputes geometry, keeps sources, and is reversible', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'base', x: 0, width: 100, height: 100 })
  store.add('rectangle', { id: 'cut', x: 50, width: 150, height: 100 })
  store.select(['base', 'cut'])
  const compound = store.booleanSelection('subtract'), before = store.getSnapshot()
  store.clearHistory()
  store.reorderBooleanOperands(compound.id, ['cut', 'base'])
  const updated = store.getSnapshot().elements[compound.id]
  assert.deepEqual(updated.boolean.operands.map(source => source.id), ['cut', 'base'])
  assert.deepEqual(updated.boolean.operands.map(source => source.width), [150, 100])
  assert.ok(Math.abs(updated.x - 100) < 1e-8)
  assert.ok(Math.abs(updated.width - 100) < 1e-8)
  assert.notEqual(updated.d, compound.d)
  assert.equal(store.getHistorySnapshot().undoCount, 1)
  store.reorderBooleanOperands(compound.id, ['cut', 'base'])
  assert.equal(store.getHistorySnapshot().undoCount, 1)
  const ordered = store.getSnapshot()
  assert.throws(() => store.reorderBooleanOperands(compound.id, ['cut', 'cut']), /exactly once/)
  assert.throws(() => store.reorderBooleanOperands(compound.id, ['base', 'unknown']), /exactly once/)
  assert.equal(store.getSnapshot(), ordered)
  store.undo(); assert.equal(store.getSnapshot(), before)
  store.redo()
  const released = store.releaseBoolean(compound.id)
  assert.deepEqual(released, ['cut', 'base'])
  assert.equal(store.getSnapshot().elements.cut.width, 150)
})
