import test from 'node:test'
import assert from 'node:assert/strict'
import { copyContours, getHandleType, insertPathAnchor, moveAnchor, moveHandle, nearestPathSegment, parsePath, roundPathContours, segmentPoint, serializePath, setHandleType } from '../src/scene/pathGeometry.ts'
import { SceneStore } from '../src/scene/store.ts'

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`)

test('subdivision retains the complete cubic and handles closing edges', () => {
  for (const closed of [false, true]) {
    const c = { closed, anchors: [{ x: 0, y: 0, out: { x: 30, y: -80 } }, { x: 120, y: 90, in: { x: 90, y: 150 }, out: { x: 80, y: 20 } }] }
    if (closed) c.anchors[0].in = { x: -30, y: 40 }
    const segment = closed ? 1 : 0, original = copyContours([c])[0], split = .37
    const index = insertPathAnchor(c, segment, split)
    assert.equal(c.anchors.length, 3)
    assert.equal(index, segment + 1)
    for (let i = 0; i <= 100; i++) {
      const t = i / 100, expected = segmentPoint(original.anchors[segment], original.anchors[(segment + 1) % 2], t)
      const actual = t <= split ? segmentPoint(c.anchors[segment], c.anchors[index], t / split) : segmentPoint(c.anchors[index], c.anchors[(index + 1) % 3], (t - split) / (1 - split))
      near(actual.x, expected.x); near(actual.y, expected.y)
    }
  }
})

test('handle constraints keep mirrored length, asymmetric length, and independent positions', () => {
  const c = parsePath('M0 0L60 60L120 0')[0]
  const mirrored = setHandleType(c, 1, 'mirrored')
  const moved = moveHandle(mirrored, 'out', { x: 90, y: 90 })
  assert.deepEqual(moved.in, { x: 30, y: 30 })
  assert.equal(getHandleType(moved), 'mirrored')
  const asymmetric = { ...mirrored, handleType: 'asymmetric', in: { x: 50, y: 60 } }
  const longer = moveHandle(asymmetric, 'out', { x: 60, y: 100 })
  assert.deepEqual(longer.in, { x: 60, y: 50 })
  assert.deepEqual(moveHandle({ ...asymmetric, handleType: 'disconnected' }, 'out', { x: 100, y: 70 }).in, asymmetric.in)
  const broken = moveHandle(mirrored, 'in', { x: 20, y: 80 }, true)
  assert.deepEqual(broken.out, mirrored.out)
  assert.equal(broken.handleType, 'disconnected')
  assert.deepEqual(moveHandle(mirrored, 'out', { x: 60, y: 60 }).in, { x: 60, y: 60 })
})

test('rounded corners retain source nodes, clamp trims, and leave open endpoints intact', () => {
  const c = parsePath('M0 0H100V100H0Z')[0]
  c.anchors.forEach(a => { a.cornerRadius = 20 })
  const rounded = roundPathContours([c])[0]
  assert.equal(c.anchors.length, 4)
  assert.equal(rounded.anchors.length, 8)
  near(rounded.anchors[0].x, 0); near(rounded.anchors[0].y, 20)
  assert.match(serializePath([c]), / C /)
  c.anchors.forEach(a => { a.cornerRadius = 1000 })
  for (const a of roundPathContours([c])[0].anchors) assert.ok(a.x >= 0 && a.x <= 100 && a.y >= 0 && a.y <= 100)
  const open = { ...c, closed: false }
  assert.deepEqual(roundPathContours([open])[0].anchors[0], c.anchors[0])
  assert.equal(roundPathContours([open])[0].anchors.at(-1).x, 0)
})

test('anchor translation preserves editing metadata and handle offsets', () => {
  const a = { x: 10, y: 20, in: { x: 5, y: 10 }, handleType: 'disconnected', cornerRadius: 8 }
  const moved = moveAnchor(a, { x: 30, y: 40 })
  assert.deepEqual(moved, { x: 30, y: 40, in: { x: 25, y: 30 }, handleType: 'disconnected', cornerRadius: 8 })
})

test('segment picking uses screen-space tolerance and finds separate subpaths', () => {
  const contours = parsePath('M0 0H100 M0 100C25 50 75 150 100 100')
  for (const zoom of [.1, 1, 8]) {
    const map = p => ({ x: p.x * zoom + 200, y: p.y * zoom + 100 })
    const hit = nearestPathSegment(contours, map(segmentPoint(contours[1].anchors[0], contours[1].anchors[1], .3)), map)
    assert.equal(hit.contour, 1); assert.equal(hit.segment, 0)
    assert.ok(Math.abs(hit.t - .3) < .001)
    assert.equal(nearestPathSegment(contours, { x: -100, y: -100 }, map), null)
  }
})

test('editable metadata stays immutable through history, JSON, and direct SVG changes', () => {
  const store = new SceneStore(), contours = parsePath('M0 0H100V100H0Z M20 20H80V80Z')
  const path = store.add('path', { nodes: contours })
  store.clearHistory()
  const initial = store.getSnapshot()
  contours[0].anchors[0].cornerRadius = 12
  assert.equal(path.nodes[0].anchors[0].cornerRadius, undefined)
  store.beginTransaction('Round node')
  store.update(path.id, 'path', { nodes: contours })
  contours[0].anchors[0].cornerRadius = 20
  store.update(path.id, 'path', { nodes: contours })
  store.endTransaction()
  const rounded = store.getSnapshot()
  assert.match(rounded.elements[path.id].d, / C /)
  assert.equal(rounded.elements[path.id].nodes[0].anchors[0].cornerRadius, 20)
  assert.equal(Object.isFrozen(rounded.elements[path.id].nodes[0].anchors[0]), true)
  store.undo(); assert.equal(store.getSnapshot(), initial)
  store.redo(); assert.equal(store.getSnapshot(), rounded)
  const opened = new SceneStore()
  opened.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(opened.getSnapshot().elements[path.id].nodes, rounded.elements[path.id].nodes)
  store.update(path.id, 'path', { d: 'M0 0L100 100' })
  assert.equal(store.getSnapshot().elements[path.id].nodes, undefined)
  store.undo(); assert.equal(store.getSnapshot().elements[path.id].nodes[0].anchors[0].cornerRadius, 20)
})

test('invalid editing metadata and inconsistent cached outlines are rejected atomically', () => {
  const store = new SceneStore(), path = store.add('path')
  const before = store.getSnapshot()
  for (const anchor of [{ x: NaN, y: 0 }, { x: 0, y: 0, cornerRadius: -1 }, { x: 0, y: 0, handleType: 'unknown' }, { x: 0, y: 0, out: { x: 0, y: Infinity } }]) {
    assert.throws(() => store.update(path.id, 'path', { nodes: [{ closed: false, anchors: [anchor] }] }))
    assert.equal(store.getSnapshot(), before)
  }
  const document = JSON.parse(JSON.stringify(store.toJSON()))
  document.elements[path.id].nodes = [{ closed: false, anchors: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }]
  assert.throws(() => store.load(document), /outline/)
  assert.equal(store.getSnapshot(), before)
})
