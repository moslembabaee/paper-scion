import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { HISTORY_LIMIT } from '../src/scene/history.ts'
import { createDemoScene } from '../src/scene/seed.ts'
import { createShader } from '../src/shaders/catalog.ts'

function fixture() {
  const store = new SceneStore()
  store.batch(() => {
    store.add('frame', { id: 'a' })
    store.add('frame', { id: 'b' })
    store.add('rectangle', { id: 'rect', parentId: 'a' })
    store.add('text', { id: 'text', parentId: 'a' })
    store.select(['rect', 'text'])
  })
  store.clearHistory()
  return store
}

test('seed and selection have no undo steps; history snapshots are stable and frozen', () => {
  const store = createDemoScene()
  const initial = store.getHistorySnapshot()
  assert.equal(initial.canUndo, false)
  assert.equal(initial.canRedo, false)
  assert.equal(Object.isFrozen(initial), true)
  const elements = store.getSnapshot().elements
  store.select(['space'])
  assert.equal(store.getSnapshot().elements, elements)
  assert.equal(store.getHistorySnapshot(), initial)
  store.undo()
  store.redo()
  assert.equal(store.getHistorySnapshot(), initial)
})

test('creation and its selection undo and redo as one immutable command', () => {
  const store = new SceneStore()
  for (const type of ['frame', 'rectangle', 'ellipse', 'path', 'text', 'image']) {
    const before = store.getSnapshot()
    store.batch(() => {
      const node = store.add(type)
      store.select([node.id])
    }, `Add ${type}`)
    const after = store.getSnapshot()
    assert.equal(store.getHistorySnapshot().undoLabel, `Add ${type}`)
    store.undo()
    assert.equal(store.getSnapshot(), before)
    assert.equal(store.getHistorySnapshot().redoLabel, `Add ${type}`)
    store.redo()
    assert.equal(store.getSnapshot(), after)
    assert.equal(Object.isFrozen(after.elements), true)
    assert.equal(Object.isFrozen(after.elements[after.selection[0]].style), true)
  }
})

test('geometry, nested style, text, and shaders restore without mutating earlier snapshots', () => {
  const store = fixture()
  const before = store.getSnapshot()
  store.update('rect', 'rectangle', {
    x: 24, y: 48, width: 240, height: 360, rotation: 45,
    style: { fill: '#222222', opacity: .5, stroke: { color: '#080808', width: 2, dash: [3, 4] }, shadow: { color: '#08080833', x: 1, y: 2, blur: 12 }, shader: createShader('mesh-gradient') },
  })
  const styled = store.getSnapshot()
  assert.equal(styled.elements.text, before.elements.text)
  assert.equal(before.elements.rect.x, 0)
  assert.equal(before.elements.rect.style.fill, '#81adec')
  assert.throws(() => { styled.elements.rect.style.stroke.dash[0] = 100 }, TypeError)
  store.undo()
  assert.equal(store.getSnapshot(), before)
  store.redo()
  assert.equal(store.getSnapshot(), styled)
  store.update('text', 'text', { text: 'Make room.', fontSize: 48 })
  const text = store.getSnapshot()
  store.setBackgroundShader(createShader('mesh-gradient'))
  const background = store.getSnapshot()
  store.undo()
  assert.equal(store.getSnapshot(), text)
  store.undo()
  assert.equal(store.getSnapshot(), styled)
  store.redo()
  store.redo()
  assert.equal(store.getSnapshot(), background)
})

test('nested multi-element batches publish one reversible checkpoint and notification', () => {
  const store = fixture()
  const before = store.getSnapshot()
  let notifications = 0
  store.subscribe(() => notifications++)
  store.batch(() => {
    store.update('rect', 'rectangle', { x: 120 })
    store.batch(() => store.update('text', 'text', { y: 120 }))
    store.select(['text'])
  }, 'Move selection')
  const after = store.getSnapshot()
  assert.equal(notifications, 1)
  assert.equal(store.getHistorySnapshot().undoCount, 1)
  store.undo()
  assert.equal(notifications, 2)
  assert.equal(store.getSnapshot(), before)
  store.redo()
  assert.equal(notifications, 3)
  assert.equal(store.getSnapshot(), after)
})

test('150 live transform frames become one command; undo is blocked until release', () => {
  const store = fixture()
  const before = store.getSnapshot()
  store.beginTransaction('Resize elements')
  assert.equal(store.getHistorySnapshot().active, true)
  for (let i = 1; i <= 150; i++) {
    store.batch(() => {
      store.update('rect', 'rectangle', { width: 120 + i })
      store.update('text', 'text', { width: 240 + i })
    })
  }
  const after = store.getSnapshot()
  assert.equal(store.getHistorySnapshot().undoCount, 0)
  store.undo()
  assert.equal(store.getSnapshot(), after)
  store.endTransaction()
  assert.equal(store.getHistorySnapshot().undoCount, 1)
  assert.equal(store.getHistorySnapshot().undoLabel, 'Resize elements')
  store.undo()
  assert.equal(store.getSnapshot(), before)
  store.redo()
  assert.equal(store.getSnapshot(), after)
})

test('cancelled and unchanged gestures preserve the redo branch', () => {
  const store = fixture()
  store.update('rect', 'rectangle', { x: 120 })
  store.undo()
  const before = store.getSnapshot()
  store.beginTransaction('Move elements')
  store.update('rect', 'rectangle', { x: 500 })
  store.cancelTransaction()
  assert.equal(store.getSnapshot(), before)
  assert.equal(store.getHistorySnapshot().redoCount, 1)
  store.beginTransaction('Move elements')
  store.update('rect', 'rectangle', { x: 24 })
  store.update('rect', 'rectangle', { x: 0 })
  store.endTransaction()
  assert.equal(store.getHistorySnapshot().undoCount, 0)
  assert.equal(store.getHistorySnapshot().redoCount, 1)
  store.redo()
  assert.equal(store.getSnapshot().elements.rect.x, 120)
})

test('no-op edits and selection preserve redo; a real edit discards the future', () => {
  const store = fixture()
  store.update('rect', 'rectangle', { style: { fill: '#222222' } })
  store.undo()
  const history = store.getHistorySnapshot()
  store.select(['text'])
  store.update('rect', 'rectangle', { x: 0, style: { fill: '#81adec' } })
  store.setLocked('rect', false)
  store.reorder('rect', 0)
  assert.equal(store.getHistorySnapshot(), history)
  store.update('rect', 'rectangle', { x: 24 })
  assert.equal(store.getHistorySnapshot().canRedo, false)
  store.redo()
  assert.equal(store.getSnapshot().elements.rect.style.fill, '#81adec')
  store.undo()
  assert.equal(store.getSnapshot().elements.rect.x, 0)
  assert.deepEqual(store.getSnapshot().selection, ['text'])
})

test('retains exactly the latest 100 checkpoints across undo and redo', () => {
  const store = fixture()
  for (let x = 1; x <= 105; x++) store.update('rect', 'rectangle', { x })
  assert.equal(store.getHistorySnapshot().undoCount, HISTORY_LIMIT)
  for (let i = 0; i < 110; i++) store.undo()
  assert.equal(store.getSnapshot().elements.rect.x, 5)
  assert.equal(store.getHistorySnapshot().canUndo, false)
  assert.equal(store.getHistorySnapshot().redoCount, HISTORY_LIMIT)
  for (let i = 0; i < 110; i++) store.redo()
  assert.equal(store.getSnapshot().elements.rect.x, 105)
  assert.equal(store.getHistorySnapshot().canRedo, false)
  assert.equal(store.getHistorySnapshot().undoCount, HISTORY_LIMIT)
})

test('ordering, reparenting, subtree deletion, and inherited flags restore exactly', () => {
  const store = fixture()
  store.add('frame', { id: 'nested', parentId: 'a' })
  store.add('ellipse', { id: 'child', parentId: 'nested' })
  store.clearHistory()
  const steps = [store.getSnapshot()]
  const change = work => { work(); steps.push(store.getSnapshot()) }
  change(() => store.reorder('text', 0))
  change(() => store.reparent('nested', 'b'))
  change(() => store.setLocked('a', true))
  change(() => store.setVisible('b', false))
  assert.equal(store.getHistorySnapshot().undoLabel, 'Hide Frame')
  change(() => store.remove('nested'))
  assert.equal(store.getSnapshot().elements.child, undefined)
  for (let i = steps.length - 2; i >= 0; i--) {
    store.undo()
    assert.equal(store.getSnapshot(), steps[i])
  }
  for (let i = 1; i < steps.length; i++) {
    store.redo()
    assert.equal(store.getSnapshot(), steps[i])
  }
})

test('invalid mutations and imports do not change state or history', () => {
  const store = fixture()
  store.update('rect', 'rectangle', { x: 120 })
  store.undo()
  const state = store.getSnapshot()
  const history = store.getHistorySnapshot()
  assert.throws(() => store.update('rect', 'rectangle', { width: -1 }))
  assert.throws(() => store.reparent('a', 'a'))
  assert.throws(() => store.load({ version: 1, elements: state.elements, rootIds: ['missing'] }))
  assert.equal(store.getSnapshot(), state)
  assert.equal(store.getHistorySnapshot(), history)
})

test('document replacement is reversible; clearing history establishes a new baseline', () => {
  const store = fixture()
  const before = store.getSnapshot()
  const imported = new SceneStore()
  imported.add('image', { id: 'imported' })
  store.load(imported.toJSON())
  const after = store.getSnapshot()
  assert.equal(Object.hasOwn(store.toJSON(), 'history'), false)
  store.undo()
  assert.equal(store.getSnapshot(), before)
  store.redo()
  assert.equal(store.getSnapshot(), after)
  store.clearHistory()
  store.undo()
  assert.equal(store.getSnapshot(), after)
  assert.equal(store.getHistorySnapshot().undoCount, 0)
  assert.equal(store.getHistorySnapshot().redoCount, 0)
})
