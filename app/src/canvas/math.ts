import type { Bounds, Camera, Point, Size, ViewportMatrix } from './types.ts'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 32
export const GRID_SIZE = 120
export const SUBGRID_SIZE = 24

export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : 1
}

export function worldToScreen(point: Point, camera: Camera): Point {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y }
}

export function screenToWorld(point: Point, camera: Camera): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom }
}

export function cameraMatrix(camera: Camera): ViewportMatrix {
  return [camera.zoom, 0, 0, camera.zoom, camera.x, camera.y]
}

export function inverseCameraMatrix(camera: Camera): ViewportMatrix {
  return [1 / camera.zoom, 0, 0, 1 / camera.zoom, -camera.x / camera.zoom, -camera.y / camera.zoom]
}

export function transformPoint(point: Point, matrix: ViewportMatrix): Point {
  const [a, b, c, d, e, f] = matrix
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
}

/** Keep the world point beneath the anchor fixed, including at zoom limits. */
export function zoomAt(camera: Camera, zoom: number, anchor: Point): Camera {
  const world = screenToWorld(anchor, camera)
  const nextZoom = clampZoom(zoom)
  return { x: anchor.x - world.x * nextZoom, y: anchor.y - world.y * nextZoom, zoom: nextZoom }
}

export function visibleBounds(camera: Camera, size: Size): Bounds {
  return { ...screenToWorld({ x: 0, y: 0 }, camera), width: size.width / camera.zoom, height: size.height / camera.zoom }
}

export function fitBounds(bounds: Bounds, size: Size, padding = 80): Camera {
  const availableWidth = Math.max(1, size.width - padding * 2)
  const availableHeight = Math.max(1, size.height - padding * 2)
  const zoom = clampZoom(Math.min(availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height)))
  return {
    x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  }
}

export function unionBounds(bounds: readonly Bounds[]): Bounds {
  if (bounds.length === 0) return { x: -600, y: -400, width: 1200, height: 800 }
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const item of bounds) {
    left = Math.min(left, item.x)
    top = Math.min(top, item.y)
    right = Math.max(right, item.x + item.width)
    bottom = Math.max(bottom, item.y + item.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}
