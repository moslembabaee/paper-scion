import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createElement } from '../src/scene/elements.ts'
import {
  computeBoolean,
  evaluateCompoundHierarchy,
  evaluateVectorElement,
  findCompoundOperand,
  vectorPathData,
  vectorToContours,
} from '../src/scene/booleanGeometry.ts'
import { parsePath } from '../src/scene/pathGeometry.ts'
import {
  exportCleanSVGGeometry,
  generateCompoundClipPath,
  generateCompoundSVGMask,
  generateCompoundHierarchyMarkup,
  generateClippedSVGExport,
  calculatePathArea,
} from '../src/scene/cagEngine.ts'
import {
  drawSvgPathToCanvas2D,
  renderCompoundToCanvas2D,
  renderCompoundMaskToCanvas2D,
  renderSceneToCanvas2D,
} from '../src/io/canvas2dExport.ts'
import { sceneToSVG } from '../src/io/svg.ts'
import {
  maskContainsWorldPoint,
  shapeContainsWorldPoint,
  frameMask,
  isCompoundMask,
} from '../src/scene/maskGeometry.ts'
import { measurementHit } from '../src/scene/measurementGeometry.ts'

const close = (actual, expected, epsilon = 2) => {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `Expected ${actual} to be close to ${expected} (diff: ${Math.abs(actual - expected)}, epsilon: ${epsilon})`
  )
}

function mockCanvasContext() {
  const operations = []
  return {
    operations,
    save: () => operations.push(['save']),
    restore: () => operations.push(['restore']),
    beginPath: () => operations.push(['beginPath']),
    closePath: () => operations.push(['closePath']),
    moveTo: (x, y) => operations.push(['moveTo', x, y]),
    lineTo: (x, y) => operations.push(['lineTo', x, y]),
    bezierCurveTo: (cp1x, cp1y, cp2x, cp2y, x, y) =>
      operations.push(['bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y]),
    rect: (x, y, w, h) => operations.push(['rect', x, y, w, h]),
    fillRect: (x, y, w, h) => operations.push(['fillRect', x, y, w, h]),
    roundRect: (x, y, w, h, r) => operations.push(['roundRect', x, y, w, h, r]),
    ellipse: (x, y, rx, ry, rot, start, end) =>
      operations.push(['ellipse', x, y, rx, ry, rot, start, end]),
    clip: (rule) => operations.push(['clip', rule]),
    fill: (rule) => operations.push(['fill', rule]),
    stroke: () => operations.push(['stroke']),
    translate: (x, y) => operations.push(['translate', x, y]),
    rotate: (rad) => operations.push(['rotate', rad]),
    scale: (sx, sy) => operations.push(['scale', sx, sy]),
    setLineDash: (d) => operations.push(['setLineDash', d]),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    lineJoin: 'miter',
  }
}

test('non-destructive boolean vector operations (union, subtract, intersect, exclude)', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'a', name: 'Base', width: 100, height: 100, style: { fill: '#080808' } })
  store.add('rectangle', { id: 'b', name: 'Cutter', x: 50, y: 50, width: 100, height: 100 })
  store.select(['b', 'a'])

  // 1. Union: 100x100 at (0,0) + 100x100 at (50,50) = 17500 px²
  const unionNode = store.booleanSelection('union', false)
  assert.equal(unionNode.type, 'path')
  assert.ok(unionNode.boolean)
  assert.equal(unionNode.boolean.operation, 'union')
  assert.equal(unionNode.boolean.operands.length, 2)
  close(calculatePathArea(unionNode.d), 17500)

  // 2. Live switch to subtract: Base - Cutter = 7500 px²
  store.setBooleanOperation(unionNode.id, 'subtract')
  let current = store.getSnapshot().elements[unionNode.id]
  assert.equal(current.boolean.operation, 'subtract')
  close(calculatePathArea(current.d), 7500)

  // 3. Live switch to intersect: Overlap = 50x50 = 2500 px²
  store.setBooleanOperation(unionNode.id, 'intersect')
  current = store.getSnapshot().elements[unionNode.id]
  assert.equal(current.boolean.operation, 'intersect')
  close(calculatePathArea(current.d), 2500)

  // 4. Live switch to exclude: Union - Intersection = 17500 - 2500 = 15000 px²
  store.setBooleanOperation(unionNode.id, 'exclude')
  current = store.getSnapshot().elements[unionNode.id]
  assert.equal(current.boolean.operation, 'exclude')
  close(calculatePathArea(current.d), 15000)

  // 5. Reorder operands: Cutter first, then Base (subtract reverses)
  store.setBooleanOperation(unionNode.id, 'subtract')
  store.reorderBooleanOperands(unionNode.id, ['b', 'a'])
  current = store.getSnapshot().elements[unionNode.id]
  assert.equal(current.boolean.operands[0].id, 'b')
  assert.equal(current.boolean.operands[1].id, 'a')
  close(calculatePathArea(current.d), 7500)

  // 6. Mute operand: muting operand leaves single operand
  store.toggleBooleanOperandMute(unionNode.id, 'a')
  current = store.getSnapshot().elements[unionNode.id]
  assert.deepEqual(current.boolean.mutedOperandIds, ['a'])
  close(calculatePathArea(current.d), 10000)

  // Unmute operand restores full compound evaluation
  store.toggleBooleanOperandMute(unionNode.id, 'a')
  current = store.getSnapshot().elements[unionNode.id]
  assert.equal(current.boolean.mutedOperandIds, undefined)
  close(calculatePathArea(current.d), 7500)

  // 7. Duplicate and Remove operands
  store.duplicateBooleanOperand(unionNode.id, 'a')
  current = store.getSnapshot().elements[unionNode.id]
  assert.equal(current.boolean.operands.length, 3)

  store.removeBooleanOperand(unionNode.id, current.boolean.operands[2].id)
  current = store.getSnapshot().elements[unionNode.id]
  assert.equal(current.boolean.operands.length, 2)

  // 8. Flattening vs Releasing
  store.flattenBoolean(unionNode.id)
  current = store.getSnapshot().elements[unionNode.id]
  assert.equal(current.boolean, undefined)
  assert.ok(current.d)
})

test('live compound shape hierarchy evaluation with nested compound trees', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'r1', x: 0, y: 0, width: 100, height: 100 })
  store.add('rectangle', { id: 'r2', x: 50, y: 0, width: 100, height: 100 })
  store.add('rectangle', { id: 'r3', x: 25, y: 50, width: 100, height: 100 })
  store.select(['r1', 'r2', 'r3'])
  const root = store.booleanSelection('union')

  // Group r2 and r3 into a nested compound
  store.groupBooleanOperands(root.id, ['r2', 'r3'], 'intersect')
  let current = store.getSnapshot().elements[root.id]
  assert.equal(current.boolean.operands.length, 2)
  const nested = current.boolean.operands[1]
  assert.ok(nested.boolean)
  assert.equal(nested.boolean.operation, 'intersect')

  // evaluateVectorElement & evaluateCompoundHierarchy evaluation
  const evaluatedElement = evaluateVectorElement(current)
  assert.ok(evaluatedElement.d)
  assert.equal(evaluatedElement.fillRule, 'nonzero')

  const hierarchyResult = evaluateCompoundHierarchy(current.boolean)
  assert.ok(hierarchyResult.d)
  assert.ok(hierarchyResult.bounds.width > 0)

  // Finding operand at any hierarchy depth
  const foundR3 = findCompoundOperand(current.boolean, 'r3')
  assert.ok(foundR3)
  assert.equal(foundR3.id, 'r3')

  // Live transform edit on nested operand propagates to root compound outline
  const beforeArea = calculatePathArea(current.d)
  store.updateBooleanOperand(root.id, 'r3', { x: 40, y: 60 })
  current = store.getSnapshot().elements[root.id]
  const afterArea = calculatePathArea(current.d)
  assert.notEqual(beforeArea, afterArea)

  // Switch nested operation to difference/subtract
  store.setNestedBooleanOperation(root.id, nested.id, 'subtract')
  current = store.getSnapshot().elements[root.id]
  assert.equal(current.boolean.operands[1].boolean.operation, 'subtract')

  // Unwrap hierarchy restores flat operand list
  store.unwrapNestedBoolean(root.id, nested.id)
  current = store.getSnapshot().elements[root.id]
  assert.equal(current.boolean.operands.length, 3)
})

test('editable sub-path anchors for compound shape operands with real-time outline re-baking', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'base', width: 100, height: 100, style: { fill: '#81adec' } })
  store.add('rectangle', { id: 'cutter', x: 50, y: 50, width: 100, height: 100 })
  store.select(['base', 'cutter'])
  const compound = store.booleanSelection('subtract')
  const initialD = compound.d
  const initialArea = calculatePathArea(initialD)

  // Test pathEditingTarget tracking in store
  let editingTargetNotified = 0
  const unsubscribe = store.subscribePathEditingTarget(() => editingTargetNotified++)
  store.setPathEditingTarget({ id: compound.id, operandId: 'cutter' })
  assert.deepEqual(store.getPathEditingTarget(), { id: compound.id, operandId: 'cutter' })
  assert.equal(editingTargetNotified, 1)
  unsubscribe()

  // Convert cutter rectangle to editable sub-path anchors
  const cutterOp = store.getCompoundOperand(compound.id, 'cutter')
  assert.ok(cutterOp)
  const contours = vectorToContours(cutterOp)
  assert.equal(contours.length, 1)
  assert.equal(contours[0].anchors.length, 4)

  // Edit anchor positions: move cutting corner deeper into base
  const editedContours = [
    {
      closed: true,
      anchors: [
        { x: -20, y: -20 }, // expanded cutting edge into base
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    },
  ]

  // Update sub-path anchors of the operand
  store.updateBooleanOperandNodes(compound.id, 'cutter', editedContours)
  let updated = store.getSnapshot().elements[compound.id]
  assert.notEqual(updated.d, initialD)
  const newArea = calculatePathArea(updated.d)
  // Larger cutter subtracted -> remaining base area decreases
  assert.ok(newArea < initialArea)

  // Convert corner to curved Bézier handles
  const curvedContours = [
    {
      closed: true,
      anchors: [
        { x: -20, y: -20, out: { x: 20, y: -30 } },
        { x: 100, y: 0, in: { x: 70, y: -30 } },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    },
  ]
  store.updateBooleanOperandNodes(compound.id, 'cutter', curvedContours)
  updated = store.getSnapshot().elements[compound.id]
  assert.match(updated.d, / C /)

  // Sub-path anchor edits support full Undo & Redo
  store.undo()
  let undone = store.getSnapshot().elements[compound.id]
  assert.notEqual(undone.d, updated.d)

  store.redo()
  let redone = store.getSnapshot().elements[compound.id]
  assert.equal(redone.d, updated.d)

  // Clear path editing target
  store.setPathEditingTarget(null)
  assert.equal(store.getPathEditingTarget(), null)
})

test('compound shape masking: creation, live evaluation, inverted, alpha, luminance, and isolation', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'frame', width: 300, height: 300, clipContent: false, style: { fill: null } })
  store.add('rectangle', { id: 'content', parentId: 'frame', width: 300, height: 300, style: { fill: '#ff0000' } })
  store.add('rectangle', { id: 'm1', parentId: 'frame', x: 20, y: 20, width: 100, height: 100 })
  store.add('ellipse', { id: 'm2', parentId: 'frame', x: 60, y: 60, width: 100, height: 100 })

  // 1. Create compound mask using createCompoundMask
  const maskGroup = store.createCompoundMask('subtract', ['content', 'm1', 'm2'])
  assert.equal(maskGroup.type, 'frame')

  const frameSnapshot = store.getSnapshot()
  const mask = frameMask(frameSnapshot.elements, maskGroup)
  assert.ok(mask)
  assert.equal(isCompoundMask(mask), true)
  assert.equal(mask.boolean.operation, 'subtract')
  assert.equal(mask.mask.enabled, true)

  // 2. Hit testing through compound mask
  // Inside m1 but outside m2: visible content
  const localInsidePoint = { x: 30, y: 30 }
  const localCutoutPoint = { x: 80, y: 80 }
  assert.equal(shapeContainsWorldPoint(frameSnapshot, mask, localInsidePoint), true)
  assert.equal(shapeContainsWorldPoint(frameSnapshot, mask, localCutoutPoint), false)

  // 3. Switch compound mask operation to union
  store.setCompoundMaskOperation(mask.id, 'union')
  let currentMask = store.getSnapshot().elements[mask.id]
  assert.equal(currentMask.boolean.operation, 'union')
  // Both m1 and m2 regions now visible
  assert.equal(shapeContainsWorldPoint(store.getSnapshot(), currentMask, localCutoutPoint), true)

  // 4. Inverted compound mask
  store.setMaskInverted(mask.id, true)
  currentMask = store.getSnapshot().elements[mask.id]
  assert.equal(currentMask.mask.inverted, true)
  assert.equal(maskContainsWorldPoint(store.getSnapshot(), currentMask, localInsidePoint), false)

  // 5. Alpha and luminance clip modes
  store.setMaskMode(mask.id, 'alpha')
  currentMask = store.getSnapshot().elements[mask.id]
  assert.equal(currentMask.mask.mode, 'alpha')

  store.setMaskMode(mask.id, 'luminance')
  store.setMaskLuminanceThreshold(mask.id, 0.7)
  currentMask = store.getSnapshot().elements[mask.id]
  assert.equal(currentMask.mask.mode, 'luminance')
  assert.equal(currentMask.mask.luminanceThreshold, 0.7)

  // 6. Mask isolation mode
  store.setMaskIsolated(mask.id, true)
  currentMask = store.getSnapshot().elements[mask.id]
  assert.equal(currentMask.mask.isolated, true)
  assert.equal(store.getIsolatedMaskId(), mask.id)

  store.toggleMaskIsolation(mask.id)
  currentMask = store.getSnapshot().elements[mask.id]
  assert.equal(currentMask.mask.isolated, false)
  assert.equal(store.getIsolatedMaskId(), null)

  // 7. Live sub-path anchor editing on compound mask updates clipping
  const op = store.getCompoundOperand(mask.id, currentMask.boolean.operands[0].id)
  const opContours = vectorToContours(op)
  opContours[0].anchors[1].x += 50
  store.updateBooleanOperandNodes(mask.id, op.id, opContours)
  currentMask = store.getSnapshot().elements[mask.id]
  assert.ok(currentMask.d)
})

test('SVG export rendering for non-destructive compound shapes and compound masks', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'container', width: 200, height: 200, clipContent: true, style: { fill: '#141414' } })
  store.add('rectangle', { id: 'bg', parentId: 'container', width: 200, height: 200, style: { fill: '#ffffff' } })
  store.add('rectangle', { id: 'b1', parentId: 'container', width: 100, height: 100 })
  store.add('rectangle', { id: 'b2', parentId: 'container', x: 50, y: 50, width: 100, height: 100 })
  const compound = store.booleanSelection('exclude', false, ['b1', 'b2'])

  // Export scene containing non-destructive compound shape to SVG
  const svg = sceneToSVG(store.getSnapshot(), { scope: 'canvas', scale: 1, background: 'transparent' })
  assert.ok(svg.includes('<svg'))
  assert.ok(svg.includes('<path'))
  assert.match(svg, /d="M/)
  assert.match(svg, /fill-rule="nonzero"/)

  // Export clean standalone SVG geometry from compound shape
  const standaloneSvg = exportCleanSVGGeometry(compound, { standalone: true, precision: 3 })
  assert.ok(standaloneSvg.startsWith('<svg'))
  assert.ok(standaloneSvg.includes('<path'))

  // Generate SVG <clipPath> definition
  const clipPathSvg = generateCompoundClipPath(compound, { clipPathId: 'custom-clip-1' })
  assert.ok(clipPathSvg.includes('<clipPath id="custom-clip-1"'))
  assert.ok(clipPathSvg.includes('<path'))

  // Generate SVG <mask> definition
  const maskSvg = generateCompoundSVGMask(compound, { maskId: 'custom-mask-1' })
  assert.ok(maskSvg.includes('<mask id="custom-mask-1"'))

  // Generate compound hierarchy inspection markup
  const hierarchySvg = generateCompoundHierarchyMarkup(compound)
  assert.ok(hierarchySvg.includes('data-type="compound"'))
  assert.ok(hierarchySvg.includes('data-boolean-op="exclude"'))
  assert.ok(hierarchySvg.includes('data-role="sources"'))

  // Test compound mask SVG export
  store.setMask(compound.id, true)
  const maskedSvg = sceneToSVG(store.getSnapshot(), { scope: 'canvas', scale: 1, background: 'transparent' })
  assert.ok(maskedSvg.includes('clip-path="url(#paper-export-'))
})

test('Canvas2D export rendering for compound shapes and compound masks', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'card', width: 200, height: 200, clipContent: true, style: { fill: '#0a0a0a' } })
  store.add('rectangle', { id: 'art', parentId: 'card', width: 200, height: 200, style: { fill: '#3b82f6' } })
  store.add('rectangle', { id: 's1', parentId: 'card', width: 80, height: 80 })
  store.add('ellipse', { id: 's2', parentId: 'card', x: 40, y: 40, width: 80, height: 80 })
  const compound = store.booleanSelection('subtract', false, ['s1', 's2'])

  // 1. Test drawSvgPathToCanvas2D directly
  const ctx = mockCanvasContext()
  drawSvgPathToCanvas2D(ctx, 'M 0 0 L 100 0 C 120 20 120 80 100 100 L 0 100 Z')
  const opNames = ctx.operations.map(op => op[0])
  assert.ok(opNames.includes('beginPath'))
  assert.ok(opNames.includes('moveTo'))
  assert.ok(opNames.includes('lineTo'))
  assert.ok(opNames.includes('bezierCurveTo'))
  assert.ok(opNames.includes('closePath'))

  // 2. Test renderCompoundToCanvas2D
  const compoundCtx = mockCanvasContext()
  renderCompoundToCanvas2D(compoundCtx, compound, {
    fill: '#81adec',
    stroke: '#080808',
    strokeWidth: 2,
    opacity: 0.9,
  })
  const compOps = compoundCtx.operations.map(op => op[0])
  assert.ok(compOps.includes('save'))
  assert.ok(compOps.includes('translate'))
  assert.ok(compOps.includes('scale'))
  assert.ok(compOps.includes('fill'))
  assert.ok(compOps.includes('stroke'))
  assert.ok(compOps.includes('restore'))

  // 3. Test renderCompoundMaskToCanvas2D
  store.setMask(compound.id, true)
  const mask = store.getSnapshot().elements[compound.id]
  const maskCtx = mockCanvasContext()
  let childrenRendered = false
  renderCompoundMaskToCanvas2D(maskCtx, mask, () => {
    childrenRendered = true
  }, 200, 200)
  assert.equal(childrenRendered, true)
  const maskOps = maskCtx.operations.map(op => op[0])
  assert.ok(maskOps.includes('clip'))

  // Inverted mask
  store.setMaskInverted(compound.id, true)
  const invertedMask = store.getSnapshot().elements[compound.id]
  const invCtx = mockCanvasContext()
  let invChildrenRendered = false
  renderCompoundMaskToCanvas2D(invCtx, invertedMask, () => {
    invChildrenRendered = true
  }, 200, 200)
  assert.equal(invChildrenRendered, true)
  const invOps = invCtx.operations.map(op => op[0])
  assert.ok(invOps.includes('rect'))
  assert.ok(invOps.includes('clip'))

  // 4. Test renderSceneToCanvas2D with mock canvas element
  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: () => mockCanvasContext(),
  }
  renderSceneToCanvas2D(mockCanvas, store.getSnapshot(), {
    scope: 'canvas',
    scale: 2,
    background: 'cream',
  })
  assert.ok(mockCanvas.width > 0)
  assert.ok(mockCanvas.height > 0)
})
