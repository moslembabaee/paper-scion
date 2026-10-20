import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createElement } from '../src/scene/elements.ts'
import {
  computeBoolean,
  evaluateCompoundHierarchy,
  evaluateSingleOperand,
  evaluateVectorElement,
  vectorToContours,
  vectorPathData,
} from '../src/scene/booleanGeometry.ts'
import {
  expandPathOutline,
  expandContourOutline,
  expandVectorOutline,
  offsetPath,
} from '../src/scene/outlineExpansion.ts'
import {
  buildShapeTree,
  countTreeLeaves,
  findTreeNode,
  updateTreeNode,
  toggleNodeMute,
  invertNodeOperation,
  dissolveTreeNode,
  extractTreeNode,
  reorderTreeChildren,
  evaluateShapeTree,
  shapeTreeToCompound,
  shapeTreeToVectorElement,
  revertShapeTreeToElements,
  nestShapeTreeNodes,
  flattenShapeTree,
  cloneShapeTreeNode,
} from '../src/scene/shapeTree.ts'
import {
  createRegularPolygon,
  createStarPolygon,
  polygonToPathData,
  polygonArea,
} from '../src/scene/polygonGeometry.ts'
import {
  calculatePathArea,
  calculatePathPerimeter,
  evaluateCAG,
  toBooleanOperation,
  fromBooleanOperation,
} from '../src/scene/cagEngine.ts'
import { parsePath } from '../src/scene/pathGeometry.ts'

const close = (actual, expected, epsilon = 2) => {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} ≈ ${expected} (diff: ${Math.abs(actual - expected)}, epsilon: ${epsilon})`
  )
}

function fixture() {
  const store = new SceneStore()
  // Add base rectangle
  store.add('rectangle', {
    id: 'rect-a',
    name: 'Rect A',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    style: { fill: '#81adec', stroke: null },
  })
  // Add overlapping rectangle
  store.add('rectangle', {
    id: 'rect-b',
    name: 'Rect B',
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    style: { fill: '#f87171', stroke: null },
  })
  return store
}

test('Vector Boolean: Union, Subtract, Intersect, Exclude for arbitrary polygon layers', () => {
  // Triangle (3-sided regular polygon)
  const triangle = createRegularPolygon({ sides: 3, radius: 60, cx: 100, cy: 100 })
  const triElem = createElement('path', {
    id: 'poly-tri',
    name: 'Triangle',
    x: 40,
    y: 40,
    width: 120,
    height: 120,
    d: triangle.d,
    viewBox: [triangle.bounds.x, triangle.bounds.y, triangle.bounds.width, triangle.bounds.height],
    fillRule: 'nonzero',
    style: { fill: '#81adec' },
  })

  // Star polygon
  const star = createStarPolygon({ points: 5, outerRadius: 60, innerRadius: 25, cx: 100, cy: 100 })
  const starElem = createElement('path', {
    id: 'poly-star',
    name: 'Star',
    x: 70,
    y: 70,
    width: 120,
    height: 120,
    d: star.d,
    viewBox: [star.bounds.x, star.bounds.y, star.bounds.width, star.bounds.height],
    fillRule: 'nonzero',
    style: { fill: '#fbbf24' },
  })

  // 1. Union
  const unionRes = computeBoolean([triElem, starElem], 'union')
  assert.ok(unionRes.d.length > 0)
  const areaUnion = calculatePathArea(unionRes.d)
  assert.ok(areaUnion > 0)

  // 2. Intersect
  const intersectRes = computeBoolean([triElem, starElem], 'intersect')
  assert.ok(intersectRes.d.length > 0)
  const areaIntersect = calculatePathArea(intersectRes.d)
  assert.ok(areaIntersect > 0)

  // 3. Subtract
  const subtractRes = computeBoolean([triElem, starElem], 'subtract')
  assert.ok(subtractRes.d.length > 0)
  const areaSubtract = calculatePathArea(subtractRes.d)
  assert.ok(areaSubtract > 0)

  // 4. Exclude
  const excludeRes = computeBoolean([triElem, starElem], 'exclude')
  assert.ok(excludeRes.d.length > 0)
  const areaExclude = calculatePathArea(excludeRes.d)
  assert.ok(areaExclude > 0)

  // Mathematical Area Identity: A ∪ B = A + B - (A ∩ B)
  const areaTri = calculatePathArea(vectorPathData(triElem))
  const areaStar = calculatePathArea(vectorPathData(starElem))
  close(areaUnion, areaTri + areaStar - areaIntersect, 5)
  close(areaExclude, areaUnion - areaIntersect, 5)
})

test('Vector Boolean: FillRule preservation (nonzero vs evenodd)', () => {
  const store = fixture()
  store.select(['rect-a', 'rect-b'])

  // Evenodd operand
  const pathEvenOdd = createElement('path', {
    id: 'evenodd-path',
    name: 'EvenOdd Path',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    d: 'M 0 0 L 100 0 L 100 100 L 0 100 Z M 25 25 L 75 25 L 75 75 L 25 75 Z',
    viewBox: [0, 0, 100, 100],
    fillRule: 'evenodd',
    style: { fill: '#81adec' },
  })

  const rectB = store.getSnapshot().elements['rect-b']

  // Passing fillRule: 'evenodd' in options
  const resWithOptions = computeBoolean([pathEvenOdd, rectB], 'union', { fillRule: 'evenodd' })
  assert.equal(resWithOptions.fillRule, 'evenodd')

  // Inheriting evenodd from operand
  const resInherited = computeBoolean([pathEvenOdd, rectB], 'union')
  assert.equal(resInherited.fillRule, 'evenodd')

  // Normal nonzero operands
  const rectA = store.getSnapshot().elements['rect-a']
  const resNonzero = computeBoolean([rectA, rectB], 'union')
  assert.equal(resNonzero.fillRule, 'nonzero')

  // Exclude option override
  const resExclude = computeBoolean([rectA, rectB], 'exclude', { fillRule: 'evenodd' })
  assert.equal(resExclude.fillRule, 'evenodd')
})

test('Path Outline Expansion: open stroked paths with lineCap, lineJoin, and offsetMode', () => {
  const lineD = 'M 0 50 L 100 50'

  // Round cap
  const expRound = expandPathOutline(lineD, { strokeWidth: 20, lineCap: 'round', precision: 2 })
  assert.ok(expRound.d.includes('A 10 10'))
  close(expRound.bounds.width, 120, 2)
  close(expRound.bounds.height, 20, 2)

  // Square cap
  const expSquare = expandPathOutline(lineD, { strokeWidth: 20, lineCap: 'square', precision: 2 })
  close(expSquare.bounds.width, 120, 2)
  close(expSquare.bounds.height, 20, 2)

  // Butt cap
  const expButt = expandPathOutline(lineD, { strokeWidth: 20, lineCap: 'butt', precision: 2 })
  close(expButt.bounds.width, 100, 2)
  close(expButt.bounds.height, 20, 2)

  // Offset mode: outside vs inside vs center
  const expCenter = expandPathOutline(lineD, { strokeWidth: 20, offsetMode: 'center', lineCap: 'butt' })
  const expOutside = expandPathOutline(lineD, { strokeWidth: 20, offsetMode: 'outside', lineCap: 'butt' })
  const expInside = expandPathOutline(lineD, { strokeWidth: 20, offsetMode: 'inside', lineCap: 'butt' })

  assert.ok(expCenter.d.length > 0)
  assert.ok(expOutside.d.length > 0)
  assert.ok(expInside.d.length > 0)

  // Corner lineJoin: Miter vs Round vs Bevel on a right-angle path
  const cornerD = 'M 0 0 L 100 0 L 100 100'
  const expMiter = expandPathOutline(cornerD, { strokeWidth: 20, lineJoin: 'miter', miterLimit: 4 })
  const expRoundJoin = expandPathOutline(cornerD, { strokeWidth: 20, lineJoin: 'round' })
  const expBevel = expandPathOutline(cornerD, { strokeWidth: 20, lineJoin: 'bevel' })

  assert.ok(expMiter.d.length > 0)
  assert.ok(expRoundJoin.d.length > 0)
  assert.ok(expBevel.d.length > 0)

  // Closed path outline expansion creates outer and inner concentric contours
  const closedD = 'M 0 0 L 100 0 L 100 100 L 0 100 Z'
  const expClosed = expandPathOutline(closedD, { strokeWidth: 10, offsetMode: 'center' })
  const contours = parsePath(expClosed.d)
  assert.equal(contours.length, 2) // Outer contour and inner contour hole
})

test('Path Outline Expansion: expandVectorOutline and store.expandOutline', () => {
  const store = fixture()
  store.update('rect-a', 'rectangle', {
    style: { fill: null, stroke: { color: '#81adec', width: 10, dash: [] } },
  })

  const node = store.getSnapshot().elements['rect-a']
  const outlineElement = expandVectorOutline(node, { strokeWidth: 10 })

  assert.equal(outlineElement.type, 'path')
  assert.equal(outlineElement.style.fill, '#81adec')
  assert.equal(outlineElement.style.stroke, null)
  assert.ok(outlineElement.d.length > 0)

  // Store integration: expandOutline
  const expanded = store.expandOutline('rect-a')
  assert.equal(expanded.type, 'path')
  assert.equal(expanded.style.fill, '#81adec')
  assert.equal(store.getSnapshot().elements['rect-a'], undefined)
  assert.ok(store.getSnapshot().elements[expanded.id])

  // Undo restores original rect-a
  store.undo()
  assert.ok(store.getSnapshot().elements['rect-a'])
  assert.equal(store.getSnapshot().elements[expanded.id], undefined)

  // Redo re-expands
  store.redo()
  assert.equal(store.getSnapshot().elements['rect-a'], undefined)
  assert.ok(store.getSnapshot().elements[expanded.id])
})

test('Boolean with Stroke Expansion: stroked path combined with filled polygon', () => {
  const strokedLine = createElement('path', {
    id: 'stroked-path',
    name: 'Stroked Line',
    x: 0,
    y: 40,
    width: 100,
    height: 20,
    d: 'M 0 50 L 100 50',
    viewBox: [0, 40, 100, 20],
    fillRule: 'nonzero',
    style: { fill: null, stroke: { color: '#81adec', width: 20, dash: [] } },
  })

  const filledCircle = createElement('ellipse', {
    id: 'circle',
    name: 'Circle',
    x: 30,
    y: 30,
    width: 40,
    height: 40,
    rotation: 0,
    style: { fill: '#f87171', stroke: null },
  })

  const result = computeBoolean([strokedLine, filledCircle], 'union', { expandStrokes: true })
  assert.ok(result.d.length > 0)
  const area = calculatePathArea(result.d)
  assert.ok(area > 1000)
})

test('Reversible Shape Tree: build, query, mute, and reorder operations', () => {
  const store = fixture()
  store.select(['rect-a', 'rect-b'])
  const compound = store.booleanSelection('subtract')

  // Build shape tree
  const tree = buildShapeTree(compound)
  assert.equal(tree.type, 'compound')
  assert.equal(tree.operation, 'subtract')
  assert.equal(tree.operands?.length, 2)
  assert.equal(countTreeLeaves(tree), 2)

  // Polygon detection in tree
  const polyElem = createElement('path', {
    id: 'poly',
    name: 'Polygon',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    d: 'M 0 0 L 50 0 L 25 50 Z', // straight lines only
    viewBox: [0, 0, 50, 50],
    fillRule: 'nonzero',
    style: { fill: '#81adec' },
  })
  const polyNode = buildShapeTree(polyElem)
  assert.equal(polyNode.type, 'polygon')

  // Query node in tree
  const foundA = findTreeNode(tree, 'rect-a')
  assert.ok(foundA)
  assert.equal(foundA.id, 'rect-a')

  // Toggle mute on operand in tree
  const mutedTree = toggleNodeMute(tree, 'rect-b')
  const foundMutedB = findTreeNode(mutedTree, 'rect-b')
  assert.equal(foundMutedB?.muted, true)

  // Reorder tree operands
  const reordered = reorderTreeChildren(tree, compound.id, ['rect-b', 'rect-a'])
  assert.equal(reordered.operands?.[0].id, 'rect-b')
  assert.equal(reordered.operands?.[1].id, 'rect-a')

  // Invert operation on subtract: swaps base and cutter
  const inverted = invertNodeOperation(tree, compound.id)
  assert.equal(inverted.operands?.[0].id, 'rect-b')
  assert.equal(inverted.operands?.[1].id, 'rect-a')

  // Invert operation on union: becomes exclude
  const unionTree = { ...tree, operation: 'union' }
  const invertedUnion = invertNodeOperation(unionTree, compound.id)
  assert.equal(invertedUnion.operation, 'exclude')
})

test('Reversible Shape Tree: nesting, dissolution, and full reversibility', () => {
  const store = fixture()
  // Add third shape
  store.add('ellipse', {
    id: 'ellipse-c',
    name: 'Circle C',
    x: 80,
    y: 20,
    width: 60,
    height: 60,
    style: { fill: '#34d399', stroke: null },
  })

  store.select(['rect-a', 'rect-b', 'ellipse-c'])
  const compound = store.booleanSelection('union')

  // Build tree
  const tree = buildShapeTree(compound)
  assert.equal(tree.operands?.length, 3)

  // Nest two operands into a sub-compound
  const nestedTree = nestShapeTreeNodes(tree, compound.id, ['rect-a', 'rect-b'], 'intersect')
  assert.equal(nestedTree.operands?.length, 2)
  const nestedGroup = nestedTree.operands?.find(c => c.type === 'compound')
  assert.ok(nestedGroup)
  assert.equal(nestedGroup.operation, 'intersect')
  assert.equal(nestedGroup.operands?.length, 2)

  // Dissolve nested sub-compound back into parent
  const dissolvedTree = dissolveTreeNode(nestedTree, nestedGroup.id)
  assert.equal(dissolvedTree.operands?.length, 3)
  assert.ok(dissolvedTree.operands.some(c => c.id === 'rect-a'))
  assert.ok(dissolvedTree.operands.some(c => c.id === 'rect-b'))

  // Revert shape tree to original independent leaf elements
  const restoredElements = revertShapeTreeToElements(nestedTree, compound)
  assert.equal(restoredElements.length, 3)
  assert.ok(restoredElements.some(e => e.id === 'rect-a'))
  assert.ok(restoredElements.some(e => e.id === 'rect-b'))
  assert.ok(restoredElements.some(e => e.id === 'ellipse-c'))

  // Store integration: applyShapeTree
  store.applyShapeTree(compound.id, nestedTree)
  const updatedCompound = store.getSnapshot().elements[compound.id]
  assert.ok(updatedCompound.boolean)

  // Store integration: invertBooleanOperation
  store.invertBooleanOperation(compound.id)
  const invertedCompound = store.getSnapshot().elements[compound.id]
  assert.equal(invertedCompound.boolean.operation, 'exclude')

  // Store integration: revertCompound completely restores independent layers
  const releasedIds = store.revertCompound(compound.id)
  assert.equal(releasedIds.length, 3)
  assert.equal(store.getSnapshot().elements[compound.id], undefined)
  for (const id of releasedIds) {
    assert.ok(store.getSnapshot().elements[id])
  }

  // Undo reverts the dissolution
  store.undo()
  assert.ok(store.getSnapshot().elements[compound.id])
})

test('Visual Preview Indicators: floating indicator, distinct styling per operation', () => {
  const store = fixture()
  store.select(['rect-a', 'rect-b'])

  for (const op of ['union', 'subtract', 'intersect', 'exclude']) {
    store.previewBoolean(op)
    const preview = store.getBooleanPreview()
    assert.ok(preview)
    assert.equal(preview.operation, op)
    assert.ok(preview.node.d.length > 0)
    assert.equal(preview.sourceIds.length, 2)
  }

  store.previewBoolean(null)
  assert.equal(store.getBooleanPreview(), null)
})

test('Path Outline Expansion: offsetPath outward and inward', () => {
  const rectD = 'M 10 10 L 90 10 L 90 90 L 10 90 Z'
  const outward = offsetPath(rectD, 10)
  assert.ok(outward.length > 0)
  const inward = offsetPath(rectD, -5)
  assert.ok(inward.length > 0)

  // Empty/zero distance edge case returns original
  assert.equal(offsetPath('', 10), '')
  assert.equal(offsetPath(rectD, 0), rectD)
})

test('Shape Tree: clone, extract, and deeply nested compound evaluation', () => {
  const store = fixture()
  store.add('ellipse', {
    id: 'elem-c',
    name: 'Circle C',
    x: 40,
    y: 40,
    width: 60,
    height: 60,
    style: { fill: '#34d399', stroke: null },
  })
  store.add('rectangle', {
    id: 'elem-d',
    name: 'Rect D',
    x: 70,
    y: 70,
    width: 50,
    height: 50,
    style: { fill: '#fbbf24', stroke: null },
  })

  // Group into compound A
  store.select(['rect-a', 'rect-b'])
  const compA = store.booleanSelection('union')

  // Group into compound B with compA and elem-c
  store.select([compA.id, 'elem-c'])
  const compB = store.booleanSelection('subtract')

  // Group into root compound C with compB and elem-d
  store.select([compB.id, 'elem-d'])
  const compC = store.booleanSelection('intersect')

  const tree = buildShapeTree(compC)
  assert.equal(tree.type, 'compound')
  assert.equal(countTreeLeaves(tree), 4)

  // Clone tree
  const cloned = cloneShapeTreeNode(tree)
  assert.notEqual(cloned.id, tree.id)
  assert.equal(countTreeLeaves(cloned), 4)

  // Extract a node
  const { updatedRoot, extracted } = extractTreeNode(tree, 'elem-d')
  assert.ok(extracted)
  assert.equal(extracted.id, 'elem-d')
  assert.equal(countTreeLeaves(updatedRoot), 3)

  // Multi-selection outline expansion
  store.add('path', {
    id: 'path-s1',
    name: 'Stroke 1',
    x: 0,
    y: 0,
    width: 100,
    height: 10,
    d: 'M 0 5 L 100 5',
    viewBox: [0, 0, 100, 10],
    fillRule: 'nonzero',
    style: { fill: null, stroke: { color: '#ffffff', width: 4, dash: [] } },
  })
  store.add('path', {
    id: 'path-s2',
    name: 'Stroke 2',
    x: 0,
    y: 20,
    width: 100,
    height: 10,
    d: 'M 0 5 L 100 5',
    viewBox: [0, 0, 100, 10],
    fillRule: 'nonzero',
    style: { fill: null, stroke: { color: '#ffffff', width: 6, dash: [] } },
  })

  const expandedList = store.expandOutlineSelection({}, ['path-s1', 'path-s2'])
  assert.equal(expandedList.length, 2)
  assert.equal(expandedList[0].style.stroke, null)
  assert.equal(expandedList[1].style.stroke, null)
})

