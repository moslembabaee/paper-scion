import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PhysicsEngine,
  PHYSICS_PRESETS,
  DEFAULT_PHYSICS_CONFIG,
  validatePhysicsConfig,
  validateElementPhysics,
  validatePhysicsDocument,
} from '../src/physics/index.ts'
import { SceneStore } from '../src/scene/store.ts'

test('PhysicsEngine initial state and default config', () => {
  const engine = new PhysicsEngine()
  assert.equal(engine.getConfig().preset, DEFAULT_PHYSICS_CONFIG.preset)
  assert.equal(engine.getConfig().stiffness, DEFAULT_PHYSICS_CONFIG.stiffness)
  assert.equal(engine.getConfig().damping, DEFAULT_PHYSICS_CONFIG.damping)
  assert.equal(engine.getConfig().mass, DEFAULT_PHYSICS_CONFIG.mass)
  assert.equal(engine.getBodies().length, 0)
})

test('Configurable physics presets apply correct parameters', () => {
  const engine = new PhysicsEngine()

  engine.applyPreset('gentle')
  assert.equal(engine.getConfig().preset, 'gentle')
  assert.equal(engine.getConfig().stiffness, PHYSICS_PRESETS.gentle.stiffness)
  assert.equal(engine.getConfig().damping, PHYSICS_PRESETS.gentle.damping)
  assert.equal(engine.getConfig().restitution, PHYSICS_PRESETS.gentle.restitution)

  engine.applyPreset('snappy')
  assert.equal(engine.getConfig().preset, 'snappy')
  assert.equal(engine.getConfig().stiffness, PHYSICS_PRESETS.snappy.stiffness)
  assert.equal(engine.getConfig().damping, PHYSICS_PRESETS.snappy.damping)

  engine.applyPreset('bouncy')
  assert.equal(engine.getConfig().preset, 'bouncy')
  assert.equal(engine.getConfig().restitution, PHYSICS_PRESETS.bouncy.restitution)

  engine.applyPreset('zero-g')
  assert.equal(engine.getConfig().preset, 'zero-g')
  assert.equal(engine.getConfig().friction, PHYSICS_PRESETS['zero-g'].friction)
})

test('Spring-mass-damper dynamics restore displaced node towards rest position', () => {
  const engine = new PhysicsEngine({
    stiffness: 200,
    damping: 10,
    mass: 1.0,
    magneticGrid: false,
    boundaryMode: 'none',
  })

  // Add body displaced 100px from its rest position
  const body = engine.addBody({
    id: 'node-1',
    x: 100,
    y: 0,
    width: 60,
    height: 60,
    restX: 0,
    restY: 0,
  })

  assert.equal(body.x, 100)
  assert.equal(body.vx, 0)

  // Step simulation forward
  for (let i = 0; i < 30; i++) {
    engine.step(0.016)
  }

  // Node should have moved towards rest position (x < 100) and acquired velocity towards 0
  assert.ok(body.x < 100, 'Body should have moved towards rest position')
  assert.ok(body.vx !== 0, 'Body should have acquired velocity')

  // Run simulation longer to test settling via damping
  for (let i = 0; i < 300; i++) {
    engine.step(0.016)
  }

  // Node should settle near rest position
  assert.ok(Math.abs(body.x - body.restX) < 1.0, 'Body should settle near rest position')
  assert.ok(Math.abs(body.vx) < 1.0, 'Body velocity should have damped down')
})

test('Draggable canvas nodes track pointer and acquire inertia on release', () => {
  const engine = new PhysicsEngine({
    stiffness: 50,
    damping: 2,
    magneticGrid: false,
    boundaryMode: 'none',
  })

  const body = engine.addBody({
    id: 'drag-node',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
  })

  // Start drag at (0, 0)
  const started = engine.startDrag('drag-node', { x: 0, y: 0 })
  assert.equal(started, true)
  assert.equal(body.isDragging, true)

  // Update drag over several frames to simulate a flick
  engine.updateDrag({ x: 50, y: 0 })
  engine.updateDrag({ x: 120, y: 0 })
  engine.updateDrag({ x: 200, y: 0 })

  assert.equal(body.x, 200)

  // End drag (throw/release)
  const result = engine.endDrag()
  assert.ok(result)
  assert.equal(result.id, 'drag-node')
  assert.equal(body.isDragging, false)

  // Body should retain momentum/velocity in release direction
  assert.ok(body.vx > 0, 'Body should inherit positive release velocity along x axis')

  // Step simulation forward: body should coast with inertia
  const posAfterThrow = body.x
  engine.step(0.016)
  assert.ok(body.x > posAfterThrow, 'Body should continue coasting forward with inertia')
})

test('Velocity-based collision boundaries rebound with restitution and clamp position', () => {
  const engine = new PhysicsEngine({
    boundaryMode: 'bounce',
    restitution: 0.8,
    friction: 0.05,
    stiffness: 10, // low spring restoring force to isolate boundary bounce
    damping: 1,
    magneticGrid: false,
  })

  engine.setArena({
    minX: 0,
    minY: 0,
    maxX: 500,
    maxY: 500,
  })

  const body = engine.addBody({
    id: 'bounce-node',
    x: 480,
    y: 100,
    width: 20,
    height: 20,
    restX: 480,
    restY: 100,
  })

  // Give high velocity towards right boundary (maxX = 500, node right edge = 480 + 20 = 500)
  body.vx = 400
  body.vy = 0

  // Step into collision
  engine.step(0.02)

  // Body right edge should not exceed 500
  assert.ok(body.x + body.width <= 500, 'Body should not penetrate boundary')
  // Velocity along normal should be inverted
  assert.ok(body.vx < 0, 'Normal velocity should be reversed on boundary bounce')
  // Collision velocity should be recorded
  assert.ok(body.lastCollisionVelocity > 0, 'Impact velocity should be tracked')
})

test('Magnetic snapping targets attract and capture nodes within radius', () => {
  const engine = new PhysicsEngine({
    stiffness: 100,
    damping: 15,
    magneticGrid: true,
    magneticRadius: 120,
    magneticStrength: 3.0,
    boundaryMode: 'none',
  })

  // Position body at (105, 105), which is close to the 120px grid point (120, 120)
  const body = engine.addBody({
    id: 'magnet-node',
    x: 100,
    y: 100,
    width: 20,
    height: 20,
    restX: 100,
    restY: 100,
    magnetic: true,
  })

  // Step simulation
  for (let i = 0; i < 40; i++) {
    engine.step(0.016)
  }

  // Node center should have been pulled closer to the 120px grid snap point (120, 120)
  const centerX = body.x + body.width / 2
  const centerY = body.y + body.height / 2

  assert.ok(Math.abs(centerX - 120) < 10, 'Node should be magnetically drawn to 120px grid x')
  assert.ok(Math.abs(centerY - 120) < 10, 'Node should be magnetically drawn to 120px grid y')
})

test('Radial shockwave impulse propels nearby nodes outward', () => {
  const engine = new PhysicsEngine({
    stiffness: 50,
    damping: 5,
    magneticGrid: false,
    boundaryMode: 'none',
  })

  const body = engine.addBody({
    id: 'shock-node',
    x: 150,
    y: 0,
    width: 20,
    height: 20,
    restX: 150,
    restY: 0,
  })

  // Apply impulse at origin (0, 0)
  engine.applyImpulse(0, 0, 300, 2000)

  // Body is to the right of impulse center, so it should acquire positive vx
  assert.ok(body.vx > 0, 'Shockwave should propel node away from impulse origin')
})

test('SceneStore integrates physics document and element physics config', () => {
  const store = new SceneStore()

  // Add element with physics config
  const el = store.add('rectangle', {
    name: 'Physics Box',
    x: 120,
    y: 120,
    width: 120,
    height: 120,
    physics: {
      enabled: true,
      mass: 2.0,
      preset: 'bouncy',
      restitution: 0.9,
    },
  })

  assert.ok(el.physics)
  assert.equal(el.physics.mass, 2.0)
  assert.equal(el.physics.preset, 'bouncy')

  // Set document physics
  store.setPhysics({
    enabled: true,
    preset: 'snappy',
    magneticGrid: true,
    boundaryMode: 'bounce',
  })

  const doc = store.toJSON()
  assert.ok(doc.physics)
  assert.equal(doc.physics.preset, 'snappy')
  assert.equal(doc.physics.magneticGrid, true)

  // Load into new store to verify serialization fidelity
  const store2 = new SceneStore()
  store2.load(doc)
  assert.equal(store2.getSnapshot().physics?.preset, 'snappy')
  assert.equal(store2.getSnapshot().elements[el.id]?.physics?.mass, 2.0)
})

test('Validation functions reject malformed inputs safely', () => {
  assert.doesNotThrow(() => validatePhysicsConfig({ preset: 'gentle', stiffness: 100 }))
  assert.doesNotThrow(() => validateElementPhysics({ mass: 1.5, pinned: true }))
  assert.doesNotThrow(() => validatePhysicsDocument({ enabled: true, preset: 'bouncy' }))

  assert.throws(() => validateElementPhysics({ mass: -1 }), /Invalid physics mass/)
  assert.throws(() => validateElementPhysics({ restitution: 1.5 }), /Invalid physics restitution/)
  assert.throws(() => validateElementPhysics('invalid'), /Invalid element physics/)
  assert.throws(() => validatePhysicsDocument('invalid'), /Invalid physics document/)
})
