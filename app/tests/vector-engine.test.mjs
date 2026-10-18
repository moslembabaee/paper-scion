import test from 'node:test'
import assert from 'node:assert/strict'
import { optimizeSVGPath } from '../src/io/pathOptimize.ts'
import { parsePath, segmentPoint } from '../src/scene/pathGeometry.ts'
import { PathDraftHistory } from '../src/scene/pathDraftHistory.ts'
import { SceneStore } from '../src/scene/store.ts'
import { sceneToSVG } from '../src/io/svg.ts'

const fixtures = [
  'M 0 0 L 100 0 L 100 100 L 0 100 Z',
  'M 10000 10000 L 10010 10005 L 10020 10010',
  'M 0 0 C 10 20 20 20 30 0 C 40 -20 50 -20 60 0',
  'M 0 0 C 0 0 100 0 100 0 L 100 100 Z M 20 20 L 20 80 L 80 80 Z',
  'M .1 .2 C .123456789012345 .25 .35 .65 .7 .8 L .9 .8',
  'm 10 10 c 10 -20 20 -20 30 0 s 20 20 30 0 z m 20 20 h 10 v 10 z',
  'M 0 0 L 0 0 C 100 0 -100 0 0 0',
  'M 0 0 C 10 0 10 10 20 10 C 30 10 30 0 0 0 Z',
  'M0 0H10V10ZL100 100L100 0Z',
  'M 0 0 Q 30 100 60 0 T 120 0',
  'M 0 50 A 50 50 0 01100 50 A 50 50 0 010 50 Z',
  'M 1e-8 -2e-7 L 3e-8 -4e-7',
]

test('optimized SVG preserves all subpaths and sampled curve geometry', () => {
  for (const source of fixtures) {
    const optimized = optimizeSVGPath(source)
    assert.ok(optimized.length <= source.length, optimized)
    const before = parsePath(source), after = parsePath(optimized)
    assert.equal(after.length, before.length, source)
    before.forEach((c, ci) => {
      assert.equal(after[ci].closed, c.closed)
      assert.equal(after[ci].anchors.length, c.anchors.length, optimized)
      const count = c.closed ? c.anchors.length : c.anchors.length - 1
      for (let i = 0; i < count; i++) for (let j = 0; j <= 20; j++) {
        const next = (i + 1) % c.anchors.length
        const a = segmentPoint(c.anchors[i], c.anchors[next], j / 20)
        const b = segmentPoint(after[ci].anchors[i], after[ci].anchors[next], j / 20)
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-10, `${source}: ${optimized}`)
      }
    })
  }
  assert.ok(optimizeSVGPath(fixtures[0]).length < fixtures[0].length / 2)
  assert.match(optimizeSVGPath(fixtures[2]), /S|s/)
  assert.match(optimizeSVGPath(fixtures[10]), /A/)
})

test('SVG export compacts outlines while keeping editable scene geometry untouched', () => {
  const store = new SceneStore()
  const path = store.add('path', { d: fixtures[0] })
  store.select([path.id])
  const before = store.getSnapshot()
  const svg = sceneToSVG(before, { scope: 'selection', scale: 1, background: 'transparent' })
  assert.ok(svg.includes(`d="${optimizeSVGPath(path.d)}"`))
  assert.equal(store.getSnapshot(), before)
  assert.equal(store.getSnapshot().elements[path.id].d, fixtures[0])
})

test('draft undo restores handles, isolates snapshots, and invalidates redo after branching', () => {
  const history = new PathDraftHistory(), first = parsePath('M0 0'), second = parsePath('M0 0C10 20 20 20 30 0')
  history.record([], first)
  history.record(first, second)
  second[0].anchors[0].out.x = 100 // Caller-owned data cannot corrupt history.
  const restored = history.undo(second)
  assert.deepEqual(restored, first)
  const redo = history.redo(restored)
  assert.equal(redo[0].anchors[0].out.x, 100)
  history.undo(redo)
  history.record(first, parsePath('M0 0L50 50'))
  assert.equal(history.canRedo, false)
  assert.deepEqual(history.undo(parsePath('M0 0L50 50')), first)
  assert.deepEqual(history.undo(first), [])
  assert.equal(history.undo([]), null)
})
