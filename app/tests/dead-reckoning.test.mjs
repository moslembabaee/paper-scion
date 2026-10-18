import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DeadReckoningCursor,
  projectEdgePosition,
  formatCursorCoordinates,
  computeZoomScale,
  isNearGrid,
  normalizeTimestamp,
} from '../src/collaboration/deadReckoning.ts'

test('DeadReckoningCursor initializes at initial point with zero velocity', () => {
  const dr = new DeadReckoningCursor({ x: 100, y: 200 })
  assert.deepEqual(dr.getPoint(), { x: 100, y: 200 })
  assert.deepEqual(dr.getVelocity(), { x: 0, y: 0 })
})

test('DeadReckoningCursor estimates velocity and dead-reckons position forward', () => {
  const dr = new DeadReckoningCursor({ x: 100, y: 50 }, undefined, 1000)
  // Sample 2 at t = 1100ms (dx = 100 in 0.1s -> ~1000 px/sec)
  dr.update({ x: 200, y: 100 }, 1100)

  const vel = dr.getVelocity()
  assert.ok(vel.x > 500, `Expected positive x velocity, got ${vel.x}`)
  assert.ok(vel.y > 200, `Expected positive y velocity, got ${vel.y}`)

  // Step at t = 1120ms (dt = 20ms)
  const result = dr.step(1120, 20, 1, false)
  assert.ok(result.moving)
  // Projected forward beyond sample 1 (x started at 100 and moves towards > 200)
  assert.ok(result.point.x > 120, `Expected point.x > 120, got ${result.point.x}`)
})

test('DeadReckoningCursor decays forward prediction when samples stop', () => {
  const dr = new DeadReckoningCursor({ x: 0, y: 0 }, undefined, 950)
  dr.update({ x: 100, y: 100 }, 1000)
  dr.update({ x: 200, y: 200 }, 1050)

  // Step over multiple frames past prediction window
  let result
  for (let t = 1066; t <= 1600; t += 16.67) {
    result = dr.step(t, 16.67, 1, false)
  }
  // Should settle at target (200, 200)
  assert.equal(Math.round(result.point.x), 200)
  assert.equal(Math.round(result.point.y), 200)
  assert.equal(result.moving, false)
})

test('DeadReckoningCursor snaps immediately on large teleport jumps', () => {
  const dr = new DeadReckoningCursor({ x: 100, y: 100 })
  // Teleport jump > 1200 px
  dr.update({ x: 5000, y: 5000 }, 1000)
  assert.deepEqual(dr.getPoint(), { x: 5000, y: 5000 })
  assert.deepEqual(dr.getVelocity(), { x: 0, y: 0 })
})

test('DeadReckoningCursor snaps directly when reducedMotion is true', () => {
  const dr = new DeadReckoningCursor({ x: 0, y: 0 })
  dr.update({ x: 300, y: 400 }, 1000)
  const result = dr.step(1050, 16.67, 1, true)
  assert.deepEqual(result.point, { x: 300, y: 400 })
  assert.equal(result.moving, false)
})

test('projectEdgePosition returns isOffscreen: false when point is inside viewport', () => {
  const camera = { x: 0, y: 0, zoom: 1 }
  const size = { width: 1000, height: 800 }
  const result = projectEdgePosition({ x: 500, y: 400 }, camera, size, 30)
  assert.equal(result.isOffscreen, false)
  assert.equal(result.distance, 0)
})

test('projectEdgePosition calculates edge coordinates and angles for offscreen points', () => {
  const camera = { x: 0, y: 0, zoom: 1 }
  const size = { width: 1000, height: 800 } // center at 500, 400
  const margin = 20

  // Far right point
  const right = projectEdgePosition({ x: 2000, y: 400 }, camera, size, margin)
  assert.equal(right.isOffscreen, true)
  assert.equal(Math.round(right.edgePoint.x), 1000 - margin)
  assert.equal(Math.round(right.edgePoint.y), 400)
  assert.equal(Math.round(right.angleDeg), 0)

  // Far top point
  const top = projectEdgePosition({ x: 500, y: -500 }, camera, size, margin)
  assert.equal(top.isOffscreen, true)
  assert.equal(Math.round(top.edgePoint.x), 500)
  assert.equal(Math.round(top.edgePoint.y), margin)
  assert.equal(Math.round(top.angleDeg), -90)

  // Far left point
  const left = projectEdgePosition({ x: -1000, y: 400 }, camera, size, margin)
  assert.equal(left.isOffscreen, true)
  assert.equal(Math.round(left.edgePoint.x), margin)
  assert.equal(Math.round(left.edgePoint.y), 400)

  // Far bottom point
  const bottom = projectEdgePosition({ x: 500, y: 1500 }, camera, size, margin)
  assert.equal(bottom.isOffscreen, true)
  assert.equal(Math.round(bottom.edgePoint.x), 500)
  assert.equal(Math.round(bottom.edgePoint.y), 800 - margin)
  assert.equal(Math.round(bottom.angleDeg), 90)
})

test('formatCursorCoordinates formats with appropriate precision for zoom level', () => {
  assert.equal(formatCursorCoordinates(120.45, 240.89, 1), 'X: 120  Y: 241')
  assert.equal(formatCursorCoordinates(120.45, 240.89, 2), 'X: 120.5  Y: 240.9')
  assert.equal(formatCursorCoordinates(120.45, 240.89, 4), 'X: 120.5  Y: 240.9')
})

test('computeZoomScale adjusts scale factor smoothly based on zoom level', () => {
  assert.equal(computeZoomScale(1), 1)
  assert.equal(computeZoomScale(0.2), 1.25)
  assert.equal(computeZoomScale(0.4), 1.12)
  assert.equal(computeZoomScale(5), 0.92)
})

test('normalizeTimestamp handles relative, performance.now, and Date.now epoch timestamps', () => {
  assert.equal(normalizeTimestamp(1234), 1234)
  const epochNow = Date.now()
  const normalized = normalizeTimestamp(epochNow - 50)
  assert.ok(normalized > 0)
  assert.ok(normalized < 1e11)
})

test('DeadReckoningCursor handles Date.now epoch timestamps without numerical overflow', () => {
  const epochStart = Date.now() - 200
  const dr = new DeadReckoningCursor({ x: 50, y: 50 }, undefined, epochStart)
  dr.update({ x: 150, y: 150 }, epochStart + 100)
  const vel = dr.getVelocity()
  assert.ok(vel.x > 0 && vel.y > 0)
  const result = dr.step(performance.now(), 16.67, 1, false)
  assert.ok(result.point.x > 50)
  assert.ok(result.point.y > 50)
})

test('isNearGrid identifies points snapped to the 120px engineering grid', () => {
  assert.equal(isNearGrid(0, 0, 120), true)
  assert.equal(isNearGrid(120, 240, 120), true)
  assert.equal(isNearGrid(120.5, 239.8, 120), true)
  assert.equal(isNearGrid(360, 480, 120), true)
  assert.equal(isNearGrid(50, 100, 120), false)
  assert.equal(isNearGrid(120, 135, 120), false)
})

