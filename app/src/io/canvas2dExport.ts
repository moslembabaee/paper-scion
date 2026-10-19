import { parsePath, type PathAnchor, type PathContour } from '../scene/pathGeometry.ts'
import { maskFillRule, maskPathData, type MaskElement } from '../scene/maskGeometry.ts'
import { evaluateVectorElement } from '../scene/booleanGeometry.ts'
import { exportBounds, exportRoots, type ExportOptions } from './svg.ts'
import type { PathElement, SceneSnapshot } from '../scene/types.ts'

export interface Canvas2DRenderOptions {
  readonly scale?: number
  readonly fill?: string
  readonly stroke?: string
  readonly strokeWidth?: number
  readonly fillRule?: CanvasFillRule
  readonly opacity?: number
}

/**
 * Traces an SVG path data string onto an active Canvas2D rendering context.
 * Supports cubic Bézier curves, straight lines, multiple sub-paths, and automatic closure.
 * Works seamlessly in both browser DOM and headless/mocked canvas environments.
 */
export function drawSvgPathToCanvas2D(ctx: CanvasRenderingContext2D, d: string): void {
  if (!d || !d.trim()) return

  // If modern browser Path2D is available and supported by context
  if (typeof Path2D !== 'undefined' && typeof ctx.fill === 'function') {
    try {
      const path2d = new Path2D(d)
      ctx.beginPath()
      // Path2D can be passed directly or used to stamp into active path
      const ctxWithPath = ctx as unknown as { addPath?: (p: Path2D) => void }
      if (typeof ctxWithPath.addPath === 'function') {
        ctxWithPath.addPath(path2d)
        return
      }
    } catch {
      // Fallback to manual contour parsing
    }
  }

  const contours: PathContour[] = parsePath(d)
  ctx.beginPath()

  for (const { anchors, closed } of contours) {
    if (!anchors.length) continue
    ctx.moveTo(anchors[0].x, anchors[0].y)

    const count = closed ? anchors.length : anchors.length - 1
    for (let i = 0; i < count; i++) {
      const a: PathAnchor = anchors[i]
      const b: PathAnchor = anchors[(i + 1) % anchors.length]
      const aOut = a.out ?? (a.curveMode === 'quadratic' && a.quadApex ? { x: a.x + (2 / 3) * (a.quadApex.x - a.x), y: a.y + (2 / 3) * (a.quadApex.y - a.y) } : undefined)
      const bIn = b.in ?? (a.curveMode === 'quadratic' && a.quadApex ? { x: b.x + (2 / 3) * (a.quadApex.x - b.x), y: b.y + (2 / 3) * (a.quadApex.y - b.y) } : undefined)

      if (!aOut && !bIn) {
        ctx.lineTo(b.x, b.y)
      } else {
        const cp1x = aOut ? aOut.x : a.x
        const cp1y = aOut ? aOut.y : a.y
        const cp2x = bIn ? bIn.x : b.x
        const cp2y = bIn ? bIn.y : b.y
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, b.x, b.y)
      }
    }

    if (closed) {
      ctx.closePath()
    }
  }
}

/**
 * Renders a non-destructive compound vector shape directly to a Canvas2D context.
 * Preserves compound transform, viewBox scaling, fillRule ('nonzero' | 'evenodd'), and styles.
 */
export function renderCompoundToCanvas2D(
  ctx: CanvasRenderingContext2D,
  element: PathElement,
  options: Canvas2DRenderOptions = {}
): void {
  ctx.save()

  const target = element.boolean ? evaluateVectorElement(element) as PathElement : element
  const opacity = (target.style.opacity ?? 1) * (options.opacity ?? 1)
  ctx.globalAlpha *= Math.max(0, Math.min(1, opacity))

  // Apply element position, size, and rotation
  ctx.translate(target.x + target.width / 2, target.y + target.height / 2)
  if (target.rotation) {
    ctx.rotate((target.rotation * Math.PI) / 180)
  }
  ctx.translate(-target.width / 2, -target.height / 2)

  // Map from local viewBox coordinates into element pixel dimensions
  const [vx, vy, vw, vh] = target.viewBox
  const sx = target.width / Math.max(0.001, vw)
  const sy = target.height / Math.max(0.001, vh)
  ctx.scale(sx, sy)
  ctx.translate(-vx, -vy)

  // Trace path
  drawSvgPathToCanvas2D(ctx, target.d)

  // Fill
  const fill = options.fill ?? target.style.fill
  const fillRule: CanvasFillRule = options.fillRule ?? (target.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
  if (fill && fill !== 'none') {
    ctx.fillStyle = fill
    ctx.fill(fillRule)
  }

  // Stroke
  const stroke = options.stroke ?? target.style.stroke?.color
  const strokeWidth = options.strokeWidth ?? target.style.stroke?.width ?? 0
  if (stroke && stroke !== 'none' && strokeWidth > 0) {
    ctx.strokeStyle = stroke
    // Account for inverse viewBox scale so stroke stays uniform
    ctx.lineWidth = strokeWidth / ((sx + sy) / 2)
    if (target.style.stroke?.dash && target.style.stroke.dash.length > 0) {
      ctx.setLineDash(target.style.stroke.dash.map(n => n / ((sx + sy) / 2)))
    }
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Clips the Canvas2D context with a compound shape vector mask.
 * Renders the child callback within the clipped region and cleanly restores context.
 */
export function renderCompoundMaskToCanvas2D(
  ctx: CanvasRenderingContext2D,
  mask: MaskElement,
  renderChildren: () => void,
  frameWidth?: number,
  frameHeight?: number
): void {
  ctx.save()

  const d = maskPathData(mask)
  const rule: CanvasFillRule = maskFillRule(mask) === 'evenodd' ? 'evenodd' : 'nonzero'
  const inverted = Boolean(mask.mask?.inverted)
  const mode = mask.mask?.mode ?? 'vector'

  if (mode === 'vector' || mode === 'luminance') {
    if (inverted && frameWidth && frameHeight) {
      ctx.beginPath()
      ctx.rect(0, 0, frameWidth, frameHeight)
      drawSvgPathToCanvas2D(ctx, d)
      ctx.clip('evenodd')
      renderChildren()
    } else {
      drawSvgPathToCanvas2D(ctx, d)
      ctx.clip(rule)
      renderChildren()
    }
  } else if (mode === 'alpha') {
    const opacity = Math.max(0, Math.min(1, mask.style.opacity ?? 1))
    ctx.globalAlpha *= opacity
    if (inverted && frameWidth && frameHeight) {
      ctx.beginPath()
      ctx.rect(0, 0, frameWidth, frameHeight)
      drawSvgPathToCanvas2D(ctx, d)
      ctx.clip('evenodd')
      renderChildren()
    } else {
      drawSvgPathToCanvas2D(ctx, d)
      ctx.clip(rule)
      renderChildren()
    }
  }

  ctx.restore()
}

/**
 * Direct Canvas2D scene export engine supporting non-destructive compound shapes,
 * compound shape masks, and deep element hierarchies.
 */
export function renderSceneToCanvas2D(
  canvas: HTMLCanvasElement,
  state: SceneSnapshot,
  options: ExportOptions
): void {
  const bounds = exportBounds(state, options.scope)
  if (!bounds) throw new Error('There are no visible layers to export.')

  const scale = options.scale ?? 1
  canvas.width = Math.ceil(bounds.width * scale)
  canvas.height = Math.ceil(bounds.height * scale)

  const ctx = canvas.getContext('2d', { colorSpace: options.colorSpace ?? 'srgb' })
  if (!ctx) throw new Error('Could not create Canvas2D rendering context.')

  ctx.scale(scale, scale)
  ctx.translate(-bounds.x, -bounds.y)

  // Background
  if (options.background === 'cream') {
    ctx.fillStyle = '#edebe1'
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
  }

  const renderNode = (id: string): void => {
    const node = state.elements[id]
    if (!node || !node.visible) return

    ctx.save()

    if (node.type === 'frame') {
      const mask = state.elements[id].type === 'frame'
        ? (node.children.map(cid => state.elements[cid]).find(c => c && c.mask?.enabled) as MaskElement | undefined)
        : undefined

      ctx.translate(node.x, node.y)
      if (node.rotation) {
        ctx.rotate((node.rotation * Math.PI) / 180)
      }

      if (node.style.fill) {
        ctx.fillStyle = node.style.fill
        ctx.beginPath()
        ctx.roundRect(0, 0, node.width, node.height, node.cornerRadius)
        ctx.fill()
      }

      const renderChildren = () => {
        for (const childId of node.children) {
          if (mask && childId === mask.id) continue
          renderNode(childId)
        }
      }

      if (mask) {
        renderCompoundMaskToCanvas2D(ctx, mask, renderChildren, node.width, node.height)
      } else {
        if (node.clipContent) {
          ctx.save()
          ctx.beginPath()
          ctx.roundRect(0, 0, node.width, node.height, node.cornerRadius)
          ctx.clip()
          renderChildren()
          ctx.restore()
        } else {
          renderChildren()
        }
      }

      if (node.style.stroke && node.style.stroke.width > 0) {
        ctx.strokeStyle = node.style.stroke.color
        ctx.lineWidth = node.style.stroke.width
        ctx.beginPath()
        ctx.roundRect(0, 0, node.width, node.height, node.cornerRadius)
        ctx.stroke()
      }
    } else if (node.type === 'path') {
      renderCompoundToCanvas2D(ctx, node)
    } else if (node.type === 'rectangle') {
      ctx.translate(node.x, node.y)
      if (node.rotation) ctx.rotate((node.rotation * Math.PI) / 180)
      if (node.style.fill) {
        ctx.fillStyle = node.style.fill
        ctx.beginPath()
        ctx.roundRect(0, 0, node.width, node.height, node.cornerRadius)
        ctx.fill()
      }
      if (node.style.stroke && node.style.stroke.width > 0) {
        ctx.strokeStyle = node.style.stroke.color
        ctx.lineWidth = node.style.stroke.width
        ctx.beginPath()
        ctx.roundRect(0, 0, node.width, node.height, node.cornerRadius)
        ctx.stroke()
      }
    } else if (node.type === 'ellipse') {
      ctx.translate(node.x + node.width / 2, node.y + node.height / 2)
      if (node.rotation) ctx.rotate((node.rotation * Math.PI) / 180)
      ctx.beginPath()
      ctx.ellipse(0, 0, node.width / 2, node.height / 2, 0, 0, Math.PI * 2)
      if (node.style.fill) {
        ctx.fillStyle = node.style.fill
        ctx.fill()
      }
      if (node.style.stroke && node.style.stroke.width > 0) {
        ctx.strokeStyle = node.style.stroke.color
        ctx.lineWidth = node.style.stroke.width
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  const roots = exportRoots(state, options.scope)
  for (const rootId of roots) {
    renderNode(rootId)
  }
}
