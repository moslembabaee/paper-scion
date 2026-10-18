import type { Bounds, Point, Size } from './types.ts'

export interface RadarLayout {
  scale: number
  x: number
  y: number
  width: number
  height: number
}

export type ViewportHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface ViewportHandle {
  id: ViewportHandleId
  x: number
  y: number
  cursor: string
}

/**
 * Computes the scaling factor and translation offset to fit world content and visible
 * bounds neatly inside the minimap radar display canvas.
 */
export function computeRadarLayout(
  bounds: Bounds,
  canvasWidth: number,
  canvasHeight: number,
  inset = 14
): RadarLayout {
  const safeWidth = Math.max(1, bounds.width)
  const safeHeight = Math.max(1, bounds.height)
  const availableWidth = Math.max(10, canvasWidth - inset * 2)
  const availableHeight = Math.max(10, canvasHeight - inset * 2)

  const scale = Math.min(availableWidth / safeWidth, availableHeight / safeHeight)
  const x = (canvasWidth - bounds.width * scale) / 2 - bounds.x * scale
  const y = (canvasHeight - bounds.height * scale) / 2 - bounds.y * scale

  return { scale, x, y, width: canvasWidth, height: canvasHeight }
}

/**
 * Projects a world coordinate point into minimap canvas pixel coordinates.
 */
export function worldToMinimap(point: Point, layout: RadarLayout): Point {
  return {
    x: point.x * layout.scale + layout.x,
    y: point.y * layout.scale + layout.y,
  }
}

/**
 * Inverse projects a minimap canvas coordinate back into world space.
 */
export function minimapToWorld(point: Point, layout: RadarLayout): Point {
  const safeScale = layout.scale === 0 ? 1 : layout.scale
  return {
    x: (point.x - layout.x) / safeScale,
    y: (point.y - layout.y) / safeScale,
  }
}

/**
 * Projects a world bounding box into minimap canvas space.
 */
export function worldBoundsToMinimap(bounds: Bounds, layout: RadarLayout): Bounds {
  return {
    x: bounds.x * layout.scale + layout.x,
    y: bounds.y * layout.scale + layout.y,
    width: bounds.width * layout.scale,
    height: bounds.height * layout.scale,
  }
}

/**
 * Inverse projects a minimap bounding box into world space.
 */
export function minimapBoundsToWorld(bounds: Bounds, layout: RadarLayout): Bounds {
  const safeScale = layout.scale === 0 ? 1 : layout.scale
  return {
    x: (bounds.x - layout.x) / safeScale,
    y: (bounds.y - layout.y) / safeScale,
    width: bounds.width / safeScale,
    height: bounds.height / safeScale,
  }
}

/**
 * Returns the 8 resize handle coordinates for the viewport bounding rectangle in minimap space.
 */
export function getViewportHandles(rect: Bounds): readonly ViewportHandle[] {
  const midX = rect.x + rect.width / 2
  const midY = rect.y + rect.height / 2
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height

  return [
    { id: 'nw', x: rect.x, y: rect.y, cursor: 'nwse-resize' },
    { id: 'n', x: midX, y: rect.y, cursor: 'ns-resize' },
    { id: 'ne', x: right, y: rect.y, cursor: 'nesw-resize' },
    { id: 'e', x: right, y: midY, cursor: 'ew-resize' },
    { id: 'se', x: right, y: bottom, cursor: 'nwse-resize' },
    { id: 's', x: midX, y: bottom, cursor: 'ns-resize' },
    { id: 'sw', x: rect.x, y: bottom, cursor: 'nesw-resize' },
    { id: 'w', x: rect.x, y: midY, cursor: 'ew-resize' },
  ]
}

/**
 * Tests if a point hits any of the 8 viewport resize handles within a given pixel tolerance.
 */
export function hitTestHandle(
  point: Point,
  handles: readonly ViewportHandle[],
  threshold = 8
): ViewportHandle | null {
  for (const handle of handles) {
    const dist = Math.hypot(point.x - handle.x, point.y - handle.y)
    if (dist <= threshold) {
      return handle
    }
  }
  return null
}

/**
 * Tests if a point is within a bounding box.
 */
export function hitTestRect(point: Point, rect: Bounds): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/**
 * Calculates new visible bounds in world space when dragging a viewport resize handle on the minimap.
 * Dragging a handle outward expands the visible area (zooming OUT).
 * Dragging a handle inward contracts the visible area (zooming IN).
 */
export function calculateNewViewportFromHandleDrag(
  handleId: ViewportHandleId,
  currentMinimapPoint: Point,
  initialVisibleBounds: Bounds,
  layout: RadarLayout,
  viewportSize: Size
): Bounds {
  const currentWorld = minimapToWorld(currentMinimapPoint, layout)
  const minWorldSpan = 40
  const aspect = viewportSize.width > 0 && viewportSize.height > 0
    ? viewportSize.width / viewportSize.height
    : 16 / 9

  const initRight = initialVisibleBounds.x + initialVisibleBounds.width
  const initBottom = initialVisibleBounds.y + initialVisibleBounds.height

  switch (handleId) {
    case 'se': {
      const anchorX = initialVisibleBounds.x
      const anchorY = initialVisibleBounds.y
      const targetX = Math.max(anchorX + minWorldSpan, currentWorld.x)
      const targetY = Math.max(anchorY + minWorldSpan, currentWorld.y)
      return {
        x: anchorX,
        y: anchorY,
        width: targetX - anchorX,
        height: targetY - anchorY,
      }
    }
    case 'nw': {
      const targetX = Math.min(initRight - minWorldSpan, currentWorld.x)
      const targetY = Math.min(initBottom - minWorldSpan, currentWorld.y)
      return {
        x: targetX,
        y: targetY,
        width: initRight - targetX,
        height: initBottom - targetY,
      }
    }
    case 'ne': {
      const anchorX = initialVisibleBounds.x
      const targetX = Math.max(anchorX + minWorldSpan, currentWorld.x)
      const targetY = Math.min(initBottom - minWorldSpan, currentWorld.y)
      return {
        x: anchorX,
        y: targetY,
        width: targetX - anchorX,
        height: initBottom - targetY,
      }
    }
    case 'sw': {
      const targetX = Math.min(initRight - minWorldSpan, currentWorld.x)
      const targetY = Math.max(initialVisibleBounds.y + minWorldSpan, currentWorld.y)
      return {
        x: targetX,
        y: initialVisibleBounds.y,
        width: initRight - targetX,
        height: targetY - initialVisibleBounds.y,
      }
    }
    case 'e': {
      const newWidth = Math.max(minWorldSpan, currentWorld.x - initialVisibleBounds.x)
      const newHeight = newWidth / aspect
      const centerY = initialVisibleBounds.y + initialVisibleBounds.height / 2
      return {
        x: initialVisibleBounds.x,
        y: centerY - newHeight / 2,
        width: newWidth,
        height: newHeight,
      }
    }
    case 'w': {
      const newWidth = Math.max(minWorldSpan, initRight - currentWorld.x)
      const newHeight = newWidth / aspect
      const centerY = initialVisibleBounds.y + initialVisibleBounds.height / 2
      return {
        x: initRight - newWidth,
        y: centerY - newHeight / 2,
        width: newWidth,
        height: newHeight,
      }
    }
    case 's': {
      const newHeight = Math.max(minWorldSpan, currentWorld.y - initialVisibleBounds.y)
      const newWidth = newHeight * aspect
      const centerX = initialVisibleBounds.x + initialVisibleBounds.width / 2
      return {
        x: centerX - newWidth / 2,
        y: initialVisibleBounds.y,
        width: newWidth,
        height: newHeight,
      }
    }
    case 'n': {
      const newHeight = Math.max(minWorldSpan, initBottom - currentWorld.y)
      const newWidth = newHeight * aspect
      const centerX = initialVisibleBounds.x + initialVisibleBounds.width / 2
      return {
        x: centerX - newWidth / 2,
        y: initBottom - newHeight,
        width: newWidth,
        height: newHeight,
      }
    }
  }
}

/**
 * Returns world coordinates for 120px engineering grid lines mapped onto the minimap,
 * sub-sampled if there are too many lines to avoid visual noise.
 */
export function getRadarGridLines(
  layout: RadarLayout,
  bounds: Bounds,
  gridStep = 120
): { vertical: number[]; horizontal: number[] } {
  // Determine stride so we don't draw more than ~30 lines in either axis
  const maxLines = 30
  let step = gridStep
  while ((bounds.width / step) > maxLines || (bounds.height / step) > maxLines) {
    step *= 2
  }

  const vertical: number[] = []
  const horizontal: number[] = []

  const startX = Math.floor(bounds.x / step) * step
  const endX = bounds.x + bounds.width
  for (let wx = startX; wx <= endX; wx += step) {
    const mx = wx * layout.scale + layout.x
    if (mx >= 0 && mx <= layout.width) {
      vertical.push(mx)
    }
  }

  const startY = Math.floor(bounds.y / step) * step
  const endY = bounds.y + bounds.height
  for (let wy = startY; wy <= endY; wy += step) {
    const my = wy * layout.scale + layout.y
    if (my >= 0 && my <= layout.height) {
      horizontal.push(my)
    }
  }

  return { vertical, horizontal }
}
