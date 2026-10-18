import test from 'node:test'
import assert from 'node:assert/strict'
import { containBody, createBody, DEFAULT_PHYSICS, FIXED_STEP, magneticTarget, PHYSICS_PRESETS, PhysicsClock, stepPhysics } from '../src/physics/simulation.ts'
import { createPhysicsScene } from '../src/physics/scene.ts'
import { SceneStore } from '../src/scene/store.ts'

const arena = { x: -500, y: -500, width: 1000, height: 1000 }
const free = { ...DEFAULT_PHYSICS, tether: false, magnets: false, damping: 1 }
const body = (id = 'a', x = 0, width = 20) => createBody(id, { x, y: 0, width, height: 20 })

test('all presets converge to the spring origin without numerical drift', () => {
  for (const preset of Object.values(PHYSICS_PRESETS)) {
    const a = body(); a.x = 180; a.y = -110; a.vx = 1800
    let active = true
    for (let i = 0; i < 2400; i++) active = stepPhysics([a], arena, { ...DEFAULT_PHYSICS, ...preset })
    assert.equal(active, false, preset.label)
    assert.equal(a.x, a.home.x); assert.equal(a.y, a.home.y)
    assert.equal(a.vx, 0); assert.equal(a.vy, 0)
  }
})

test('release retains inertia; wall collision reflects only the normal velocity', () => {
  const a = body(); a.vx = 1200; a.vy = 80
  stepPhysics([a], arena, free)
  assert.ok(a.x > 0 && a.vx > 0)
  a.x = 479; a.vx = 1200
  stepPhysics([a], arena, { ...free, restitution: .8 })
  assert.ok(a.x <= 480 && a.vx < 0 && a.vy > 0)
})

test('fast thin bodies exchange impulses instead of passing through each other', () => {
  const a = body('a', 0, 2), b = body('b', 8, 2)
  a.vx = 2400
  stepPhysics([a, b], arena, { ...free, restitution: 1 })
  assert.ok(a.x + a.width <= b.x + 1e-6)
  assert.ok(b.vx > 2000 && Math.abs(a.vx) < 10)
})

test('spring acceleration from rest cannot tunnel through a thin held body', () => {
  const a = body('a', 0, 2), b = body('b', 8, 2)
  a.home.x = 300
  b.held = true
  stepPhysics([a, b], arena, { ...DEFAULT_PHYSICS, mass: .2, stiffness: 400, damping: 1 })
  assert.ok(a.x + a.width <= b.x + 1e-6)
  assert.equal(b.x, 8)
})

test('boundary correction preserves velocity already pointing into the arena', () => {
  const a = body('a', -501)
  a.vx = 100
  containBody(a, arena, .5)
  assert.equal(a.x, -500)
  assert.equal(a.vx, 100)
})

test('magnets ignore grid targets that would place a body outside the arena', () => {
  const a = body('a', 1)
  const bounded = { x: 0, y: 0, width: 100, height: 100 }
  assert.equal(magneticTarget(a, bounded), null)
  for (let i = 0; i < 300; i++) stepPhysics([a], bounded, { ...DEFAULT_PHYSICS, tether: false })
  assert.ok(a.x >= 0 && a.y >= 0)
  assert.equal(stepPhysics([a], bounded, { ...DEFAULT_PHYSICS, tether: false }), false)
})

test('held bodies remain under pointer control and push free bodies', () => {
  const a = body('a', 0), b = body('b', 15)
  a.held = true; a.vx = 500
  stepPhysics([a, b], arena, free)
  assert.equal(a.x, 0)
  assert.ok(b.x >= 20 && b.vx > 0)
})

test('magnetic targets settle body centers onto the 120px engineering grid', () => {
  const a = body('a', 92); a.y = 101
  for (let i = 0; i < 1000; i++) stepPhysics([a], arena, { ...DEFAULT_PHYSICS, tether: false })
  assert.equal(a.x + a.width / 2, 120)
  assert.equal(a.y + a.height / 2, 120)
})

test('fixed clock gives equivalent motion at 30, 60 and 144Hz and bounds catch-up', () => {
  const samples = [30, 60, 144].map(hz => {
    const a = body(); a.x = 100
    const clock = new PhysicsClock()
    for (let i = 0; i < hz; i++) clock.advance(1 / hz, () => stepPhysics([a], arena, DEFAULT_PHYSICS))
    return a.x
  })
  assert.ok(Math.max(...samples) - Math.min(...samples) < 1e-8)
  let steps = 0
  new PhysicsClock().advance(600, () => steps++)
  assert.ok(steps <= Math.ceil(.05 / FIXED_STEP))
})

test('scene selection excludes descendants, hidden and locked nodes without document edits', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'frame', width: 400, height: 300, rotation: 30 })
  store.add('rectangle', { id: 'child', parentId: 'frame', width: 40, height: 40 })
  store.add('rectangle', { id: 'locked', locked: true })
  store.add('rectangle', { id: 'hidden', visible: false })
  store.select(['frame', 'child', 'locked', 'hidden'])
  store.clearHistory()
  const before = store.getSnapshot()
  const scene = createPhysicsScene(store)
  assert.deepEqual(scene.bodies.map(b => b.id), ['frame'])
  stepPhysics(scene.bodies, scene.arena, DEFAULT_PHYSICS)
  assert.equal(store.getSnapshot(), before)
  assert.equal(store.getHistorySnapshot().canUndo, false)
  store.select(['child'])
  const nested = createPhysicsScene(store)
  assert.ok(Math.abs(nested.basis.get('child').b - .5) < 1e-8)
})
