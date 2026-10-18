import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canSplitAnchor,
  splitPathAtAnchor,
  splitPathAtSegment,
  splitContoursAtSelection,
  reversePathContour,
  canJoinSelection,
  joinPathAnchors,
  copyContours,
  serializePath,
  parsePath,
} from '../src/scene/pathGeometry.ts'
import { SceneStore } from '../src/scene/store.ts'

test('canSplitAnchor correctly identifies splittable anchors', () => {
  // Closed contour with 3 anchors -> any anchor can be split to open the path
  const closedContour = {
    closed: true,
    anchors: [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ],
  }
  assert.equal(canSplitAnchor(closedContour, 0), true)
  assert.equal(canSplitAnchor(closedContour, 1), true)
  assert.equal(canSplitAnchor(closedContour, 2), true)
  assert.equal(canSplitAnchor(closedContour, 3), false)

  // Open contour with 4 anchors -> only interior anchors (1 and 2) can be split
  const openContour = {
    closed: false,
    anchors: [
      { x: 0, y: 0 },
      { x: 30, y: 30 },
      { x: 60, y: 60 },
      { x: 100, y: 100 },
    ],
  }
  assert.equal(canSplitAnchor(openContour, 0), false) // start endpoint
  assert.equal(canSplitAnchor(openContour, 1), true) // interior
  assert.equal(canSplitAnchor(openContour, 2), true) // interior
  assert.equal(canSplitAnchor(openContour, 3), false) // end endpoint
  assert.equal(canSplitAnchor(undefined, 1), false)
})

test('splitPathAtAnchor opens a closed contour at the specified anchor', () => {
  const closedContour = {
    closed: true,
    anchors: [
      { x: 0, y: 0, out: { x: 10, y: 0 } },
      { x: 50, y: 50, in: { x: 40, y: 50 }, out: { x: 60, y: 50 } },
      { x: 100, y: 0, in: { x: 90, y: 0 }, out: { x: 90, y: -10 } },
    ],
  }

  // Split at anchor index 1 (50, 50)
  const result = splitPathAtAnchor(closedContour, 1)
  assert.equal(result.length, 1)
  const opened = result[0]
  assert.equal(opened.closed, false)
  // Number of anchors should be 4: starts at 50,50, passes through 100,0 and 0,0, ends at 50,50
  assert.equal(opened.anchors.length, 4)
  assert.equal(opened.anchors[0].x, 50)
  assert.equal(opened.anchors[0].y, 50)
  assert.equal(opened.anchors[0].in, undefined)
  assert.deepEqual(opened.anchors[0].out, { x: 60, y: 50 })

  assert.equal(opened.anchors[1].x, 100)
  assert.equal(opened.anchors[1].y, 0)

  assert.equal(opened.anchors[2].x, 0)
  assert.equal(opened.anchors[2].y, 0)

  assert.equal(opened.anchors[3].x, 50)
  assert.equal(opened.anchors[3].y, 50)
  assert.deepEqual(opened.anchors[3].in, { x: 40, y: 50 })
  assert.equal(opened.anchors[3].out, undefined)
})

test('splitPathAtAnchor splits an open contour at an interior anchor into two contours', () => {
  const openContour = {
    closed: false,
    anchors: [
      { x: 0, y: 0 },
      { x: 30, y: 30, in: { x: 20, y: 30 }, out: { x: 40, y: 30 } },
      { x: 60, y: 60 },
      { x: 100, y: 100 },
    ],
  }

  const result = splitPathAtAnchor(openContour, 1)
  assert.equal(result.length, 2)
  const [partA, partB] = result
  assert.equal(partA.closed, false)
  assert.equal(partB.closed, false)

  // Part A ends at (30, 30)
  assert.equal(partA.anchors.length, 2)
  assert.equal(partA.anchors[0].x, 0)
  assert.equal(partA.anchors[1].x, 30)
  assert.deepEqual(partA.anchors[1].in, { x: 20, y: 30 })
  assert.equal(partA.anchors[1].out, undefined)

  // Part B starts at (30, 30)
  assert.equal(partB.anchors.length, 3)
  assert.equal(partB.anchors[0].x, 30)
  assert.equal(partB.anchors[0].in, undefined)
  assert.deepEqual(partB.anchors[0].out, { x: 40, y: 30 })
  assert.equal(partB.anchors[1].x, 60)
  assert.equal(partB.anchors[2].x, 100)
})

test('splitPathAtSegment inserts a node and splits in one pure step', () => {
  const closedContour = {
    closed: true,
    anchors: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  }

  // Split on segment 0 at t = 0.5 (midpoint between (0,0) and (100,0) -> (50,0))
  const split = splitPathAtSegment(closedContour, 0, 0.5)
  assert.equal(split.length, 1)
  const contour = split[0]
  assert.equal(contour.closed, false)
  assert.equal(contour.anchors[0].x, 50)
  assert.equal(contour.anchors[0].y, 0)
  assert.equal(contour.anchors.at(-1)?.x, 50)
  assert.equal(contour.anchors.at(-1)?.y, 0)

  // Original contour should not be mutated
  assert.equal(closedContour.anchors.length, 4)
  assert.equal(closedContour.closed, true)
})

test('splitContoursAtSelection splits within a multi-contour path', () => {
  const contours = [
    {
      closed: true,
      anchors: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    },
    {
      closed: false,
      anchors: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }],
    },
  ]

  const updated = splitContoursAtSelection(contours, { contour: 1, anchor: 1 })
  assert.equal(updated.length, 3)
  assert.equal(updated[0], contours[0])
  assert.equal(updated[1].anchors.length, 2)
  assert.equal(updated[2].anchors.length, 2)
})

test('reversePathContour reverses anchor points and inverts tangent handles', () => {
  const contour = {
    closed: false,
    anchors: [
      { x: 0, y: 0, out: { x: 10, y: 20 } },
      { x: 50, y: 50, in: { x: 40, y: 50 }, out: { x: 60, y: 50 } },
      { x: 100, y: 100, in: { x: 90, y: 80 } },
    ],
  }

  const rev = reversePathContour(contour)
  assert.equal(rev.anchors.length, 3)
  assert.equal(rev.closed, false)

  assert.equal(rev.anchors[0].x, 100)
  assert.equal(rev.anchors[0].y, 100)
  assert.deepEqual(rev.anchors[0].out, { x: 90, y: 80 })
  assert.equal(rev.anchors[0].in, undefined)

  assert.equal(rev.anchors[1].x, 50)
  assert.deepEqual(rev.anchors[1].in, { x: 60, y: 50 })
  assert.deepEqual(rev.anchors[1].out, { x: 40, y: 50 })

  assert.equal(rev.anchors[2].x, 0)
  assert.deepEqual(rev.anchors[2].in, { x: 10, y: 20 })
  assert.equal(rev.anchors[2].out, undefined)
})

test('canJoinSelection and joinPathAnchors correctly join open contours in all 4 orientation cases', () => {
  // Case A: Single open contour endpoint -> close it
  const singleOpen = [{
    closed: false,
    anchors: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }],
  }]
  assert.equal(canJoinSelection(singleOpen, [{ contour: 0, anchor: 0 }]), true)
  const joinedSingle = joinPathAnchors(singleOpen, [{ contour: 0, anchor: 0 }])
  assert.equal(joinedSingle.joined, true)
  assert.equal(joinedSingle.contours[0].closed, true)

  // Case B: Same contour both endpoints (0 and 2)
  const joinedSame = joinPathAnchors(singleOpen, [{ contour: 0, anchor: 0 }, { contour: 0, anchor: 2 }])
  assert.equal(joinedSame.joined, true)
  assert.equal(joinedSame.contours[0].closed, true)

  // Case C: Two open contours - end of c1 to start of c2 (coincident)
  const c1 = {
    closed: false,
    anchors: [{ x: 0, y: 0 }, { x: 50, y: 0, out: { x: 60, y: 0 } }],
  }
  const c2 = {
    closed: false,
    anchors: [{ x: 50, y: 0, out: { x: 70, y: 20 } }, { x: 100, y: 50 }],
  }
  const twoContours = [c1, c2]
  assert.equal(canJoinSelection(twoContours, [{ contour: 0, anchor: 1 }, { contour: 1, anchor: 0 }]), true)

  const res1 = joinPathAnchors(twoContours, [{ contour: 0, anchor: 1 }, { contour: 1, anchor: 0 }])
  assert.equal(res1.joined, true)
  assert.equal(res1.contours.length, 1)
  assert.equal(res1.contours[0].anchors.length, 3)
  assert.equal(res1.contours[0].anchors[0].x, 0)
  assert.equal(res1.contours[0].anchors[1].x, 50)
  assert.deepEqual(res1.contours[0].anchors[1].out, { x: 70, y: 20 })
  assert.equal(res1.contours[0].anchors[2].x, 100)

  // Case D: Two open contours - start of c1 to start of c2 (reverses c1)
  const c3 = {
    closed: false,
    anchors: [{ x: 0, y: 0 }, { x: -50, y: 0 }],
  }
  const c4 = {
    closed: false,
    anchors: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
  }
  const res2 = joinPathAnchors([c3, c4], [{ contour: 0, anchor: 0 }, { contour: 1, anchor: 0 }])
  assert.equal(res2.joined, true)
  assert.equal(res2.contours.length, 1)
  assert.equal(res2.contours[0].anchors[0].x, -50)
  assert.equal(res2.contours[0].anchors[1].x, 0)
  assert.equal(res2.contours[0].anchors[2].x, 50)

  // Case E: Two open contours - end of c1 to end of c2 (reverses c2)
  const c5 = {
    closed: false,
    anchors: [{ x: -50, y: 0 }, { x: 0, y: 0 }],
  }
  const c6 = {
    closed: false,
    anchors: [{ x: 50, y: 0 }, { x: 0, y: 0 }],
  }
  const res3 = joinPathAnchors([c5, c6], [{ contour: 0, anchor: 1 }, { contour: 1, anchor: 1 }])
  assert.equal(res3.joined, true)
  assert.equal(res3.contours.length, 1)
  assert.equal(res3.contours[0].anchors[0].x, -50)
  assert.equal(res3.contours[0].anchors[1].x, 0)
  assert.equal(res3.contours[0].anchors[2].x, 50)

  // Case F: Start of c1 to end of c2 (order c2 then c1)
  const c7 = {
    closed: false,
    anchors: [{ x: 50, y: 0 }, { x: 100, y: 0 }],
  }
  const c8 = {
    closed: false,
    anchors: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
  }
  const res4 = joinPathAnchors([c7, c8], [{ contour: 0, anchor: 0 }, { contour: 1, anchor: 1 }])
  assert.equal(res4.joined, true)
  assert.equal(res4.contours.length, 1)
  assert.equal(res4.contours[0].anchors[0].x, 0)
  assert.equal(res4.contours[0].anchors[1].x, 50)
  assert.equal(res4.contours[0].anchors[2].x, 100)
})

test('SceneStore splitPathToSeparateElements breaks compound contours into distinct scene graph layers', () => {
  const store = new SceneStore()

  // Add a path with two subpaths
  const contour1 = {
    closed: true,
    anchors: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 10, y: 50 }],
  }
  const contour2 = {
    closed: true,
    anchors: [{ x: 100, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 150 }, { x: 100, y: 150 }],
  }

  const originalPath = store.add('path', {
    name: 'Multi-contour Shape',
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    nodes: [contour1, contour2],
    d: serializePath([contour1, contour2]),
    viewBox: [0, 0, 200, 200],
    style: {
      fill: '#81adec',
      stroke: { color: '#080808', width: 2, dash: [] },
    },
  })

  assert.equal(store.getSnapshot().elements[originalPath.id].nodes?.length, 2)

  // Split into separate layers
  const createdIds = store.splitPathToSeparateElements(originalPath.id)
  assert.equal(createdIds.length, 2)

  // Original path should have been removed
  assert.equal(store.getSnapshot().elements[originalPath.id], undefined)

  // New layers should exist with independent geometry and styles
  const layer1 = store.getSnapshot().elements[createdIds[0]]
  const layer2 = store.getSnapshot().elements[createdIds[1]]

  assert.ok(layer1 && layer1.type === 'path')
  assert.ok(layer2 && layer2.type === 'path')
  assert.equal(layer1.nodes?.length, 1)
  assert.equal(layer2.nodes?.length, 1)
  assert.equal(layer1.style.fill, '#81adec')
  assert.equal(layer2.style.fill, '#81adec')

  // Test undo
  store.undo()
  assert.ok(store.getSnapshot().elements[originalPath.id])
  assert.equal(store.getSnapshot().elements[createdIds[0]], undefined)

  // Test redo
  store.redo()
  assert.equal(store.getSnapshot().elements[originalPath.id], undefined)
  assert.ok(store.getSnapshot().elements[createdIds[0]])
  assert.ok(store.getSnapshot().elements[createdIds[1]])
})
