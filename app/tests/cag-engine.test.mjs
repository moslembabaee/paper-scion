import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateCAG,
  evaluatePathCAG,
  calculatePathArea,
  calculatePathPerimeter,
  calculatePathCentroid,
  extractCAGMetrics,
  cleanSvgPathGeometry,
  createSyntheticVectorPath,
  buildCAGHierarchyTree,
  countUnderlyingSources,
  doVectorShapesOverlap,
  exportCleanSVGGeometry,
  toBooleanOperation,
  fromBooleanOperation,
  CAG_OPERATIONS,
} from '../src/scene/cagEngine.ts'
import { createElement } from '../src/scene/elements.ts'

const close = (actual, expected, epsilon = 1e-4) => {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} ≈ ${expected} (diff: ${Math.abs(actual - expected)})`
  )
}

test('CAG operation mappings and metadata are complete and bijective', () => {
  assert.equal(CAG_OPERATIONS.length, 4)
  const ops = CAG_OPERATIONS.map(c => c.operation)
  assert.deepEqual(ops, ['union', 'difference', 'intersection', 'exclusion'])

  assert.equal(toBooleanOperation('union'), 'union')
  assert.equal(toBooleanOperation('difference'), 'subtract')
  assert.equal(toBooleanOperation('intersection'), 'intersect')
  assert.equal(toBooleanOperation('exclusion'), 'exclude')

  assert.equal(fromBooleanOperation('union'), 'union')
  assert.equal(fromBooleanOperation('subtract'), 'difference')
  assert.equal(fromBooleanOperation('intersect'), 'intersection')
  assert.equal(fromBooleanOperation('exclude'), 'exclusion')

  for (const metadata of CAG_OPERATIONS) {
    assert.equal(toBooleanOperation(metadata.operation), metadata.booleanOp)
    assert.equal(fromBooleanOperation(metadata.booleanOp), metadata.operation)
    assert.ok(metadata.name.length > 0)
    assert.ok(metadata.symbol.length > 0)
    assert.ok(metadata.mathFormula.length > 0)
    assert.ok(metadata.hint.length > 0)
  }
})

test('calculatePathArea, calculatePathPerimeter, and calculatePathCentroid evaluate exact metrics', () => {
  // 100 x 100 square
  const square = 'M 0 0 H 100 V 100 H 0 Z'
  close(calculatePathArea(square), 10000)
  close(calculatePathPerimeter(square), 400)
  const centroid = calculatePathCentroid(square)
  close(centroid.x, 50)
  close(centroid.y, 50)

  // Empty or degenerate path handling
  assert.equal(calculatePathArea(''), 0)
  assert.equal(calculatePathPerimeter(''), 0)
  assert.deepEqual(calculatePathCentroid(''), { x: 0, y: 0 })

  // Metrics summary extraction
  const metrics = extractCAGMetrics(square)
  close(metrics.area, 10000)
  close(metrics.perimeter, 400)
  assert.equal(metrics.contourCount, 1)
  assert.equal(metrics.closedContourCount, 1)
  close(metrics.centroid.x, 50)
  close(metrics.centroid.y, 50)
  assert.equal(metrics.bounds.x, -1)
  assert.equal(metrics.bounds.y, -1)
  assert.equal(metrics.bounds.width, 102)
  assert.equal(metrics.bounds.height, 102)
})

test('evaluateCAG computes all 4 Constructive Area Geometry operations across shapes', () => {
  const rectA = createElement('rectangle', { id: 'a', name: 'A', x: 0, y: 0, width: 100, height: 100 })
  const rectB = createElement('rectangle', { id: 'b', name: 'B', x: 50, y: 50, width: 100, height: 100 })

  // Union: Area = 10000 + 10000 - 2500 = 17500
  const unionResult = evaluateCAG([rectA, rectB], 'union')
  assert.equal(unionResult.operation, 'union')
  close(unionResult.metrics.area, 17500)
  assert.ok(unionResult.cleanD.length > 0)

  // Difference: Area = 10000 - 2500 = 7500
  const diffResult = evaluateCAG([rectA, rectB], 'difference')
  assert.equal(diffResult.operation, 'difference')
  close(diffResult.metrics.area, 7500)

  // Intersection: Area = 2500
  const intersectResult = evaluateCAG([rectA, rectB], 'intersection')
  assert.equal(intersectResult.operation, 'intersection')
  close(intersectResult.metrics.area, 2500)

  // Exclusion: Area = 17500 - 2500 = 15000
  const exclusionResult = evaluateCAG([rectA, rectB], 'exclusion')
  assert.equal(exclusionResult.operation, 'exclusion')
  close(exclusionResult.metrics.area, 15000)
})

test('evaluatePathCAG operates directly on raw SVG path strings', () => {
  const pathA = 'M 0 0 H 100 V 100 H 0 Z'
  const pathB = 'M 50 50 H 150 V 150 H 50 Z'

  const resUnion = evaluatePathCAG(pathA, pathB, 'union')
  close(resUnion.metrics.area, 17500)

  const resDiff = evaluatePathCAG(pathA, pathB, 'difference')
  close(resDiff.metrics.area, 7500)

  const resIntersect = evaluatePathCAG(pathA, pathB, 'intersection')
  close(resIntersect.metrics.area, 2500)

  const resExclude = evaluatePathCAG(pathA, pathB, 'exclusion')
  close(resExclude.metrics.area, 15000)
})

test('doVectorShapesOverlap detects bounding intersections', () => {
  const a = createElement('rectangle', { id: 'a', x: 0, y: 0, width: 100, height: 100 })
  const b = createElement('rectangle', { id: 'b', x: 50, y: 50, width: 100, height: 100 })
  const c = createElement('rectangle', { id: 'c', x: 200, y: 200, width: 50, height: 50 })

  assert.equal(doVectorShapesOverlap(a, b), true)
  assert.equal(doVectorShapesOverlap(a, c), false)
  assert.equal(doVectorShapesOverlap(b, c), false)
})

test('buildCAGHierarchyTree and countUnderlyingSources preserve non-destructive source hierarchy', () => {
  const primitiveA = createElement('rectangle', { id: 'r1', name: 'Rect 1', x: 0, y: 0, width: 100, height: 100 })
  const primitiveB = createElement('rectangle', { id: 'r2', name: 'Rect 2', x: 40, y: 40, width: 100, height: 100 })
  const primitiveC = createElement('ellipse', { id: 'c1', name: 'Circle 1', x: 80, y: 80, width: 60, height: 60 })

  const primTree = buildCAGHierarchyTree(primitiveA)
  assert.equal(primTree.type, 'primitive')
  assert.equal(primTree.operandCount, 1)
  assert.equal(primTree.children.length, 0)
  assert.equal(countUnderlyingSources(primitiveA), 1)

  // Sub-compound: A union B
  const subCompound = createElement('path', {
    id: 'compound-sub',
    name: 'Compound 1',
    x: 0,
    y: 0,
    width: 140,
    height: 140,
    d: 'M 0 0 H 140 V 140 H 0 Z',
    boolean: {
      operation: 'union',
      operands: [primitiveA, primitiveB],
    },
  })

  assert.equal(countUnderlyingSources(subCompound), 2)
  const subTree = buildCAGHierarchyTree(subCompound)
  assert.equal(subTree.type, 'compound')
  assert.equal(subTree.operation, 'union')
  assert.equal(subTree.operandCount, 2)
  assert.equal(subTree.children.length, 2)

  // Nested compound: (A union B) subtract C
  const rootCompound = createElement('path', {
    id: 'compound-root',
    name: 'Compound Root',
    x: 0,
    y: 0,
    width: 140,
    height: 140,
    d: 'M 0 0 H 140 V 140 H 0 Z',
    boolean: {
      operation: 'subtract',
      operands: [subCompound, primitiveC],
    },
  })

  assert.equal(countUnderlyingSources(rootCompound), 3)
  const rootTree = buildCAGHierarchyTree(rootCompound)
  assert.equal(rootTree.type, 'compound')
  assert.equal(rootTree.operation, 'difference')
  assert.equal(rootTree.operandCount, 2)
  assert.equal(rootTree.children.length, 2)
  assert.equal(rootTree.children[0].type, 'compound')
  assert.equal(rootTree.children[0].operation, 'union')
  assert.equal(rootTree.children[0].children.length, 2)
  assert.equal(rootTree.children[1].type, 'primitive')
})

test('cleanSvgPathGeometry cleans redundant collinear points and normalizes precision', () => {
  const raw = 'M 0 0 L 10 0 L 20 0 L 30 0'
  const cleaned = cleanSvgPathGeometry(raw)
  assert.equal(cleaned, 'M 0 0 H 30')
  assert.equal(cleanSvgPathGeometry(''), '')
})

test('exportCleanSVGGeometry generates both standalone and inline SVG geometry', () => {
  const result = evaluatePathCAG('M 0 0 H 100 V 100 H 0 Z', 'M 50 50 H 150 V 150 H 50 Z', 'union')

  // Fragment format
  const fragment = exportCleanSVGGeometry(result, {
    standalone: false,
    fill: '#81adec',
  })
  assert.match(fragment, /^<path d="[^"]+" fill="#81adec" fill-rule="nonzero"\/>$/)

  // Standalone format
  const standalone = exportCleanSVGGeometry(result, {
    standalone: true,
    fill: '#edebe1',
    stroke: '#080808',
    strokeWidth: 2,
  })
  assert.match(standalone, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="/)
  assert.match(standalone, /fill="#edebe1"/)
  assert.match(standalone, /stroke="#080808"/)
  assert.match(standalone, /stroke-width="2"/)
  assert.match(standalone, /<\/svg>$/)
})

test('createSyntheticVectorPath creates well-formed PathElement from SVG path', () => {
  const el = createSyntheticVectorPath('M 10 20 H 110 V 120 H 10 Z', 'test-path', 'Custom Test Path')
  assert.equal(el.id, 'test-path')
  assert.equal(el.name, 'Custom Test Path')
  assert.equal(el.type, 'path')
  assert.equal(el.x, 10)
  assert.equal(el.y, 20)
  assert.equal(el.width, 100)
  assert.equal(el.height, 100)
  assert.deepEqual(el.viewBox, [10, 20, 100, 100])
})

test('evaluateCAG handles disjoint shapes cleanly for union, difference, intersection and exclusion', () => {
  const r1 = createElement('rectangle', { id: 'r1', x: 0, y: 0, width: 50, height: 50 })
  const r2 = createElement('rectangle', { id: 'r2', x: 100, y: 100, width: 50, height: 50 })

  const union = evaluateCAG([r1, r2], 'union')
  close(union.metrics.area, 5000)
  assert.equal(union.metrics.contourCount, 2)

  const diff = evaluateCAG([r1, r2], 'difference')
  close(diff.metrics.area, 2500)
  assert.equal(diff.metrics.contourCount, 1)

  const inter = evaluateCAG([r1, r2], 'intersection')
  close(inter.metrics.area, 0)
  assert.equal(inter.cleanD, '')

  const excl = evaluateCAG([r1, r2], 'exclusion')
  close(excl.metrics.area, 5000)
  assert.equal(excl.metrics.contourCount, 2)
})

test('exportCleanSVGGeometry formats clean SVG directly from compound PathElement', () => {
  const r1 = createElement('rectangle', { id: 'r1', x: 0, y: 0, width: 100, height: 100 })
  const r2 = createElement('rectangle', { id: 'r2', x: 50, y: 50, width: 100, height: 100 })
  const union = evaluateCAG([r1, r2], 'union')

  const compoundElement = createElement('path', {
    id: 'compound-1',
    name: 'Compound Union',
    x: union.bounds.x,
    y: union.bounds.y,
    width: union.bounds.width,
    height: union.bounds.height,
    d: union.cleanD,
    viewBox: union.viewBox,
    fillRule: union.fillRule,
    boolean: {
      operation: 'union',
      operands: [r1, r2],
    },
    style: {
      fill: '#81adec',
      stroke: { color: '#080808', width: 1.5, dash: [] },
      opacity: 1,
      shadow: null,
    },
  })

  const standaloneSvg = exportCleanSVGGeometry(compoundElement, {
    standalone: true,
  })

  assert.match(standaloneSvg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(standaloneSvg, /<path d="M 0 0/)
  assert.match(standaloneSvg, /fill="#81adec"/)
  assert.match(standaloneSvg, /stroke="#080808"/)
  assert.match(standaloneSvg, /stroke-width="1.5"/)
})
