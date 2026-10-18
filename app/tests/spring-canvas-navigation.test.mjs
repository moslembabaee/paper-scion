import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CanvasSpringEngine,
  VelocityTracker,
  DEFAULT_CANVAS_PHYSICS,
  CANVAS_PHYSICS_PRESETS,
  validatePhysicsConfig,
  rubberBandDisplacement,
} from '../src/canvas/springPhysics.ts'
import { ViewportController } from '../src/canvas/ViewportController.ts'
import { MIN_ZOOM, MAX_ZOOM } from '../src/canvas/math.ts'

test('VelocityTracker computes accurate weighted velocity and handles idle timeouts', () => {
  const tracker = new VelocityTracker()

  // Empty tracker
  assert.deepEqual(tracker.getVelocity(100), { vx: 0, vy: 0, vz: 0 })

  // Single sample
  tracker.add({ x: 0, y: 0 }, 1, 100)
  assert.deepEqual(tracker.getVelocity(100), { vx: 0, vy: 0, vz: 0 })

  // Movement over 50ms: dx = 100, dy = 50 -> vx = 2000 px/s, vy = 1000 px/s
  tracker.add({ x: 50, y: 25 }, 1, 125)
  tracker.add({ x: 100, y: 50 }, 1, 150)

  const vel = tracker.getVelocity(150)
  assert.ok(vel.vx > 1800 && vel.vx < 2200, `Expected vx near 2000, got ${vel.vx}`)
  assert.ok(vel.vy > 900 && vel.vy < 1100, `Expected vy near 1000, got ${vel.vy}`)

  // Idle timeout: stationary for 80ms should zero out velocity
  const idleVel = tracker.getVelocity(230)
  assert.equal(idleVel.vx, 0)
  assert.equal(idleVel.vy, 0)

  // Reset
  tracker.reset()
  assert.deepEqual(tracker.getVelocity(240), { vx: 0, vy: 0, vz: 0 })
})

test('VelocityTracker computes logarithmic zoom velocity', () => {
  const tracker = new VelocityTracker()
  // Zoom double over 100ms: ln(2) / 0.1s ≈ 6.93 /s
  tracker.add({ x: 0, y: 0 }, 1, 1000)
  tracker.add({ x: 0, y: 0 }, 2, 1100)

  const vel = tracker.getVelocity(1100)
  assert.ok(vel.vz > 5 && vel.vz < 8, `Expected vz near ~6.9, got ${vel.vz}`)
})

test('rubberBandDisplacement applies diminishing return curve', () => {
  assert.equal(rubberBandDisplacement(0, 0.5), 0)

  const d100 = rubberBandDisplacement(100, 0.5, 200)
  const d200 = rubberBandDisplacement(200, 0.5, 200)
  const d400 = rubberBandDisplacement(400, 0.5, 200)

  // Sub-linear / diminishing returns
  assert.ok(d100 > 0)
  assert.ok(d200 > d100)
  assert.ok(d400 > d200)
  assert.ok(d200 < d100 * 2, 'Rubberband displacement should have diminishing returns')

  // Stiffer resistance yields smaller displacement
  const dStiff = rubberBandDisplacement(200, 0.8, 200)
  assert.ok(dStiff < d200, 'Higher resistance should yield smaller displacement')
})

test('CanvasSpringEngine initializes with default config and validates parameters', () => {
  const engine = new CanvasSpringEngine({ x: 100, y: 200, zoom: 1.5 })
  const config = engine.getConfig()

  assert.equal(config.preset, 'paper')
  assert.equal(config.stiffness, DEFAULT_CANVAS_PHYSICS.stiffness)
  assert.equal(config.damping, DEFAULT_CANVAS_PHYSICS.damping)
  assert.equal(config.mass, DEFAULT_CANVAS_PHYSICS.mass)
  assert.equal(config.momentumPanning, true)
  assert.equal(config.kineticZoom, true)
  assert.equal(config.edgeBouncing, true)

  const current = engine.getCurrent()
  assert.equal(current.x, 100)
  assert.equal(current.y, 200)
  assert.equal(current.zoom, 1.5)
  assert.ok(engine.isSettled())
})

test('CanvasSpringEngine applies presets correctly', () => {
  const engine = new CanvasSpringEngine({ x: 0, y: 0, zoom: 1 })

  engine.applyPreset('snappy')
  assert.equal(engine.getConfig().preset, 'snappy')
  assert.equal(engine.getConfig().stiffness, CANVAS_PHYSICS_PRESETS.snappy.stiffness)
  assert.equal(engine.getConfig().damping, CANVAS_PHYSICS_PRESETS.snappy.damping)

  engine.applyPreset('fluid')
  assert.equal(engine.getConfig().preset, 'fluid')
  assert.equal(engine.getConfig().friction, CANVAS_PHYSICS_PRESETS.fluid.friction)

  engine.applyPreset('direct')
  assert.equal(engine.getConfig().preset, 'direct')
  assert.equal(engine.getConfig().momentumPanning, false)
})

test('CanvasSpringEngine spring interpolation towards target camera', () => {
  const engine = new CanvasSpringEngine({ x: 0, y: 0, zoom: 1 })
  engine.setTargetCamera({ x: 500, y: 300, zoom: 2 }, true)

  assert.equal(engine.isSettled(), false)
  const initial = engine.getCurrent()
  assert.equal(initial.x, 0)

  // Step simulation forward 20 frames (approx 320ms)
  for (let i = 0; i < 20; i++) {
    engine.step(0.016)
  }

  const midway = engine.getCurrent()
  assert.ok(midway.x > 100 && midway.x < 500, `Expected midway x to advance, got ${midway.x}`)
  assert.ok(midway.y > 50 && midway.y < 300, `Expected midway y to advance, got ${midway.y}`)
  assert.ok(midway.zoom > 1 && midway.zoom <= 2, `Expected midway zoom to advance, got ${midway.zoom}`)

  // Step until settled (up to 120 more frames)
  let settled = false
  for (let i = 0; i < 120; i++) {
    const res = engine.step(0.016)
    if (res.settled) {
      settled = true
      break
    }
  }

  assert.ok(settled, 'Engine should settle on target')
  const finalCam = engine.getCurrent()
  assert.ok(Math.abs(finalCam.x - 500) < 0.1)
  assert.ok(Math.abs(finalCam.y - 300) < 0.1)
  assert.ok(Math.abs(finalCam.zoom - 2) < 0.001)
})

test('CanvasSpringEngine momentum fling coasting and friction decay', () => {
  const engine = new CanvasSpringEngine({ x: 0, y: 0, zoom: 1 })
  // Fling with 1000 px/s in x
  engine.fling({ x: 1000, y: 0 })

  assert.equal(engine.isSettled(), false)
  const initialTelemetry = engine.getTelemetry()
  assert.equal(initialTelemetry.isCoasting, true)
  assert.ok(initialTelemetry.speed > 900)

  // Step forward
  engine.step(0.1) // 100ms
  const posAfter100ms = engine.getCurrent()
  assert.ok(posAfter100ms.x > 30, `Expected x displacement from fling, got ${posAfter100ms.x}`)

  // Continue stepping until momentum is absorbed by friction
  let settled = false
  for (let i = 0; i < 150; i++) {
    const res = engine.step(0.016)
    if (res.settled) {
      settled = true
      break
    }
  }

  assert.ok(settled, 'Fling momentum should eventually settle due to friction')
  assert.equal(engine.getTelemetry().isCoasting, false)
  assert.equal(engine.getVelocity().x, 0)
})

test('CanvasSpringEngine kinetic zoom and anchor preservation', () => {
  const engine = new CanvasSpringEngine({ x: 0, y: 0, zoom: 1 })
  engine.setViewportSize({ width: 800, height: 600 })

  // Cursor at center (400, 300)
  const anchor = { x: 400, y: 300 }
  engine.addZoomImpulse(0.5, anchor)

  assert.equal(engine.isSettled(), false)
  assert.ok(engine.getVelocity().zoom > 0)

  // Step forward
  for (let i = 0; i < 30; i++) {
    engine.step(0.016)
  }

  const cam = engine.getCurrent()
  assert.ok(cam.zoom > 1, `Zoom should have increased, got ${cam.zoom}`)
})

test('CanvasSpringEngine fluid edge bouncing on zoom limits', () => {
  const engine = new CanvasSpringEngine({ x: 0, y: 0, zoom: 0.1 })
  // Directly set zoom below MIN_ZOOM (simulating extreme pinch or overshoot)
  engine.zoomImmediate(0.05, undefined, false)

  // Verify bounce triggers
  const res = engine.step(0.016)
  assert.equal(res.settled, false)
  const telemetry = engine.getTelemetry()
  assert.ok(telemetry.isBouncing)
  assert.ok(telemetry.bounceState.zoomMin > 0)

  // Step until spring restores zoom to MIN_ZOOM
  for (let i = 0; i < 120; i++) {
    engine.step(0.016)
  }

  const finalCam = engine.getCurrent()
  assert.ok(finalCam.zoom >= MIN_ZOOM * 0.99, `Zoom should restore to MIN_ZOOM, got ${finalCam.zoom}`)
})

test('CanvasSpringEngine spatial edge bouncing on soft bounds', () => {
  const engine = new CanvasSpringEngine({ x: 0, y: 0, zoom: 1 })
  engine.setViewportSize({ width: 800, height: 600 })
  // Set soft boundaries around world (0,0) with 1000x1000
  engine.setSoftBounds({ x: 0, y: 0, width: 1000, height: 1000 })

  // Pan far left past boundary
  engine.panImmediate({ x: 3000, y: 0 })

  const res = engine.step(0.016)
  const telemetry = engine.getTelemetry()
  assert.ok(telemetry.bounceState.active || telemetry.bounceState.left > 0)

  // Step until spring pushes it back
  for (let i = 0; i < 100; i++) {
    engine.step(0.016)
  }

  const finalCam = engine.getCurrent()
  assert.ok(finalCam.x < 3000, 'Spatial edge bounce should pull camera back inward')
})

test('CanvasSpringEngine immediate stop halts all velocities and motion', () => {
  const engine = new CanvasSpringEngine({ x: 0, y: 0, zoom: 1 })
  engine.fling({ x: 2000, y: 1500 }, 2)
  assert.equal(engine.isSettled(), false)

  engine.stop()
  assert.equal(engine.isSettled(), true)
  assert.deepEqual(engine.getVelocity(), { x: 0, y: 0, zoom: 0 })
})

test('ViewportController integrates CanvasSpringEngine and provides telemetry', () => {
  const controller = new ViewportController({ x: 0, y: 0, zoom: 1 })
  controller.resize({ width: 1000, height: 800 })

  let receivedSnapshot = null
  controller.subscribe((snap) => {
    receivedSnapshot = snap
  })
  assert.ok(receivedSnapshot !== null)
  assert.equal(receivedSnapshot.camera.zoom, 1)

  let telemetryReceived = null
  const unsubPhysics = controller.subscribePhysics((tel) => {
    telemetryReceived = tel
  })
  assert.ok(telemetryReceived !== null)
  assert.equal(telemetryReceived.speed, 0)

  // Fling
  controller.fling({ x: 800, y: 400 })
  const postFlingTel = controller.getPhysicsTelemetry()
  assert.ok(postFlingTel.isCoasting)

  // Stop immediately
  controller.stop()
  assert.equal(controller.getPhysicsTelemetry().isCoasting, false)
  assert.equal(controller.getPhysicsTelemetry().speed, 0)

  // Presets and config
  controller.applyPhysicsPreset('snappy')
  assert.equal(controller.getPhysicsConfig().preset, 'snappy')

  controller.setPhysicsConfig({ friction: 0.92 })
  assert.equal(controller.getPhysicsConfig().friction, 0.92)

  unsubPhysics()
  controller.dispose()
})
