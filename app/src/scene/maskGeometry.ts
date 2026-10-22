import type { Point } from '../canvas/types.ts'
import { isVector, vectorContainsPoint, vectorPathData } from './booleanGeometry.ts'
import { getWorldMatrix } from './geometry.ts'
import type { FrameElement, GradientPaint, MaskClipMode, MaskElement, MaskHierarchyInfo, MaskHierarchyRole, SceneElement, SceneSnapshot, VectorElement } from './types.ts'
import { interpolateGradientColor } from '../shaders/gradient.ts'

export type { MaskElement, MaskHierarchyInfo, MaskHierarchyRole } from './types.ts'
export const canMask = (node: SceneElement): node is MaskElement => node.type === 'frame' || isVector(node)

export const isVectorMask = (node: MaskElement): boolean => !node.mask?.mode || node.mask.mode === 'vector'
export const isAlphaMask = (node: MaskElement): boolean => node.mask?.mode === 'alpha'
export const isLuminanceMask = (node: MaskElement): boolean => node.mask?.mode === 'luminance'
export const maskLuminanceThreshold = (node: MaskElement): number => node.mask?.luminanceThreshold ?? 0.5
export const isMaskInverted = (node: MaskElement): boolean => Boolean(node.mask?.inverted)
export const isMaskIsolated = (node: MaskElement): boolean => Boolean(node.mask?.isolated)

/** Calculate perceived luminance (0..1) from a CSS or hex color string */
export function hexOrColorToLuminance(color: string | null | undefined): number {
  if (!color || color === 'none' || color === 'transparent') return 0
  const trimmed = color.trim()
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1)
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255
      const g = parseInt(hex.slice(2, 4), 16) / 255
      const b = parseInt(hex.slice(4, 6), 16) / 255
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
  }
  const rgbMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10) / 255
    const g = parseInt(rgbMatch[2], 10) / 255
    const b = parseInt(rgbMatch[3], 10) / 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return 1
}

/** Sample normalized gradient luminance (0..1) at local coordinates (u, v) */
export function sampleGradientLuminance(gradient: GradientPaint, u: number, v: number): number {
  if (!gradient.stops || gradient.stops.length === 0) return 1
  let offset = 0
  if (gradient.type === 'linear') {
    const rad = (gradient.angle * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const du = u - 0.5
    const dv = v - 0.5
    offset = du * cos + dv * sin + 0.5
  } else if (gradient.type === 'radial') {
    const ox = gradient.origin?.x ?? 0.5
    const oy = gradient.origin?.y ?? 0.5
    const spread = Math.max(0.01, gradient.spread ?? 1)
    const dx = (u - ox) / spread
    const dy = (v - oy) / spread
    offset = Math.sqrt(dx * dx + dy * dy)
  } else {
    const ox = gradient.origin?.x ?? 0.5
    const oy = gradient.origin?.y ?? 0.5
    const angle = ((Math.atan2(v - oy, u - ox) * 180) / Math.PI - gradient.angle + 360) % 360
    offset = angle / 360
  }
  const clampedOffset = Math.max(0, Math.min(1, offset))
  const color = interpolateGradientColor(gradient.stops, clampedOffset)
  return hexOrColorToLuminance(color)
}

/** Sample normalized gradient alpha (0..1) at local coordinates (u, v) */
export function sampleGradientAlpha(gradient: GradientPaint, u: number, v: number): number {
  if (!gradient.stops || gradient.stops.length === 0) return 1
  let offset = 0
  if (gradient.type === 'linear') {
    const rad = (gradient.angle * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const du = u - 0.5
    const dv = v - 0.5
    offset = du * cos + dv * sin + 0.5
  } else if (gradient.type === 'radial') {
    const ox = gradient.origin?.x ?? 0.5
    const oy = gradient.origin?.y ?? 0.5
    const spread = Math.max(0.01, gradient.spread ?? 1)
    const dx = (u - ox) / spread
    const dy = (v - oy) / spread
    offset = Math.sqrt(dx * dx + dy * dy)
  } else {
    const ox = gradient.origin?.x ?? 0.5
    const oy = gradient.origin?.y ?? 0.5
    const angle = ((Math.atan2(v - oy, u - ox) * 180) / Math.PI - gradient.angle + 360) % 360
    offset = angle / 360
  }
  const clampedOffset = Math.max(0, Math.min(1, offset))
  const sorted = [...gradient.stops].sort((a, b) => a.offset - b.offset)
  if (clampedOffset <= sorted[0].offset) return sorted[0].opacity ?? 1
  if (clampedOffset >= sorted[sorted.length - 1].offset) return sorted[sorted.length - 1].opacity ?? 1
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (clampedOffset >= a.offset && clampedOffset <= b.offset) {
      const range = b.offset - a.offset
      const t = range > 0 ? (clampedOffset - a.offset) / range : 0
      const opA = a.opacity ?? 1
      const opB = b.opacity ?? 1
      return opA + (opB - opA) * t
    }
  }
  return 1
}

/** Check if world coordinate is within the effective visible region of a mask (accounting for vector, alpha, and luminance threshold modes) */
export function maskContainsWorldPoint(state: SceneSnapshot, mask: MaskElement, world: Point): boolean {
  const geomInside = shapeContainsWorldPoint(state, mask, world)
  const mode: MaskClipMode = mask.mask?.mode ?? 'vector'
  const inverted = Boolean(mask.mask?.inverted)

  if (mode === 'vector') {
    return inverted ? !geomInside : geomInside
  }

  const local = worldToLocal(state, mask.id, world)
  const u = mask.width > 0 ? Math.max(0, Math.min(1, local.x / mask.width)) : 0.5
  const v = mask.height > 0 ? Math.max(0, Math.min(1, local.y / mask.height)) : 0.5

  if (mode === 'alpha') {
    if (!geomInside) return inverted
    let alpha = (mask.style.opacity ?? 1) * (mask.style.fill === 'none' ? 0 : 1)
    if (mask.style.gradient && mask.style.gradient.stops?.length) {
      alpha *= sampleGradientAlpha(mask.style.gradient, u, v)
    }
    const hasAlpha = alpha > 0.01
    return inverted ? !hasAlpha : hasAlpha
  }

  if (mode === 'luminance') {
    if (!geomInside) return inverted
    let lum = hexOrColorToLuminance(mask.style.fill)
    if (mask.style.gradient && mask.style.gradient.stops?.length) {
      lum = sampleGradientLuminance(mask.style.gradient, u, v)
    }
    lum *= (mask.style.opacity ?? 1)
    const threshold = mask.mask?.luminanceThreshold ?? 0.5
    const passes = lum >= threshold
    return inverted ? !passes : passes
  }

  return inverted ? !geomInside : geomInside
}

/** A role lives on the source itself, so cloning/components need no ID remapping. */
export function frameMask(elements: Readonly<Record<string, SceneElement>>, frame: FrameElement): MaskElement | undefined {
  return frame.children.map(id => elements[id]).find((node): node is MaskElement => !!node?.mask?.enabled && node.visible && canMask(node))
}

const frameVectors = new WeakMap<FrameElement, VectorElement>()
function maskVector(node: MaskElement): VectorElement {
  if (node.type !== 'frame') return node
  let vector = frameVectors.get(node)
  if (!vector) {
    vector = { ...node, type: 'rectangle', style: { ...node.style, stroke: null } }
    frameVectors.set(node, vector)
  }
  return vector
}

const outlines = new WeakMap<MaskElement, string>()
export function maskPathData(node: MaskElement): string {
  let d = outlines.get(node)
  if (d === undefined) { d = vectorPathData(maskVector(node)); outlines.set(node, d) }
  return d
}
export const maskFillRule = (node: MaskElement) => node.type === 'path' ? node.fillRule : 'nonzero'

export const isCompoundMask = (node: MaskElement): boolean => node.type === 'path' && !!node.boolean

export function worldToLocal(state: SceneSnapshot, id: string, world: Point): Point {
  const [a, b, c, d, e, f] = getWorldMatrix(state, id)
  const det = a * d - b * c, dx = world.x - e, dy = world.y - f
  return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det }
}

export function shapeContainsWorldPoint(state: SceneSnapshot, node: SceneElement, world: Point): boolean {
  if (canMask(node)) {
    const parentPoint = node.parentId === null ? world : worldToLocal(state, node.parentId, world)
    return vectorContainsPoint(maskVector(node), parentPoint)
  }
  const p = worldToLocal(state, node.id, world)
  return p.x >= 0 && p.y >= 0 && p.x <= node.width && p.y <= node.height
}

export function validateMaskGraph(elements: Readonly<Record<string, SceneElement>>): void {
  for (const node of Object.values(elements)) {
    if (node.type === 'frame' && node.children.filter(id => elements[id]?.mask).length > 1) throw new Error('A frame can have only one mask source')
  }
}

/** Find the mask source that directly clips an element within its parent frame */
export function getDirectMask(elements: Readonly<Record<string, SceneElement>>, id: string): MaskElement | undefined {
  const node = elements[id]
  if (!node || node.parentId === null) return undefined
  const parent = elements[node.parentId]
  if (!parent || parent.type !== 'frame') return undefined
  const mask = frameMask(elements, parent)
  if (!mask || mask.id === id) return undefined
  return mask
}

/** Find all children in a frame that are clipped by the given mask source */
export function getMaskedChildren(elements: Readonly<Record<string, SceneElement>>, maskId: string): SceneElement[] {
  const mask = elements[maskId]
  if (!mask || mask.parentId === null) return []
  const parent = elements[mask.parentId]
  if (!parent || parent.type !== 'frame') return []
  const activeMask = frameMask(elements, parent)
  if (activeMask?.id !== maskId) return []
  return parent.children
    .filter(childId => childId !== maskId)
    .map(childId => elements[childId])
    .filter((el): el is SceneElement => Boolean(el))
}

/** Cycle through mask clip modes: vector -> alpha -> luminance -> vector */
export function cycleNextMaskMode(mode?: MaskClipMode): MaskClipMode {
  if (mode === 'alpha') return 'luminance'
  if (mode === 'luminance') return 'vector'
  return 'alpha'
}

/**
 * Mask hierarchy reports are pure functions of the element map, but callers
 * subscribe to them through `useSyncExternalStore`, which compares snapshots by
 * reference. A freshly built report object would read as a store change on
 * every render and drive React into an endless update loop (error #185), so
 * each element map keeps one report per node.
 */
const hierarchyCache = new WeakMap<Readonly<Record<string, SceneElement>>, Map<string, MaskHierarchyInfo>>()

/** Get complete mask hierarchy inspection information for any scene node */
export function getMaskHierarchy(elements: Readonly<Record<string, SceneElement>>, id: string): MaskHierarchyInfo {
  let reports = hierarchyCache.get(elements)
  if (!reports) {
    reports = new Map()
    hierarchyCache.set(elements, reports)
  }
  const cached = reports.get(id)
  if (cached) return cached
  const report = computeMaskHierarchy(elements, id)
  reports.set(id, report)
  return report
}

function computeMaskHierarchy(elements: Readonly<Record<string, SceneElement>>, id: string): MaskHierarchyInfo {
  const node = elements[id]
  const isMask = Boolean(node?.mask)
  const isMaskGroup = node?.type === 'frame' && Boolean(frameMask(elements, node as FrameElement))
  const directMask = getDirectMask(elements, id)
  const isMasked = Boolean(directMask)

  let role: MaskHierarchyRole = 'none'
  if (isMask) role = 'mask-source'
  else if (isMaskGroup) role = 'mask-group'
  else if (isMasked) role = 'masked-content'

  const maskSource = isMask ? (node as MaskElement) : isMaskGroup ? frameMask(elements, node as FrameElement) : directMask
  const parentFrame = isMaskGroup ? (node as FrameElement) : node?.parentId ? (elements[node.parentId] as FrameElement) : undefined
  const maskedElements = maskSource ? getMaskedChildren(elements, maskSource.id) : undefined

  const mode: MaskClipMode = maskSource?.mask?.mode ?? 'vector'
  const luminanceThreshold = maskSource?.mask?.luminanceThreshold ?? 0.5
  const inverted = Boolean(maskSource?.mask?.inverted)
  const isolated = Boolean(maskSource?.mask?.isolated)
  const enabled = maskSource?.mask?.enabled ?? false

  return {
    role,
    isMask,
    isMasked,
    isMaskGroup,
    maskSource,
    maskedElements,
    parentFrame,
    mode,
    luminanceThreshold,
    inverted,
    isolated,
    enabled,
  }
}
