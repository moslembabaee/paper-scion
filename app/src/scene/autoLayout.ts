import { withElementGeometry } from './elements.ts'
import type { AutoLayout, ElementSizing, FrameElement, SceneElement, SceneSnapshot, TextElement } from './types.ts'
import type { Bounds, Point } from '../canvas/types.ts'
import { getWorldMatrix } from './geometry.ts'
import type { SceneStore } from './store.ts'

export const FIXED_SIZING: ElementSizing = Object.freeze({ width: 'fixed', height: 'fixed' })
export const DEFAULT_AUTO_LAYOUT: AutoLayout = Object.freeze({
  direction: 'horizontal', wrap: 'nowrap', alignContent: 'start', gap: 16,
  padding: Object.freeze({ top: 24, right: 24, bottom: 24, left: 24 }),
  justify: 'start', align: 'start',
})
// Scene geometry must remain positive (including empty frames and exhausted fill space).
const MIN_SIZE = .01
const size = (value: number) => {
  if (!Number.isFinite(value)) throw new Error('Invalid auto layout dimensions')
  return Math.max(MIN_SIZE, value)
}
interface LayoutBox { width: number; height: number; children: readonly PlacedBox[] }
interface PlacedBox { id: string; x: number; y: number; box: LayoutBox }
type Axis = 'width' | 'height'

function bounded(node: SceneElement, axis: Axis, value: number): number {
  const min = (axis === 'width' ? node.sizing?.minWidth : node.sizing?.minHeight) ?? MIN_SIZE
  const max = (axis === 'width' ? node.sizing?.maxWidth : node.sizing?.maxHeight) ?? Infinity
  return Math.min(max, Math.max(min, size(value)))
}

/** Resolve zero-basis flex shares, freezing only the bounds that cause the net
 * violation. This lets capped siblings release space and preserves minima when
 * the frame is too small. Normalize weights to keep large finite values safe. */
function distributeFill(nodes: readonly SceneElement[], axis: Axis, available: number): Map<string, number> {
  const result = new Map<string, number>()
  let active = [...nodes]
  let remaining = available
  while (active.length) {
    const maxWeight = active.reduce((max, node) => Math.max(max, node.sizing?.flexGrow ?? 1), 0)
    const total = active.reduce((sum, node) => sum + (node.sizing?.flexGrow ?? 1) / maxWeight, 0)
    const proposals = active.map(node => {
      const share = Math.max(0, remaining) * ((node.sizing?.flexGrow ?? 1) / maxWeight / total)
      const value = bounded(node, axis, share)
      return { node, value, violation: value - share }
    })
    const violation = proposals.reduce((sum, proposal) => sum + proposal.violation, 0)
    const frozen = proposals.filter(proposal => violation > 0 ? proposal.violation > 0 : violation < 0 ? proposal.violation < 0 : true)
    for (const { node, value } of frozen) { result.set(node.id, value); remaining -= value }
    active = active.filter(node => !result.has(node.id))
  }
  return result
}

let context: CanvasRenderingContext2D | null | undefined
const textCache = new Map<string, number>()
export function invalidateLayoutTextMetrics(): void { textCache.clear() }
function textWidth(text: string, node: TextElement): number {
  const font = `${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`
  const key = JSON.stringify([font, node.letterSpacing, text])
  const cached = textCache.get(key)
  if (cached !== undefined) return cached
  if (context === undefined) context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (context) context.font = font
  // Headless integrations can lay out documents without a DOM. Browser measurements
  // replace this estimate when the document opens in the editor.
  const advance = context ? context.measureText(text).width : Array.from(text).length * node.fontSize * .6
  const result = Math.max(0, advance + Array.from(text).length * node.letterSpacing)
  if (textCache.size > 4096) textCache.clear()
  textCache.set(key, result)
  return result
}

function textHeight(node: TextElement, width: number): number {
  let lines = 0
  for (const paragraph of node.text.split('\n')) {
    if (textWidth(paragraph, node) <= width) { lines++; continue }
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (line && textWidth(line + word, node) > width && !/^\s+$/.test(word)) { lines++; line = '' }
      if (textWidth(word, node) > width) {
        for (const char of word) {
          if (line && textWidth(line + char, node) > width) { lines++; line = '' }
          line += char
        }
      } else line += word
    }
    lines++
  }
  return size(lines * node.fontSize * node.lineHeight)
}

/** Resolve intrinsic sizes before distributing available space. Fixed children never
 * shrink; fill siblings share the remainder by flex weight within their bounds.
 * A fill child inside a hug axis uses its intrinsic size, breaking the otherwise
 * circular dependency. Hidden layers
 * retain geometry and do not occupy space. Rotation does not affect the layout box.
 * No DOM layout reads, iterative convergence, or extra history commands are needed.
 */
export function reflowAutoLayout(input: Readonly<Record<string, SceneElement>>, roots: readonly string[]): Readonly<Record<string, SceneElement>> {
  if (!Object.values(input).some(node => node.sizing || (node.type === 'frame' && node.layout))) return input
  const memo = new Map<string, Map<string, LayoutBox>>()
  const measure = (id: string, assignedWidth?: number, assignedHeight?: number): LayoutBox => {
    const node = input[id], sizing = node.sizing ?? FIXED_SIZING
    const key = `${assignedWidth ?? ''}:${assignedHeight ?? ''}`
    let entries = memo.get(id)
    const cached = entries?.get(key)
    if (cached) return cached
    if (!entries) { entries = new Map(); memo.set(id, entries) }
    let width = bounded(node, 'width', assignedWidth ?? node.width), height = bounded(node, 'height', assignedHeight ?? node.height)
    let placed: PlacedBox[] = []
    if (node.type === 'text') {
      if (assignedWidth === undefined && sizing.width === 'hug') width = bounded(node, 'width', Math.max(0, ...node.text.split('\n').map(line => textWidth(line, node))))
      if (assignedHeight === undefined && sizing.height === 'hug') height = bounded(node, 'height', textHeight(node, width))
    } else if (node.type === 'frame') {
      const children = node.children.filter(child => input[child].visible && !(node.layout && input[child].mask?.enabled))
      const natural = children.map(child => measure(child))
      const layout = node.layout
      if (!layout) {
        if (assignedWidth === undefined && sizing.width === 'hug') width = size(Math.max(0, ...children.map((child, i) => input[child].x + natural[i].width)))
        if (assignedHeight === undefined && sizing.height === 'hug') height = size(Math.max(0, ...children.map((child, i) => input[child].y + natural[i].height)))
        placed = children.map((child, i) => ({ id: child, x: input[child].x, y: input[child].y, box: natural[i] }))
      } else {
        const horizontal = layout.direction === 'horizontal'
        if (layout.wrap && layout.wrap !== 'nowrap') {
          // Flex lines are formed from fixed/hug bases; fill has a zero basis and
          // receives a bounded, weighted share within its own line.
          const main = horizontal ? 'width' : 'height'
          const cross = horizontal ? 'height' : 'width'
          const p = layout.padding
          const mainStart = horizontal ? p.left : p.top
          const mainPadding = horizontal ? p.left + p.right : p.top + p.bottom
          const crossStart = horizontal ? p.top : p.left
          const crossPadding = horizontal ? p.top + p.bottom : p.left + p.right
          const hugMain = sizing[main] === 'hug' && (horizontal ? assignedWidth : assignedHeight) === undefined
          const hugCross = sizing[cross] === 'hug' && (horizontal ? assignedHeight : assignedWidth) === undefined
          let mainSize = horizontal ? width : height
          if (hugMain) mainSize = bounded(node, main, mainPadding + natural.reduce((sum, box) => sum + box[main], 0) + Math.max(0, children.length - 1) * layout.gap)
          const innerMain = Math.max(0, mainSize - mainPadding)
          const lines: { indices: number[]; boxes: LayoutBox[]; crossSize: number }[] = []
          let used = 0
          for (let i = 0; i < children.length; i++) {
            const basis = !hugMain && input[children[i]].sizing?.[main] === 'fill' ? bounded(input[children[i]], main, 0) : natural[i][main]
            let line = lines[lines.length - 1]
            if (!line || (used + layout.gap + basis > innerMain + 1e-6)) {
              line = { indices: [], boxes: [], crossSize: 0 }
              lines.push(line)
              used = 0
            }
            used += (line.indices.length ? layout.gap : 0) + basis
            line.indices.push(i)
          }
          for (const line of lines) {
            const fills = new Set(line.indices.filter(i => input[children[i]].sizing?.[main] === 'fill' && !hugMain))
            const fixed = line.indices.reduce((sum, i) => sum + (fills.has(i) ? 0 : natural[i][main]), 0)
            const fillSizes = distributeFill([...fills].map(i => input[children[i]]), main, innerMain - fixed - Math.max(0, line.indices.length - 1) * layout.gap)
            line.boxes = line.indices.map(i => {
              const assigned = fillSizes.get(children[i]) ?? natural[i][main]
              return horizontal ? measure(children[i], assigned) : measure(children[i], undefined, assigned)
            })
            // A cross-axis fill is stretched after line measurement. Reusing its
            // previous stretched size here would prevent responsive shrinking.
            line.crossSize = Math.max(MIN_SIZE, ...line.boxes.map((box, j) => !hugCross && input[children[line.indices[j]]].sizing?.[cross] === 'fill' ? bounded(input[children[line.indices[j]]], cross, 0) : box[cross]))
          }
          const crossUsed = lines.reduce((sum, line) => sum + line.crossSize, 0) + Math.max(0, lines.length - 1) * layout.gap
          const crossSize = hugCross ? bounded(node, cross, crossUsed + crossPadding) : horizontal ? height : width
          const innerCross = Math.max(0, crossSize - crossPadding)
          const spareCross = Math.max(0, innerCross - crossUsed)
          const packing = layout.alignContent ?? 'start'
          const lineGap = layout.gap + (packing === 'space-between' && lines.length > 1 ? spareCross / (lines.length - 1) : 0)
          let crossCursor = packing === 'center' ? spareCross / 2 : packing === 'end' ? spareCross : 0
          for (const line of lines) {
            if (packing === 'stretch' && lines.length) line.crossSize += spareCross / lines.length
            const reverse = layout.wrap === 'wrap-reverse'
            const lineStart = crossStart + (reverse ? innerCross - crossCursor - line.crossSize : crossCursor)
            const boxes = line.boxes.map((box, j) => {
              const child = children[line.indices[j]]
              if (input[child].sizing?.[cross] !== 'fill' || hugCross) return box
              return horizontal ? measure(child, box.width, size(line.crossSize)) : measure(child, size(line.crossSize), box.height)
            })
            const remaining = Math.max(0, innerMain - boxes.reduce((sum, box) => sum + box[main], 0) - Math.max(0, boxes.length - 1) * layout.gap)
            let cursor = mainStart + (layout.justify === 'center' ? remaining / 2 : layout.justify === 'end' ? remaining : 0)
            const gap = layout.gap + (layout.justify === 'space-between' && boxes.length > 1 ? remaining / (boxes.length - 1) : 0)
            boxes.forEach((box, j) => {
              const spare = Math.max(0, line.crossSize - box[cross])
              const offset = layout.align === 'center' ? spare / 2 : layout.align === 'end' ? spare : 0
              const crossPosition = lineStart + (reverse ? spare - offset : offset)
              placed.push({ id: children[line.indices[j]], x: horizontal ? cursor : crossPosition, y: horizontal ? crossPosition : cursor, box })
              cursor += box[main] + gap
            })
            crossCursor += line.crossSize + lineGap
          }
          width = horizontal ? mainSize : crossSize
          height = horizontal ? crossSize : mainSize
        } else {
          const p = layout.padding, gaps = Math.max(0, children.length - 1) * layout.gap
          const hugWidth = sizing.width === 'hug' && assignedWidth === undefined
          const hugHeight = sizing.height === 'hug' && assignedHeight === undefined
          if (hugWidth) width = bounded(node, 'width', p.left + p.right + (horizontal ? natural.reduce((sum, box) => sum + box.width, 0) + gaps : Math.max(0, ...natural.map(box => box.width))))
          const innerWidth = Math.max(0, width - p.left - p.right)
          const fillWidths = children.filter(child => input[child].sizing?.width === 'fill').map(child => input[child])
          const fixedWidths = natural.reduce((sum, box, i) => sum + (input[children[i]].sizing?.width === 'fill' ? 0 : box.width), 0)
          const fillWidth = horizontal && !hugWidth ? distributeFill(fillWidths, 'width', innerWidth - fixedWidths - gaps) : new Map<string, number>()
          // Resolve width first so wrapped text contributes its actual height to a hug frame.
          const widths = children.map((child, i) => input[child].sizing?.width === 'fill' && !hugWidth ? horizontal ? fillWidth.get(child)! : bounded(input[child], 'width', innerWidth) : natural[i].width)
          const constrained = children.map((child, i) => measure(child, widths[i]))
          if (hugHeight) height = bounded(node, 'height', p.top + p.bottom + (horizontal ? Math.max(0, ...constrained.map(box => box.height)) : constrained.reduce((sum, box) => sum + box.height, 0) + gaps))
          const innerHeight = Math.max(0, height - p.top - p.bottom)
          const fillHeights = children.filter(child => input[child].sizing?.height === 'fill').map(child => input[child])
          const fixedHeights = constrained.reduce((sum, box, i) => sum + (input[children[i]].sizing?.height === 'fill' ? 0 : box.height), 0)
          const fillHeight = !horizontal && !hugHeight ? distributeFill(fillHeights, 'height', innerHeight - fixedHeights - gaps) : new Map<string, number>()
          const boxes = children.map((child, i) => input[child].sizing?.height === 'fill' && !hugHeight ? measure(child, widths[i], horizontal ? bounded(input[child], 'height', innerHeight) : fillHeight.get(child)!) : constrained[i])
          const mainSpace = horizontal ? innerWidth : innerHeight
          const used = boxes.reduce((sum, box) => sum + (horizontal ? box.width : box.height), 0) + gaps
          const remaining = Math.max(0, mainSpace - used)
          let cursor = (horizontal ? p.left : p.top) + (layout.justify === 'center' ? remaining / 2 : layout.justify === 'end' ? remaining : 0)
          const gap = layout.gap + (layout.justify === 'space-between' && children.length > 1 ? remaining / (children.length - 1) : 0)
          placed = children.map((child, i) => {
            const box = boxes[i]
            const crossSpace = Math.max(0, (horizontal ? innerHeight - box.height : innerWidth - box.width))
            const cross = (horizontal ? p.top : p.left) + (layout.align === 'center' ? crossSpace / 2 : layout.align === 'end' ? crossSpace : 0)
            const result = { id: child, x: horizontal ? cursor : cross, y: horizontal ? cross : cursor, box }
            cursor += (horizontal ? box.width : box.height) + gap
            return result
          })
        }
      }
    }
    if (node.type === 'frame' && node.layout) {
      for (const id of node.children) {
        const child = input[id]
        if (child.visible && child.mask?.enabled) placed.push({ id, x: child.x, y: child.y, box: measure(id) })
      }
    }
    const result = { width: bounded(node, 'width', width), height: bounded(node, 'height', height), children: placed }
    entries.set(key, result)
    return result
  }
  let output = input
  const apply = (id: string, box: LayoutBox, x = input[id].x, y = input[id].y) => {
    const node = input[id]
    if (![x, y, box.width, box.height].every(Number.isFinite)) throw new Error('Invalid auto layout dimensions')
    if (node.x !== x || node.y !== y || node.width !== box.width || node.height !== box.height) {
      if (output === input) output = { ...input }
      ;(output as Record<string, SceneElement>)[id] = withElementGeometry(node, { x, y, width: box.width, height: box.height })
    }
    for (const child of box.children) apply(child.id, child.box, child.x, child.y)
  }
  for (const id of roots) apply(id, measure(id))
  return output
}

export interface AutoLayoutDropIndicator {
  readonly frameId: string
  readonly insertIndex: number
  readonly axis: 'horizontal' | 'vertical'
  readonly local: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly world: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
    readonly rotation: number
  }
}

/**
 * Calculates the target child insertion index within an auto-layout frame given
 * a local coordinate point (e.g. from pointer or dragged item center).
 * Excludes the dragged child so its current slot does not perturb the ordering.
 */
export function calculateAutoLayoutReorderIndex(
  frame: FrameElement,
  elements: Readonly<Record<string, SceneElement>>,
  draggedId: string,
  localPosition: Point,
): number {
  if (!frame.layout) return 0
  const layout = frame.layout

  const siblings = frame.children
    .filter(id => id !== draggedId)
    .map(id => elements[id])
    .filter((child): child is SceneElement => !!child && child.visible && !child.mask?.enabled)

  if (siblings.length === 0) return 0

  const horizontal = layout.direction === 'horizontal'

  // Wrapped flex layout handling
  if (layout.wrap && layout.wrap !== 'nowrap') {
    const main = horizontal ? 'x' : 'y'
    const cross = horizontal ? 'y' : 'x'
    const mainSize = horizontal ? 'width' : 'height'
    const crossSize = horizontal ? 'height' : 'width'

    const lines: SceneElement[][] = []
    for (const child of siblings) {
      let line = lines[lines.length - 1]
      const prev = line?.[line.length - 1]
      if (!line || (prev && child[main] < prev[main] + prev[mainSize] - 1e-6)) {
        line = []
        lines.push(line)
      }
      line.push(child)
    }

    if (lines.length === 0) return 0

    // Find closest line by cross axis coordinate
    let closestLineIndex = 0
    let minCrossDist = Infinity
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]
      const lineCrossStart = Math.min(...line.map(c => c[cross]))
      const lineCrossEnd = Math.max(...line.map(c => c[cross] + c[crossSize]))
      const lineCrossCenter = (lineCrossStart + lineCrossEnd) / 2
      const dist = Math.abs(localPosition[cross] - lineCrossCenter)
      if (dist < minCrossDist) {
        minCrossDist = dist
        closestLineIndex = li
      }
    }

    const targetLine = lines[closestLineIndex]
    let slotInLine = 0
    if (localPosition[main] < targetLine[0][main] + targetLine[0][mainSize] / 2) {
      slotInLine = 0
    } else if (localPosition[main] >= targetLine[targetLine.length - 1][main] + targetLine[targetLine.length - 1][mainSize] / 2) {
      slotInLine = targetLine.length
    } else {
      for (let i = 0; i < targetLine.length - 1; i++) {
        const c1 = targetLine[i][main] + targetLine[i][mainSize] / 2
        const c2 = targetLine[i + 1][main] + targetLine[i + 1][mainSize] / 2
        if (localPosition[main] >= c1 && localPosition[main] < c2) {
          slotInLine = i + 1
          break
        }
      }
    }

    const precedingCount = lines.slice(0, closestLineIndex).reduce((sum, l) => sum + l.length, 0)
    return precedingCount + slotInLine
  }

  // Standard nowrap auto-layout
  const main = horizontal ? 'x' : 'y'
  const sizeAttr = horizontal ? 'width' : 'height'

  if (localPosition[main] < siblings[0][main] + siblings[0][sizeAttr] / 2) {
    return 0
  }
  if (localPosition[main] >= siblings[siblings.length - 1][main] + siblings[siblings.length - 1][sizeAttr] / 2) {
    return siblings.length
  }

  for (let i = 0; i < siblings.length - 1; i++) {
    const c1 = siblings[i][main] + siblings[i][sizeAttr] / 2
    const c2 = siblings[i + 1][main] + siblings[i + 1][sizeAttr] / 2
    if (localPosition[main] >= c1 && localPosition[main] < c2) {
      return i + 1
    }
  }

  return siblings.length
}

/**
 * Computes the insertion indicator bar for an auto-layout frame at a given insertion index.
 */
export function getAutoLayoutDropIndicator(
  frame: FrameElement,
  elements: Readonly<Record<string, SceneElement>>,
  insertIndex: number,
  state?: Pick<SceneSnapshot, 'elements'>,
): AutoLayoutDropIndicator | null {
  const layout = frame.layout
  if (!layout) return null

  const horizontal = layout.direction === 'horizontal'
  const p = layout.padding
  const visibleChildren = frame.children
    .map(id => elements[id])
    .filter((child): child is SceneElement => !!child && child.visible && !child.mask?.enabled)

  let localX = 0
  let localY = 0
  let localWidth = 0
  let localHeight = 0
  const axis: 'horizontal' | 'vertical' = horizontal ? 'vertical' : 'horizontal'

  if (horizontal) {
    localWidth = 2
    if (visibleChildren.length === 0) {
      localX = p.left
      localY = p.top
      localHeight = Math.max(16, frame.height - p.top - p.bottom)
    } else if (insertIndex <= 0) {
      const c0 = visibleChildren[0]
      localX = Math.max(p.left, c0.x - (layout.gap > 0 ? layout.gap / 2 : 4))
      localY = c0.y
      localHeight = Math.max(16, c0.height)
    } else if (insertIndex >= visibleChildren.length) {
      const clast = visibleChildren[visibleChildren.length - 1]
      localX = Math.min(frame.width - p.right, clast.x + clast.width + (layout.gap > 0 ? layout.gap / 2 : 2))
      localY = clast.y
      localHeight = Math.max(16, clast.height)
    } else {
      const prev = visibleChildren[insertIndex - 1]
      const next = visibleChildren[insertIndex]
      // In wrapped layouts, next could be on a lower line
      if (layout.wrap && layout.wrap !== 'nowrap' && next.y > prev.y + prev.height * 0.5) {
        localX = Math.max(p.left, next.x - (layout.gap > 0 ? layout.gap / 2 : 4))
        localY = next.y
        localHeight = Math.max(16, next.height)
      } else {
        localX = (prev.x + prev.width + next.x) / 2 - 1
        localY = Math.min(prev.y, next.y)
        localHeight = Math.max(16, prev.height, next.height)
      }
    }
  } else {
    localHeight = 2
    if (visibleChildren.length === 0) {
      localX = p.left
      localY = p.top
      localWidth = Math.max(16, frame.width - p.left - p.right)
    } else if (insertIndex <= 0) {
      const c0 = visibleChildren[0]
      localX = c0.x
      localY = Math.max(p.top, c0.y - (layout.gap > 0 ? layout.gap / 2 : 4))
      localWidth = Math.max(16, c0.width)
    } else if (insertIndex >= visibleChildren.length) {
      const clast = visibleChildren[visibleChildren.length - 1]
      localX = clast.x
      localY = Math.min(frame.height - p.bottom, clast.y + clast.height + (layout.gap > 0 ? layout.gap / 2 : 2))
      localWidth = Math.max(16, clast.width)
    } else {
      const prev = visibleChildren[insertIndex - 1]
      const next = visibleChildren[insertIndex]
      if (layout.wrap && layout.wrap !== 'nowrap' && next.x > prev.x + prev.width * 0.5) {
        localX = next.x
        localY = Math.max(p.top, next.y - (layout.gap > 0 ? layout.gap / 2 : 4))
        localWidth = Math.max(16, next.width)
      } else {
        localX = Math.min(prev.x, next.x)
        localY = (prev.y + prev.height + next.y) / 2 - 1
        localWidth = Math.max(16, prev.width, next.width)
      }
    }
  }

  let worldX = frame.x + localX
  let worldY = frame.y + localY
  let rotation = frame.rotation ?? 0

  if (state) {
    try {
      const [a, b, c, d, e, f] = getWorldMatrix(state, frame.id)
      worldX = a * localX + c * localY + e
      worldY = b * localX + d * localY + f
      rotation = Math.atan2(b, a) * 180 / Math.PI
    } catch {
      // Fallback to local coordinates if node lookup fails
    }
  }

  return {
    frameId: frame.id,
    insertIndex,
    axis,
    local: { x: localX, y: localY, width: localWidth, height: localHeight },
    world: { x: worldX, y: worldY, width: localWidth, height: localHeight, rotation },
  }
}

/**
 * Discovers the deepest auto-layout frame under a world point and calculates
 * the corresponding insertion index and drop indicator affordance.
 */
export function findAutoLayoutDropTarget(
  state: SceneSnapshot,
  worldPoint: Point,
  excludeIds: readonly string[] = [],
): { frameId: string; insertIndex: number; indicator: AutoLayoutDropIndicator } | null {
  const excludeSet = new Set(excludeIds)
  for (const id of excludeIds) {
    const node = state.elements[id]
    if (node?.type === 'frame') {
      const collect = (frameNode: FrameElement) => {
        for (const childId of frameNode.children) {
          excludeSet.add(childId)
          const child = state.elements[childId]
          if (child?.type === 'frame') collect(child)
        }
      }
      collect(node)
    }
  }

  const candidateFrames: { frame: FrameElement; depth: number; localPoint: Point }[] = []

  for (const node of Object.values(state.elements)) {
    if (node.type !== 'frame' || !node.layout || !node.visible || node.locked || excludeSet.has(node.id)) {
      continue
    }

    const [a, b, c, d, e, f] = getWorldMatrix(state, node.id)
    const det = a * d - b * c
    if (Math.abs(det) < 1e-9) continue
    const dx = worldPoint.x - e, dy = worldPoint.y - f
    const localX = (d * dx - c * dy) / det
    const localY = (-b * dx + a * dy) / det

    const margin = 10
    if (localX >= -margin && localX <= node.width + margin && localY >= -margin && localY <= node.height + margin) {
      let depth = 0
      let cur = node.parentId
      while (cur !== null) {
        depth++
        cur = state.elements[cur]?.parentId ?? null
      }
      candidateFrames.push({
        frame: node,
        depth,
        localPoint: { x: Math.max(0, Math.min(node.width, localX)), y: Math.max(0, Math.min(node.height, localY)) },
      })
    }
  }

  if (candidateFrames.length === 0) return null

  // Sort deepest first, then smallest area
  candidateFrames.sort((a, b) => {
    if (b.depth !== a.depth) return b.depth - a.depth
    return (a.frame.width * a.frame.height) - (b.frame.width * b.frame.height)
  })

  const { frame, localPoint } = candidateFrames[0]
  const draggedId = excludeIds[0] ?? ''
  const insertIndex = calculateAutoLayoutReorderIndex(frame, state.elements, draggedId, localPoint)
  const indicator = getAutoLayoutDropIndicator(frame, state.elements, insertIndex, state)
  if (!indicator) return null

  return {
    frameId: frame.id,
    insertIndex,
    indicator,
  }
}

/**
 * Reorders a child element within an auto-layout frame.
 * Emits store updates and triggers real-time reflow and bounding box recalculation.
 */
export function reorderAutoLayoutChild(
  store: SceneStore,
  frameId: string,
  childId: string,
  targetIndex: number,
): boolean {
  const state = store.getSnapshot()
  const frame = state.elements[frameId]
  if (!frame || frame.type !== 'frame' || !frame.layout) return false
  const child = state.elements[childId]
  if (!child || child.parentId !== frameId) return false
  if (store.isLocked(childId) || store.isLocked(frameId)) return false

  const currentIndex = frame.children.indexOf(childId)
  if (currentIndex === -1 || currentIndex === targetIndex) return false

  store.reorder(childId, targetIndex)
  return true
}

/**
 * Reparents an element into an auto-layout frame at a given insertion slot.
 */
export function reparentToAutoLayout(
  store: SceneStore,
  elementId: string,
  targetFrameId: string,
  targetIndex: number,
): boolean {
  const state = store.getSnapshot()
  const targetFrame = state.elements[targetFrameId]
  if (!targetFrame || targetFrame.type !== 'frame' || !targetFrame.layout) return false
  const node = state.elements[elementId]
  if (!node || node.parentId === targetFrameId) return false
  if (store.isLocked(elementId) || store.isLocked(targetFrameId)) return false

  let ancestor: string | null = targetFrameId
  while (ancestor !== null) {
    if (ancestor === elementId) return false
    ancestor = state.elements[ancestor]?.parentId ?? null
  }

  store.reparent(elementId, targetFrameId, targetIndex)
  return true
}

/**
 * Non-destructive simulation helper: computes the reflowed scene elements and the frame's
 * updated bounding box when a child is reordered or reparented to targetIndex, without mutating store.
 */
export function computeSimulatedAutoLayout(
  elements: Readonly<Record<string, SceneElement>>,
  rootIds: readonly string[],
  frameId: string,
  childId: string,
  targetIndex: number,
): { elements: Readonly<Record<string, SceneElement>>; frameBounds: Bounds } {
  const frame = elements[frameId]
  if (!frame || frame.type !== 'frame') throw new Error(`Element ${frameId} is not a frame`)
  const child = elements[childId]
  if (!child) throw new Error(`Element ${childId} not found`)

  const nextElements = { ...elements }

  if (child.parentId === frameId) {
    const remaining = frame.children.filter(id => id !== childId)
    const clampedIndex = Math.max(0, Math.min(targetIndex, remaining.length))
    remaining.splice(clampedIndex, 0, childId)
    nextElements[frameId] = { ...frame, children: remaining }
  } else {
    if (child.parentId && nextElements[child.parentId]?.type === 'frame') {
      const oldParent = nextElements[child.parentId] as FrameElement
      nextElements[child.parentId] = {
        ...oldParent,
        children: oldParent.children.filter(id => id !== childId),
      }
    }
    const children = [...frame.children]
    const clampedIndex = Math.max(0, Math.min(targetIndex, children.length))
    children.splice(clampedIndex, 0, childId)
    nextElements[frameId] = { ...frame, children }
    nextElements[childId] = { ...child, parentId: frameId }
  }

  const reflowed = reflowAutoLayout(nextElements, rootIds)
  const updatedFrame = reflowed[frameId]
  return {
    elements: reflowed,
    frameBounds: {
      x: updatedFrame.x,
      y: updatedFrame.y,
      width: updatedFrame.width,
      height: updatedFrame.height,
    },
  }
}

