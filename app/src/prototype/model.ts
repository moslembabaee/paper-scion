import type { SceneDocument, SceneElement, SceneSnapshot } from '../scene/types.ts'
import { getWorldBounds } from '../scene/geometry.ts'
import type { BezierCurve, Easing, PrototypeDocument, PrototypeInteraction, PrototypeTransition } from './types.ts'
import { DEFAULT_SPRING, springCSS, springDuration, springProgress, validateSpring } from './spring.ts'

export const TRIGGERS = { click: 'On Click', hover: 'On Hover', drag: 'Drag', delay: 'After Delay' } as const
export const ACTIONS = { navigate: 'Navigate to', overlay: 'Open Overlay', scroll: 'Scroll to' } as const
export const TRANSITIONS = { instant: 'Instant', dissolve: 'Dissolve', smart: 'Smart Animate', slide: 'Slide', 'slide-in': 'Slide In', 'slide-out': 'Slide Out', push: 'Push' } as const
export const EASINGS = { linear: 'Linear', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in & out', custom: 'Custom curve', spring: 'Spring · Physics' } as const
export const CURVES: Readonly<Record<Exclude<Easing, 'custom' | 'spring'>, BezierCurve>> = {
  linear: [0, 0, 1, 1], 'ease-in': [.42, 0, 1, 1], 'ease-out': [0, 0, .16, 1], 'ease-in-out': [.65, 0, .35, 1],
}
export const EMPTY_PROTOTYPE: PrototypeDocument = Object.freeze({ startFrameId: null, device: 'none', interactions: Object.freeze([]) })
export const DEFAULT_TRANSITION: PrototypeTransition = Object.freeze({ kind: 'dissolve', duration: 300, easing: 'ease-out', curve: Object.freeze([.16, 1, .3, 1]) as BezierCurve, direction: 'left' })

export function frameFor(elements: SceneDocument['elements'], id: string): string | null {
  let node: SceneElement | undefined = elements[id], frame: string | null = null
  while (node) { if (node.type === 'frame') frame = node.id; node = node.parentId ? elements[node.parentId] : undefined }
  return frame
}

export function isDescendant(elements: SceneDocument['elements'], id: string, ancestor: string): boolean {
  let node: SceneElement | undefined = elements[id]
  while (node) { if (node.id === ancestor) return true; node = node.parentId ? elements[node.parentId] : undefined }
  return false
}

export function isVisible(elements: SceneDocument['elements'], id: string): boolean {
  let node: SceneElement | undefined = elements[id]
  if (!node) return false
  while (node) { if (!node.visible) return false; node = node.parentId ? elements[node.parentId] : undefined }
  return true
}

export function validConnection(elements: SceneDocument['elements'], interaction: PrototypeInteraction): boolean {
  const source = elements[interaction.sourceId], target = elements[interaction.targetId]
  return !!source && !!target && !!frameFor(elements, source.id) && (interaction.action === 'scroll'
    ? isDescendant(elements, target.id, frameFor(elements, source.id)!)
    : target.type === 'frame')
}

/** Strict, atomic validation for file imports and store edits. */
export function validatePrototype(value: PrototypeDocument | undefined, elements: SceneDocument['elements']): PrototypeDocument {
  if (value === undefined) return EMPTY_PROTOTYPE
  if (!value || !Array.isArray(value.interactions) || value.interactions.length > 10000 || !['none', 'phone', 'tablet', 'desktop'].includes(value.device)) throw new Error('Invalid prototype settings')
  if (value.startFrameId !== null && (typeof value.startFrameId !== 'string' || elements[value.startFrameId]?.type !== 'frame')) throw new Error('Invalid prototype starting frame')
  const ids = new Set<string>()
  const interactions = value.interactions.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.sourceId !== 'string' || typeof item.targetId !== 'string' || !Object.hasOwn(TRIGGERS, item.trigger) || !Object.hasOwn(ACTIONS, item.action) || !Number.isFinite(item.delay) || item.delay < 0 || item.delay > 60000 || !validConnection(elements, item)) throw new Error('Invalid prototype interaction')
    const t = item.transition
    if (!t || !Object.hasOwn(TRANSITIONS, t.kind) || !Object.hasOwn(EASINGS, t.easing) || !['left', 'right', 'up', 'down'].includes(t.direction) || !Number.isFinite(t.duration) || t.duration < 0 || t.duration > 10000 || !Array.isArray(t.curve) || t.curve.length !== 4 || !t.curve.every(Number.isFinite) || t.curve[0] < 0 || t.curve[0] > 1 || t.curve[2] < 0 || t.curve[2] > 1 || Math.abs(t.curve[1]) > 5 || Math.abs(t.curve[3]) > 5) throw new Error('Invalid prototype transition')
    ids.add(item.id)
    const spring = t.spring === undefined ? (t.easing === 'spring' ? DEFAULT_SPRING : undefined) : validateSpring(t.spring)
    return Object.freeze({ id: item.id, sourceId: item.sourceId, targetId: item.targetId, trigger: item.trigger, action: item.action, delay: item.delay, transition: Object.freeze({ kind: t.kind, duration: t.duration, easing: t.easing, direction: t.direction, curve: Object.freeze([...t.curve]) as BezierCurve, ...(spring ? { spring } : {}) }) })
  })
  return Object.freeze({ startFrameId: value.startFrameId, device: value.device, interactions: Object.freeze(interactions) })
}

/** Removing/reparenting layers cleans dangling wires in the same history command. */
export function prunePrototype(value: PrototypeDocument, elements: SceneDocument['elements']): PrototypeDocument {
  const interactions = value.interactions.filter(item => validConnection(elements, item))
  const startFrameId = value.startFrameId && elements[value.startFrameId]?.type === 'frame' ? value.startFrameId : null
  return interactions.length === value.interactions.length && startFrameId === value.startFrameId ? value : Object.freeze({ ...value, startFrameId, interactions: Object.freeze(interactions) })
}

export function easingCurve(t: PrototypeTransition): BezierCurve { return t.easing === 'custom' ? t.curve : t.easing === 'spring' ? CURVES['ease-out'] : CURVES[t.easing] }
export function transitionDuration(t: PrototypeTransition): number { return t.kind === 'instant' ? 0 : t.easing === 'spring' ? springDuration(t.spring) : t.duration }
export function easingCSS(t: PrototypeTransition, duration = transitionDuration(t)): string { return t.easing === 'spring' ? springCSS(t.spring, duration) : `cubic-bezier(${easingCurve(t).join(',')})` }
export function transitionProgress(progress: number, t: PrototypeTransition, duration = transitionDuration(t)): number { return t.easing === 'spring' ? springProgress(progress, t.spring, duration) : easeProgress(progress, easingCurve(t)) }

/** Measure scrollable content in the presented frame's coordinates, respecting nested clips. */
export function presentationExtent(state: SceneSnapshot, frameId: string): { width: number; height: number } {
  const node = state.elements[frameId]
  if (!node) return { width: 0, height: 0 }
  const localState = { ...state, elements: { ...state.elements, [frameId]: { ...node, x: 0, y: 0, rotation: 0, parentId: null } } }
  let width = node.width, height = node.height
  const visit = (id: string) => {
    const child = state.elements[id]
    if (!child?.visible) return
    const bounds = getWorldBounds(localState, id)
    width = Math.max(width, bounds.x + bounds.width)
    height = Math.max(height, bounds.y + bounds.height)
    if (child.type === 'frame' && (id === frameId || !child.clipContent)) child.children.forEach(visit)
  }
  visit(frameId)
  return { width, height }
}

/** Solve x before evaluating y, for scroll animation with the same timing as WAAPI. */
export function easeProgress(progress: number, curve: BezierCurve): number {
  if (progress <= 0 || progress >= 1) return progress
  const sample = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3
  let low = 0, high = 1
  for (let i = 0; i < 18; i++) { const t = (low + high) / 2; if (sample(t, curve[0], curve[2]) < progress) low = t; else high = t }
  return sample((low + high) / 2, curve[1], curve[3])
}

export function transitionFrames(t: PrototypeTransition): { incoming: Keyframe[]; outgoing: Keyframe[] } {
  const offset = { left: ['100%', '0'], right: ['-100%', '0'], up: ['0', '100%'], down: ['0', '-100%'] }[t.direction]
  const reverse = { left: ['-100%', '0'], right: ['100%', '0'], up: ['0', '-100%'], down: ['0', '100%'] }[t.direction]
  const still = [{ opacity: 1 }, { opacity: 1 }]
  if (t.kind === 'instant') return { incoming: still, outgoing: still }
  if (t.kind === 'slide-in' || t.kind === 'slide') return { incoming: [{ transform: `translate(${offset[0]}, ${offset[1]})` }, { transform: 'translate(0, 0)' }], outgoing: still }
  if (t.kind === 'slide-out') return { incoming: still, outgoing: [{ transform: 'translate(0, 0)' }, { transform: `translate(${reverse[0]}, ${reverse[1]})` }] }
  if (t.kind === 'push') {
    return {
      incoming: [{ transform: `translate(${offset[0]}, ${offset[1]})` }, { transform: 'translate(0, 0)' }],
      outgoing: [{ transform: 'translate(0, 0)' }, { transform: `translate(${reverse[0]}, ${reverse[1]})` }],
    }
  }
  return { incoming: [{ opacity: 0 }, { opacity: 1 }], outgoing: [{ opacity: 1 }, { opacity: 0 }] }
}

/** Compensate for the matched parent's size so nested transforms do not scale twice.
 * Matrix endpoints use a top-left origin while preserving center-origin rotation. */
export function smartKeyframes(from: SceneElement, to: SceneElement, parent?: { from: SceneElement; to: SceneElement }, fitRatio = 1, scrollOffset = 0, scrollLeft = 0): Keyframe[] {
  const matrix = (node: SceneElement, width: number, height: number, px: number, py: number, root: boolean, offset = 0, offsetX = 0) => {
    const radians = (root ? 0 : node.rotation) * Math.PI / 180
    const cos = Math.cos(radians), sin = Math.sin(radians)
    const cx = node.width / 2, cy = node.height / 2
    const x = root ? 0 : node.x + cx - cos * cx + sin * cy
    const y = root ? 0 : node.y + cy - sin * cx - cos * cy
    return `matrix(${cos * width * px},${sin * width * py},${-sin * height * px},${cos * height * py},${x * px - (root ? offsetX : to.x)},${y * py - (root ? offset : to.y)})`
  }
  const root = !parent
  return [
    { transformOrigin: '0 0', transform: matrix(from, from.width / to.width, from.height / to.height, parent ? parent.to.width / parent.from.width : fitRatio, parent ? parent.to.height / parent.from.height : fitRatio, root, scrollOffset, scrollLeft) },
    { transformOrigin: '0 0', transform: matrix(to, 1, 1, 1, 1, root) },
  ]
}

/** Match by type and hierarchical name; duplicate siblings get deterministic ordinals. */
export function matchedLayers(elements: SceneDocument['elements'], fromId: string, toId: string): readonly { from: SceneElement; to: SceneElement }[] {
  const index = (root: string) => {
    const result = new Map<string, SceneElement>()
    const visit = (id: string, path: string) => {
      const node = elements[id]
      if (!node?.visible) return
      result.set(path, node)
      if (node.type === 'frame') {
        const counts = new Map<string, number>()
        for (const childId of node.children) {
          const child = elements[childId], key = JSON.stringify([child.type, child.name]), n = counts.get(key) ?? 0
          counts.set(key, n + 1); visit(childId, `${path}/${key}:${n}`)
        }
      }
    }
    visit(root, 'root'); return result
  }
  const from = index(fromId), to = index(toId)
  return [...to].flatMap(([key, node]) => from.has(key) ? [{ from: from.get(key)!, to: node }] : [])
}
