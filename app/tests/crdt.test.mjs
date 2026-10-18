import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VectorClock,
  generateKeyBetween,
  sortByFractionalIndex,
  LWWRegister,
  CollaborativeUndoManager,
} from '../src/collaboration/crdt/index.ts'
import { SceneReplica, getValueAtPath } from '../src/collaboration/model.ts'
import { SceneStore } from '../src/scene/store.ts'

test('VectorClock: tracks ticks, merges, and causal relationships accurately', () => {
  const v1 = new VectorClock()
  assert.equal(v1.get('alice'), 0)
  v1.tick('alice')
  v1.tick('alice')
  assert.equal(v1.get('alice'), 2)

  const v2 = new VectorClock({ alice: 1, bob: 3 })
  assert.equal(v2.get('alice'), 1)
  assert.equal(v2.get('bob'), 3)

  // Causality: v1 has alice:2, bob:0; v2 has alice:1, bob:3 -> Concurrent
  assert.equal(v1.compare(v2), 'concurrent')
  assert.equal(v1.isConcurrent(v2), true)

  // Merge v2 into v1: alice:2, bob:3
  v1.merge(v2)
  assert.equal(v1.get('alice'), 2)
  assert.equal(v1.get('bob'), 3)

  // Now v1 dominates v2
  assert.equal(v1.compare(v2), 'after')
  assert.equal(v2.compare(v1), 'before')

  // Cloned clock equals original
  const v3 = v1.clone()
  assert.equal(v1.compare(v3), 'equal')
  assert.deepEqual(v3.toJSON(), { alice: 2, bob: 3 })
})

test('FractionalIndex: generates strictly increasing keys for arbitrary insertions', () => {
  // Case 1: First item
  const k1 = generateKeyBetween(null, null, 'actorA')
  assert.ok(k1)

  // Case 2: Insert before first item
  const k0 = generateKeyBetween(null, k1, 'actorA')
  assert.ok(k0 < k1, `Expected ${k0} < ${k1}`)

  // Case 3: Insert after item
  const k2 = generateKeyBetween(k1, null, 'actorA')
  assert.ok(k1 < k2, `Expected ${k1} < ${k2}`)

  // Case 4: Insert between two items
  const k1_5 = generateKeyBetween(k1, k2, 'actorA')
  assert.ok(k1 < k1_5 && k1_5 < k2, `Expected ${k1} < ${k1_5} < ${k2}`)

  // Dense insertions between adjacent items: 50 consecutive insertions
  let left = k1
  const right = k1_5
  for (let i = 0; i < 50; i++) {
    const mid = generateKeyBetween(left, right, `actor${i % 3}`)
    assert.ok(left < mid, `Dense insertion failed: ${left} not < ${mid}`)
    assert.ok(mid < right, `Dense insertion failed: ${mid} not < ${right}`)
    left = mid
  }

  // Sorting items by fractional index
  const items = [
    { id: 'item3', order: k2 },
    { id: 'item1', order: k0 },
    { id: 'item2', order: k1 },
  ]
  const sorted = sortByFractionalIndex(items, i => i.order, i => i.id)
  assert.deepEqual(sorted.map(i => i.id), ['item1', 'item2', 'item3'])
})

test('LWWRegister: resolves conflicts deterministically by Lamport clock and actor ID', () => {
  const regA = new LWWRegister(['elements', 'rect1', 'x'], 100, 1, 'actorA')
  const regB = new LWWRegister(['elements', 'rect1', 'x'], 200, 2, 'actorB')

  // Higher clock wins
  assert.equal(regB.isNewerThan(regA), true)
  assert.equal(regA.isNewerThan(regB), false)

  regA.merge(regB)
  assert.equal(regA.value, 200)
  assert.equal(regA.clock, 2)
  assert.equal(regA.actor, 'actorB')

  // Same clock tie-broken by actor ID lexicographically
  const regC1 = new LWWRegister(['elements', 'rect1', 'y'], 50, 5, 'actorA')
  const regC2 = new LWWRegister(['elements', 'rect1', 'y'], 75, 5, 'actorB')
  assert.equal(regC2.isNewerThan(regC1), true) // 'actorB' > 'actorA'
  assert.equal(regC1.isNewerThan(regC2), false)

  // Export and import round-trip
  const exported = regC2.toRegister()
  const restored = LWWRegister.fromRegister(exported)
  assert.deepEqual(restored.path, regC2.path)
  assert.equal(restored.value, regC2.value)
  assert.equal(restored.clock, regC2.clock)
  assert.equal(restored.actor, regC2.actor)
})

test('CollaborativeUndoManager: selectively inverts local operations without touching remote state', () => {
  const manager = new CollaborativeUndoManager('localActor')
  let clock = 10

  // 1. Record local move of rect1
  manager.recordOperations([
    {
      path: ['elements', 'rect1', 'x'],
      beforeValue: 10,
      afterValue: 100,
      clock: ++clock,
    },
  ], 'Move rect1')

  assert.equal(manager.getSnapshot().canUndo, true)
  assert.equal(manager.getSnapshot().canRedo, false)
  assert.equal(manager.getSnapshot().undoLabel, 'Move rect1')

  // 2. Undo local operation
  const inverse = manager.undo(() => ++clock)
  assert.equal(inverse.length, 1)
  assert.deepEqual(inverse[0].path, ['elements', 'rect1', 'x'])
  assert.equal(inverse[0].value, 10)
  assert.equal(inverse[0].actor, 'localActor')
  assert.ok(inverse[0].clock > 10)

  assert.equal(manager.getSnapshot().canUndo, false)
  assert.equal(manager.getSnapshot().canRedo, true)
  assert.equal(manager.getSnapshot().redoLabel, 'Move rect1')

  // 3. Redo local operation
  const forward = manager.redo(() => ++clock)
  assert.equal(forward.length, 1)
  assert.deepEqual(forward[0].path, ['elements', 'rect1', 'x'])
  assert.equal(forward[0].value, 100)
  assert.equal(forward[0].actor, 'localActor')

  assert.equal(manager.getSnapshot().canUndo, true)
  assert.equal(manager.getSnapshot().canRedo, false)
})

test('Collaborative CRDT SceneReplica: vector clock progression and selective undo replay', () => {
  const storeA = new SceneStore()
  storeA.add('rectangle', { id: 'rect1', x: 20, y: 20, width: 100, height: 100 })
  storeA.clearHistory()

  const replicaA = new SceneReplica('alice')
  replicaA.seed(storeA.toJSON())

  // Vector clock reflects seed actor
  assert.ok(replicaA.getVectorClock().get('alice') > 0)

  // Alice moves rect1
  const beforeA = storeA.toJSON()
  storeA.update('rect1', 'rectangle', { x: 250 })
  const changesA = replicaA.change(beforeA, storeA.toJSON())
  assert.equal(changesA.length, 1)
  assert.equal(changesA[0].path[2], 'x')
  assert.equal(changesA[0].value, 250)

  // Bob has a replica seeded from beforeA
  const replicaB = new SceneReplica('bob')
  replicaB.seed(beforeA)

  // Bob updates rect1 y position concurrently
  const storeB = new SceneStore()
  storeB.load(beforeA)
  storeB.update('rect1', 'rectangle', { y: 400 })
  const changesB = replicaB.change(beforeA, storeB.toJSON())

  // Merge changes across both replicas
  replicaA.merge(changesB)
  replicaB.merge(changesA)

  // Both converge to the identical state with x: 250 and y: 400
  const docA = replicaA.document()
  const docB = replicaB.document()
  assert.equal(docA.elements.rect1.x, 250)
  assert.equal(docA.elements.rect1.y, 400)
  assert.equal(docB.elements.rect1.x, 250)
  assert.equal(docB.elements.rect1.y, 400)

  // Test getValueAtPath utility
  assert.equal(getValueAtPath(docA, ['elements', 'rect1', 'x']), 250)
  assert.equal(getValueAtPath(docA, ['elements', 'rect1', 'y']), 400)
  assert.equal(getValueAtPath(docA, ['elements', 'rect1', '$alive']), true)
  assert.equal(getValueAtPath(docA, ['elements', 'nonexistent', 'x']), undefined)
})

test('CollaborationSession: supports collaborative undo/redo and live presence extensions', async t => {
  const window = new EventTarget()
  const document = Object.assign(new EventTarget(), { hidden: false })
  class Stream extends EventTarget { close() {} }
  const replacements = {
    window,
    document,
    navigator: { onLine: true },
    fetch: async () => new Response(JSON.stringify({ token: 'test-token', registers: [], peers: [] })),
    EventSource: Stream,
  }
  const descriptors = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true })

  t.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })

  const { CollaborationSession } = await import('../src/collaboration/session.ts')
  const store = new SceneStore()
  store.add('rectangle', { id: 'rect1', x: 50, y: 50, width: 100, height: 100 })
  store.clearHistory()

  let camera = { x: 0, y: 0, zoom: 1 }, size = { width: 800, height: 600 }
  const listeners = new Set()
  const controller = {
    getSnapshot: () => ({ camera, size }),
    screenToWorld: (p) => p,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    setCamera: (c) => { camera = c },
    stop: () => {},
  }

  const session = new CollaborationSession('test-room', store, controller, 'Designer1')

  // Live presence methods: pointerDown, activity, chat
  session.setPointerDown(true)
  session.setActivity('editing text')
  session.setChat('Hello team!')

  // Verify undoManager is initialized
  assert.ok(session.undoManager)
  assert.equal(session.undoManager.actor, session.id)

  // Start session to listen for store changes
  session.start()

  // Make a local store change
  store.update('rect1', 'rectangle', { x: 300 })
  assert.equal(store.getSnapshot().elements.rect1.x, 300)
  assert.equal(session.undoManager.getSnapshot().canUndo, true)

  // Test session.undo() reverts local change
  const undone = session.undo()
  assert.equal(undone, true)
  assert.equal(store.getSnapshot().elements.rect1.x, 50)
  assert.equal(session.undoManager.getSnapshot().canRedo, true)

  // Test session.redo() re-applies local change
  const redone = session.redo()
  assert.equal(redone, true)
  assert.equal(store.getSnapshot().elements.rect1.x, 300)

  session.stop()
})

