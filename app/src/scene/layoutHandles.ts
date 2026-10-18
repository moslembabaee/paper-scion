import type { AutoLayout, FrameElement, LayoutPadding, SceneElement } from './types.ts'
import type { Point } from '../canvas/types.ts'
import { rotateVector } from './selectionGeometry.ts'

export type SpacingProperty = keyof LayoutPadding | 'gap'
export interface LayoutHandle {
  id: string
  property: SpacingProperty
  axis: 'x' | 'y'
  sign: 1 | -1
  x: number
  y: number
}

export interface GapBand {
  id: string
  property: 'gap'
  axis: 'x' | 'y'
  sign: 1 | -1
  x: number
  y: number
  width: number
  height: number
  value: number
}

export interface PaddingBand {
  id: 'top' | 'right' | 'bottom' | 'left'
  property: 'top' | 'right' | 'bottom' | 'left'
  axis: 'x' | 'y'
  sign: 1 | -1
  x: number
  y: number
  width: number
  height: number
  value: number
}

export function layoutPaddingBands(frame: FrameElement): PaddingBand[] {
  const layout = frame.layout
  if (!layout) return []
  const p = layout.padding
  const contentHeight = Math.max(0, frame.height - p.top - p.bottom)
  return [
    { id: 'top', property: 'top', axis: 'y', sign: 1, x: 0, y: 0, width: frame.width, height: p.top, value: p.top },
    { id: 'right', property: 'right', axis: 'x', sign: -1, x: frame.width - p.right, y: p.top, width: p.right, height: contentHeight, value: p.right },
    { id: 'bottom', property: 'bottom', axis: 'y', sign: -1, x: 0, y: frame.height - p.bottom, width: frame.width, height: p.bottom, value: p.bottom },
    { id: 'left', property: 'left', axis: 'x', sign: 1, x: 0, y: p.top, width: p.left, height: contentHeight, value: p.left },
  ]
}

export function layoutGapBands(frame: FrameElement, elements: Readonly<Record<string, SceneElement>>): GapBand[] {
  const layout = frame.layout
  if (!layout) return []
  const horizontal = layout.direction === 'horizontal'
  const main = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x'
  const mainSize = horizontal ? 'width' : 'height', crossSize = horizontal ? 'height' : 'width'
  const lines: SceneElement[][] = []
  const bands: GapBand[] = []

  for (const id of frame.children) {
    const child = elements[id]
    if (!child.visible || child.mask?.enabled) continue
    let line = lines[lines.length - 1]
    const previous = line?.[line.length - 1]
    if (!line || (layout.wrap && layout.wrap !== 'nowrap' && previous && child[main] < previous[main] + previous[mainSize] - 1e-6)) {
      line = []
      lines.push(line)
    }
    if (previous && line.length && bands.length < 84) {
      const start = previous[main] + previous[mainSize]
      const end = child[main]
      const span = Math.max(0, end - start)
      const crossStart = Math.min(previous[cross], child[cross])
      const crossEnd = Math.max(previous[cross] + previous[crossSize], child[cross] + child[crossSize])
      const crossSpan = Math.max(12, crossEnd - crossStart)

      bands.push({
        id: `gap-band-${id}`,
        property: 'gap',
        axis: main,
        sign: 1,
        x: horizontal ? start : crossStart,
        y: horizontal ? crossStart : start,
        width: horizontal ? span : crossSpan,
        height: horizontal ? crossSpan : span,
        value: layout.gap,
      })
    }
    line.push(child)
  }

  const reverse = layout.wrap === 'wrap-reverse'
  for (let i = 1; i < lines.length && bands.length < 84; i++) {
    const before = lines[i - 1], after = lines[i]
    const boundary = (line: SceneElement[], end: boolean) => end ? Math.max(...line.map(child => child[cross] + child[crossSize])) : Math.min(...line.map(child => child[cross]))
    const crossStart = reverse ? boundary(after, false) : boundary(before, true)
    const crossEnd = reverse ? boundary(before, true) : boundary(after, false)
    const span = Math.max(0, crossEnd - crossStart)

    const p = layout.padding
    const mainStart = horizontal ? p.left : p.top
    const mainSpan = Math.max(20, (horizontal ? frame.width - p.left - p.right : frame.height - p.top - p.bottom))

    bands.push({
      id: `line-gap-band-${i}`,
      property: 'gap',
      axis: cross,
      sign: reverse ? -1 : 1,
      x: horizontal ? mainStart : crossStart,
      y: horizontal ? crossStart : mainStart,
      width: horizontal ? mainSpan : span,
      height: horizontal ? span : mainSpan,
      value: layout.gap,
    })
  }

  return bands
}

export function layoutHandleCursor(axis: 'x' | 'y', rotation: number): string {
  const angle = rotation + (axis === 'y' ? 90 : 0)
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][((Math.round(angle / 45) % 4) + 4) % 4]
}

/** Local-space affordances, transformed with the selected frame by the overlay. */
export function layoutHandles(frame: FrameElement, elements: Readonly<Record<string, SceneElement>>): LayoutHandle[] {
  const layout = frame.layout
  if (!layout) return []
  const p = layout.padding
  const handles: LayoutHandle[] = [
    { id: 'top', property: 'top', axis: 'y', sign: 1, x: frame.width * .38, y: p.top },
    { id: 'right', property: 'right', axis: 'x', sign: -1, x: frame.width - p.right, y: frame.height * .38 },
    { id: 'bottom', property: 'bottom', axis: 'y', sign: -1, x: frame.width * .62, y: frame.height - p.bottom },
    { id: 'left', property: 'left', axis: 'x', sign: 1, x: p.left, y: frame.height * .62 },
  ]
  const horizontal = layout.direction === 'horizontal'
  const main = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x'
  const mainSize = horizontal ? 'width' : 'height', crossSize = horizontal ? 'height' : 'width'
  const lines: SceneElement[][] = []
  for (const id of frame.children) {
    const child = elements[id]
    if (!child.visible || child.mask?.enabled) continue
    let line = lines[lines.length - 1]
    const previous = line?.[line.length - 1]
    if (!line || (layout.wrap && layout.wrap !== 'nowrap' && previous && child[main] < previous[main] + previous[mainSize] - 1e-6)) {
      line = []
      lines.push(line)
    }
    if (previous && line.length && handles.length < 84) {
      const mainPosition = (previous[main] + previous[mainSize] + child[main]) / 2
      const crossPosition = (previous[cross] + previous[crossSize] / 2 + child[cross] + child[crossSize] / 2) / 2
      handles.push({ id: `gap-${id}`, property: 'gap', axis: main, sign: 1, x: horizontal ? mainPosition : crossPosition, y: horizontal ? crossPosition : mainPosition })
    }
    line.push(child)
  }
  const reverse = layout.wrap === 'wrap-reverse'
  for (let i = 1; i < lines.length && handles.length < 84; i++) {
    const before = lines[i - 1], after = lines[i]
    const boundary = (line: SceneElement[], end: boolean) => end ? Math.max(...line.map(child => child[cross] + child[crossSize])) : Math.min(...line.map(child => child[cross]))
    const crossPosition = (boundary(before, !reverse) + boundary(after, reverse)) / 2
    handles.push({ id: `line-gap-${i}`, property: 'gap', axis: cross, sign: reverse ? -1 : 1, x: horizontal ? frame.width / 2 : crossPosition, y: horizontal ? crossPosition : frame.height / 2 })
  }
  return handles
}

export function spacingValue(layout: AutoLayout, property: SpacingProperty): number {
  return property === 'gap' ? layout.gap : layout.padding[property]
}

export function adjustSpacing(layout: AutoLayout, property: SpacingProperty, value: number): AutoLayout {
  const next = Math.max(0, value)
  return property === 'gap' ? { ...layout, gap: next } : { ...layout, padding: { ...layout.padding, [property]: next } }
}

/** World deltas already account for zoom; project them onto the frame's axes.
 * When symmetric is true (e.g. Alt key held), opposite padding sides update together. */
export function dragSpacing(layout: AutoLayout, property: SpacingProperty, axis: 'x' | 'y', sign: number, rotation: number, delta: Point, coarse: boolean, symmetric = false): AutoLayout {
  const local = rotateVector(delta, -rotation)
  const value = spacingValue(layout, property) + local[axis] * sign
  const next = coarse ? Math.round(value / 8) * 8 : Math.round(value)
  if (symmetric && property !== 'gap') {
    const p = layout.padding
    const clamped = Math.max(0, next)
    if (property === 'top' || property === 'bottom') {
      return { ...layout, padding: { ...p, top: clamped, bottom: clamped } }
    }
    if (property === 'left' || property === 'right') {
      return { ...layout, padding: { ...p, left: clamped, right: clamped } }
    }
  }
  return adjustSpacing(layout, property, next)
}
