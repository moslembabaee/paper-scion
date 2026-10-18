import test from 'node:test'
import assert from 'node:assert/strict'
import { moveAnchor, parsePath, pathBounds, serializePath, snapPathPoint } from '../src/scene/pathGeometry.ts'
import { getPixelSnap, setPixelSnap, subscribePixelSnap, togglePixelSnap } from '../src/scene/pixelSnap.ts'

test('pathGeometry: parses lines, curves, shorthand and normalizes to cubic anchors', () => {
  const d = 'M 10 20 L 30 40 H 50 V 60 C 60 70 80 90 100 110 S 130 140 150 160 Q 170 180 190 200 T 220 230 Z'
  const contours = parsePath(d)
  assert.equal(contours.length, 1)
  const contour = contours[0]
  assert.equal(contour.closed, true)
  assert.ok(contour.anchors.length >= 6)

  // First anchor should be Move end point
  assert.equal(contour.anchors[0].x, 10)
  assert.equal(contour.anchors[0].y, 20)

  // Serializing should produce valid SVG path data starting with M and ending with Z
  const serialized = serializePath(contours)
  assert.match(serialized, /^M 10 20/)
  assert.match(serialized, /Z$/)
})

test('pathGeometry: parses relative commands and tracks cursor position', () => {
  const d = 'm 10 10 l 20 0 l 0 20 l -20 0 z'
  const contours = parsePath(d)
  assert.equal(contours.length, 1)
  const [c] = contours
  assert.equal(c.closed, true)
  assert.equal(c.anchors[0].x, 10)
  assert.equal(c.anchors[0].y, 10)
  assert.equal(c.anchors[1].x, 30)
  assert.equal(c.anchors[1].y, 10)
  assert.equal(c.anchors[2].x, 30)
  assert.equal(c.anchors[2].y, 30)
})

test('pathGeometry: pathBounds calculates accurate bounding box including handles', () => {
  const contours = [
    {
      closed: false,
      anchors: [
        { x: 0, y: 0, out: { x: 10, y: -20 } },
        { x: 100, y: 50, in: { x: 90, y: 80 } }
      ]
    }
  ]
  const bounds = pathBounds(contours, 2)
  // Handles reach y = -20 and y = 80; padding is 2
  assert.equal(bounds.x, -2)
  assert.equal(bounds.y, -22)
  assert.equal(bounds.width, 104)
  assert.equal(bounds.height, 104)
})

test('pathGeometry: moveAnchor translates anchor and both control handles together', () => {
  const anchor = { x: 10, y: 20, in: { x: 5, y: 15 }, out: { x: 15, y: 25 } }
  const moved = moveAnchor(anchor, { x: 30, y: 50 })
  assert.equal(moved.x, 30)
  assert.equal(moved.y, 50)
  assert.equal(moved.in.x, 25)
  assert.equal(moved.in.y, 45)
  assert.equal(moved.out.x, 35)
  assert.equal(moved.out.y, 55)
})

test('pathGeometry: snapPathPoint snaps strictly to half-pixels when enabled', () => {
  assert.deepEqual(snapPathPoint({ x: 10.1, y: 10.2 }, true), { x: 10, y: 10 })
  assert.deepEqual(snapPathPoint({ x: 10.26, y: 10.74 }, true), { x: 10.5, y: 10.5 })
  assert.deepEqual(snapPathPoint({ x: 10.8, y: 11.2 }, true), { x: 11, y: 11 })
  // When disabled, coordinates are preserved exactly
  assert.deepEqual(snapPathPoint({ x: 10.26, y: 10.74 }, false), { x: 10.26, y: 10.74 })
})

test('pathGeometry: rejects invalid path commands and normalizes SVG arcs', () => {
  assert.deepEqual(parsePath(''), [])
  assert.throws(() => parsePath('M 0 0 @@@ 10 20'), /Invalid SVG path data/)
  assert.throws(() => parsePath('L 10 20'), /A path must start with Move/)
  const arcs = parsePath('M 0 0 A 10 10 0 0 0 20 20')
  assert.equal(arcs[0].anchors.at(-1).x, 20)
  assert.equal(arcs[0].anchors.at(-1).y, 20)
  assert.ok(arcs[0].anchors[0].out)
  assert.match(serializePath(arcs), / C /)
  assert.throws(() => parsePath('M 0 0 A 10 10 0 2 0 20 20'), /arc flags/)
})

test('pixelSnap: state persists, notifies subscribers, and toggles cleanly', () => {
  let observed = null
  const unsubscribe = subscribePixelSnap(value => { observed = value })
  setPixelSnap(false)
  assert.equal(getPixelSnap(), false)
  assert.equal(observed, false)

  togglePixelSnap()
  assert.equal(getPixelSnap(), true)
  assert.equal(observed, true)

  unsubscribe()
  setPixelSnap(false)
  assert.equal(observed, true) // Unsubscribed listener was not notified
  setPixelSnap(true) // Restore
})

test('pathGeometry: SVG compact arc flags and drawing after close normalize correctly', () => {
  const arc = parsePath('M0 50A50 50 0 01100 50')
  assert.equal(arc[0].anchors.at(-1).x, 100)
  assert.equal(arc[0].anchors.at(-1).y, 50)
  const contours = parsePath('M0 0H10V10ZL20 20L20 0Z')
  assert.equal(contours.length, 2)
  assert.equal(contours[0].anchors.length, 3)
  assert.deepEqual(contours[1].anchors[0], { x: 0, y: 0 })
})
