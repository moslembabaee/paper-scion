import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bendSegment,
  convertSegmentCurveMode,
  copyContours,
  cubicHandlesToQuadApex,
  evaluateSegmentCurvature,
  getHandleType,
  isSmoothNode,
  moveAnchor,
  moveHandle,
  moveQuadApex,
  nearestPathSegment,
  parsePath,
  quadToCubicHandles,
  roundPathContours,
  segmentPoint,
  serializePath,
  setHandleType,
  snapToGrid,
  toggleNodeCornerSmooth,
} from '../src/scene/pathGeometry.ts'
import { evaluatePathCAG } from '../src/scene/cagEngine.ts'

test('quadToCubicHandles & cubicHandlesToQuadApex are exact mathematical inverses', () => {
  const p0 = { x: 0, y: 0 }
  const quadApex = { x: 50, y: 120 }
  const p1 = { x: 100, y: 0 }

  const handles = quadToCubicHandles(p0, quadApex, p1)
  assert.ok(handles.out && handles.in)

  // Out and In handles for quadratic Bézier are at 2/3 distance
  assert.ok(Math.abs(handles.out.x - (2 / 3) * 50) < 1e-4)
  assert.ok(Math.abs(handles.out.y - (2 / 3) * 120) < 1e-4)

  // Invert back to apex
  const reconstructedApex = cubicHandlesToQuadApex(p0, handles.out, handles.in, p1)
  assert.ok(Math.abs(reconstructedApex.x - quadApex.x) < 1e-4)
  assert.ok(Math.abs(reconstructedApex.y - quadApex.y) < 1e-4)
})

test('bendSegment interactively pulls curve through target point in both cubic and quadratic modes', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 100, y: 0 }
  const dragPoint = { x: 50, y: 60 }
  const t = 0.5

  // 1. Quadratic bending
  const bentQuad = bendSegment(a, b, t, dragPoint, 'quadratic')
  assert.equal(bentQuad.mode, 'quadratic')
  assert.ok(bentQuad.quadApex)

  const anchorQuadA = { ...a, out: bentQuad.out, quadApex: bentQuad.quadApex, curveMode: 'quadratic' }
  const anchorQuadB = { ...b, in: bentQuad.in }
  const evaluatedQuad = segmentPoint(anchorQuadA, anchorQuadB, t)
  assert.ok(Math.abs(evaluatedQuad.x - dragPoint.x) < 1e-3)
  assert.ok(Math.abs(evaluatedQuad.y - dragPoint.y) < 1e-3)

  // 2. Cubic bending
  const bentCubic = bendSegment(a, b, t, dragPoint, 'cubic')
  assert.equal(bentCubic.mode, 'cubic')

  const anchorCubicA = { ...a, out: bentCubic.out, curveMode: 'cubic' }
  const anchorCubicB = { ...b, in: bentCubic.in }
  const evaluatedCubic = segmentPoint(anchorCubicA, anchorCubicB, t)
  assert.ok(Math.abs(evaluatedCubic.x - dragPoint.x) < 1e-3)
  assert.ok(Math.abs(evaluatedCubic.y - dragPoint.y) < 1e-3)
})

test('toggleNodeCornerSmooth toggles between sharp corner and continuous smooth curvature', () => {
  const contour = {
    closed: true,
    anchors: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  }

  const initialAnchor = contour.anchors[1]
  assert.equal(isSmoothNode(initialAnchor), false)

  // Toggle from sharp corner to smooth
  const smoothed = toggleNodeCornerSmooth(initialAnchor, contour, 1)
  assert.ok(smoothed.in && smoothed.out)
  assert.equal(isSmoothNode(smoothed), true)
  assert.equal(getHandleType(smoothed), 'mirrored')

  // Toggle back from smooth to sharp corner
  const cornerAgain = toggleNodeCornerSmooth(smoothed, contour, 1)
  assert.equal(cornerAgain.in, undefined)
  assert.equal(cornerAgain.out, undefined)
  assert.equal(isSmoothNode(cornerAgain), false)
})

test('evaluateSegmentCurvature computes accurate curvature radius and normal vectors', () => {
  // Semi-circle-like symmetric cubic curve
  const a = { x: 0, y: 0, out: { x: 0, y: 55.228 } }
  const b = { x: 100, y: 0, in: { x: 100, y: 55.228 } }

  const curvature = evaluateSegmentCurvature(a, b, 0.5)
  assert.ok(Number.isFinite(curvature.curvature))
  assert.ok(curvature.curvature > 0)
  assert.ok(Number.isFinite(curvature.radius))
  assert.ok(curvature.radius > 10 && curvature.radius < 500)

  // Tangent at midpoint of symmetric curve should be horizontal
  assert.ok(Math.abs(curvature.tangent.y) < 1e-3)
  assert.ok(Math.abs(Math.hypot(curvature.tangent.x, curvature.tangent.y) - 1) < 1e-3)

  // Normal should be unit length and orthogonal to tangent
  assert.ok(Math.abs(Math.hypot(curvature.normal.x, curvature.normal.y) - 1) < 1e-3)
  assert.ok(Math.abs(curvature.normal.x * curvature.tangent.x + curvature.normal.y * curvature.tangent.y) < 1e-4)
})

test('snapToGrid accurately snaps to 120px engineering grid lines and 24px minor grid', () => {
  // Point close to (120, 240)
  const nearMajor = { x: 122, y: 239 }
  const snappedMajor = snapToGrid(nearMajor, true, 120, 24, 8, 1)
  assert.equal(snappedMajor.snapped, true)
  assert.equal(snappedMajor.type, 'major')
  assert.equal(snappedMajor.point.x, 120)
  assert.equal(snappedMajor.point.y, 240)

  // Point close to (48, 72) - minor grid
  const nearMinor = { x: 49, y: 71 }
  const snappedMinor = snapToGrid(nearMinor, true, 120, 24, 8, 1)
  assert.equal(snappedMinor.snapped, true)
  assert.equal(snappedMinor.type, 'minor')
  assert.equal(snappedMinor.point.x, 48)
  assert.equal(snappedMinor.point.y, 72)

  // Point far from grid
  const farPoint = { x: 55, y: 83 }
  const unsnapped = snapToGrid(farPoint, true, 120, 24, 4, 1)
  assert.equal(unsnapped.snapped, false)
  assert.equal(unsnapped.point.x, 55)
  assert.equal(unsnapped.point.y, 83)
})

test('convertSegmentCurveMode seamlessly switches between cubic and quadratic Bézier segments', () => {
  const contour = {
    closed: true,
    anchors: [
      { x: 0, y: 0, out: { x: 25, y: 50 }, curveMode: 'cubic' },
      { x: 100, y: 0, in: { x: 75, y: 50 } },
      { x: 50, y: 100 },
    ],
  }

  convertSegmentCurveMode(contour, 0, 'quadratic')
  assert.equal(contour.anchors[0].curveMode, 'quadratic')
  assert.ok(contour.anchors[0].quadApex)

  const serializedQuad = serializePath([contour])
  assert.match(serializedQuad, /Q /)

  convertSegmentCurveMode(contour, 0, 'cubic')
  assert.equal(contour.anchors[0].curveMode, 'cubic')
  assert.equal(contour.anchors[0].quadApex, undefined)

  const serializedCubic = serializePath([contour])
  assert.match(serializedCubic, /C /)
})

test('vector Pen paths with Bézier curves integrate seamlessly with CAG boolean engine', () => {
  // Construct two paths designed via Pen tool with Bézier curves:
  // Path 1: Curving closed balloon
  const contour1 = {
    closed: true,
    anchors: [
      { x: 0, y: 50, out: { x: 0, y: 20 }, in: { x: 0, y: 80 } },
      { x: 50, y: 0, out: { x: 80, y: 0 }, in: { x: 20, y: 0 } },
      { x: 100, y: 50, out: { x: 100, y: 80 }, in: { x: 100, y: 20 } },
      { x: 50, y: 100, out: { x: 20, y: 100 }, in: { x: 80, y: 100 } },
    ],
  }
  const d1 = serializePath([contour1])

  // Path 2: Overlapping cutter rectangle
  const d2 = 'M 40 40 L 120 40 L 120 120 L 40 120 Z'

  // Union
  const unionResult = evaluatePathCAG(d1, d2, 'union')
  assert.ok(unionResult.d)
  assert.ok(unionResult.metrics.area > 0)
  assert.ok(unionResult.metrics.contourCount >= 1)

  // Difference
  const diffResult = evaluatePathCAG(d1, d2, 'difference')
  assert.ok(diffResult.d)
  assert.ok(diffResult.metrics.area > 0)

  // Intersection
  const intersectResult = evaluatePathCAG(d1, d2, 'intersection')
  assert.ok(intersectResult.d)
  assert.ok(intersectResult.metrics.area > 0)

  // Exclusion
  const excludeResult = evaluatePathCAG(d1, d2, 'exclusion')
  assert.ok(excludeResult.d)
  assert.ok(excludeResult.metrics.area > 0)
})

test('moveQuadApex correctly recomputes equivalent cubic handles for quadratic segment', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 100, y: 0 }
  const apex = { x: 50, y: 80 }

  const updated = moveQuadApex(a, b, apex)
  assert.equal(updated.a.curveMode, 'quadratic')
  assert.deepEqual(updated.a.quadApex, apex)
  assert.ok(Math.abs(updated.a.out.x - (2 / 3) * 50) < 1e-4)
  assert.ok(Math.abs(updated.a.out.y - (2 / 3) * 80) < 1e-4)
  assert.ok(Math.abs(updated.b.in.x - (100 + (2 / 3) * (50 - 100))) < 1e-4)
  assert.ok(Math.abs(updated.b.in.y - (2 / 3) * 80) < 1e-4)
})

test('parsePath extracts quadratic curveMode and quadApex from SVG Q commands', () => {
  const d = 'M 0 0 Q 60 120 120 0 Z'
  const contours = parsePath(d)
  assert.equal(contours.length, 1)
  assert.equal(contours[0].anchors[0].curveMode, 'quadratic')
  assert.deepEqual(contours[0].anchors[0].quadApex, { x: 60, y: 120 })
})

test('elements validation and freezing preserve quadratic quadApex on path nodes', async () => {
  const { validateElement, freezeElement } = await import('../src/scene/elements.ts')
  const contour = {
    closed: true,
    anchors: [
      { x: 0, y: 0, out: { x: 40, y: 80 }, quadApex: { x: 60, y: 120 }, curveMode: 'quadratic' },
      { x: 120, y: 0, in: { x: 80, y: 80 } },
    ],
  }
  const d = serializePath([contour])
  const element = {
    id: 'path-1',
    name: 'Vector Path',
    parentId: null,
    type: 'path',
    x: 0,
    y: 0,
    width: 120,
    height: 120,
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    d,
    viewBox: [0, 0, 120, 120],
    fillRule: 'nonzero',
    nodes: [contour],
    style: { fill: '#81adec', stroke: null, opacity: 1, shadow: null },
  }

  assert.doesNotThrow(() => validateElement(element))
  const frozen = freezeElement(element)
  assert.ok(frozen.type === 'path' && frozen.nodes)
  assert.deepEqual(frozen.nodes[0].anchors[0].quadApex, { x: 60, y: 120 })
})

test('path closing serializes with Z and integrates with boolean engine', () => {
  const openContour = {
    closed: false,
    anchors: [
      { x: 0, y: 0 },
      { x: 100, y: 0, out: { x: 100, y: 50 } },
      { x: 100, y: 100, in: { x: 100, y: 50 } },
      { x: 0, y: 100 },
    ],
  }
  const openSvg = serializePath([openContour])
  assert.ok(!openSvg.includes('Z'))

  // Close the contour
  const closedContour = { ...openContour, closed: true }
  const closedSvg = serializePath([closedContour])
  assert.ok(closedSvg.includes('Z'))

  // Test boolean operation with closed path
  const cutter = 'M 50 50 L 150 50 L 150 150 L 50 150 Z'
  const result = evaluatePathCAG(closedSvg, cutter, 'intersection')
  assert.ok(result.d)
  assert.ok(result.metrics.area > 0)
})


