import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { getWorldMatrix } from '../src/scene/geometry.ts'
import { captureOrigins, moveGeometry, resizedBox, resizeGeometry, rotateGeometry, selectionBox, selectionBounds, selectionRoots, rotateVector } from '../src/scene/selectionGeometry.ts'
import { computeSnap } from '../src/scene/snapEngine.ts'

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`)
const center = (state, id) => {
  const node = state.elements[id], [a, b, c, d, e, f] = getWorldMatrix(state, id)
  return { x: a * node.width / 2 + c * node.height / 2 + e, y: b * node.width / 2 + d * node.height / 2 + f }
}
const nested = () => {
  const store = new SceneStore()
  store.add('frame', { id: 'frame', x: 400, y: 200, width: 300, height: 300, rotation: 90 })
  store.add('rectangle', { id: 'child', parentId: 'frame', x: 20, y: 30, width: 80, height: 60 })
  return store
}

test('moving a child uses parent coordinates even inside a rotated frame', () => {
  const store = nested(), before = store.getSnapshot(), origin = captureOrigins(before, ['child'])[0]
  store.update('child', 'rectangle', moveGeometry(origin, { x: 24, y: 48 }))
  const after = store.getSnapshot(), actual = center(after, 'child')
  close(actual.x, origin.center.x + 24)
  close(actual.y, origin.center.y + 48)
  close(after.elements.child.x, before.elements.child.x + 48)
  close(after.elements.child.y, before.elements.child.y - 24)
})

test('selecting a frame and descendant transforms only the frame once', () => {
  const store = nested(), state = store.getSnapshot()
  assert.deepEqual(selectionRoots(state, ['child', 'frame']), ['frame'])
  assert.equal(captureOrigins(state, ['frame', 'child']).length, 1)
  assert.deepEqual(selectionBounds(state, ['frame', 'child']), selectionBounds(state, ['frame']))
  const before = center(state, 'child')
  for (const origin of captureOrigins(state, ['frame', 'child'])) store.update(origin.id, state.elements[origin.id].type, moveGeometry(origin, { x: 30, y: 40 }))
  const after = center(store.getSnapshot(), 'child')
  close(after.x, before.x + 30)
  close(after.y, before.y + 40)
})

test('single selection box follows the element world rotation and true dimensions', () => {
  const store = nested(), state = store.getSnapshot(), box = selectionBox(state, ['child']), actual = center(state, 'child')
  close(box.rotation, 90)
  close(box.width, 80)
  close(box.height, 60)
  close(box.x + box.width / 2, actual.x)
  close(box.y + box.height / 2, actual.y)
  assert.equal(selectionBox(state, []), null)
})

test('all eight handles resize a rotated child while preserving the opposite anchor', () => {
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  for (const handle of handles) {
    const store = nested()
    store.update('child', 'rectangle', { rotation: 30 })
    const state = store.getSnapshot(), box = selectionBox(state, ['child']), origin = captureOrigins(state, ['child'])[0]
    const worldDelta = rotateVector({ x: handle.includes('w') ? -20 : 20, y: handle.includes('n') ? -10 : 10 }, box.rotation)
    const after = resizedBox(box, handle, worldDelta, false)
    const anchor = value => {
      const offset = rotateVector({ x: handle.includes('e') ? -value.width / 2 : handle.includes('w') ? value.width / 2 : 0, y: handle.includes('s') ? -value.height / 2 : handle.includes('n') ? value.height / 2 : 0 }, value.rotation)
      return { x: value.x + value.width / 2 + offset.x, y: value.y + value.height / 2 + offset.y }
    }
    close(anchor(after).x, anchor(box).x)
    close(anchor(after).y, anchor(box).y)
    close(after.width, box.width + (handle.includes('w') || handle.includes('e') ? 20 : 0))
    close(after.height, box.height + (handle.includes('n') || handle.includes('s') ? 10 : 0))
    store.update('child', 'rectangle', resizeGeometry(origin, box, after))
    const actual = selectionBox(store.getSnapshot(), ['child'])
    close(actual.x, after.x)
    close(actual.y, after.y)
    close(actual.width, after.width)
    close(actual.height, after.height)
  }
})

test('proportional resize shrinks and grows without losing aspect ratio or crossing zero', () => {
  const box = { x: 10, y: 20, width: 100, height: 50, rotation: 0 }
  for (const [handle, delta] of [['se', { x: -40, y: -10 }], ['w', { x: 20, y: 0 }], ['n', { x: 0, y: -25 }], ['nw', { x: 1000, y: 1000 }]]) {
    const after = resizedBox(box, handle, delta, true)
    close(after.width / after.height, 2)
    assert.ok(after.width >= 1 && after.height >= 1)
  }
  close(resizedBox(box, 'se', { x: -40, y: -10 }, true).width, 60)
})

test('multi-selection resizes positions and dimensions around the fixed anchor', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'a', x: 100, y: 200, width: 40, height: 40 })
  store.add('rectangle', { id: 'b', x: 200, y: 200, width: 40, height: 40 })
  const state = store.getSnapshot(), box = selectionBox(state, ['a', 'b'])
  const after = resizedBox(box, 'e', { x: 140, y: 0 }, false)
  for (const origin of captureOrigins(state, ['a', 'b'])) store.update(origin.id, 'rectangle', resizeGeometry(origin, box, after))
  const resized = store.getSnapshot()
  close(resized.elements.a.x, 100)
  close(resized.elements.b.x, 300)
  close(resized.elements.a.width, 80)
  close(resized.elements.b.width, 80)
})

test('group rotation revolves centers together including children of rotated parents', () => {
  const store = nested()
  store.add('rectangle', { id: 'other', x: 50, y: 50, width: 20, height: 20 })
  const state = store.getSnapshot(), origins = captureOrigins(state, ['child', 'other']), pivot = { x: 300, y: 250 }
  for (const origin of origins) store.update(origin.id, state.elements[origin.id].type, rotateGeometry(origin, pivot, 90))
  for (const origin of origins) {
    const actual = center(store.getSnapshot(), origin.id)
    close(actual.x, pivot.x - (origin.center.y - pivot.y))
    close(actual.y, pivot.y + (origin.center.x - pivot.x))
    close(store.getSnapshot().elements[origin.id].rotation, (origin.rotation + 90) % 360)
  }
})

test('snap chooses independent nearest edge/center alignment and keeps exact guides visible', () => {
  const target = { x: 200, y: 200, width: 100, height: 100 }
  const snap = computeSnap({ x: 147, y: 148, width: 100, height: 100 }, [target], 8)
  close(snap.dx, 3)
  close(snap.dy, 2)
  assert.ok(snap.guides.some(g => g.axis === 'v' && g.value === 200))
  assert.ok(snap.guides.some(g => g.axis === 'h' && g.value === 200))
  const exact = computeSnap({ x: 150, y: 150, width: 100, height: 100 }, [target], 8)
  assert.equal(exact.dx, 0)
  assert.equal(exact.dy, 0)
  assert.ok(exact.guides.length > 0)
})

test('snap threshold scales with zoom and has no correction outside tolerance', () => {
  const moving = { x: 92, y: 70, width: 10, height: 10 }, targets = [{ x: 100, y: 100, width: 10, height: 10 }]
  close(computeSnap(moving, targets, 8 / 2).dx, -2)
  assert.equal(computeSnap(moving, targets, 8 / 8).guides.length, 0)
  assert.equal(computeSnap(moving, [], 8).dx, 0)
})

test('equal spacing snaps before, between and after neighbors with distance guides', () => {
  const targets = [{ x: 0, y: 0, width: 20, height: 20 }, { x: 100, y: 0, width: 20, height: 20 }]
  for (const [x, expected, gap] of [[-96, -100, 80], [47, 50, 30], [197, 200, 80]]) {
    const snap = computeSnap({ x, y: 0, width: 20, height: 20 }, targets, 8)
    close(x + snap.dx, expected)
    const distances = snap.guides.filter(g => g.distance !== undefined)
    assert.equal(distances.length, 2)
    assert.ok(distances.every(g => g.distance === gap && g.axis === 'h'))
  }
  const vertical = computeSnap({ x: 0, y: 47, width: 20, height: 20 }, targets.map(t => ({ ...t, x: 0, y: t.x })), 8)
  close(vertical.dy, 3)
  assert.equal(vertical.guides.filter(g => g.distance === 30 && g.axis === 'v').length, 2)
  const exact = computeSnap({ x: 200, y: 0, width: 20, height: 20 }, targets, 8)
  assert.equal(exact.dx, 0)
  assert.equal(exact.guides.filter(g => g.distance === 80).length, 2)
  const disabled = computeSnap({ x: 197, y: 0, width: 20, height: 20 }, targets, 8, { xAnchors: [] })
  assert.equal(disabled.dx, 0)
})

test('resize snapping restricts candidates to the active handle and fixed axes stay fixed', () => {
  const moving = { x: 0, y: 0, width: 97, height: 40 }, targets = [{ x: 100, y: 10, width: 20, height: 20 }]
  const snap = computeSnap(moving, targets, 8, { xAnchors: [1], yAnchors: [], distances: false })
  close(snap.dx, 3)
  close(snap.dy, 0)
  assert.ok(snap.guides.every(g => g.axis === 'v'))
})
