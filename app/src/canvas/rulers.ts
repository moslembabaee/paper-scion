import { GRID_SIZE } from './math.ts'
import type { ViewportSnapshot } from './types.ts'
import { getThemePalette } from '../design-system/theme.ts'

export const RULER_SIZE = 20 // px, ruler thickness (width of left ruler / height of top ruler)

// Label spacing: only show labels when ticks are at least this many px apart.
const MIN_LABEL_GAP = 48

/** Pick a world-unit step that keeps screen-space tick spacing >= minPx. */
function pickStep(zoom: number, minPx: number): number {
  const base = GRID_SIZE
  const candidates = [
    base / 5, base / 4, base / 2, base,
    base * 2, base * 4, base * 5, base * 10, base * 20, base * 50,
  ]
  for (const c of candidates) {
    if (c * zoom >= minPx) return c
  }
  return candidates[candidates.length - 1]
}

function setCanvasSize(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const pw = Math.round(width * ratio)
  const ph = Math.round(height * ratio)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  return ctx
}

/** Horizontal ruler along the top edge. canvas is sized to (viewportWidth, RULER_SIZE). */
export function drawHorizontalRuler(canvas: HTMLCanvasElement, snapshot: ViewportSnapshot): void {
  const palette = getThemePalette()
  const { camera, size } = snapshot
  const w = size.width
  const h = RULER_SIZE
  const ctx = setCanvasSize(canvas, w, h)
  if (!ctx) return

  // Background + bottom border
  ctx.fillStyle = palette.surface
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = palette.border
  ctx.fillRect(0, h - 1, w, 1)

  const step = pickStep(camera.zoom, 12)
  const screenStep = step * camera.zoom
  // Origin of world-0 in screen space
  const originX = camera.x

  // First tick world value at or before visible left edge
  const worldLeft = -originX / camera.zoom
  const firstTick = Math.ceil(worldLeft / step) * step

  ctx.strokeStyle = palette['ruler-tick']
  ctx.lineWidth = 1
  ctx.font = `9px "Inter", "Matter", ui-sans-serif, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = palette['ruler-label']

  const showLabel = screenStep >= MIN_LABEL_GAP

  for (let world = firstTick; ; world += step) {
    const sx = originX + world * camera.zoom
    if (sx > w + screenStep) break

    const px = Math.round(sx) + 0.5

    // Major tick: full height; minor ticks would be drawn here if needed
    ctx.beginPath()
    ctx.moveTo(px, h - 6)
    ctx.lineTo(px, h)
    ctx.strokeStyle = palette['ruler-tick']
    ctx.stroke()

    if (showLabel) {
      const label = String(Math.round(world))
      ctx.fillStyle = palette['ruler-label']
      ctx.fillText(label, px + 2, h / 2 - 1)
    }
  }

  // World-axis marker (x=0 vertical line)
  if (originX >= 0 && originX <= w) {
    const px = Math.round(originX) + 0.5
    ctx.strokeStyle = palette['accent-text']
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, h)
    ctx.stroke()
  }
}

/** Vertical ruler along the left edge. canvas is sized to (RULER_SIZE, viewportHeight). */
export function drawVerticalRuler(canvas: HTMLCanvasElement, snapshot: ViewportSnapshot): void {
  const palette = getThemePalette()
  const { camera, size } = snapshot
  const w = RULER_SIZE
  const h = size.height
  const ctx = setCanvasSize(canvas, w, h)
  if (!ctx) return

  // Background + right border
  ctx.fillStyle = palette.surface
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = palette.border
  ctx.fillRect(w - 1, 0, 1, h)

  const step = pickStep(camera.zoom, 12)
  const screenStep = step * camera.zoom
  const originY = camera.y

  const worldTop = -originY / camera.zoom
  const firstTick = Math.ceil(worldTop / step) * step

  ctx.strokeStyle = palette['ruler-tick']
  ctx.lineWidth = 1
  const showLabel = screenStep >= MIN_LABEL_GAP

  for (let world = firstTick; ; world += step) {
    const sy = originY + world * camera.zoom
    if (sy > h + screenStep) break

    const py = Math.round(sy) + 0.5

    ctx.beginPath()
    ctx.moveTo(w - 6, py)
    ctx.lineTo(w, py)
    ctx.strokeStyle = palette['ruler-tick']
    ctx.stroke()

    if (showLabel) {
      // Draw label rotated -90° so it reads bottom-to-top
      ctx.save()
      ctx.translate(w / 2 - 1, py - 2)
      ctx.rotate(-Math.PI / 2)
      ctx.font = `9px "Inter", "Matter", ui-sans-serif, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = palette['ruler-label']
      ctx.fillText(String(Math.round(world)), 0, 0)
      ctx.restore()
    }
  }

  // World-axis marker (y=0 horizontal line)
  if (originY >= 0 && originY <= h) {
    const py = Math.round(originY) + 0.5
    ctx.strokeStyle = palette['accent-text']
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, py)
    ctx.lineTo(w, py)
    ctx.stroke()
  }
}
