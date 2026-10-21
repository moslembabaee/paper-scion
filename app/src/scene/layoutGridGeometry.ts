import type { Bounds } from '../canvas/types.ts'
import type { FrameElement, FrameLayoutGrid, LayoutGridType } from './types.ts'

export interface ColumnInterval {
  readonly index: number
  readonly x: number
  readonly width: number
}

export interface RowInterval {
  readonly index: number
  readonly y: number
  readonly height: number
}

export function computeColumnIntervals(
  frameWidth: number,
  grid: FrameLayoutGrid,
): readonly ColumnInterval[] {
  const count = Math.max(1, Math.floor(grid.count ?? 12))
  const gutter = Math.max(0, grid.gutter ?? 20)
  const margin = Math.max(0, grid.margin ?? 0)
  const alignment = grid.alignment ?? 'stretch'

  const intervals: ColumnInterval[] = []

  if (alignment === 'stretch') {
    const totalGutter = (count - 1) * gutter
    const available = Math.max(1, frameWidth - margin * 2 - totalGutter)
    const colWidth = available / count

    for (let i = 0; i < count; i++) {
      intervals.push({
        index: i + 1,
        x: margin + i * (colWidth + gutter),
        width: colWidth,
      })
    }
  } else if (alignment === 'left') {
    const colWidth = Math.max(1, grid.size ?? 60)
    for (let i = 0; i < count; i++) {
      intervals.push({
        index: i + 1,
        x: margin + i * (colWidth + gutter),
        width: colWidth,
      })
    }
  } else if (alignment === 'right') {
    const colWidth = Math.max(1, grid.size ?? 60)
    const total = count * colWidth + (count - 1) * gutter
    const startX = frameWidth - margin - total
    for (let i = 0; i < count; i++) {
      intervals.push({
        index: i + 1,
        x: startX + i * (colWidth + gutter),
        width: colWidth,
      })
    }
  } else if (alignment === 'center') {
    const colWidth = Math.max(1, grid.size ?? 60)
    const total = count * colWidth + (count - 1) * gutter
    const startX = (frameWidth - total) * 0.5
    for (let i = 0; i < count; i++) {
      intervals.push({
        index: i + 1,
        x: startX + i * (colWidth + gutter),
        width: colWidth,
      })
    }
  }

  return intervals
}

export function computeRowIntervals(
  frameHeight: number,
  grid: FrameLayoutGrid,
): readonly RowInterval[] {
  const count = Math.max(1, Math.floor(grid.count ?? 8))
  const gutter = Math.max(0, grid.gutter ?? 20)
  const margin = Math.max(0, grid.margin ?? 0)
  const alignment = grid.alignment ?? 'stretch'

  const intervals: RowInterval[] = []

  if (alignment === 'stretch') {
    const totalGutter = (count - 1) * gutter
    const available = Math.max(1, frameHeight - margin * 2 - totalGutter)
    const rowHeight = available / count

    for (let i = 0; i < count; i++) {
      intervals.push({
        index: i + 1,
        y: margin + i * (rowHeight + gutter),
        height: rowHeight,
      })
    }
  } else if (alignment === 'top') {
    const rowHeight = Math.max(1, grid.size ?? 60)
    for (let i = 0; i < count; i++) {
      intervals.push({
        index: i + 1,
        y: margin + i * (rowHeight + gutter),
        height: rowHeight,
      })
    }
  } else if (alignment === 'bottom') {
    const rowHeight = Math.max(1, grid.size ?? 60)
    const total = count * rowHeight + (count - 1) * gutter
    const startY = frameHeight - margin - total
    for (let i = 0; i < count; i++) {
      intervals.push({
        index: i + 1,
        y: startY + i * (rowHeight + gutter),
        height: rowHeight,
      })
    }
  } else if (alignment === 'center') {
    const rowHeight = Math.max(1, grid.size ?? 60)
    const total = count * rowHeight + (count - 1) * gutter
    const startY = (frameHeight - total) * 0.5
    for (let i = 0; i < count; i++) {
      intervals.push({
        index: i + 1,
        y: startY + i * (rowHeight + gutter),
        height: rowHeight,
      })
    }
  }

  return intervals
}

export function createDefaultLayoutGrid(type: LayoutGridType): FrameLayoutGrid {
  const id = crypto.randomUUID()
  if (type === 'columns') {
    return {
      id,
      type: 'columns',
      visible: true,
      color: 'rgba(129, 173, 236, 0.12)',
      count: 12,
      gutter: 20,
      margin: 32,
      alignment: 'stretch',
    }
  }
  if (type === 'rows') {
    return {
      id,
      type: 'rows',
      visible: true,
      color: 'rgba(129, 173, 236, 0.12)',
      count: 8,
      gutter: 20,
      margin: 24,
      alignment: 'stretch',
    }
  }
  return {
    id,
    type: 'grid',
    visible: true,
    color: 'rgba(129, 173, 236, 0.15)',
    sectionSize: 120, // High-craft Paper 120px grid
  }
}

/**
 * Returns world-space bounding boxes for active layout grid columns and rows
 * to enable real-time snap targeting during element moves and resizes.
 */
export function getLayoutGridSnapTargets(
  frame: FrameElement,
  frameWorldBounds: Bounds,
): Bounds[] {
  if (!frame.layoutGrids || frame.layoutGrids.length === 0) return []

  const targets: Bounds[] = []

  for (const grid of frame.layoutGrids) {
    if (!grid.visible) continue

    if (grid.type === 'columns') {
      const cols = computeColumnIntervals(frame.width, grid)
      for (const col of cols) {
        targets.push({
          x: frameWorldBounds.x + col.x,
          y: frameWorldBounds.y,
          width: col.width,
          height: frameWorldBounds.height,
        })
      }
    } else if (grid.type === 'rows') {
      const rows = computeRowIntervals(frame.height, grid)
      for (const row of rows) {
        targets.push({
          x: frameWorldBounds.x,
          y: frameWorldBounds.y + row.y,
          width: frameWorldBounds.width,
          height: row.height,
        })
      }
    } else if (grid.type === 'grid') {
      const size = Math.max(8, grid.sectionSize ?? 120)
      const numCols = Math.min(200, Math.floor(frame.width / size))
      const numRows = Math.min(200, Math.floor(frame.height / size))
      for (let c = 0; c < numCols; c++) {
        targets.push({
          x: frameWorldBounds.x + c * size,
          y: frameWorldBounds.y,
          width: size,
          height: frameWorldBounds.height,
        })
      }
      for (let r = 0; r < numRows; r++) {
        targets.push({
          x: frameWorldBounds.x,
          y: frameWorldBounds.y + r * size,
          width: frameWorldBounds.width,
          height: size,
        })
      }
    }
  }

  return targets
}
