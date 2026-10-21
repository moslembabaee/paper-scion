import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createElement } from '../src/scene/elements.ts'
import {
  computeBoolean,
  evaluateCompoundHierarchy,
  evaluateVectorElement,
  findCompoundOperand,
  findCompoundParent,
  vectorPathData,
  vectorToContours,
} from '../src/scene/booleanGeometry.ts'
import {
  buildShapeTree,
  countTreeLeaves,
  findTreeNode,
  moveTreeNode,
  setTreeNodeOperation,
  updateTreeNodeParameters,
  inspectCompoundHierarchy,
  shapeTreeToCompound,
  revertShapeTreeToElements,
  dissolveTreeNode,
} from '../src/scene/shapeTree.ts'
import {
  calculatePathArea,
  calculatePathPerimeter,
  calculatePathCentroid,
  cleanSvgPathGeometry,
  exportCleanSVGGeometry,
  exportCompoundAsSVG,
  generateCompoundClipPath,
  generateCompoundClipPathData,
  generateCompoundSVGMask,
  generateCompoundHierarchyMarkup,
  generateCssClipPath,
  generateClippedSVGExport,
  clipPathWithCompound,
  computePolygonClipping,
} from '../src/scene/cagEngine.ts'
import { createRegularPolygon, createStarPolygon } from '../src/scene/polygonGeometry.ts'
import { sceneToSVG } from '../src/io/svg.ts'

const close = (actual, expected, epsilon = 2) => {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `Expected ${actual} to be close to ${expected} (diff: ${Math.abs(actual - expected)}, epsilon: ${epsilon})`
  )
}

test('Non-Destructive Boolean Vector Operations: Union, Subtract, Intersect, Exclude with live parameter adjustments', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'base-rect', name: 'Base Rectangle', x: 0, y: 0, width: 100, height: 100, cornerRadius: 0, style: { fill: '#3b82f6' } })
  store.add('ellipse', { id: 'cutter-circle', name: 'Cutter Circle', x: 50, y: 0, width: 100, height: 100, style: { fill: '#ef4444' } })
  store.select(['base-rect', 'cutter-circle'])

  // 1. Union operation
  const compound = store.booleanSelection('union', false)
  assert.equal(compound.type, 'path')
  assert.ok(compound.boolean)
  assert.equal(compound.boolean.operation, 'union')
  assert.equal(compound.boolean.operands.length, 2)
  const unionArea = calculatePathArea(compound.d)
  assert.ok(unionArea > 10000)

  // 2. Switch operation live: Subtract
  store.setBooleanOperation(compound.id, 'subtract')
  let current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operation, 'subtract')
  const subtractArea = calculatePathArea(current.d)
  assert.ok(subtractArea < 10000)

  // 3. Switch operation live: Intersect
  store.setBooleanOperandOperation(compound.id, compound.id, 'intersect')
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operation, 'intersect')
  const intersectArea = calculatePathArea(current.d)
  assert.ok(intersectArea > 0 && intersectArea < subtractArea)

  // 4. Switch operation live: Exclude
  store.setBooleanOperation(compound.id, 'exclude')
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operation, 'exclude')
  const excludeArea = calculatePathArea(current.d)
  close(excludeArea, unionArea - intersectArea, 10)

  // 5. Live parameter adjustments on operands: dimensions, coordinates, cornerRadius
  store.setBooleanOperation(compound.id, 'subtract')
  const beforeArea = calculatePathArea(store.getSnapshot().elements[compound.id].d)

  // Adjust cutter size: larger cutter subtracts more
  store.updateBooleanOperand(compound.id, 'cutter-circle', { width: 120, height: 120 })
  current = store.getSnapshot().elements[compound.id]
  const afterArea = calculatePathArea(current.d)
  assert.ok(afterArea < beforeArea)

  // Adjust base rectangle corner radius live
  store.updateBooleanOperand(compound.id, 'base-rect', { cornerRadius: 15 })
  current = store.getSnapshot().elements[compound.id]
  const baseOp = findCompoundOperand(current.boolean, 'base-rect')
  assert.equal(baseOp.cornerRadius, 15)

  // Adjust operand position
  store.updateBooleanOperand(compound.id, 'cutter-circle', { x: 70, y: 10 })
  current = store.getSnapshot().elements[compound.id]
  const movedOp = findCompoundOperand(current.boolean, 'cutter-circle')
  assert.equal(movedOp.x, 70)
  assert.equal(movedOp.y, 10)

  // 6. Undo & Redo parameter adjustments
  store.undo()
  current = store.getSnapshot().elements[compound.id]
  const revertedOp = findCompoundOperand(current.boolean, 'cutter-circle')
  assert.notEqual(revertedOp.x, 70)

  store.redo()
  current = store.getSnapshot().elements[compound.id]
  const restoredOp = findCompoundOperand(current.boolean, 'cutter-circle')
  assert.equal(restoredOp.x, 70)
})

test('Child path reordering at root and nested compound levels with moveBooleanOperand', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 's1', name: 'Shape 1', x: 0, y: 0, width: 80, height: 80 })
  store.add('rectangle', { id: 's2', name: 'Shape 2', x: 40, y: 0, width: 80, height: 80 })
  store.add('rectangle', { id: 's3', name: 'Shape 3', x: 20, y: 40, width: 80, height: 80 })
  store.select(['s1', 's2', 's3'])

  const root = store.booleanSelection('subtract')
  assert.deepEqual(root.boolean.operands.map(op => op.id), ['s1', 's2', 's3'])

  // 1. Reorder using reorderBooleanOperands
  store.reorderBooleanOperands(root.id, ['s2', 's1', 's3'])
  let current = store.getSnapshot().elements[root.id]
  assert.deepEqual(current.boolean.operands.map(op => op.id), ['s2', 's1', 's3'])

  // 2. Move operand up and down using moveBooleanOperand
  // Move 's1' earlier (-1) -> becomes first (base)
  store.moveBooleanOperand(root.id, 's1', -1)
  current = store.getSnapshot().elements[root.id]
  assert.equal(current.boolean.operands[0].id, 's1')

  // Move 's1' later (+1) -> becomes second
  store.moveBooleanOperand(root.id, 's1', 1)
  current = store.getSnapshot().elements[root.id]
  assert.equal(current.boolean.operands[1].id, 's1')

  // Boundary checks: moving first earlier or last later is safe no-op
  store.moveBooleanOperand(root.id, current.boolean.operands[0].id, -1)
  store.moveBooleanOperand(root.id, current.boolean.operands[2].id, 1)
  const afterNoop = store.getSnapshot().elements[root.id]
  assert.deepEqual(
    current.boolean.operands.map(o => o.id),
    afterNoop.boolean.operands.map(o => o.id)
  )

  // 3. Nest s2 and s3 into a nested compound
  store.groupBooleanOperands(root.id, ['s2', 's3'], 'union')
  current = store.getSnapshot().elements[root.id]
  assert.equal(current.boolean.operands.length, 2)
  const nestedCompound = current.boolean.operands.find(op => op.type === 'path' && op.boolean)
  assert.ok(nestedCompound)
  assert.equal(nestedCompound.boolean.operands.length, 2)
  const nestedId = nestedCompound.id

  // 4. Reorder within nested compound via reorderNestedBooleanOperands
  const origNestedOrder = nestedCompound.boolean.operands.map(op => op.id)
  store.reorderNestedBooleanOperands(root.id, nestedId, [origNestedOrder[1], origNestedOrder[0]])
  current = store.getSnapshot().elements[root.id]
  let currentNested = current.boolean.operands.find(op => op.id === nestedId)
  assert.deepEqual(currentNested.boolean.operands.map(op => op.id), [origNestedOrder[1], origNestedOrder[0]])

  // 5. Move nested operand up and down via moveBooleanOperand directly
  store.moveBooleanOperand(root.id, origNestedOrder[0], -1)
  current = store.getSnapshot().elements[root.id]
  currentNested = current.boolean.operands.find(op => op.id === nestedId)
  assert.deepEqual(currentNested.boolean.operands.map(op => op.id), [origNestedOrder[0], origNestedOrder[1]])
})

test('Translating a nested compound group shifts all descendant operands and preserves hierarchy', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'base', x: 0, y: 0, width: 200, height: 200 })
  store.add('rectangle', { id: 'c1', x: 20, y: 20, width: 40, height: 40 })
  store.add('rectangle', { id: 'c2', x: 80, y: 20, width: 40, height: 40 })
  store.select(['base', 'c1', 'c2'])

  const root = store.booleanSelection('subtract')
  store.groupBooleanOperands(root.id, ['c1', 'c2'], 'union')
  let current = store.getSnapshot().elements[root.id]
  const nested = current.boolean.operands.find(op => op.type === 'path' && op.boolean)
  assert.ok(nested)

  const c1Before = findCompoundOperand(current.boolean, 'c1')
  const c2Before = findCompoundOperand(current.boolean, 'c2')
  const nestedXBefore = nested.x

  // Shift nested compound group by dx = +30, dy = +15
  store.updateBooleanOperand(root.id, nested.id, { x: nestedXBefore + 30, y: nested.y + 15 })
  current = store.getSnapshot().elements[root.id]

  const c1After = findCompoundOperand(current.boolean, 'c1')
  const c2After = findCompoundOperand(current.boolean, 'c2')
  assert.equal(c1After.x, c1Before.x + 30)
  assert.equal(c1After.y, c1Before.y + 15)
  assert.equal(c2After.x, c2Before.x + 30)
  assert.equal(c2After.y, c2Before.y + 15)
})

test('Shape tree hierarchy modeling: inspection, moveTreeNode, setTreeNodeOperation, updateTreeNodeParameters', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'r1', name: 'R1', x: 0, y: 0, width: 100, height: 100 })
  store.add('ellipse', { id: 'e1', name: 'E1', x: 50, y: 50, width: 100, height: 100 })
  store.add('rectangle', { id: 'r2', name: 'R2', x: 100, y: 0, width: 50, height: 50 })
  store.select(['r1', 'e1', 'r2'])

  const compound = store.booleanSelection('union')
  store.groupBooleanOperands(compound.id, ['e1', 'r2'], 'intersect')
  const current = store.getSnapshot().elements[compound.id]

  // 1. Diagnostic inspection
  const info = inspectCompoundHierarchy(current)
  assert.equal(info.isCompound, true)
  assert.equal(info.operation, 'union')
  assert.equal(info.totalLeafCount, 3)
  assert.equal(info.directOperandCount, 2)
  assert.equal(info.maxDepth, 2)
  assert.ok(info.operationsUsed.includes('union'))
  assert.ok(info.operationsUsed.includes('intersect'))

  // 2. Tree node movement via moveTreeNode
  const tree = buildShapeTree(current)
  const nestedNode = tree.operands.find(o => o.type === 'compound')
  assert.ok(nestedNode)
  const firstChildId = nestedNode.operands[0].id
  const secondChildId = nestedNode.operands[1].id

  const movedTree = moveTreeNode(tree, firstChildId, 1)
  const movedNested = movedTree.operands.find(o => o.type === 'compound')
  assert.equal(movedNested.operands[0].id, secondChildId)
  assert.equal(movedNested.operands[1].id, firstChildId)

  // 3. Set operation via setTreeNodeOperation
  const updatedOpTree = setTreeNodeOperation(movedTree, nestedNode.id, 'subtract')
  const updatedNested = updatedOpTree.operands.find(o => o.type === 'compound')
  assert.equal(updatedNested.operation, 'subtract')

  // 4. Update parameters via updateTreeNodeParameters
  const paramUpdatedTree = updateTreeNodeParameters(updatedOpTree, firstChildId, { width: 150 })
  const updatedLeaf = findTreeNode(paramUpdatedTree, firstChildId)
  assert.equal(updatedLeaf.element.width, 150)

  // 5. findCompoundParent utility
  const parentOfE1 = findCompoundParent(current.boolean, 'e1')
  assert.ok(parentOfE1)
  assert.equal(parentOfE1.operation, 'intersect')

  const parentOfR1 = findCompoundParent(current.boolean, 'r1')
  assert.ok(parentOfR1)
  assert.equal(parentOfR1.operation, 'union')
})

test('SVG path clipping and path-string generation for compound shapes', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'box', x: 0, y: 0, width: 120, height: 120, style: { fill: '#10b981' } })
  store.add('ellipse', { id: 'cut', x: 60, y: 60, width: 80, height: 80 })
  store.select(['box', 'cut'])

  const compound = store.booleanSelection('subtract')

  // 1. generateCompoundClipPath
  const clipPathXml = generateCompoundClipPath(compound, {
    clipPathId: 'custom-clip-path',
    clipPathUnits: 'userSpaceOnUse',
    precision: 3,
  })
  assert.ok(clipPathXml.includes('<clipPath id="custom-clip-path" clipPathUnits="userSpaceOnUse">'))
  assert.ok(clipPathXml.includes('<path d="M'))
  assert.ok(clipPathXml.includes('clip-rule="nonzero"'))

  // 2. generateCompoundClipPathData
  const clipData = generateCompoundClipPathData(compound, { precision: 3 })
  assert.ok(clipData.startsWith('M'))
  assert.ok(!clipData.includes('NaN'))

  // 3. generateCompoundSVGMask with modes
  const alphaMask = generateCompoundSVGMask(compound, { maskId: 'mask-alpha', mode: 'alpha', opacity: 0.85 })
  assert.ok(alphaMask.includes('<mask id="mask-alpha" maskUnits="userSpaceOnUse">'))
  assert.ok(alphaMask.includes('opacity="0.85"'))

  const lumMask = generateCompoundSVGMask(compound, { maskId: 'mask-lum', mode: 'luminance', inverted: true })
  assert.ok(lumMask.includes('mask-type="luminance"'))
  assert.ok(lumMask.includes('fill="#000000"'))
  assert.ok(lumMask.includes('<rect width="100%" height="100%" fill="#ffffff"/>'))

  // 4. generateCssClipPath
  const cssClip = generateCssClipPath(compound, { precision: 3 })
  assert.ok(cssClip.startsWith("path('M"))
  assert.ok(cssClip.endsWith("')"))

  // 5. exportCompoundAsSVG with clipPath and hierarchy metadata
  const standaloneExport = exportCompoundAsSVG(compound, {
    standalone: true,
    includeClipPath: true,
    includeHierarchy: true,
    fill: '#81adec',
  })
  assert.ok(standaloneExport.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(standaloneExport.includes('<defs>'))
  assert.ok(standaloneExport.includes('<clipPath'))
  assert.ok(standaloneExport.includes('data-type="compound"'))
  assert.ok(standaloneExport.includes('data-boolean-op="subtract"'))
  assert.ok(standaloneExport.includes('</svg>'))

  // 6. Convert operand to editable path
  const converted = store.convertBooleanOperandToPath(compound.id, 'cut')
  assert.equal(converted.type, 'path')
  assert.ok(converted.d)
  assert.ok(converted.nodes)
})

test('Reversible sub-path anchor editing on compound operands with undo and redo', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'base', name: 'Base Rect', x: 0, y: 0, width: 100, height: 100 })
  store.add('rectangle', { id: 'cutter', name: 'Cutter Rect', x: 50, y: 0, width: 60, height: 60 })
  store.select(['base', 'cutter'])

  const compound = store.booleanSelection('subtract')
  const initialD = compound.d
  const initialArea = calculatePathArea(initialD)

  // 1. Convert cutter to path so it has sub-path anchors
  const cutterPath = store.convertBooleanOperandToPath(compound.id, 'cutter')
  assert.equal(cutterPath.type, 'path')
  assert.ok(cutterPath.nodes && cutterPath.nodes.length > 0)

  // 2. Modify cutter's sub-path anchors to expand cutter downward (increasing overlap)
  const originalContours = vectorToContours(cutterPath)
  const modifiedContours = originalContours.map(contour => ({
    ...contour,
    anchors: contour.anchors.map(anchor => ({
      ...anchor,
      y: anchor.y > 30 ? anchor.y + 30 : anchor.y, // stretch height from 60 to 90
    })),
  }))

  store.updateBooleanOperandNodes(compound.id, 'cutter', modifiedContours)
  let updatedCompound = store.getSnapshot().elements[compound.id]
  const modifiedArea = calculatePathArea(updatedCompound.d)

  // Larger cutter subtracted -> remaining area must be smaller
  assert.ok(modifiedArea < initialArea)
  assert.notEqual(updatedCompound.d, initialD)

  // 3. Undo restores previous anchor positions and compound outline
  store.undo()
  updatedCompound = store.getSnapshot().elements[compound.id]
  close(calculatePathArea(updatedCompound.d), initialArea)

  // 4. Redo re-applies anchor edits
  store.redo()
  updatedCompound = store.getSnapshot().elements[compound.id]
  close(calculatePathArea(updatedCompound.d), modifiedArea)
})

test('Compound hierarchy transformations: invert, dissolve, revert to leaf shapes, and undo', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'r1', name: 'Rect 1', x: 0, y: 0, width: 100, height: 100 })
  store.add('ellipse', { id: 'e1', name: 'Ellipse 1', x: 40, y: 40, width: 80, height: 80 })
  store.add('rectangle', { id: 'r2', name: 'Rect 2', x: 80, y: 80, width: 60, height: 60 })
  store.select(['r1', 'e1', 'r2'])

  const root = store.booleanSelection('union')
  store.groupBooleanOperands(root.id, ['e1', 'r2'], 'intersect')

  let current = store.getSnapshot().elements[root.id]
  const nested = current.boolean.operands.find(op => op.type === 'path' && op.boolean)
  assert.ok(nested)

  // 1. Invert operation on nested compound
  store.invertBooleanOperation(root.id, nested.id)
  current = store.getSnapshot().elements[root.id]
  let currentNested = current.boolean.operands.find(op => op.id === nested.id)
  // intersect inverted becomes subtract
  assert.equal(currentNested.boolean.operation, 'subtract')

  // 2. Dissolve nested compound group back into parent compound
  store.dissolveCompound(root.id, nested.id)
  current = store.getSnapshot().elements[root.id]
  // Dissolving promotes the 2 grandchildren back to root operands (total: r1 + e1 + r2 = 3)
  assert.equal(current.boolean.operands.length, 3)
  assert.ok(current.boolean.operands.some(op => op.id === 'e1'))
  assert.ok(current.boolean.operands.some(op => op.id === 'r2'))

  // 3. Revert entire compound into independent top-level shapes
  const releasedIds = store.revertCompound(root.id)
  assert.equal(store.getSnapshot().elements[root.id], undefined)
  assert.equal(releasedIds.length, 3)
  for (const id of releasedIds) {
    const el = store.getSnapshot().elements[id]
    assert.ok(el)
    assert.equal(el.visible, true)
  }

  // 4. Undo restores the compound shape
  store.undo()
  assert.ok(store.getSnapshot().elements[root.id])
  assert.ok(store.getSnapshot().elements[root.id].boolean)
})

test('Boolean operand lifecycle: add, duplicate, mute/unmute, and extract', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'a', name: 'Shape A', x: 0, y: 0, width: 100, height: 100 })
  store.add('rectangle', { id: 'b', name: 'Shape B', x: 50, y: 0, width: 100, height: 100 })
  store.select(['a', 'b'])

  const compound = store.booleanSelection('union')
  const baseArea = calculatePathArea(compound.d)

  // 1. Add operand
  const extra = createElement('rectangle', { id: 'c', name: 'Shape C', x: 100, y: 0, width: 100, height: 100 })
  store.addBooleanOperand(compound.id, extra)
  let current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operands.length, 3)
  assert.ok(calculatePathArea(current.d) > baseArea)

  // 2. Mute operand 'c' -> area drops back to baseArea
  store.toggleBooleanOperandMute(compound.id, 'c')
  current = store.getSnapshot().elements[compound.id]
  assert.ok(current.boolean.mutedOperandIds.includes('c'))
  close(calculatePathArea(current.d), baseArea)

  // Unmute operand 'c'
  store.toggleBooleanOperandMute(compound.id, 'c')
  current = store.getSnapshot().elements[compound.id]
  assert.ok(!current.boolean.mutedOperandIds || !current.boolean.mutedOperandIds.includes('c'))
  assert.ok(calculatePathArea(current.d) > baseArea)

  // 3. Duplicate operand 'b'
  store.duplicateBooleanOperand(compound.id, 'b')
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operands.length, 4)

  // 4. Extract operand 'c' as a standalone scene element
  store.extractBooleanOperand(compound.id, 'c')
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operands.length, 3)
  // 'c' is now an independent element in the scene
  assert.ok(store.getSnapshot().elements['c'])
})

test('Standalone clipped SVG export with generateClippedSVGExport and polygon clipping', () => {
  const compound = createElement('path', {
    id: 'cutter-comp',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    d: 'M 10 10 H 90 V 90 H 10 Z',
    viewBox: [0, 0, 100, 100],
    fillRule: 'nonzero',
  })
  const target = createElement('rectangle', {
    id: 'target-rect',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    style: { fill: '#3b82f6' },
  })

  // 1. generateClippedSVGExport
  const clippedExport = generateClippedSVGExport(compound, target)
  assert.ok(clippedExport.includes('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(clippedExport.includes('<clipPath id="clip-cutter-comp"'))
  assert.ok(clippedExport.includes('clip-path="url(#clip-cutter-comp)"'))
  assert.ok(clippedExport.includes('</svg>'))

  // 2. clipPathWithCompound
  const result = clipPathWithCompound(target, compound, 'intersect')
  assert.ok(result.d)
  close(calculatePathArea(result.d), 6400) // (90 - 10)^2 = 80 * 80 = 6400

  // 3. Sutherland-Hodgman computePolygonClipping
  const subjectPoly = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
  const clipPoly = [
    { x: 20, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 80 },
    { x: 20, y: 80 },
  ]
  const clippedPoints = computePolygonClipping(subjectPoly, clipPoly)
  assert.equal(clippedPoints.length, 4)
  for (const expectedPt of clipPoly) {
    assert.ok(
      clippedPoints.some(pt => Math.abs(pt.x - expectedPt.x) < 1e-4 && Math.abs(pt.y - expectedPt.y) < 1e-4),
      `Expected point (${expectedPt.x}, ${expectedPt.y}) to be in clipped polygon`
    )
  }
})
