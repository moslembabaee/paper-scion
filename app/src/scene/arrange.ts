import type { Bounds, Point } from '../canvas/types.ts'
import { getWorldBounds } from './geometry.ts'
import { captureOrigins, moveGeometry, resizeGeometry, selectionBounds, selectionBox, selectionRoots } from './selectionGeometry.ts'
import type { SceneStore } from './store.ts'
import type { ElementGeometry, SceneSnapshot } from './types.ts'
import { DEFAULT_AUTO_LAYOUT } from './autoLayout.ts'

export type Alignment = 'top' | 'bottom' | 'left' | 'right' | 'horizontal-center' | 'vertical-center'
export type Distribution = 'horizontal' | 'vertical'
export type LayerOrder = 'front' | 'back' | 'forward' | 'backward'

/** Preserve bindings on geometry properties that the action did not change. */
function applyGeometry(store: SceneStore, state: SceneSnapshot, id: string, geometry: ElementGeometry): void {
  const node = state.elements[id]
  const patch: { -readonly [Key in keyof ElementGeometry]?: number } = {}
  for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
    if (Math.abs(geometry[key] - node[key]) > 1e-9) patch[key] = geometry[key]
  }
  if (Object.keys(patch).length) store.update(id, node.type, patch)
}

export function arrangeableIds(store: SceneStore): string[] {
  const state = store.getSnapshot()
  return selectionRoots(state, state.selection).filter(id => store.isVisible(id) && !store.isLocked(id))
}

/** Multiple layers align to their union; a single layer aligns to its frame or visible canvas. */
export function alignSelection(store: SceneStore, alignment: Alignment, canvas: Bounds): void {
  const state = store.getSnapshot(), ids = arrangeableIds(store)
  if (!ids.length) return
  const parent = state.elements[ids[0]].parentId
  const target = ids.length > 1 ? selectionBounds(state, ids)! : parent ? getWorldBounds(state, parent) : canvas
  store.batch(() => {
    for (const origin of captureOrigins(state, ids)) {
      const bounds = getWorldBounds(state, origin.id)
      const delta: Point = { x: 0, y: 0 }
      if (alignment === 'left') delta.x = target.x - bounds.x
      if (alignment === 'right') delta.x = target.x + target.width - bounds.x - bounds.width
      if (alignment === 'horizontal-center') delta.x = target.x + target.width / 2 - bounds.x - bounds.width / 2
      if (alignment === 'top') delta.y = target.y - bounds.y
      if (alignment === 'bottom') delta.y = target.y + target.height - bounds.y - bounds.height
      if (alignment === 'vertical-center') delta.y = target.y + target.height / 2 - bounds.y - bounds.height / 2
      applyGeometry(store, state, origin.id, moveGeometry(origin, delta))
    }
  }, `Align ${alignment.replace('-', ' ')}`)
}

/** Equal edge gaps, including negative gaps for overlaps. Keep the two outer layers fixed. */
export function distributeSelection(store: SceneStore, axis: Distribution): void {
  const state = store.getSnapshot(), ids = arrangeableIds(store)
  if (ids.length < 3) return
  const coordinate = axis === 'horizontal' ? 'x' : 'y'
  const dimension = axis === 'horizontal' ? 'width' : 'height'
  const items = captureOrigins(state, ids).map(origin => ({ origin, bounds: getWorldBounds(state, origin.id) }))
    .sort((a, b) => a.bounds[coordinate] - b.bounds[coordinate])
  const first = items[0].bounds, last = items.at(-1)!.bounds
  const gap = (last[coordinate] + last[dimension] - first[coordinate] - items.reduce((sum, item) => sum + item.bounds[dimension], 0)) / (items.length - 1)
  let position = first[coordinate] + first[dimension] + gap
  store.batch(() => {
    for (const { origin, bounds } of items.slice(1, -1)) {
      const offset = position - bounds[coordinate]
      applyGeometry(store, state, origin.id, moveGeometry(origin, { x: axis === 'horizontal' ? offset : 0, y: axis === 'vertical' ? offset : 0 }))
      position += bounds[dimension] + gap
    }
  }, `Distribute ${axis === 'horizontal' ? 'horizontally' : 'vertically'}`)
}

export function nudgeSelection(store: SceneStore, delta: Point): void {
  const state = store.getSnapshot()
  store.batch(() => {
    for (const origin of captureOrigins(state, arrangeableIds(store))) applyGeometry(store, state, origin.id, moveGeometry(origin, delta))
  }, 'Nudge elements')
}

/** Grow/shrink the selection from its top-left anchor in its own axes. */
export function resizeSelection(store: SceneStore, delta: Point): void {
  const state = store.getSnapshot(), ids = arrangeableIds(store), box = selectionBox(state, ids)
  if (!box) return
  const after = { ...box, width: Math.max(1, box.width + delta.x), height: Math.max(1, box.height + delta.y) }
  // Preserve the top-left corner even for a rotated selection.
  const angle = box.rotation * Math.PI / 180
  const dx = (after.width - box.width) / 2, dy = (after.height - box.height) / 2
  after.x += dx * Math.cos(angle) - dy * Math.sin(angle) - dx
  after.y += dx * Math.sin(angle) + dy * Math.cos(angle) - dy
  store.batch(() => {
    for (const origin of captureOrigins(state, ids)) applyGeometry(store, state, origin.id, resizeGeometry(origin, box, after))
  }, 'Resize elements')
}

/** Reorder each sibling list together, preserving the relative order of selected layers. */
export function orderSelection(store: SceneStore, order: LayerOrder): void {
  const state = store.getSnapshot(), ids = arrangeableIds(store).filter(id => { const node = state.elements[id]; return node.component?.kind !== 'instance' || node.component.instanceId === id }), selected = new Set(ids)
  const parents = new Set(ids.map(id => state.elements[id].parentId))
  store.batch(() => {
    for (const parent of parents) {
      const siblings = [...store.getChildren(parent)]
      let desired = [...siblings]
      if (order === 'front') desired = [...siblings.filter(id => !selected.has(id)), ...siblings.filter(id => selected.has(id))]
      else if (order === 'back') desired = [...siblings.filter(id => selected.has(id)), ...siblings.filter(id => !selected.has(id))]
      else if (order === 'forward') {
        for (let i = desired.length - 2; i >= 0; i--) if (selected.has(desired[i]) && !selected.has(desired[i + 1])) [desired[i], desired[i + 1]] = [desired[i + 1], desired[i]]
      } else {
        for (let i = 1; i < desired.length; i++) if (selected.has(desired[i]) && !selected.has(desired[i - 1])) [desired[i], desired[i - 1]] = [desired[i - 1], desired[i]]
      }
      // Move only selected layers; locked siblings retain their lock and are never edited directly.
      const moving = desired.filter(id => selected.has(id))
      if (order === 'front' || order === 'forward') moving.reverse()
      for (const id of moving) store.reorder(id, desired.indexOf(id))
    }
  }, `Arrange ${order}`)
}

export function duplicateSelection(store: SceneStore): string[] {
  const state = store.getSnapshot()
  const ids = selectionRoots(state, state.selection)
  if (!ids.length) return []
  const duplicated: string[] = []
  store.batch(() => {
    for (const id of ids) {
      const node = state.elements[id]
      if (!node || store.isLocked(id)) continue
      if (node.component?.kind === 'instance' && node.component.instanceId === node.id) {
        try {
          const inst = store.createComponentInstance(node.component.masterId, {
            x: node.x + 20,
            y: node.y + 20,
            parentId: node.parentId,
          })
          if (node.component.propertyValues && Object.keys(node.component.propertyValues).length) {
            for (const [pId, pVal] of Object.entries(node.component.propertyValues)) {
              store.setComponentProperty(inst.id, pId, pVal)
            }
          }
          duplicated.push(inst.id)
          continue
        } catch (err) {
          console.error('Failed to duplicate component instance:', err)
        }
      } else if (node.component?.kind === 'master') {
        try {
          const masterCopy = store.duplicateComponent(node.id)
          duplicated.push(masterCopy.id)
          continue
        } catch (err) {
          console.error('Failed to duplicate master component:', err)
        }
      }
      const { id: _id, zIndex: _z, children: _c, ...rest } = node as any
      const copy = {
        ...rest,
        x: node.x + 20,
        y: node.y + 20,
        name: `${node.name.replace(/ copy( \d+)?$/, '')} copy`,
      }
      try {
        const added = store.add(node.type, copy)
        duplicated.push(added.id)
      } catch (err) {
        console.error('Failed to duplicate element:', err)
      }
    }
  }, 'Duplicate elements')
  if (duplicated.length) store.select(duplicated)
  return duplicated
}

export function deleteSelection(store: SceneStore): void {
  const state = store.getSnapshot()
  const ids = selectionRoots(state, state.selection)
  if (!ids.length) return
  store.batch(() => {
    for (const id of ids) {
      if (!store.isLocked(id) && store.getSnapshot().elements[id]) {
        try {
          store.remove(id)
        } catch (err) {
          console.error('Failed to remove element:', err)
        }
      }
    }
  }, 'Delete elements')
  store.select([])
}

export function groupSelection(store: SceneStore): string | null {
  const state = store.getSnapshot()
  const ids = selectionRoots(state, state.selection).filter(id => store.isVisible(id) && !store.isLocked(id))
  if (!ids.length) return null
  const bounds = selectionBounds(state, ids)
  if (!bounds) return null
  let createdId: string | null = null
  store.batch(() => {
    const parent = state.elements[ids[0]].parentId
    const frame = store.add('frame', {
      name: 'Group',
      parentId: parent,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      clipContent: false,
      style: { fill: null },
    })
    createdId = frame.id
    for (const id of ids) {
      const node = state.elements[id]
      store.reparent(id, frame.id, node.zIndex)
      const sizing = node.sizing
      const resetSizing = sizing && (sizing.width === 'fill' || sizing.height === 'fill')
        ? { ...sizing, width: sizing.width === 'fill' ? 'fixed' as const : sizing.width, height: sizing.height === 'fill' ? 'fixed' as const : sizing.height }
        : undefined
      store.update(id, node.type, {
        x: node.x - bounds.x,
        y: node.y - bounds.y,
        ...(resetSizing ? { sizing: resetSizing } : {}),
      })
    }
    store.select([frame.id])
  }, 'Group selection in frame')
  return createdId
}

export function createAutoLayoutSelection(store: SceneStore): string | null {
  const state = store.getSnapshot()
  const ids = selectionRoots(state, state.selection).filter(id => store.isVisible(id) && !store.isLocked(id))
  if (!ids.length) return null

  // Single frame selected
  if (ids.length === 1) {
    const node = state.elements[ids[0]]
    if (node.type === 'frame') {
      if (node.layout) return node.id
      const children = node.children.map(cid => state.elements[cid]).filter(Boolean)
      let direction: 'horizontal' | 'vertical' = 'horizontal'
      let gap = 16
      if (children.length >= 2) {
        const xDist = Math.max(...children.map(c => c.x)) - Math.min(...children.map(c => c.x))
        const yDist = Math.max(...children.map(c => c.y)) - Math.min(...children.map(c => c.y))
        direction = xDist >= yDist ? 'horizontal' : 'vertical'
        const sorted = [...children].sort((a, b) => direction === 'horizontal' ? a.x - b.x : a.y - b.y)
        const gaps: number[] = []
        for (let i = 0; i < sorted.length - 1; i++) {
          const current = sorted[i], next = sorted[i + 1]
          const g = direction === 'horizontal' ? next.x - (current.x + current.width) : next.y - (current.y + current.height)
          if (g >= 0) gaps.push(g)
        }
        if (gaps.length) gap = Math.round(gaps.reduce((sum, g) => sum + g, 0) / gaps.length)
      }
      let padding = DEFAULT_AUTO_LAYOUT.padding
      if (children.length > 0) {
        const padLeft = Math.max(0, Math.round(Math.min(...children.map(c => c.x))))
        const padTop = Math.max(0, Math.round(Math.min(...children.map(c => c.y))))
        const padRight = Math.max(0, Math.round(node.width - Math.max(...children.map(c => c.x + c.width))))
        const padBottom = Math.max(0, Math.round(node.height - Math.max(...children.map(c => c.y + c.height))))
        padding = { top: padTop, right: padRight, bottom: padBottom, left: padLeft }
      }
      store.batch(() => {
        if (children.length >= 2) {
          const sorted = [...children].sort((a, b) => direction === 'horizontal' ? a.x - b.x : a.y - b.y)
          sorted.forEach((child, idx) => {
            store.reorder(child.id, idx)
          })
        }
        store.update(node.id, 'frame', { layout: { ...DEFAULT_AUTO_LAYOUT, direction, gap: Math.max(0, gap), padding } })
      }, 'Add auto layout')
      return node.id
    }
  }

  // 1 non-frame element or 2+ elements: wrap them in a new Auto Layout frame
  const bounds = selectionBounds(state, ids)
  if (!bounds) return null

  const items = ids.map(id => state.elements[id]).filter(Boolean)
  let direction: 'horizontal' | 'vertical' = 'horizontal'
  let gap = 16
  if (items.length >= 2) {
    const xDist = Math.max(...items.map(c => c.x)) - Math.min(...items.map(c => c.x))
    const yDist = Math.max(...items.map(c => c.y)) - Math.min(...items.map(c => c.y))
    direction = xDist >= yDist ? 'horizontal' : 'vertical'
    const sorted = [...items].sort((a, b) => direction === 'horizontal' ? a.x - b.x : a.y - b.y)
    const gaps: number[] = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i], next = sorted[i + 1]
      const g = direction === 'horizontal' ? next.x - (current.x + current.width) : next.y - (current.y + current.height)
      if (g >= 0) gaps.push(g)
    }
    if (gaps.length) gap = Math.round(gaps.reduce((sum, g) => sum + g, 0) / gaps.length)
  }

  const sortedIds = [...items].sort((a, b) => direction === 'horizontal' ? a.x - b.x : a.y - b.y).map(item => item.id)
  let createdId: string | null = null

  store.batch(() => {
    const parent = state.elements[ids[0]].parentId
    const padding = { top: 16, right: 16, bottom: 16, left: 16 }
    const frame = store.add('frame', {
      name: 'Frame',
      parentId: parent,
      x: bounds.x - padding.left,
      y: bounds.y - padding.top,
      width: bounds.width + padding.left + padding.right,
      height: bounds.height + padding.top + padding.bottom,
      clipContent: false,
      style: { fill: null },
      layout: { ...DEFAULT_AUTO_LAYOUT, direction, gap: Math.max(0, gap), padding },
      sizing: { width: 'hug', height: 'hug' },
    })
    createdId = frame.id
    for (let i = 0; i < sortedIds.length; i++) {
      const id = sortedIds[i]
      store.reparent(id, frame.id, i)
    }
    store.select([frame.id])
  }, 'Add auto layout')

  return createdId
}

export function removeAutoLayoutSelection(store: SceneStore): void {
  const state = store.getSnapshot()
  const ids = selectionRoots(state, state.selection)
  store.batch(() => {
    for (const id of ids) {
      const node = state.elements[id]
      if (node && node.type === 'frame' && node.layout) {
        store.update(id, 'frame', { layout: null })
        for (const childId of node.children) {
          const child = store.getSnapshot().elements[childId]
          if (child?.sizing && (child.sizing.width === 'fill' || child.sizing.height === 'fill')) {
            store.update(childId, child.type, {
              sizing: {
                ...child.sizing,
                width: child.sizing.width === 'fill' ? 'fixed' as const : child.sizing.width,
                height: child.sizing.height === 'fill' ? 'fixed' as const : child.sizing.height,
              },
            })
          }
        }
      }
    }
  }, 'Remove auto layout')
}

export function ungroupSelection(store: SceneStore): string[] {
  const state = store.getSnapshot()
  const ids = selectionRoots(state, state.selection).filter(id => {
    const node = state.elements[id]
    return node && node.type === 'frame' && !store.isLocked(id)
  })
  if (!ids.length) return []
  const extractedIds: string[] = []

  store.batch(() => {
    for (const frameId of ids) {
      const frame = store.getSnapshot().elements[frameId]
      if (!frame || frame.type !== 'frame') continue
      const parentId = frame.parentId
      const children = [...frame.children]
      for (const childId of children) {
        const child = store.getSnapshot().elements[childId]
        if (!child) continue
        const absX = child.x + frame.x
        const absY = child.y + frame.y
        store.reparent(childId, parentId)
        const sizing = child.sizing
        const resetSizing = sizing && (sizing.width === 'fill' || sizing.height === 'fill')
          ? { ...sizing, width: sizing.width === 'fill' ? 'fixed' as const : sizing.width, height: sizing.height === 'fill' ? 'fixed' as const : sizing.height }
          : undefined
        store.update(childId, child.type, {
          x: absX,
          y: absY,
          ...(resetSizing ? { sizing: resetSizing } : {}),
        })
        extractedIds.push(childId)
      }
      store.remove(frameId)
    }
    if (extractedIds.length) store.select(extractedIds)
  }, 'Ungroup elements')

  return extractedIds
}

