import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import {
  applyConstraintsToChild,
  applyConstraintsToChildren,
  DEFAULT_CONSTRAINTS,
  HORIZONTAL_CONSTRAINTS,
  VERTICAL_CONSTRAINTS,
} from '../src/scene/layoutConstraints.ts'
import {
  computeColumnIntervals,
  computeRowIntervals,
  createDefaultLayoutGrid,
  getLayoutGridSnapTargets,
} from '../src/scene/layoutGridGeometry.ts'

const node = (store, id) => store.getSnapshot().elements[id]
const geometry = n => [n.x, n.y, n.width, n.height]

test('layout constraints constants are complete and frozen', () => {
  assert.deepEqual(DEFAULT_CONSTRAINTS, { horizontal: 'left', vertical: 'top' })
  assert.deepEqual([...HORIZONTAL_CONSTRAINTS], ['left', 'right', 'left-right', 'center', 'scale'])
  assert.deepEqual([...VERTICAL_CONSTRAINTS], ['top', 'bottom', 'top-bottom', 'center', 'scale'])
})

test('applyConstraintsToChild: Left and Top pinning preserves top-left offset', () => {
  const child = {
    x: 40,
    y: 30,
    width: 100,
    height: 80,
    rotation: 0,
    constraints: { horizontal: 'left', vertical: 'top' },
  }
  const fromFrame = { width: 400, height: 300 }
  const toFrame = { width: 600, height: 500 }

  const res = applyConstraintsToChild(child, fromFrame, toFrame)
  assert.deepEqual(res, {
    x: 40,
    y: 30,
    width: 100,
    height: 80,
    rotation: 0,
  })
})

test('applyConstraintsToChild: Right and Bottom pinning preserves right/bottom margins', () => {
  // fromFrame is 400x300. child is at x: 260, y: 180, width: 100, height: 80.
  // right distance = 400 - (260 + 100) = 40.
  // bottom distance = 300 - (180 + 80) = 40.
  const child = {
    x: 260,
    y: 180,
    width: 100,
    height: 80,
    rotation: 0,
    constraints: { horizontal: 'right', vertical: 'bottom' },
  }
  const fromFrame = { width: 400, height: 300 }
  const toFrame = { width: 600, height: 500 }

  const res = applyConstraintsToChild(child, fromFrame, toFrame)
  // dW = 200, dH = 200
  // new x = 260 + 200 = 460. Right margin = 600 - (460 + 100) = 40 (preserved!)
  // new y = 180 + 200 = 380. Bottom margin = 500 - (380 + 80) = 40 (preserved!)
  assert.deepEqual(res, {
    x: 460,
    y: 380,
    width: 100,
    height: 80,
    rotation: 0,
  })
})

test('applyConstraintsToChild: Left-Right and Top-Bottom stretches child while preserving margins', () => {
  const child = {
    x: 50,
    y: 40,
    width: 300,
    height: 200,
    rotation: 0,
    constraints: { horizontal: 'left-right', vertical: 'top-bottom' },
  }
  // fromFrame is 400x300.
  // left margin = 50, right margin = 400 - (50 + 300) = 50.
  // top margin = 40, bottom margin = 300 - (40 + 200) = 60.
  const fromFrame = { width: 400, height: 300 }
  const toFrame = { width: 600, height: 500 }

  const res = applyConstraintsToChild(child, fromFrame, toFrame)
  // new width = 600 - 50 - 50 = 500.
  // new height = 500 - 40 - 60 = 400.
  assert.deepEqual(res, {
    x: 50,
    y: 40,
    width: 500,
    height: 400,
    rotation: 0,
  })
})

test('applyConstraintsToChild: Center maintains relative center alignment', () => {
  // fromFrame is 400x300. Child center is at x: 200 (width 100, x 150), y: 150 (height 60, y 120).
  const child = {
    x: 150,
    y: 120,
    width: 100,
    height: 60,
    rotation: 0,
    constraints: { horizontal: 'center', vertical: 'center' },
  }
  const fromFrame = { width: 400, height: 300 }
  const toFrame = { width: 600, height: 500 }

  const res = applyConstraintsToChild(child, fromFrame, toFrame)
  // dW = 200, dH = 200
  // new x = 150 + 200 * 0.5 = 250. Child center in 600px frame = 250 + 50 = 300 (exact center of 600!).
  // new y = 120 + 200 * 0.5 = 220. Child center in 500px frame = 220 + 30 = 250 (exact center of 500!).
  assert.deepEqual(res, {
    x: 250,
    y: 220,
    width: 100,
    height: 60,
    rotation: 0,
  })
})

test('applyConstraintsToChild: Scale scales position and size proportionally', () => {
  // fromFrame 400x200 -> toFrame 800x600 (scaleX = 2, scaleY = 3)
  const child = {
    x: 50,
    y: 20,
    width: 100,
    height: 40,
    rotation: 0,
    constraints: { horizontal: 'scale', vertical: 'scale' },
  }
  const fromFrame = { width: 400, height: 200 }
  const toFrame = { width: 800, height: 600 }

  const res = applyConstraintsToChild(child, fromFrame, toFrame)
  assert.deepEqual(res, {
    x: 100,
    y: 60,
    width: 200,
    height: 120,
    rotation: 0,
  })
})

test('applyConstraintsToChildren: recursive nested frames reposition grandchildren with constraints', () => {
  const store = new SceneStore()
  // Outer frame: 600x400
  store.add('frame', { id: 'outer', width: 600, height: 400 })
  // Inner frame: stretched inside outer (x: 50, y: 50, width: 500, height: 300)
  store.add('frame', {
    id: 'inner',
    parentId: 'outer',
    x: 50,
    y: 50,
    width: 500,
    height: 300,
    constraints: { horizontal: 'left-right', vertical: 'top-bottom' },
  })
  // Grandchild in inner: pinned to right-bottom (x: 350, y: 200, width: 100, height: 60)
  // Inner margin right: 500 - (350 + 100) = 50. Bottom: 300 - (200 + 60) = 40.
  store.add('rectangle', {
    id: 'grandchild',
    parentId: 'inner',
    x: 350,
    y: 200,
    width: 100,
    height: 60,
    constraints: { horizontal: 'right', vertical: 'bottom' },
  })

  // Resize outer frame to 800x600 (dW = 200, dH = 200)
  store.update('outer', 'frame', { width: 800, height: 600 })

  const innerNode = node(store, 'inner')
  // Inner frame stretched from 500x300 to 700x500
  assert.equal(innerNode.width, 700)
  assert.equal(innerNode.height, 500)
  assert.equal(innerNode.x, 50)
  assert.equal(innerNode.y, 50)

  const grandchildNode = node(store, 'grandchild')
  // Grandchild in inner frame adapted to 700x500 inner frame!
  // Inner frame grew by dW = 200, dH = 200.
  // Grandchild x = 350 + 200 = 550. Right margin = 700 - (550 + 100) = 50 (preserved!)
  // Grandchild y = 200 + 200 = 400. Bottom margin = 500 - (400 + 60) = 40 (preserved!)
  assert.equal(grandchildNode.x, 550)
  assert.equal(grandchildNode.y, 400)
  assert.equal(grandchildNode.width, 100)
  assert.equal(grandchildNode.height, 60)
})

test('store transactions preserve baseline snapshot to prevent drift during continuous drag', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'frame', width: 400, height: 400 })
  store.add('rectangle', {
    id: 'rect',
    parentId: 'frame',
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    constraints: { horizontal: 'scale', vertical: 'scale' },
  })

  store.beginTransaction('Resize frame')
  // Simulate 10 intermediary drag frames with small increments
  for (let i = 1; i <= 10; i++) {
    store.update('frame', 'frame', { width: 400 + i * 20, height: 400 + i * 20 })
  }
  store.endTransaction()

  const finalRect = node(store, 'rect')
  // Final width: 600. Scale factor = 600 / 400 = 1.5.
  // x: 100 * 1.5 = 150. width: 100 * 1.5 = 150.
  assert.equal(finalRect.x, 150)
  assert.equal(finalRect.y, 150)
  assert.equal(finalRect.width, 150)
  assert.equal(finalRect.height, 150)

  // Undo transaction
  store.undo()
  const undoneRect = node(store, 'rect')
  assert.equal(undoneRect.x, 100)
  assert.equal(undoneRect.y, 100)
  assert.equal(undoneRect.width, 100)
  assert.equal(undoneRect.height, 100)

  // Redo transaction
  store.redo()
  const redoneRect = node(store, 'rect')
  assert.equal(redoneRect.x, 150)
  assert.equal(redoneRect.y, 150)
  assert.equal(redoneRect.width, 150)
  assert.equal(redoneRect.height, 150)
})

test('canceling a transaction rolls back frame and child constraints cleanly', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'frame', width: 400, height: 400 })
  store.add('rectangle', {
    id: 'rect',
    parentId: 'frame',
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    constraints: { horizontal: 'right', vertical: 'bottom' },
  })

  store.beginTransaction('Resize frame')
  store.update('frame', 'frame', { width: 800, height: 800 })
  assert.equal(node(store, 'rect').x, 450)
  assert.equal(node(store, 'rect').y, 450)

  store.cancelTransaction()
  assert.equal(node(store, 'frame').width, 400)
  assert.equal(node(store, 'frame').height, 400)
  assert.equal(node(store, 'rect').x, 50)
  assert.equal(node(store, 'rect').y, 50)
})

test('setLayoutConstraints updates constraints atomically and validates inputs', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'r', width: 100, height: 100 })
  store.setLayoutConstraints('r', { horizontal: 'center', vertical: 'scale' })

  assert.deepEqual(node(store, 'r').constraints, { horizontal: 'center', vertical: 'scale' })

  // Invalid horizontal constraint throws
  assert.throws(() => {
    store.setLayoutConstraints('r', { horizontal: 'invalid', vertical: 'top' })
  }, /Invalid layout constraints/)

  // Invalid vertical constraint throws
  assert.throws(() => {
    store.setLayoutConstraints('r', { horizontal: 'left', vertical: 'invalid' })
  }, /Invalid layout constraints/)
})

test('computeColumnIntervals: stretch, left, right, and center alignments', () => {
  // Stretch: 1200px frame, 12 cols, 20px gutter, 32px margin
  // available = 1200 - 64 - (11 * 20) = 1200 - 64 - 220 = 916.
  // colWidth = 916 / 12 = 76.333...
  const stretchGrid = {
    id: 'col-1',
    type: 'columns',
    visible: true,
    color: '#81adec',
    count: 12,
    gutter: 20,
    margin: 32,
    alignment: 'stretch',
  }
  const stretchCols = computeColumnIntervals(1200, stretchGrid)
  assert.equal(stretchCols.length, 12)
  assert.equal(stretchCols[0].x, 32)
  assert.ok(Math.abs(stretchCols[0].width - 916 / 12) < 1e-6)
  assert.ok(Math.abs(stretchCols[1].x - (32 + 916 / 12 + 20)) < 1e-6)

  // Left alignment: 4 cols, size 80, gutter 16, margin 24
  const leftGrid = {
    id: 'col-2',
    type: 'columns',
    visible: true,
    color: '#81adec',
    count: 4,
    gutter: 16,
    margin: 24,
    size: 80,
    alignment: 'left',
  }
  const leftCols = computeColumnIntervals(1000, leftGrid)
  assert.equal(leftCols.length, 4)
  assert.equal(leftCols[0].x, 24)
  assert.equal(leftCols[0].width, 80)
  assert.equal(leftCols[1].x, 24 + 80 + 16)

  // Right alignment: total = 4 * 80 + 3 * 16 = 320 + 48 = 368.
  // startX = 1000 - 24 - 368 = 608.
  const rightGrid = { ...leftGrid, alignment: 'right' }
  const rightCols = computeColumnIntervals(1000, rightGrid)
  assert.equal(rightCols[0].x, 608)

  // Center alignment: startX = (1000 - 368) * 0.5 = 316.
  const centerGrid = { ...leftGrid, alignment: 'center' }
  const centerCols = computeColumnIntervals(1000, centerGrid)
  assert.equal(centerCols[0].x, 316)
})

test('computeRowIntervals: stretch, top, bottom, and center alignments', () => {
  // Stretch: 800px frame, 8 rows, 20px gutter, 24px margin
  // available = 800 - 48 - (7 * 20) = 800 - 48 - 140 = 612.
  // rowHeight = 612 / 8 = 76.5.
  const stretchGrid = {
    id: 'row-1',
    type: 'rows',
    visible: true,
    color: '#81adec',
    count: 8,
    gutter: 20,
    margin: 24,
    alignment: 'stretch',
  }
  const stretchRows = computeRowIntervals(800, stretchGrid)
  assert.equal(stretchRows.length, 8)
  assert.equal(stretchRows[0].y, 24)
  assert.equal(stretchRows[0].height, 76.5)
  assert.equal(stretchRows[1].y, 24 + 76.5 + 20)

  // Top alignment: 3 rows, size 60, gutter 12, margin 30
  const topGrid = {
    id: 'row-2',
    type: 'rows',
    visible: true,
    color: '#81adec',
    count: 3,
    gutter: 12,
    margin: 30,
    size: 60,
    alignment: 'top',
  }
  const topRows = computeRowIntervals(600, topGrid)
  assert.equal(topRows.length, 3)
  assert.equal(topRows[0].y, 30)
  assert.equal(topRows[0].height, 60)
  assert.equal(topRows[1].y, 30 + 60 + 12)

  // Bottom alignment: total = 3 * 60 + 2 * 12 = 180 + 24 = 204.
  // startY = 600 - 30 - 204 = 366.
  const bottomGrid = { ...topGrid, alignment: 'bottom' }
  const bottomRows = computeRowIntervals(600, bottomGrid)
  assert.equal(bottomRows[0].y, 366)

  // Center alignment: startY = (600 - 204) * 0.5 = 198.
  const centerGrid = { ...topGrid, alignment: 'center' }
  const centerRows = computeRowIntervals(600, centerGrid)
  assert.equal(centerRows[0].y, 198)
})

test('createDefaultLayoutGrid creates valid defaults for columns, rows, and grid', () => {
  const colGrid = createDefaultLayoutGrid('columns')
  assert.equal(colGrid.type, 'columns')
  assert.equal(colGrid.count, 12)
  assert.equal(colGrid.visible, true)

  const rowGrid = createDefaultLayoutGrid('rows')
  assert.equal(rowGrid.type, 'rows')
  assert.equal(rowGrid.count, 8)
  assert.equal(rowGrid.visible, true)

  const modGrid = createDefaultLayoutGrid('grid')
  assert.equal(modGrid.type, 'grid')
  assert.equal(modGrid.sectionSize, 120)
  assert.equal(modGrid.visible, true)
})

test('getLayoutGridSnapTargets generates correct world bounds and ignores hidden grids', () => {
  const frame = {
    id: 'f1',
    type: 'frame',
    width: 600,
    height: 400,
    layoutGrids: [
      {
        id: 'g1',
        type: 'columns',
        visible: true,
        color: '#81adec',
        count: 4,
        gutter: 10,
        margin: 20,
        alignment: 'stretch',
      },
      {
        id: 'g2',
        type: 'rows',
        visible: false, // hidden!
        color: '#81adec',
        count: 4,
        gutter: 10,
        margin: 20,
        alignment: 'stretch',
      },
    ],
  }
  const frameWorldBounds = { x: 100, y: 150, width: 600, height: 400 }

  const targets = getLayoutGridSnapTargets(frame, frameWorldBounds)
  // Only the 4 columns from visible grid g1 should be included
  assert.equal(targets.length, 4)
  assert.equal(targets[0].y, 150)
  assert.equal(targets[0].height, 400)
  assert.equal(targets[0].x, 100 + 20) // frameWorld.x + margin
})

test('store frame layout grid CRUD operations and validation', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'f1', width: 800, height: 600 })
  store.add('rectangle', { id: 'r1', width: 100, height: 100 })

  // Calling layout grid methods on a rectangle throws
  assert.throws(() => {
    store.addFrameLayoutGrid('r1', 'columns')
  }, /Only frames support layout grids/)

  // Add columns grid to frame
  const colGrid = store.addFrameLayoutGrid('f1', 'columns')
  assert.equal(node(store, 'f1').layoutGrids.length, 1)
  assert.equal(node(store, 'f1').layoutGrids[0].id, colGrid.id)
  assert.equal(node(store, 'f1').layoutGrids[0].type, 'columns')

  // Add rows grid to frame
  const rowGrid = store.addFrameLayoutGrid('f1', 'rows')
  assert.equal(node(store, 'f1').layoutGrids.length, 2)

  // Update grid parameters
  store.updateFrameLayoutGrid('f1', colGrid.id, { count: 16, gutter: 24 })
  const updatedCol = node(store, 'f1').layoutGrids.find(g => g.id === colGrid.id)
  assert.equal(updatedCol.count, 16)
  assert.equal(updatedCol.gutter, 24)

  // Toggle grid visibility
  assert.equal(updatedCol.visible, true)
  store.toggleFrameLayoutGridVisibility('f1', colGrid.id)
  assert.equal(node(store, 'f1').layoutGrids.find(g => g.id === colGrid.id).visible, false)
  store.toggleFrameLayoutGridVisibility('f1', colGrid.id)
  assert.equal(node(store, 'f1').layoutGrids.find(g => g.id === colGrid.id).visible, true)

  // Remove grid
  store.removeFrameLayoutGrid('f1', colGrid.id)
  assert.equal(node(store, 'f1').layoutGrids.length, 1)
  assert.equal(node(store, 'f1').layoutGrids[0].id, rowGrid.id)

  // Undo/redo restores layout grids
  store.undo()
  assert.equal(node(store, 'f1').layoutGrids.length, 2)
  store.redo()
  assert.equal(node(store, 'f1').layoutGrids.length, 1)
})
