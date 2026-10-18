import { withElementGeometry } from './elements.ts'
import type { AutoLayout, ElementSizing, SceneElement, TextElement } from './types.ts'

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
