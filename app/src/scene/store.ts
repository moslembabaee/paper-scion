import { EMPTY_MOTION, pruneMotion, validateMotion } from '../motion/model.ts'
import type { MotionDocument } from '../motion/types.ts'
import type { ComponentInstance, ComponentOverrides, ComponentProperty, ComponentPropertyValue, ComponentRegistry, ComponentStateMachine, ComponentVariant, ComponentVariantMatrix, MasterComponent, MasterComponentSchema, OverrideDiffEntry, VariantDimension, VariantMatrixCell, VariantMatrixCombination } from './types.ts'
import { applyPropertyValueToElement, createVariantPresetDimensions, getEffectiveVariantDimensions, releaseComponentResources, validPropertyValue, validateComponentProperties, validatePropertyTargets, validateVariantMatrix } from './componentProperties.ts'
import { createDefaultStateMachine, getEffectiveStateMachine, validateStateMachine } from './stateMachine.ts'
import { EMPTY_COMMENTS, validateComments } from '../comments/model.ts'
import type { CommentDocument } from '../comments/types.ts'
import { EMPTY_LIBRARY, detachEditedSharedStyles, resolveSharedStyles, resolveTokens, validateLibrary } from '../tokens/library.ts'
import { detachEditedBindings, detachRemovedTokenBindings, resolveTokenBindings, supportsTokenProperty, tokenVariable, validateTokens } from '../tokens/model.ts'
import type { DesignToken, SharedStyle, SharedStyleInput, SharedStyleKind, StyleLibrary, TokenInput, TokenProperty } from '../tokens/types.ts'
import { createElement, freezeElement, validateElement } from './elements.ts'
import { freezeShader, validateShader } from '../shaders/catalog.ts'
import { CommandHistory, equalValue, valueRebaser } from './history.ts'
import { normalizeHierarchy } from '../collaboration/model.ts'
import type { ShaderPaint } from '../shaders/types.ts'
import type { BooleanCompound, BooleanOperation, ElementInput, ElementOf, ElementPatch, ElementType, MaskClipMode, PathElement, SceneDocument, SceneElement, SceneSnapshot, VectorElement } from './types.ts'
import { computeBoolean, evaluateVectorElement, findCompoundOperand, isVector, refreshBooleanElement, transformedSource } from './booleanGeometry.ts'
import { optimizeSvgBezierData } from './bezierOptimization.ts'
import { serializePath, copyContours, parsePath, pathBounds, type PathNodes, type PathContour } from './pathGeometry.ts'
import { canMask, validateMaskGraph } from './maskGeometry.ts'
import { getWorldBounds } from './geometry.ts'
import { unionBounds } from '../canvas/math.ts'
import { FIXED_SIZING, invalidateLayoutTextMetrics, reflowAutoLayout } from './autoLayout.ts'
import { applyConstraintsToChildren } from './layoutConstraints.ts'
import { createDefaultLayoutGrid } from './layoutGridGeometry.ts'
import type { FrameLayoutGrid, LayoutConstraints, LayoutGridType } from './types.ts'
import { buildComponentRegistry, componentRoot, getComponentOverrideDiff, isComponentInstance, isInstanceRoot, isMasterComponent, recordComponentEdit, recordComponentTokenEdit, subtree, synchronizeComponents, validateComponentGraph, validateComponentRegistry } from './components.ts'
import { EMPTY_PROTOTYPE, DEFAULT_TRANSITION, prunePrototype, validatePrototype } from '../prototype/model.ts'
import type { PrototypeDocument, PrototypeInteraction } from '../prototype/types.ts'
import { validatePhysicsDocument } from '../physics/constants.ts'
import type { PhysicsDocument } from '../physics/types.ts'

type Listener = () => void
const EMPTY = Object.freeze([]) as readonly string[]

export interface BooleanPreview {
  readonly operation: BooleanOperation
  readonly node: PathElement
  readonly sourceIds: readonly string[]
}

/** Framework-independent immutable scene graph. Sibling arrays are the paint order. */
export class SceneStore {
  private state: SceneSnapshot = Object.freeze({ version: 1, tokens: Object.freeze([]), styleLibrary: EMPTY_LIBRARY, backgroundShader: null, elements: Object.freeze({}), rootIds: EMPTY, selection: EMPTY })
  private listeners = new Set<Listener>()
  private batchDepth = 0
  private pending = false
  private history = new CommandHistory()
  private transaction: { before: SceneSnapshot; label: string } | null = null
  private booleanPreview: BooleanPreview | null = null
  private booleanPreviewSnapshot: SceneSnapshot | null = null
  private booleanPreviewCache = new Map<BooleanOperation, BooleanPreview>()
  private booleanPreviewListeners = new Set<Listener>()
  private highlightedBooleanSource: string | null = null
  private highlightedBooleanSourceListeners = new Set<Listener>()
  private pathEditingTarget: { id: string; operandId?: string } | null = null
  private pathEditingTargetListeners = new Set<Listener>()
  private selectedCompoundOperand: { compoundId: string; operandId: string } | null = null
  private selectedCompoundOperandListeners = new Set<Listener>()

  subscribeBooleanPreview = (listener: Listener): (() => void) => {
    this.booleanPreviewListeners.add(listener)
    return () => { this.booleanPreviewListeners.delete(listener) }
  }

  subscribeHighlightedBooleanSource = (listener: Listener): (() => void) => {
    this.highlightedBooleanSourceListeners.add(listener)
    return () => { this.highlightedBooleanSourceListeners.delete(listener) }
  }

  subscribePathEditingTarget = (listener: Listener): (() => void) => {
    this.pathEditingTargetListeners.add(listener)
    return () => { this.pathEditingTargetListeners.delete(listener) }
  }

  subscribeSelectedCompoundOperand = (listener: Listener): (() => void) => {
    this.selectedCompoundOperandListeners.add(listener)
    return () => { this.selectedCompoundOperandListeners.delete(listener) }
  }

  private emitBooleanPreview() { for (const listener of [...this.booleanPreviewListeners]) listener() }

  getBooleanPreview = (): BooleanPreview | null => this.booleanPreviewSnapshot === this.state && !this.history.getSnapshot().active ? this.booleanPreview : null

  getHighlightedBooleanSource = (): string | null => this.highlightedBooleanSource

  getPathEditingTarget = (): { id: string; operandId?: string } | null => this.pathEditingTarget

  setPathEditingTarget(target: { id: string; operandId?: string } | null): void {
    if (this.pathEditingTarget === target) return
    this.pathEditingTarget = target
    for (const listener of [...this.pathEditingTargetListeners]) listener()
  }

  getSelectedCompoundOperand = (): { compoundId: string; operandId: string } | null => this.selectedCompoundOperand

  setSelectedCompoundOperand(target: { compoundId: string; operandId: string } | null): void {
    if (this.selectedCompoundOperand?.compoundId === target?.compoundId && this.selectedCompoundOperand?.operandId === target?.operandId) return
    this.selectedCompoundOperand = target
    if (target) {
      this.highlightBooleanSource(target.operandId)
    }
    for (const listener of [...this.selectedCompoundOperandListeners]) listener()
  }

  getCompoundOperand(id: string, operandId: string): VectorElement | null {
    const node = this.state.elements[id]
    if (node?.type !== 'path' || !node.boolean) return null
    return findCompoundOperand(node.boolean, operandId) ?? null
  }

  highlightBooleanSource(id: string | null): void {
    if (this.highlightedBooleanSource === id) return
    this.highlightedBooleanSource = id
    for (const listener of [...this.highlightedBooleanSourceListeners]) listener()
  }

  /** Transient geometry never enters document snapshots, persistence, or undo history. */
  previewBoolean(operation: BooleanOperation | null): void {
    if (operation === null) {
      if (this.booleanPreview) { this.booleanPreview = null; this.emitBooleanPreview() }
      return
    }
    if (this.booleanPreviewSnapshot !== this.state) {
      this.booleanPreviewSnapshot = this.state
      this.booleanPreviewCache.clear()
    }
    const cached = this.booleanPreviewCache.get(operation)
    let preview = cached
    if (!preview) {
      const selected = this.state.selection.length === 1 ? this.state.elements[this.state.selection[0]] : undefined
      let node: PathElement
      if (selected?.type === 'path' && selected.boolean) {
        this.requireCompound(selected.id)
        node = freezeElement(refreshBooleanElement(selected, { ...selected.boolean, operation })) as PathElement
      } else {
        const reason = this.booleanSelectionReason()
        if (reason) throw new Error(reason)
        const operands = this.state.selection.map(id => this.state.elements[id] as VectorElement).sort((a, b) => a.zIndex - b.zIndex)
        const result = computeBoolean(operands, operation)
        const base = operands[0]
        node = createElement('path', { id: 'boolean-preview', parentId: operands[0].parentId, ...result.bounds, d: result.d, viewBox: result.viewBox, fillRule: result.fillRule, style: base.style })
      }
      preview = Object.freeze({ operation, node, sourceIds: this.state.selection })
      this.booleanPreviewCache.set(operation, preview)
    }
    if (preview !== this.booleanPreview) { this.booleanPreview = preview; this.emitBooleanPreview() }
  }

  getHistorySnapshot = () => this.history.getSnapshot()

  /** A gesture may publish live frames while keeping only one history command. */
  beginTransaction(label: string): void {
    if (this.transaction || this.batchDepth) throw new Error('A history transaction is already active')
    this.transaction = { before: this.state, label }
    this.history.setActive(true)
    this.emit()
  }

  endTransaction(): void {
    if (!this.transaction) return
    const { before, label } = this.transaction
    this.transaction = null
    this.history.record(before, this.state, label)
    this.history.setActive(false)
    this.emit()
  }

  cancelTransaction(): void {
    if (!this.transaction) return
    this.state = this.transaction.before
    this.transaction = null
    this.history.setActive(false)
    this.emit()
  }

  undo = (): void => {
    if (this.batchDepth || this.transaction) return
    const previous = this.history.undo()
    if (previous) { this.state = previous; this.emit() }
  }

  redo = (): void => {
    if (this.batchDepth || this.transaction) return
    const next = this.history.redo()
    if (next) { this.state = next; this.emit() }
  }

  /** Establish a fresh baseline when seeding or opening a different project. */
  clearHistory(): void {
    if (this.batchDepth || this.transaction) throw new Error('Finish the active edit before clearing history')
    this.history.clear()
    this.emit()
  }

  getSnapshot = (): SceneSnapshot => this.state
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** One history command and notification for many edits. Nested batches are supported. */
  batch<T>(work: () => T, label = 'Edit elements'): T {
    const before = this.state
    this.batchDepth++
    try { return work() } finally {
      this.batchDepth--
      if (!this.batchDepth && this.pending) {
        if (!this.transaction) this.history.record(before, this.state, label)
        this.pending = false
        this.emit()
      }
    }
  }

  private emit() {
    if (this.booleanPreviewSnapshot !== this.state || this.history.getSnapshot().active) {
      const hadPreview = this.booleanPreview !== null
      this.booleanPreview = null
      this.booleanPreviewCache.clear()
      this.booleanPreviewSnapshot = null
      if (hadPreview) this.emitBooleanPreview()
    }
    for (const listener of [...this.listeners]) listener()
  }
  private publish(next: SceneSnapshot, label: string, documentChanged = true) {
    const before = this.state
    if (documentChanged) {
      let elements = reflowAutoLayout(next.elements, next.rootIds)
      elements = synchronizeComponents(elements, resolveTokens(next.tokens, next.styleLibrary.activeThemeId), before.elements, next.styleLibrary)
      elements = reflowAutoLayout(elements, next.rootIds)
      validateMaskGraph(elements)
      if (elements !== next.elements) next = Object.freeze({ ...next, elements: Object.freeze(elements) })
      if (next.motion) {
        const motion = pruneMotion(next.motion, elements)
        if (motion !== next.motion) next = Object.freeze({ ...next, motion })
      }
      if (next.prototype) {
        const prototype = prunePrototype(next.prototype, elements)
        if (prototype !== next.prototype) next = Object.freeze({ ...next, prototype })
      }
      const selection = next.selection.filter(id => {
        let node: SceneElement | undefined = Object.hasOwn(elements, id) ? elements[id] : undefined
        if (!node) return false
        while (node) { if (!node.visible || node.locked) return false; node = node.parentId === null ? undefined : elements[node.parentId] }
        return true
      })
      if (selection.length !== next.selection.length) next = Object.freeze({ ...next, selection: Object.freeze(selection) })
      const registry = buildComponentRegistry(elements)
      if (Object.keys(registry).length > 0 || next.componentRegistry) {
        next = Object.freeze({ ...next, componentRegistry: registry })
      }
    }
    this.state = next
    if (!this.batchDepth && !this.transaction && documentChanged) this.history.record(before, next, label)
    if (this.batchDepth) this.pending = true
    else this.emit()
  }

  private commit(elements: Readonly<Record<string, SceneElement>>, rootIds = this.state.rootIds, selection = this.state.selection, label = 'Edit elements', documentChanged = true) {
    this.publish(Object.freeze({ ...this.state, elements: Object.freeze(elements), rootIds: rootIds === this.state.rootIds ? rootIds : Object.freeze([...rootIds]), selection: selection === this.state.selection ? selection : Object.freeze([...selection]) }), label, documentChanged)
  }

  private require(id: string): SceneElement {
    const node = Object.hasOwn(this.state.elements, id) ? this.state.elements[id] : undefined
    if (!node) throw new Error(`Unknown element: ${id}`)
    return node
  }

  private requireFrame(id: string | null) {
    if (id === null) return
    if (this.require(id).type !== 'frame') throw new Error('Only frames can contain elements')
  }

  /** Instance structure belongs to its master; detach before changing it locally. */
  private requireEditableStructure(id: string | null, rootAllowed = false): void {
    if (id === null) return
    const node = this.require(id)
    if (node.component?.kind === 'instance' && (!rootAllowed || node.component.instanceId !== id)) throw new Error('Detach the instance before editing its structure')
  }

  getChildren = (parentId: string | null): readonly string[] => {
    if (parentId === null) return this.state.rootIds
    const node = this.state.elements[parentId]
    return node?.type === 'frame' ? node.children : EMPTY
  }

  /** Resolve inherited visibility/locking without flattening the hierarchy. */
  isVisible = (id: string): boolean => {
    let node: SceneElement | undefined = Object.hasOwn(this.state.elements, id) ? this.state.elements[id] : undefined
    if (!node) return false
    while (node) {
      if (!node.visible) return false
      node = node.parentId === null ? undefined : this.state.elements[node.parentId]
    }
    return true
  }

  isLocked = (id: string): boolean => {
    let node: SceneElement | undefined = Object.hasOwn(this.state.elements, id) ? this.state.elements[id] : undefined
    if (!node) return true
    while (node) {
      if (node.locked) return true
      node = node.parentId === null ? undefined : this.state.elements[node.parentId]
    }
    return false
  }

  private ordered(elements: Record<string, SceneElement>, parentId: string | null, ids: readonly string[]) {
    ids.forEach((id, index) => {
      const node = elements[id]
      if (node.zIndex !== index || node.parentId !== parentId) elements[id] = freezeElement({ ...node, parentId, zIndex: index })
    })
    if (parentId !== null) {
      const frame = elements[parentId]
      if (frame.type === 'frame') elements[parentId] = freezeElement({ ...frame, children: ids })
    }
  }

  add<T extends ElementType>(type: T, input: ElementInput<T> = {}, index?: number): ElementOf<T> {
    const node = freezeElement(this.resolveStyles(createElement(type, input)))
    validateElement(node)
    if (Object.hasOwn(this.state.elements, node.id)) throw new Error(`Duplicate element: ${node.id}`)
    if (['__proto__', 'prototype', 'constructor'].includes(node.id)) throw new Error('Reserved element ID')
    this.requireFrame(node.parentId)
    this.requireEditableStructure(node.parentId)
    if (node.parentId !== null && this.isLocked(node.parentId)) throw new Error('Parent frame is locked')
    const siblings = [...this.getChildren(node.parentId)]
    siblings.splice(this.index(index ?? siblings.length, siblings.length), 0, node.id)
    const elements = { ...this.state.elements, [node.id]: node }
    this.ordered(elements, node.parentId, siblings)
    this.commit(elements, node.parentId === null ? siblings : this.state.rootIds, this.state.selection, `Add ${node.name}`)
    return this.state.elements[node.id] as ElementOf<T>
  }

  /** Structural fields can only change through add/reparent/reorder/remove. */
  update<T extends ElementType>(id: string, type: T, patch: ElementPatch<T>): void {
    const node = this.require(id)
    if (node.type !== type) throw new Error('Element type mismatch')
    if (this.isLocked(id)) throw new Error('Element is locked')
    for (const key of ['mask', 'component', 'id', 'type', 'children', 'parentId', 'zIndex', 'tokenBindings', 'sharedStyleBindings', 'boolean']) {
      if (Object.hasOwn(patch, key)) throw new Error(`Use structural actions to change ${key}`)
    }
    if (node.type === 'path' && node.boolean && ['d', 'viewBox', 'fillRule', 'nodes'].some(key => Object.hasOwn(patch, key))) throw new Error('Flatten the compound before editing its merged outline')
    const tokenBindings = detachEditedBindings(node.tokenBindings, patch as Record<string, unknown>, node)
    const updated = { ...node, ...patch, ...(node.sharedStyleBindings ? { sharedStyleBindings: detachEditedSharedStyles(node.sharedStyleBindings, patch as Record<string, unknown>) } : {}), ...(tokenBindings ? { tokenBindings } : {}), style: { ...node.style, ...patch.style } } as SceneElement
    // A direct resize is an explicit fixed-size edit; layout settings remain
    // authoritative when the caller supplies sizing in the same patch.
    if (!Object.hasOwn(patch, 'sizing') && node.sizing && (Object.hasOwn(patch, 'width') || Object.hasOwn(patch, 'height'))) {
      Object.assign(updated, { sizing: { ...node.sizing, ...(Object.hasOwn(patch, 'width') ? { width: 'fixed' } : {}), ...(Object.hasOwn(patch, 'height') ? { height: 'fixed' } : {}) } })
    }
    if (updated.type === 'path') {
      if (Object.hasOwn(patch, 'nodes') && updated.nodes) Object.assign(updated, { d: serializePath(updated.nodes) })
      else if (Object.hasOwn(patch, 'd')) delete (updated as { nodes?: unknown }).nodes
    }
    Object.assign(updated, this.resolveStyles(updated))
    validateElement(updated)
    if (Object.hasOwn(patch, 'sizing') && updated.sizing && tokenBindings) {
      for (const axis of ['width', 'height'] as const) if (updated.sizing[axis] !== 'fixed') delete tokenBindings[axis]
    }
    if (equalValue(node, updated)) return
    const label = patch.style ? 'Style' : ['x', 'y', 'width', 'height', 'rotation'].some(key => Object.hasOwn(patch, key)) ? 'Transform' : 'Edit'
    let elements = { ...this.state.elements, [id]: freezeElement(recordComponentEdit(node, updated, patch)) }

    // Real-time nested child repositioning and resizing according to responsive pinning constraints
    if (
      node.type === 'frame' &&
      !node.layout &&
      node.children &&
      node.children.length > 0 &&
      (Object.hasOwn(patch, 'width') || Object.hasOwn(patch, 'height'))
    ) {
      const nextWidth = patch.width ?? node.width
      const nextHeight = patch.height ?? node.height
      if (nextWidth !== node.width || nextHeight !== node.height) {
        const initialElements = this.transaction?.before.elements
        const fromFrame = initialElements?.[node.id] ?? node
        elements = applyConstraintsToChildren(
          elements,
          node.id,
          fromFrame,
          { width: nextWidth, height: nextHeight },
          initialElements,
        )
      }
    }

    this.commit(elements, this.state.rootIds, this.state.selection, `${label} ${node.name}`)
  }

  setLayoutConstraints(id: string, constraints: LayoutConstraints): void {
    const node = this.require(id)
    this.update(node.id, node.type, { constraints })
  }

  addFrameLayoutGrid(frameId: string, type: LayoutGridType): FrameLayoutGrid {
    const frame = this.require(frameId)
    if (frame.type !== 'frame') throw new Error('Only frames support layout grids')
    const grid = createDefaultLayoutGrid(type)
    const layoutGrids = [...(frame.layoutGrids ?? []), grid]
    this.update(frameId, 'frame', { layoutGrids })
    return grid
  }

  updateFrameLayoutGrid(frameId: string, gridId: string, patch: Partial<FrameLayoutGrid>): void {
    const frame = this.require(frameId)
    if (frame.type !== 'frame') throw new Error('Only frames support layout grids')
    const layoutGrids = (frame.layoutGrids ?? []).map(g => (g.id === gridId ? { ...g, ...patch } : g))
    this.update(frameId, 'frame', { layoutGrids })
  }

  removeFrameLayoutGrid(frameId: string, gridId: string): void {
    const frame = this.require(frameId)
    if (frame.type !== 'frame') throw new Error('Only frames support layout grids')
    const layoutGrids = (frame.layoutGrids ?? []).filter(g => g.id !== gridId)
    this.update(frameId, 'frame', { layoutGrids })
  }

  toggleFrameLayoutGridVisibility(frameId: string, gridId: string): void {
    const frame = this.require(frameId)
    if (frame.type !== 'frame') throw new Error('Only frames support layout grids')
    const layoutGrids = (frame.layoutGrids ?? []).map(g => (g.id === gridId ? { ...g, visible: !g.visible } : g))
    this.update(frameId, 'frame', { layoutGrids })
  }

  /** Flags are editable even for a locked layer, so it can always be unlocked. */
  convertTextToOutlines(id: string, d: string): PathElement {
    const source = this.require(id)
    if (source.type !== 'text') throw new Error('Select a text layer')
    if (this.isLocked(id)) throw new Error('Element is locked')
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')
    if (source.component) throw new Error('Detach the component before converting text')
    this.requireEditableStructure(source.parentId)
    if (!d.trim()) throw new Error('There are no visible glyph outlines to convert')
    const node = createElement('path', {
      id, name: `${source.name} outlines`, parentId: source.parentId,
      x: source.x, y: source.y, width: source.width, height: source.height, rotation: source.rotation,
      visible: source.visible, locked: source.locked, style: source.style,
      sizing: source.sizing, physics: source.physics,
      d, viewBox: [0, 0, source.width, source.height], fillRule: 'nonzero',
    })
    validateElement(node)
    this.commit({ ...this.state.elements, [id]: freezeElement({ ...node, zIndex: source.zIndex }) }, this.state.rootIds, [id], 'Convert text to outlines')
    return this.state.elements[id] as PathElement
  }

  setLocked(id: string, locked: boolean): void { this.setFlag(id, 'locked', locked) }
  setVisible(id: string, visible: boolean): void { this.setFlag(id, 'visible', visible) }
  private setFlag(id: string, key: 'locked' | 'visible', value: boolean) {
    const node = this.require(id)
    if (node[key] === value) return
    const action = key === 'locked' ? value ? 'Lock' : 'Unlock' : value ? 'Show' : 'Hide'
    const updated = recordComponentEdit(node, { ...node, [key]: value }, { [key]: value })
    const elements = { ...this.state.elements, [id]: freezeElement(updated) }
    this.batch(() => {
      this.commit(elements)
      this.select(this.state.selection)
    }, `${action} ${node.name}`)
  }

  select = (ids: readonly string[]): void => {
    const selection = [...new Set(ids)].filter(id => this.isVisible(id) && !this.isLocked(id))
    if (selection.length === this.state.selection.length && selection.every((id, i) => id === this.state.selection[i])) return
    if (this.selectedCompoundOperand && !selection.includes(this.selectedCompoundOperand.compoundId)) {
      this.selectedCompoundOperand = null
      for (const listener of [...this.selectedCompoundOperandListeners]) listener()
    }
    this.commit(this.state.elements, this.state.rootIds, selection, 'Select elements', false)
  }

  private index(value: number, max: number): number {
    if (!Number.isFinite(value)) throw new Error('Invalid sibling index')
    return Math.max(0, Math.min(max, Math.trunc(value)))
  }

  /** Reparenting retains local coordinates. Call update to place the node afterward. */
  reparent(id: string, parentId: string | null, index?: number): void {
    const node = this.require(id)
    this.requireFrame(parentId)
    this.requireEditableStructure(id, true)
    this.requireEditableStructure(parentId)
    if (parentId !== null && componentRoot(this.state.elements, parentId) && subtree(this.state.elements, id).some(child => child.component)) throw new Error('Nested components are not supported')
    if (this.isLocked(id) || (parentId !== null && this.isLocked(parentId))) throw new Error('Element or destination is locked')
    let ancestor = parentId
    while (ancestor !== null) {
      if (ancestor === id) throw new Error('A frame cannot contain itself or its ancestor')
      ancestor = this.require(ancestor).parentId
    }
    if (node.parentId === parentId) { this.reorder(id, index ?? this.getChildren(parentId).length - 1); return }
    const oldIds = this.getChildren(node.parentId).filter(child => child !== id)
    const newIds = [...this.getChildren(parentId)]
    newIds.splice(this.index(index ?? newIds.length, newIds.length), 0, id)
    const elements = { ...this.state.elements }
    this.ordered(elements, node.parentId, oldIds)
    this.ordered(elements, parentId, newIds)
    this.batch(() => {
      this.commit(elements, parentId === null ? newIds : node.parentId === null ? oldIds : this.state.rootIds)
      this.select(this.state.selection)
    }, `Reparent ${node.name}`)
  }

  reorder(id: string, index: number): void {
    const node = this.require(id)
    this.requireEditableStructure(id, true)
    if (this.isLocked(id)) throw new Error('Element is locked')
    const ids = this.getChildren(node.parentId).filter(child => child !== id)
    ids.splice(this.index(index, ids.length), 0, id)
    if (ids.every((child, i) => child === this.getChildren(node.parentId)[i])) return
    const elements = { ...this.state.elements }
    this.ordered(elements, node.parentId, ids)
    this.commit(elements, node.parentId === null ? ids : this.state.rootIds, this.state.selection, `Reorder ${node.name}`)
  }

  remove(id: string): void {
    const node = this.require(id)
    this.requireEditableStructure(id, true)
    if (this.isLocked(id)) throw new Error('Element is locked')
    const elements = { ...this.state.elements }
    const removeTree = (childId: string) => {
      const child = elements[childId]
      if (child.type === 'frame') child.children.forEach(removeTree)
      delete elements[childId]
    }
    removeTree(id)
    const siblings = this.getChildren(node.parentId).filter(child => child !== id)
    this.ordered(elements, node.parentId, siblings)
    this.commit(elements, node.parentId === null ? siblings : this.state.rootIds, this.state.selection.filter(selected => Object.hasOwn(elements, selected)), `Delete ${node.name}`)
  }

  componentCreationReason(id: string): string | null {
    if (this.history.getSnapshot().active) return 'Finish the active edit first.'
    const node = this.state.elements[id]
    if (!node) return 'Select a layer or frame to create a component.'
    if (this.isLocked(id)) return 'Unlock the layer first.'
    if (componentRoot(this.state.elements, id) || subtree(this.state.elements, id).some(child => child.component)) return 'Choose a layer outside an existing component.'
    return null
  }

  /** Validation check for creating a component from single or multiple selected canvas items. */
  selectionComponentCreationReason(ids: readonly string[] = this.state.selection): string | null {
    if (this.history.getSnapshot().active) return 'Finish the active edit first.'
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) return 'Select one or more layers or frames to create a component.'
    if (uniqueIds.length === 1) return this.componentCreationReason(uniqueIds[0])

    const nodes = uniqueIds.map(id => this.state.elements[id]).filter(Boolean)
    if (nodes.length !== uniqueIds.length) return 'One or more selected layers do not exist.'
    if (nodes.some(n => this.isLocked(n.id))) return 'Unlock all selected layers first.'
    if (nodes.some(n => !this.isVisible(n.id))) return 'Choose visible layers.'
    if (nodes.some(n => componentRoot(this.state.elements, n.id) || subtree(this.state.elements, n.id).some(child => child.component))) {
      return 'Choose layers outside an existing component.'
    }
    const parentId = nodes[0].parentId
    if (nodes.some(n => n.parentId !== parentId)) {
      return 'Choose layers sharing the same parent frame or canvas.'
    }
    return null
  }

  /** Any layer, including a frame with a complete subtree, can become a master. */
  createComponent(id: string): SceneElement {
    const reason = this.componentCreationReason(id)
    if (reason) throw new Error(reason)
    const now = Date.now()
    const node = freezeElement({ ...this.require(id), component: { kind: 'master', createdAt: now, updatedAt: now } })
    this.commit({ ...this.state.elements, [id]: node }, this.state.rootIds, [id], `Create ${node.name} component`)
    return node
  }

  /** Turn selection into a master component symbol. If multiple items are selected, groups them into a frame. */
  createComponentFromSelection(ids: readonly string[] = this.state.selection): SceneElement {
    const reason = this.selectionComponentCreationReason(ids)
    if (reason) throw new Error(reason)
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 1) {
      const master = this.createComponent(uniqueIds[0])
      this.autoExposeComponentProperties(master.id)
      return master
    }

    const items = uniqueIds.map(id => getWorldBounds(this.state, id)).filter(Boolean)
    const bounds = unionBounds(items)
    if (!bounds) throw new Error('Could not calculate selection bounds')

    const parentId = this.state.elements[uniqueIds[0]].parentId
    const parentBounds = parentId ? getWorldBounds(this.state, parentId) : { x: 0, y: 0 }
    const sortedIds = [...uniqueIds].sort((a, b) => this.state.elements[a].zIndex - this.state.elements[b].zIndex)
    let master: SceneElement | null = null

    this.batch(() => {
      const frame = this.add('frame', {
        name: 'Component Symbol',
        parentId,
        x: bounds.x - parentBounds.x,
        y: bounds.y - parentBounds.y,
        width: bounds.width,
        height: bounds.height,
        clipContent: false,
        style: { fill: null },
      })
      for (let i = 0; i < sortedIds.length; i++) {
        const id = sortedIds[i]
        const nodeWorld = getWorldBounds(this.state, id)
        const node = this.state.elements[id]
        this.reparent(id, frame.id, i)
        const sizing = node.sizing
        const resetSizing = sizing && (sizing.width === 'fill' || sizing.height === 'fill')
          ? { ...sizing, width: sizing.width === 'fill' ? 'fixed' as const : sizing.width, height: sizing.height === 'fill' ? 'fixed' as const : sizing.height }
          : undefined
        this.update(id, node.type, {
          x: nodeWorld.x - bounds.x,
          y: nodeWorld.y - bounds.y,
          ...(resetSizing ? { sizing: resetSizing } : {}),
        })
      }
      master = this.createComponent(frame.id)
      this.autoExposeComponentProperties(frame.id)
    }, 'Create component symbol from selection')

    this.select([master!.id])
    return master!
  }

  /** Definitions are document data; updating them is one undoable command. */
  setComponentProperties(masterId: string, properties: readonly ComponentProperty[]): void {
    const master = this.require(masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    validatePropertyTargets(master, this.state.elements, properties, resolveTokens(this.state.tokens, this.state.styleLibrary.activeThemeId), this.state.styleLibrary)
    if (equalValue(properties, master.component.properties ?? [])) return
    const next = freezeElement({ ...master, component: { ...master.component, properties, updatedAt: Date.now() } })
    this.commit({ ...this.state.elements, [masterId]: next }, this.state.rootIds, this.state.selection, 'Edit component properties')
  }

  /** Get a MasterComponent node by ID if it exists and is marked as a master symbol. */
  getMasterComponent(id: string): MasterComponent | undefined {
    const node = this.state.elements[id]
    return isMasterComponent(node) ? node : undefined
  }

  /** Get all MasterComponent nodes in the document. */
  getMasterComponents(): readonly MasterComponent[] {
    return Object.values(this.state.elements).filter(isMasterComponent)
  }

  /** Get a ComponentInstance node by ID if it exists and is marked as an instance. */
  getComponentInstance(id: string): ComponentInstance | undefined {
    const node = this.state.elements[id]
    return isComponentInstance(node) ? node : undefined
  }

  /** Get all root ComponentInstance nodes in the document, optionally filtered by masterId. */
  getComponentInstances(masterId?: string): readonly ComponentInstance[] {
    const instances = Object.values(this.state.elements).filter(isInstanceRoot)
    return masterId ? instances.filter(node => node.component.masterId === masterId) : instances
  }

  /** Get the registered instance IDs for a given master component. */
  getRegisteredInstanceIds(masterId: string): readonly string[] {
    return this.getComponentRegistry()[masterId]?.instanceIds ?? Object.freeze([])
  }

  /** Get the number of registered instances for a given master component. */
  getInstanceCount(masterId: string): number {
    return this.getRegisteredInstanceIds(masterId).length
  }

  /** Get the live component registry mapping master IDs to component schemas and registered instances. */
  getComponentRegistry(): ComponentRegistry {
    return this.state.componentRegistry ?? buildComponentRegistry(this.state.elements)
  }

  /** Get the full component schema for a master component. */
  getComponentSchema(masterId: string): MasterComponentSchema | undefined {
    const master = this.getMasterComponent(masterId)
    if (!master) return undefined
    const entry = this.getComponentRegistry()[masterId]
    return Object.freeze({
      id: master.id,
      name: master.name,
      description: master.component.description,
      masterId: master.id,
      properties: master.component.properties ?? Object.freeze([]),
      stateMachine: master.component.stateMachine,
      variantMatrix: master.component.variantMatrix,
      instanceCount: entry?.instanceIds.length ?? 0,
      instanceIds: entry?.instanceIds ?? Object.freeze([]),
      createdAt: master.component.createdAt,
      updatedAt: master.component.updatedAt,
    })
  }

  /** Get all component schemas in the document. */
  getComponentSchemas(): readonly MasterComponentSchema[] {
    return this.getMasterComponents().map(master => this.getComponentSchema(master.id)!)
  }

  /** Set optional documentation / description for a master component. */
  setComponentDescription(masterId: string, description: string): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    const trimmed = description.trim()
    const nextComponent = { ...master.component, description: trimmed, updatedAt: Date.now() }
    const next = freezeElement({ ...master, component: nextComponent })
    this.commit({ ...this.state.elements, [masterId]: next }, this.state.rootIds, this.state.selection, `Edit ${master.name} description`)
  }

  /** Add or register an exposed property schema on a master component. */
  addExposedProperty(masterId: string, property: ComponentProperty): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    const existing = master.component.properties ?? []
    if (existing.some(p => p.id === property.id || p.name.trim().toLowerCase() === property.name.trim().toLowerCase())) {
      throw new Error(`Property with id '${property.id}' or name '${property.name}' already exists`)
    }
    const nextProperties = [...existing, property]
    this.setComponentProperties(masterId, nextProperties)
  }

  /** Update an existing exposed property schema on a master component. */
  updateExposedProperty(masterId: string, propertyId: string, patch: Partial<ComponentProperty>): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    const existing = master.component.properties ?? []
    const index = existing.findIndex(p => p.id === propertyId)
    if (index === -1) throw new Error(`Property '${propertyId}' not found on master component`)
    const updated = { ...existing[index], ...patch } as ComponentProperty
    const nextProperties = [...existing]
    nextProperties[index] = updated
    this.setComponentProperties(masterId, nextProperties)
  }

  /** Remove an exposed property schema from a master component. */
  removeExposedProperty(masterId: string, propertyId: string): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    const existing = master.component.properties ?? []
    const nextProperties = existing.filter(p => p.id !== propertyId)
    if (nextProperties.length === existing.length) return
    this.setComponentProperties(masterId, nextProperties)
  }

  /** Explicitly register a component instance with a master component. */
  registerComponentInstance(masterId: string, instanceId: string): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    const instance = this.require(instanceId)
    if (!isComponentInstance(instance) || instance.component.masterId !== masterId) {
      throw new Error('Element is not an instance of the specified master')
    }
    const registry = buildComponentRegistry(this.state.elements)
    if (!equalValue(registry, this.state.componentRegistry)) {
      this.publish(Object.freeze({ ...this.state, componentRegistry: registry }), 'Register component instance', false)
    }
  }

  /** Unregister an instance by detaching it. */
  unregisterComponentInstance(instanceId: string): void {
    this.detachComponentInstance(instanceId)
  }

  /** Serialize a master component's exposed property schema and definition to a standalone JSON string. */
  serializeComponentSchema(masterId: string): string {
    const schema = this.getComponentSchema(masterId)
    if (!schema) throw new Error('Master component not found')
    return JSON.stringify(schema, null, 2)
  }

  /** Validate and parse a serialized component schema. */
  importComponentSchema(schemaJson: string): MasterComponentSchema {
    let parsed: unknown
    try { parsed = JSON.parse(schemaJson) } catch { throw new Error('Invalid JSON schema string') }
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid component schema')
    const record = parsed as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.name !== 'string' || !Array.isArray(record.properties)) {
      throw new Error('Invalid component schema structure')
    }
    validateComponentProperties(record.properties as ComponentProperty[])
    if (record.stateMachine) validateStateMachine(record.stateMachine as ComponentStateMachine)
    return parsed as MasterComponentSchema
  }

  /** Null releases a property value so it follows future master defaults. */
  setComponentProperty(id: string, propertyId: string, value: ComponentPropertyValue | null): void {
    const root = componentRoot(this.state.elements, id)
    if (root?.component?.kind !== 'instance') throw new Error('Choose a component instance')
    if (this.isLocked(root.id) || this.history.getSnapshot().active) throw new Error('Unlock the instance and finish the active edit first')
    const master = this.require(root.component.masterId)
    const property = master.component?.kind === 'master' ? master.component.properties?.find(property => property.id === propertyId || property.name.toLowerCase() === propertyId.toLowerCase()) : undefined
    const variantDim = master.component?.kind === 'master' ? master.component.variantMatrix?.dimensions.find(d => d.id === propertyId || d.name.toLowerCase() === propertyId.toLowerCase()) : undefined
    if (!property && !variantDim) throw new Error('Choose a valid component property value')
    if (property && value !== null && !validPropertyValue(property, value)) throw new Error('Choose a valid component property value')
    if (variantDim && value !== null && (typeof value !== 'string' || !variantDim.values.includes(value))) throw new Error('Choose a valid variant dimension value')
    const propKey = property ? property.id : variantDim!.name
    const propertyValues = { ...root.component.propertyValues }
    if (value === null) delete propertyValues[propKey]
    else propertyValues[propKey] = value
    if (equalValue(propertyValues, root.component.propertyValues ?? {})) return
    const next = freezeElement({ ...root, component: { ...root.component, propertyValues } })
    this.commit({ ...this.state.elements, [root.id]: next }, this.state.rootIds, this.state.selection, `Change ${property?.name ?? variantDim?.name}`)
  }

  setComponentStateMachine(masterId: string, stateMachine: ComponentStateMachine | null): void {
    const master = this.require(masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    const validated = stateMachine === null ? undefined : validateStateMachine(stateMachine)
    if (equalValue(master.component.stateMachine, validated)) return
    const next = freezeElement({ ...master, component: { ...master.component, stateMachine: validated } })
    this.commit({ ...this.state.elements, [masterId]: next }, this.state.rootIds, this.state.selection, 'Edit component state machine')
  }

  setComponentActiveState(id: string, activeState: string | null, recordHistory = true): void {
    const root = componentRoot(this.state.elements, id)
    if (root?.component?.kind !== 'instance') throw new Error('Choose a component instance')
    if (this.isLocked(root.id) || (recordHistory && this.history.getSnapshot().active)) throw new Error('Unlock the instance and finish the active edit first')
    if (activeState !== null && (typeof activeState !== 'string' || !activeState.trim())) throw new Error('Invalid active component state')
    const current = root.component.activeState ?? null
    if (current === activeState) return
    const nextComponent = { ...root.component }
    if (activeState === null) {
      delete (nextComponent as { activeState?: string }).activeState
    } else {
      nextComponent.activeState = activeState
    }
    const next = freezeElement({ ...root, component: nextComponent })
    if (recordHistory) {
      this.commit({ ...this.state.elements, [root.id]: next }, this.state.rootIds, this.state.selection, `Set state to ${activeState ?? 'default'}`)
    } else {
      let elements = synchronizeComponents({ ...this.state.elements, [root.id]: next }, resolveTokens(this.state.tokens, this.state.styleLibrary.activeThemeId), this.state.elements, this.state.styleLibrary)
      this.state = Object.freeze({ ...this.state, elements: Object.freeze(elements) })
      this.emit()
    }
  }

  generateInteractiveStates(masterId: string): void {
    const master = this.require(masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    const properties = [...(master.component.properties ?? [])]
    const existingVariant = properties.find(p => p.kind === 'variant' && (p.name.toLowerCase() === 'state' || p.options.some(o => ['default', 'hover', 'pressed', 'active'].includes(o.value))))
    const layers = subtree(this.state.elements, master.id)
    const baseCapture: Record<string, ComponentOverrides> = {}
    for (const layer of layers) {
      baseCapture[layer.id] = {
        style: { ...layer.style },
        properties: {
          width: layer.width,
          height: layer.height,
          ...('cornerRadius' in layer ? { cornerRadius: layer.cornerRadius } : {}),
          ...(layer.type === 'text' ? { text: layer.text, fontFamily: layer.fontFamily, fontSize: layer.fontSize, fontWeight: layer.fontWeight, lineHeight: layer.lineHeight, letterSpacing: layer.letterSpacing, textAlign: layer.textAlign } : {}),
        },
        ...(layer.tokenBindings ? { tokenBindings: layer.tokenBindings } : {}),
        ...(layer.sharedStyleBindings ? { sharedStyleBindings: layer.sharedStyleBindings } : {}),
      }
    }

    const hoverCapture: Record<string, ComponentOverrides> = { ...baseCapture }
    if (master.style.fill && typeof master.style.fill === 'string') {
      hoverCapture[master.id] = {
        ...hoverCapture[master.id],
        style: { ...hoverCapture[master.id]?.style, opacity: Math.max(0.7, (master.style.opacity ?? 1) * 0.9) }
      }
    }
    const pressedCapture: Record<string, ComponentOverrides> = { ...baseCapture }
    pressedCapture[master.id] = {
      ...pressedCapture[master.id],
      style: { ...pressedCapture[master.id]?.style, opacity: Math.max(0.5, (master.style.opacity ?? 1) * 0.75) }
    }
    const activeCapture: Record<string, ComponentOverrides> = { ...baseCapture }
    activeCapture[master.id] = {
      ...activeCapture[master.id],
      style: {
        ...activeCapture[master.id]?.style,
        stroke: { color: '#81adec', width: 2, dash: [] }
      }
    }

    const stateMachine = createDefaultStateMachine(['default', 'hover', 'pressed', 'active'])
    let nextProperties: ComponentProperty[]
    if (existingVariant && existingVariant.kind === 'variant') {
      const existingOptions = new Map(existingVariant.options.map(o => [o.value, o]))
      const options: ComponentVariant[] = ['default', 'hover', 'pressed', 'active'].map(val => {
        if (existingOptions.has(val)) return existingOptions.get(val)!
        if (val === 'default') return { value: val, layers: baseCapture }
        if (val === 'hover') return { value: val, layers: hoverCapture }
        if (val === 'pressed') return { value: val, layers: pressedCapture }
        return { value: val, layers: activeCapture }
      })
      for (const opt of existingVariant.options) {
        if (!options.some(o => o.value === opt.value)) options.push(opt)
      }
      nextProperties = properties.map(p => p.id === existingVariant.id ? { ...existingVariant, options, stateMachine } : p)
    } else {
      const stateProperty: ComponentProperty = {
        id: crypto.randomUUID(),
        name: 'State',
        kind: 'variant',
        defaultValue: 'default',
        options: [
          { value: 'default', layers: baseCapture },
          { value: 'hover', layers: hoverCapture },
          { value: 'pressed', layers: pressedCapture },
          { value: 'active', layers: activeCapture },
        ],
        stateMachine,
      }
      nextProperties = [...properties, stateProperty]
    }

    const next = freezeElement({
      ...master,
      component: {
        ...master.component,
        properties: nextProperties,
        stateMachine,
      }
    })
    this.commit({ ...this.state.elements, [masterId]: next }, this.state.rootIds, this.state.selection, 'Generate interactive states')
  }

  addComponentState(masterId: string, stateName: string): void {
    const master = this.require(masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    const trimmed = stateName.trim()
    if (!trimmed || trimmed.length > 100) throw new Error('Enter a valid state name (up to 100 characters)')
    const machine = getEffectiveStateMachine(master) ?? createDefaultStateMachine(['default'])
    if (machine.states.includes(trimmed)) throw new Error(`State '${trimmed}' already exists`)
    const nextStates = [...machine.states, trimmed]
    const nextMachine = validateStateMachine({
      initial: machine.initial,
      states: nextStates,
      transitions: machine.transitions,
    })

    const layers = subtree(this.state.elements, master.id)
    const baseCapture: Record<string, ComponentOverrides> = {}
    for (const layer of layers) {
      baseCapture[layer.id] = {
        style: { ...layer.style },
        properties: {
          width: layer.width,
          height: layer.height,
          ...('cornerRadius' in layer ? { cornerRadius: layer.cornerRadius } : {}),
          ...(layer.type === 'text' ? { text: layer.text, fontFamily: layer.fontFamily, fontSize: layer.fontSize, fontWeight: layer.fontWeight, lineHeight: layer.lineHeight, letterSpacing: layer.letterSpacing, textAlign: layer.textAlign } : {}),
        },
        ...(layer.tokenBindings ? { tokenBindings: layer.tokenBindings } : {}),
        ...(layer.sharedStyleBindings ? { sharedStyleBindings: layer.sharedStyleBindings } : {}),
      }
    }

    const properties = [...(master.component.properties ?? [])]
    const existingVariant = properties.find(p => p.kind === 'variant')
    let nextProperties: ComponentProperty[]
    if (existingVariant && existingVariant.kind === 'variant') {
      const options = [...existingVariant.options, { value: trimmed, layers: baseCapture }]
      nextProperties = properties.map(p => p.id === existingVariant.id ? { ...existingVariant, options, stateMachine: nextMachine } : p)
    } else {
      const stateProperty: ComponentProperty = {
        id: crypto.randomUUID(),
        name: 'State',
        kind: 'variant',
        defaultValue: machine.initial,
        options: nextStates.map(s => ({ value: s, layers: baseCapture })),
        stateMachine: nextMachine,
      }
      nextProperties = [...properties, stateProperty]
    }

    const next = freezeElement({
      ...master,
      component: {
        ...master.component,
        properties: nextProperties,
        stateMachine: nextMachine,
      }
    })
    this.commit({ ...this.state.elements, [masterId]: next }, this.state.rootIds, this.state.selection, `Add state ${trimmed}`)
  }

  removeComponentState(masterId: string, stateName: string): void {
    const master = this.require(masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    const machine = getEffectiveStateMachine(master)
    if (!machine) throw new Error('No state machine found on master')
    if (machine.states.length <= 1) throw new Error('Cannot remove the only state')
    if (!machine.states.includes(stateName)) throw new Error(`State '${stateName}' not found`)

    const nextStates = machine.states.filter(s => s !== stateName)
    const nextInitial = machine.initial === stateName ? nextStates[0] : machine.initial
    const nextTransitions = machine.transitions.filter(t => t.fromState !== stateName && t.targetState !== stateName)
    const nextMachine = validateStateMachine({
      initial: nextInitial,
      states: nextStates,
      transitions: nextTransitions,
    })

    const properties = [...(master.component.properties ?? [])]
    const existingVariant = properties.find(p => p.kind === 'variant')
    let nextProperties = properties
    if (existingVariant && existingVariant.kind === 'variant') {
      const options = existingVariant.options.filter(o => o.value !== stateName)
      const defaultValue = existingVariant.defaultValue === stateName ? nextInitial : existingVariant.defaultValue
      nextProperties = properties.map(p => p.id === existingVariant.id ? { ...existingVariant, defaultValue, options, stateMachine: nextMachine } : p)
    }

    const next = freezeElement({
      ...master,
      component: {
        ...master.component,
        properties: nextProperties,
        stateMachine: nextMachine,
      }
    })
    this.commit({ ...this.state.elements, [masterId]: next }, this.state.rootIds, this.state.selection, `Remove state ${stateName}`)
  }

  resetAllActiveStates(): void {
    let changed = false
    const nextElements = { ...this.state.elements }
    for (const [id, node] of Object.entries(this.state.elements)) {
      if (node.component?.kind === 'instance' && node.component.activeState) {
        const nextComponent = { ...node.component }
        delete (nextComponent as { activeState?: string }).activeState
        nextElements[id] = freezeElement({ ...node, component: nextComponent })
        changed = true
      }
    }
    if (!changed) return
    let synchronized = synchronizeComponents(nextElements, resolveTokens(this.state.tokens, this.state.styleLibrary.activeThemeId), this.state.elements, this.state.styleLibrary)
    this.state = Object.freeze({ ...this.state, elements: Object.freeze(synchronized) })
    this.emit()
  }

  /** Set or replace the multi-dimensional variant matrix for a master component */
  setVariantMatrix(masterId: string, matrix: ComponentVariantMatrix | null): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    if (matrix !== null) validateVariantMatrix(matrix)
    const nextComponent = { ...master.component, variantMatrix: matrix === null ? undefined : matrix, updatedAt: Date.now() }
    if (!matrix) delete (nextComponent as { variantMatrix?: ComponentVariantMatrix }).variantMatrix
    const next = freezeElement({ ...master, component: nextComponent })
    this.commit({ ...this.state.elements, [masterId]: next }, this.state.rootIds, this.state.selection, 'Update variant matrix')
  }

  /** Add a variant dimension (e.g. Size, State, Theme) to a master component */
  addVariantDimension(masterId: string, dimension: { name: string; values: string[]; defaultValue?: string }): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    const trimmedName = dimension.name.trim()
    if (!trimmedName) throw new Error('Enter a valid dimension name')
    const values = dimension.values.map(v => v.trim()).filter(Boolean)
    if (!values.length) throw new Error('Enter at least one dimension value')
    const currentMatrix = master.component.variantMatrix ?? { dimensions: [], combinations: [] }
    if (currentMatrix.dimensions.some(d => d.name.toLowerCase() === trimmedName.toLowerCase())) {
      throw new Error(`Dimension '${trimmedName}' already exists`)
    }
    const def = dimension.defaultValue && values.includes(dimension.defaultValue) ? dimension.defaultValue : values[0]
    const newDim: VariantDimension = {
      id: crypto.randomUUID(),
      name: trimmedName,
      values,
      defaultValue: def,
    }
    const nextDimensions = [...currentMatrix.dimensions, newDim]
    const nextMatrix: ComponentVariantMatrix = {
      dimensions: nextDimensions,
      combinations: currentMatrix.combinations,
    }
    this.setVariantMatrix(masterId, nextMatrix)
  }

  /** Remove a variant dimension from a master component */
  removeVariantDimension(masterId: string, dimensionId: string): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    const currentMatrix = master.component.variantMatrix
    if (!currentMatrix) return
    const nextDimensions = currentMatrix.dimensions.filter(d => d.id !== dimensionId && d.name !== dimensionId)
    const nextMatrix: ComponentVariantMatrix = {
      dimensions: nextDimensions,
      combinations: currentMatrix.combinations.map(comb => {
        const nextDims = Object.fromEntries(Object.entries(comb.dimensions).filter(([k]) => k !== dimensionId))
        return { ...comb, dimensions: nextDims }
      }),
    }
    this.setVariantMatrix(masterId, nextDimensions.length > 0 ? nextMatrix : null)
  }

  /** Update an existing variant dimension */
  updateVariantDimension(masterId: string, dimensionId: string, patch: Partial<VariantDimension>): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    const currentMatrix = master.component.variantMatrix
    if (!currentMatrix) throw new Error('No variant matrix found on master component')
    const index = currentMatrix.dimensions.findIndex(d => d.id === dimensionId || d.name === dimensionId)
    if (index === -1) throw new Error(`Dimension '${dimensionId}' not found`)
    const updated = { ...currentMatrix.dimensions[index], ...patch }
    const nextDimensions = [...currentMatrix.dimensions]
    nextDimensions[index] = updated
    this.setVariantMatrix(masterId, {
      dimensions: nextDimensions,
      combinations: currentMatrix.combinations,
    })
  }

  /** Capture current master visual appearance into a specific variant combination */
  captureVariantCombination(masterId: string, dimensions: Record<string, string>, description?: string): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')
    const layers = subtree(this.state.elements, master.id)
    const capturedLayers: Record<string, ComponentOverrides> = {}
    for (const layer of layers) {
      capturedLayers[layer.id] = {
        style: { ...layer.style },
        properties: {
          width: layer.width,
          height: layer.height,
          ...('cornerRadius' in layer ? { cornerRadius: layer.cornerRadius } : {}),
          ...(layer.type === 'text' ? { text: layer.text, fontFamily: layer.fontFamily, fontSize: layer.fontSize, fontWeight: layer.fontWeight, lineHeight: layer.lineHeight, letterSpacing: layer.letterSpacing, textAlign: layer.textAlign, ...(layer.kinetic ? { kinetic: layer.kinetic } : {}) } : {}),
        },
        ...(layer.tokenBindings ? { tokenBindings: layer.tokenBindings } : {}),
        ...(layer.sharedStyleBindings ? { sharedStyleBindings: layer.sharedStyleBindings } : {}),
      }
    }

    const currentMatrix = master.component.variantMatrix ?? {
      dimensions: Object.entries(dimensions).map(([name, val]) => ({
        id: crypto.randomUUID(),
        name,
        values: [val],
        defaultValue: val,
      })),
      combinations: [],
    }

    const existingIndex = currentMatrix.combinations.findIndex(c =>
      Object.keys(dimensions).every(k => c.dimensions[k] === dimensions[k]) &&
      Object.keys(c.dimensions).length === Object.keys(dimensions).length
    )

    const cell: VariantMatrixCell = {
      id: existingIndex >= 0 ? currentMatrix.combinations[existingIndex].id : crypto.randomUUID(),
      dimensions,
      layers: capturedLayers,
      ...(description ? { description } : {}),
    }

    const nextCombinations = [...currentMatrix.combinations]
    if (existingIndex >= 0) {
      nextCombinations[existingIndex] = cell
    } else {
      nextCombinations.push(cell)
    }

    this.setVariantMatrix(masterId, {
      dimensions: currentMatrix.dimensions,
      combinations: nextCombinations,
    })
  }

  /** Clear overrides for a variant combination */
  clearVariantCombination(masterId: string, combinationId: string): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    const currentMatrix = master.component.variantMatrix
    if (!currentMatrix) return
    const nextCombinations = currentMatrix.combinations.filter(c => c.id !== combinationId)
    this.setVariantMatrix(masterId, {
      dimensions: currentMatrix.dimensions,
      combinations: nextCombinations,
    })
  }

  /** Apply pre-configured design system matrix presets (Size, State, Theme, Full Matrix) */
  applyVariantMatrixPreset(masterId: string, preset: 'size' | 'state' | 'theme' | 'full-matrix'): void {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')

    const layers = subtree(this.state.elements, master.id)
    const baseCapture: Record<string, ComponentOverrides> = {}
    for (const layer of layers) {
      baseCapture[layer.id] = {
        style: { ...layer.style },
        properties: {
          width: layer.width,
          height: layer.height,
          ...('cornerRadius' in layer ? { cornerRadius: layer.cornerRadius } : {}),
          ...(layer.type === 'text' ? { text: layer.text, fontFamily: layer.fontFamily, fontSize: layer.fontSize, fontWeight: layer.fontWeight, lineHeight: layer.lineHeight, letterSpacing: layer.letterSpacing, textAlign: layer.textAlign } : {}),
        },
        ...(layer.tokenBindings ? { tokenBindings: layer.tokenBindings } : {}),
        ...(layer.sharedStyleBindings ? { sharedStyleBindings: layer.sharedStyleBindings } : {}),
      }
    }

    const { dimensions } = createVariantPresetDimensions(preset)
    const combinations: VariantMatrixCombination[] = []

    if (preset === 'size') {
      for (const sizeVal of ['sm', 'md', 'lg']) {
        const factor = sizeVal === 'sm' ? 0.8 : sizeVal === 'lg' ? 1.2 : 1
        const sizeLayers: Record<string, ComponentOverrides> = {}
        for (const layer of layers) {
          const w = Math.round(layer.width * factor)
          const h = Math.round(layer.height * factor)
          const rad = 'cornerRadius' in layer ? Math.max(2, Math.round((layer.cornerRadius ?? 0) * factor)) : undefined
          const fs = layer.type === 'text' ? Math.max(10, Math.round(layer.fontSize * factor)) : undefined
          sizeLayers[layer.id] = {
            ...baseCapture[layer.id],
            properties: {
              ...baseCapture[layer.id].properties,
              width: w,
              height: h,
              ...(rad !== undefined ? { cornerRadius: rad } : {}),
              ...(fs !== undefined ? { fontSize: fs } : {}),
            },
          }
        }
        combinations.push({
          id: crypto.randomUUID(),
          dimensions: { Size: sizeVal },
          layers: sizeLayers,
          description: `${sizeVal.toUpperCase()} size tier`,
        })
      }
    } else if (preset === 'state') {
      for (const stateVal of ['default', 'hover', 'pressed', 'active', 'disabled']) {
        const stateLayers: Record<string, ComponentOverrides> = {}
        for (const layer of layers) {
          let op = layer.style.opacity ?? 1
          let stroke = layer.style.stroke
          if (stateVal === 'hover') op = Math.max(0.7, op * 0.9)
          else if (stateVal === 'pressed') op = Math.max(0.5, op * 0.75)
          else if (stateVal === 'active') stroke = { color: '#81adec', width: 2, dash: [] }
          else if (stateVal === 'disabled') op = 0.4
          stateLayers[layer.id] = {
            ...baseCapture[layer.id],
            style: {
              ...baseCapture[layer.id].style,
              opacity: op,
              ...(stroke ? { stroke } : {}),
            },
          }
        }
        combinations.push({
          id: crypto.randomUUID(),
          dimensions: { State: stateVal },
          layers: stateLayers,
          description: `${stateVal} interactive state`,
        })
      }
    } else if (preset === 'theme') {
      const themes: Record<string, { fill: string; textFill: string; stroke: string }> = {
        paper: { fill: '#edebe1', textFill: '#080808', stroke: '#222222' },
        dark: { fill: '#080808', textFill: '#edebe1', stroke: '#333333' },
        accent: { fill: '#81adec', textFill: '#080808', stroke: '#81adec' },
        contrast: { fill: '#222222', textFill: '#edebe1', stroke: '#555555' },
      }
      for (const [themeVal, colors] of Object.entries(themes)) {
        const themeLayers: Record<string, ComponentOverrides> = {}
        for (const layer of layers) {
          themeLayers[layer.id] = {
            ...baseCapture[layer.id],
            style: {
              ...baseCapture[layer.id].style,
              fill: layer.type === 'text' ? colors.textFill : colors.fill,
              ...(layer.style.stroke ? { stroke: { ...layer.style.stroke, color: colors.stroke } } : {}),
            },
          }
        }
        combinations.push({
          id: crypto.randomUUID(),
          dimensions: { Theme: themeVal },
          layers: themeLayers,
          description: `${themeVal} theme appearance`,
        })
      }
    } else {
      // Full matrix combines Size × State × Theme
      for (const sizeVal of ['sm', 'md', 'lg']) {
        for (const stateVal of ['default', 'hover', 'active']) {
          for (const themeVal of ['paper', 'dark', 'accent']) {
            const factor = sizeVal === 'sm' ? 0.85 : sizeVal === 'lg' ? 1.15 : 1
            const colors = themeVal === 'dark'
              ? { fill: '#080808', textFill: '#edebe1' }
              : themeVal === 'accent'
              ? { fill: '#81adec', textFill: '#080808' }
              : { fill: '#edebe1', textFill: '#080808' }
            const cellLayers: Record<string, ComponentOverrides> = {}
            for (const layer of layers) {
              let op = layer.style.opacity ?? 1
              if (stateVal === 'hover') op = 0.9
              else if (stateVal === 'active') op = 0.95
              cellLayers[layer.id] = {
                properties: {
                  width: Math.round(layer.width * factor),
                  height: Math.round(layer.height * factor),
                  ...('cornerRadius' in layer ? { cornerRadius: Math.max(2, Math.round((layer.cornerRadius ?? 0) * factor)) } : {}),
                  ...(layer.type === 'text' ? { fontSize: Math.max(10, Math.round(layer.fontSize * factor)) } : {}),
                },
                style: {
                  fill: layer.type === 'text' ? colors.textFill : colors.fill,
                  opacity: op,
                  ...(stateVal === 'active' ? { stroke: { color: '#81adec', width: 2, dash: [] } } : {}),
                },
              }
            }
            combinations.push({
              id: crypto.randomUUID(),
              dimensions: { Size: sizeVal, State: stateVal, Theme: themeVal },
              layers: cellLayers,
            })
          }
        }
      }
    }

    const nextMatrix: ComponentVariantMatrix = {
      dimensions,
      combinations,
    }
    this.setVariantMatrix(masterId, nextMatrix)
  }

  /** Push localized instance overrides into the master's variant combination */
  pushInstanceOverridesToVariant(instanceId: string, dimensions?: Record<string, string>): void {
    const root = componentRoot(this.state.elements, instanceId)
    if (!root || root.component?.kind !== 'instance') throw new Error('Choose a component instance')
    const master = this.require(root.component.masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.isLocked(master.id)) throw new Error('Unlock the master component first')

    const activeDims = dimensions ?? (root.component.propertyValues ? Object.fromEntries(
      Object.entries(root.component.propertyValues).map(([k, v]) => [k, String(v)])
    ) : {})

    const layers = subtree(this.state.elements, root.id)
    const capturedLayers: Record<string, ComponentOverrides> = {}
    for (const layer of layers) {
      if (layer.component?.kind === 'instance' && Object.keys(layer.component.overrides).length > 0) {
        capturedLayers[layer.component.sourceId] = layer.component.overrides
      }
    }

    const currentMatrix = master.component.variantMatrix ?? {
      dimensions: Object.entries(activeDims).map(([k, v]) => ({
        id: crypto.randomUUID(),
        name: k,
        values: [v],
        defaultValue: v,
      })),
      combinations: [],
    }

    const existingIndex = currentMatrix.combinations.findIndex(c =>
      Object.keys(activeDims).every(k => c.dimensions[k] === activeDims[k])
    )

    const nextComb: VariantMatrixCombination = {
      id: existingIndex >= 0 ? currentMatrix.combinations[existingIndex].id : crypto.randomUUID(),
      dimensions: activeDims,
      layers: capturedLayers,
    }

    const nextCombinations = [...currentMatrix.combinations]
    if (existingIndex >= 0) {
      nextCombinations[existingIndex] = nextComb
    } else {
      nextCombinations.push(nextComb)
    }

    this.setVariantMatrix(master.id, {
      dimensions: currentMatrix.dimensions,
      combinations: nextCombinations,
    })
  }

  /** Compute localized scene graph property override diffs between instance and resolved master/variant */
  getOverrideDiff(instanceId: string): readonly OverrideDiffEntry[] {
    const root = componentRoot(this.state.elements, instanceId)
    if (!root || root.component?.kind !== 'instance') return []
    const master = this.state.elements[root.component.masterId]
    if (!master || master.component?.kind !== 'master') return []
    const node = this.state.elements[instanceId]
    if (!node) return []
    return getComponentOverrideDiff(node, master, resolveTokens(this.state.tokens, this.state.styleLibrary.activeThemeId), this.state.styleLibrary, this.state.elements)
  }

  /** Compute all localized scene graph property override diffs across all layers of an instance */
  getInstanceAllOverrideDiffs(instanceId: string): readonly OverrideDiffEntry[] {
    const root = componentRoot(this.state.elements, instanceId)
    if (!root || root.component?.kind !== 'instance') return []
    const master = this.state.elements[root.component.masterId]
    if (!master || master.component?.kind !== 'master') return []
    const layers = subtree(this.state.elements, root.id)
    const allDiffs: OverrideDiffEntry[] = []
    const tokens = resolveTokens(this.state.tokens, this.state.styleLibrary.activeThemeId)
    for (const layer of layers) {
      if (layer.component?.kind === 'instance') {
        const diffs = getComponentOverrideDiff(layer, master, tokens, this.state.styleLibrary, this.state.elements)
        allDiffs.push(...diffs)
      }
    }
    return Object.freeze(allDiffs)
  }

  /** Push a single property override from an instance layer to the matching variant combination in master */
  pushPropertyOverrideToVariant(layerId: string, channel: string, dimensions?: Record<string, string>): void {
    const root = componentRoot(this.state.elements, layerId)
    if (!root || root.component?.kind !== 'instance') throw new Error('Choose an instance layer')
    const master = this.require(root.component.masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.isLocked(master.id)) throw new Error('Unlock the master component first')
    const node = this.require(layerId)
    if (node.component?.kind !== 'instance') throw new Error('Choose an instance layer')

    const activeDims = dimensions ?? (root.component.propertyValues ? Object.fromEntries(
      Object.entries(root.component.propertyValues).map(([k, v]) => [k, String(v)])
    ) : {})

    const currentMatrix = master.component.variantMatrix ?? {
      dimensions: Object.entries(activeDims).map(([k, v]) => ({
        id: crypto.randomUUID(),
        name: k,
        values: [v],
        defaultValue: v,
      })),
      combinations: [],
    }

    const combIndex = currentMatrix.combinations.findIndex(c =>
      Object.keys(activeDims).every(k => c.dimensions[k] === activeDims[k]) &&
      Object.keys(c.dimensions).length === Object.keys(activeDims).length
    )

    const existingComb: VariantMatrixCombination = combIndex >= 0 ? currentMatrix.combinations[combIndex] : {
      id: crypto.randomUUID(),
      dimensions: activeDims,
      layers: {},
    }

    const sourceId = node.component.sourceId
    const existingLayerOverrides = existingComb.layers[sourceId] ?? {}
    const nodeOverrides = node.component.overrides

    const [section, propName] = channel.split('.')
    let nextLayerOverrides = { ...existingLayerOverrides }

    if (section === 'style' && nodeOverrides.style && Object.hasOwn(nodeOverrides.style, propName)) {
      nextLayerOverrides = {
        ...nextLayerOverrides,
        style: {
          ...nextLayerOverrides.style,
          [propName]: (nodeOverrides.style as any)[propName],
        },
      }
    } else if (section === 'properties' && nodeOverrides.properties && Object.hasOwn(nodeOverrides.properties, propName)) {
      nextLayerOverrides = {
        ...nextLayerOverrides,
        properties: {
          ...nextLayerOverrides.properties,
          [propName]: (nodeOverrides.properties as any)[propName],
        },
      }
    } else if (section === 'tokenBindings' && nodeOverrides.tokenBindings && Object.hasOwn(nodeOverrides.tokenBindings, propName)) {
      nextLayerOverrides = {
        ...nextLayerOverrides,
        tokenBindings: {
          ...nextLayerOverrides.tokenBindings,
          [propName]: (nodeOverrides.tokenBindings as any)[propName],
        },
      }
    } else if (section === 'sharedStyleBindings' && nodeOverrides.sharedStyleBindings && Object.hasOwn(nodeOverrides.sharedStyleBindings, propName)) {
      nextLayerOverrides = {
        ...nextLayerOverrides,
        sharedStyleBindings: {
          ...nextLayerOverrides.sharedStyleBindings,
          [propName]: (nodeOverrides.sharedStyleBindings as any)[propName],
        },
      }
    }

    const nextComb: VariantMatrixCombination = {
      ...existingComb,
      layers: {
        ...existingComb.layers,
        [sourceId]: nextLayerOverrides,
      },
    }

    const nextCombinations = [...currentMatrix.combinations]
    if (combIndex >= 0) {
      nextCombinations[combIndex] = nextComb
    } else {
      nextCombinations.push(nextComb)
    }

    this.batch(() => {
      this.setVariantMatrix(master.id, {
        dimensions: currentMatrix.dimensions,
        combinations: nextCombinations,
      })
      this.resetPropertyOverride(layerId, channel)
    }, `Push ${channel} to variant combination`)
  }

  /** Push all overrides on an instance layer to the matching variant combination in master */
  pushLayerOverridesToVariant(layerId: string, dimensions?: Record<string, string>): void {
    const root = componentRoot(this.state.elements, layerId)
    if (!root || root.component?.kind !== 'instance') throw new Error('Choose an instance layer')
    const master = this.require(root.component.masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.isLocked(master.id)) throw new Error('Unlock the master component first')
    const node = this.require(layerId)
    if (node.component?.kind !== 'instance') throw new Error('Choose an instance layer')

    const activeDims = dimensions ?? (root.component.propertyValues ? Object.fromEntries(
      Object.entries(root.component.propertyValues).map(([k, v]) => [k, String(v)])
    ) : {})

    const currentMatrix = master.component.variantMatrix ?? {
      dimensions: Object.entries(activeDims).map(([k, v]) => ({
        id: crypto.randomUUID(),
        name: k,
        values: [v],
        defaultValue: v,
      })),
      combinations: [],
    }

    const combIndex = currentMatrix.combinations.findIndex(c =>
      Object.keys(activeDims).every(k => c.dimensions[k] === activeDims[k]) &&
      Object.keys(c.dimensions).length === Object.keys(activeDims).length
    )

    const existingComb: VariantMatrixCombination = combIndex >= 0 ? currentMatrix.combinations[combIndex] : {
      id: crypto.randomUUID(),
      dimensions: activeDims,
      layers: {},
    }

    const sourceId = node.component.sourceId
    const nextComb: VariantMatrixCombination = {
      ...existingComb,
      layers: {
        ...existingComb.layers,
        [sourceId]: {
          ...(existingComb.layers[sourceId] ?? {}),
          ...node.component.overrides,
        },
      },
    }

    const nextCombinations = [...currentMatrix.combinations]
    if (combIndex >= 0) {
      nextCombinations[combIndex] = nextComb
    } else {
      nextCombinations.push(nextComb)
    }

    this.batch(() => {
      this.setVariantMatrix(master.id, {
        dimensions: currentMatrix.dimensions,
        combinations: nextCombinations,
      })
      this.resetComponentOverrides(layerId)
    }, `Push ${node.name} overrides to variant combination`)
  }

  /** Reset all overrides on an entire instance tree */
  resetAllComponentOverrides(instanceId: string): void {
    this.resetComponentOverrides(instanceId)
  }

  /** Reset overrides on a specific layer in an instance subtree */
  resetLayerOverrides(layerId: string): void {
    const node = this.require(layerId)
    if (node.component?.kind !== 'instance') throw new Error('Choose an instance layer')
    if (this.isLocked(layerId) || this.history.getSnapshot().active) throw new Error('Unlock the layer first')
    const nextNode = freezeElement({
      ...node,
      component: {
        ...node.component,
        overrides: {},
      },
    })
    this.commit({ ...this.state.elements, [layerId]: nextNode }, this.state.rootIds, this.state.selection, `Reset ${node.name} overrides`)
  }

  /** Generate a complete 2D/3D matrix grid of instances on the canvas aligned to 120px grid */
  generateVariantMatrixOnCanvas(
    masterId: string,
    options: { colDim?: string; rowDim?: string; spacing?: number } = {}
  ): SceneElement {
    const master = this.require(masterId)
    if (!isMasterComponent(master)) throw new Error('Choose a master component')
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')

    const effectiveDims = getEffectiveVariantDimensions(master)
    if (!effectiveDims.length) {
      this.applyVariantMatrixPreset(masterId, 'size')
    }

    const dims = getEffectiveVariantDimensions(this.require(masterId))
    const colDimension = dims.find(d => d.name === options.colDim) ?? dims[0]
    const rowDimension = dims.find(d => d.name === options.rowDim && d.id !== colDimension.id) ?? (dims[1] ?? { id: 'single', name: 'Variant', values: ['default'], defaultValue: 'default' })

    const colValues = colDimension.values
    const rowValues = rowDimension.values
    const gridStep = 120
    const cellWidth = Math.ceil((master.width + 40) / gridStep) * gridStep
    const cellHeight = Math.ceil((master.height + 60) / gridStep) * gridStep

    const startX = master.x + Math.ceil((master.width + 120) / gridStep) * gridStep
    const startY = master.y

    const totalWidth = Math.max(colValues.length * cellWidth + 120, 480)
    const totalHeight = Math.max(rowValues.length * cellHeight + 160, 360)

    let containerFrame: SceneElement | null = null

    this.batch(() => {
      containerFrame = this.add('frame', {
        name: `Matrix: ${master.name}`,
        x: startX,
        y: startY,
        width: totalWidth,
        height: totalHeight,
        clipContent: false,
        style: {
          fill: '#08080805',
          stroke: { color: '#81adec44', width: 1, dash: [4, 4] },
        },
      })

      for (let c = 0; c < colValues.length; c++) {
        const cVal = colValues[c]
        const colX = 100 + c * cellWidth
        this.add('text', {
          parentId: containerFrame.id,
          name: `Col: ${cVal}`,
          text: `${colDimension.name}: ${cVal}`,
          x: colX,
          y: 20,
          fontFamily: 'JetBrains Mono',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.5,
          style: { fill: '#81adec' },
        })
      }

      for (let r = 0; r < rowValues.length; r++) {
        const rVal = rowValues[r]
        const rowY = 60 + r * cellHeight
        if (rowDimension.id !== 'single') {
          this.add('text', {
            parentId: containerFrame.id,
            name: `Row: ${rVal}`,
            text: `${rowDimension.name}: ${rVal}`,
            x: 16,
            y: rowY + Math.round(master.height / 2) - 6,
            fontFamily: 'JetBrains Mono',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.5,
            style: { fill: '#81adec' },
          })
        }

        for (let c = 0; c < colValues.length; c++) {
          const cVal = colValues[c]
          const instX = 100 + c * cellWidth
          const instY = rowY

          const instance = this.createComponentInstance(masterId, {
            parentId: containerFrame.id,
            x: instX,
            y: instY,
          })

          const propValues: Record<string, ComponentPropertyValue> = {
            [colDimension.id]: cVal,
            [colDimension.name]: cVal,
          }
          if (rowDimension.id !== 'single') {
            propValues[rowDimension.id] = rVal
            propValues[rowDimension.name] = rVal
          }
          for (const [k, v] of Object.entries(propValues)) {
            try {
              this.setComponentProperty(instance.id, k, v)
            } catch {
              // Ignore if slot not found
            }
          }
        }
      }
    }, `Generate ${master.name} Variant Matrix`)

    this.select([containerFrame!.id])
    return containerFrame!
  }

  createComponentInstance(masterId: string, placement: { x?: number; y?: number; parentId?: string | null } = {}): SceneElement {
    const master = this.require(masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')
    const parentId = placement.parentId === undefined ? master.parentId : placement.parentId
    this.requireFrame(parentId)
    this.requireEditableStructure(parentId)
    if (parentId && (componentRoot(this.state.elements, parentId) || this.isLocked(parentId))) throw new Error('Choose an unlocked destination outside a component')
    const y = placement.y ?? master.y
    let x = placement.x ?? master.x + Math.ceil(master.width / 120) * 120 + 120
    if (placement.x === undefined) {
      const neighbors = this.getChildren(parentId).map(id => this.state.elements[id]).filter(node => node.visible).sort((a, b) => a.x - b.x)
      for (const neighbor of neighbors) {
        if (x < neighbor.x + neighbor.width && x + master.width > neighbor.x && y < neighbor.y + neighbor.height && y + master.height > neighbor.y) x = master.x + Math.ceil((neighbor.x + neighbor.width - master.x) / 120) * 120 + 120
      }
    }
    const id = crypto.randomUUID()
    const node = freezeElement({ ...master, id, parentId, x, y,
      component: { kind: 'instance', masterId, sourceId: masterId, instanceId: id, overrides: {} }, ...(master.type === 'frame' ? { children: [] } : {}),
    })
    validateElement(node)
    const elements = { ...this.state.elements, [id]: node }, siblings = [...this.getChildren(parentId), id]
    this.ordered(elements, parentId, siblings)
    this.commit(elements, parentId === null ? siblings : this.state.rootIds, [id], `Insert ${master.name} instance`)
    return this.state.elements[id]
  }

  /** A descendant action always detaches the complete instance without changing its appearance. */
  detachComponentInstance(id: string): void {
    const root = componentRoot(this.state.elements, id)
    if (root?.component?.kind !== 'instance') throw new Error('Choose a component instance')
    if (this.isLocked(root.id) || this.history.getSnapshot().active) throw new Error('Unlock the instance and finish the active edit first')
    const elements = { ...this.state.elements }
    for (const node of subtree(elements, root.id)) {
      const { component, ...detached } = node
      void component
      elements[node.id] = freezeElement(detached)
    }
    this.commit(elements, this.state.rootIds, this.state.selection, `Detach ${root.name} instance`)
  }

  /** Root reset includes all descendants. A child reset restores just that layer. */
  resetComponentOverrides(id: string): void {
    const node = this.require(id)
    if (node.component?.kind !== 'instance') throw new Error('Choose an instance layer')
    if (this.isLocked(id) || this.history.getSnapshot().active) throw new Error('Unlock the layer and finish the active edit first')
    const elements = { ...this.state.elements }
    const nodes = node.component.instanceId === id ? subtree(elements, id) : [node]
    for (const child of nodes) if (child.component?.kind === 'instance') elements[child.id] = freezeElement({ ...child, component: { ...child.component, overrides: {}, ...(child.id === id && child.component.propertyValues ? { propertyValues: {} } : {}) } })
    this.commit(elements, this.state.rootIds, this.state.selection, `Reset ${node.name} overrides`)
  }

  /** Push local property and visual overrides from an instance back to its master component. */
  pushOverridesToMaster(id: string): void {
    const root = componentRoot(this.state.elements, id)
    if (root?.component?.kind !== 'instance') throw new Error('Choose a component instance')
    if (this.isLocked(root.id) || this.history.getSnapshot().active) throw new Error('Unlock the instance and finish the active edit first')
    const master = this.require(root.component.masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.isLocked(master.id)) throw new Error('Unlock the master component first')

    let elements = { ...this.state.elements }
    const instanceNodes = subtree(this.state.elements, root.id)

    // For each layer in the instance, push overrides to corresponding master layer
    for (const node of instanceNodes) {
      if (node.component?.kind !== 'instance') continue
      const sourceId = node.component.sourceId
      const masterLayer = elements[sourceId]
      if (!masterLayer) continue

      const { properties = {}, style = {}, tokenBindings = {}, sharedStyleBindings = {} } = node.component.overrides
      let updatedMaster = { ...masterLayer } as any

      // Apply property overrides (exclude root coordinates to preserve master position)
      for (const [key, val] of Object.entries(properties)) {
        if (masterLayer.id === master.id && ['x', 'y', 'rotation'].includes(key)) continue
        if (key === 'kinetic' && masterLayer.type === 'text') {
          if (val === null) delete updatedMaster.kinetic
          else updatedMaster.kinetic = { ...(masterLayer.kinetic ?? {}), ...(val as Record<string, unknown>) }
        } else if (['variableAxes', 'openTypeFeatures', 'textOnPath'].includes(key) && val && masterLayer.type === 'text') {
          updatedMaster[key] = { ...((masterLayer as any)[key] ?? {}), ...(val as Record<string, unknown>) }
        } else {
          updatedMaster[key] = val
        }
      }

      // Apply style overrides
      if (Object.keys(style).length) {
        const nextStyle = { ...masterLayer.style } as any
        for (const [key, val] of Object.entries(style)) {
          if (key === 'stroke' && val && masterLayer.style.stroke) {
            nextStyle.stroke = { ...masterLayer.style.stroke, ...(val as Record<string, unknown>) }
          } else if (key === 'shader' && val && masterLayer.style.shader) {
            const shaderVal = val as any
            nextStyle.shader = {
              ...masterLayer.style.shader,
              ...shaderVal,
              params: { ...(masterLayer.style.shader.params ?? {}), ...(shaderVal.params ?? {}) },
              ...(masterLayer.style.shader.mesh || shaderVal.mesh ? { mesh: { ...(masterLayer.style.shader.mesh ?? {}), ...(shaderVal.mesh ?? {}) } } : {}),
              ...(masterLayer.style.shader.composite || shaderVal.composite ? { composite: { ...(masterLayer.style.shader.composite ?? {}), ...(shaderVal.composite ?? {}) } } : {}),
            }
          } else {
            nextStyle[key] = val
          }
        }
        updatedMaster.style = nextStyle
      }

      // Apply token bindings
      if (Object.keys(tokenBindings).length) {
        const nextTokens = { ...(masterLayer.tokenBindings ?? {}) } as any
        for (const [p, tokenId] of Object.entries(tokenBindings)) {
          if (tokenId === null) delete nextTokens[p]
          else nextTokens[p] = tokenId
        }
        updatedMaster.tokenBindings = Object.keys(nextTokens).length ? nextTokens : undefined
      }

      // Apply shared style bindings
      if (Object.keys(sharedStyleBindings).length) {
        const nextShared = { ...(masterLayer.sharedStyleBindings ?? {}) } as any
        for (const [k, sId] of Object.entries(sharedStyleBindings)) {
          if (sId === null) delete nextShared[k]
          else nextShared[k] = sId
        }
        updatedMaster.sharedStyleBindings = Object.keys(nextShared).length ? nextShared : undefined
      }

      validateElement(updatedMaster)
      elements[sourceId] = freezeElement(updatedMaster)

      // Clear overrides on the instance layer
      elements[node.id] = freezeElement({
        ...node,
        component: {
          ...node.component,
          overrides: {},
        },
      })
    }

    // If root instance had propertyValues, update master component.properties default values
    const rootComponent = root.component
    if (rootComponent.propertyValues && Object.keys(rootComponent.propertyValues).length && master.component.properties) {
      const updatedProperties = master.component.properties.map(prop => {
        if (Object.hasOwn(rootComponent.propertyValues ?? {}, prop.id)) {
          const val = (rootComponent.propertyValues as any)[prop.id]
          return { ...prop, defaultValue: val }
        }
        return prop
      })

      // Also apply the property values to the target master layers
      for (const [propId, val] of Object.entries(rootComponent.propertyValues)) {
        const prop = updatedProperties.find(p => p.id === propId)
        if (!prop) continue
        if (prop.kind === 'variant') {
          const opt = prop.options.find(o => o.value === val)
          if (opt?.layers) {
            for (const [layerId] of Object.entries(opt.layers)) {
              const layerElem = elements[layerId]
              if (layerElem) {
                const updatedLayer = applyPropertyValueToElement(layerElem, prop, val)
                validateElement(updatedLayer)
                elements[layerId] = freezeElement(updatedLayer)
              }
            }
          }
        } else {
          const targetElement = elements[prop.sourceId]
          if (targetElement) {
            const updated = applyPropertyValueToElement(targetElement, prop, val)
            validateElement(updated)
            elements[prop.sourceId] = freezeElement(updated)
          }
        }
      }

      const currentMaster = elements[master.id]
      elements[master.id] = freezeElement({
        ...currentMaster,
        component: {
          ...currentMaster.component,
          properties: updatedProperties,
        } as any,
      })

      // Clear property values on instance root
      elements[root.id] = freezeElement({
        ...elements[root.id],
        component: {
          ...elements[root.id].component,
          propertyValues: {},
        } as any,
      })
    }

    this.commit(elements, this.state.rootIds, this.state.selection, `Push overrides to ${master.name}`)
  }

  /** Push a single local property override from an instance back to its master component. */
  pushComponentPropertyToMaster(id: string, propertyId: string): void {
    const root = componentRoot(this.state.elements, id)
    if (root?.component?.kind !== 'instance') throw new Error('Choose a component instance')
    if (this.isLocked(root.id) || this.history.getSnapshot().active) throw new Error('Unlock the instance and finish the active edit first')
    const master = this.require(root.component.masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.isLocked(master.id)) throw new Error('Unlock the master component first')

    const rootComponent = root.component
    if (!rootComponent.propertyValues || !Object.hasOwn(rootComponent.propertyValues, propertyId)) {
      throw new Error('This property has no local override to push')
    }
    const val = rootComponent.propertyValues[propertyId]
    const prop = master.component.properties?.find(p => p.id === propertyId)
    if (!prop) throw new Error('Property not found on master component')

    let elements = { ...this.state.elements }
    const updatedProperties = (master.component.properties ?? []).map(p =>
      p.id === propertyId ? { ...p, defaultValue: val } : p
    )

    if (prop.kind === 'variant') {
      const opt = prop.options.find(o => o.value === val)
      if (opt?.layers) {
        for (const [layerId] of Object.entries(opt.layers)) {
          const layerElem = elements[layerId]
          if (layerElem) {
            const updatedLayer = applyPropertyValueToElement(layerElem, prop, val)
            validateElement(updatedLayer)
            elements[layerId] = freezeElement(updatedLayer)
          }
        }
      }
    } else {
      const targetElement = elements[prop.sourceId]
      if (targetElement) {
        const updated = applyPropertyValueToElement(targetElement, prop, val)
        validateElement(updated)
        elements[prop.sourceId] = freezeElement(updated)
      }
    }

    const currentMaster = elements[master.id]
    elements[master.id] = freezeElement({
      ...currentMaster,
      component: {
        ...currentMaster.component,
        properties: updatedProperties,
      } as any,
    })

    const nextPropertyValues = { ...rootComponent.propertyValues }
    delete nextPropertyValues[propertyId]
    elements[root.id] = freezeElement({
      ...elements[root.id],
      component: {
        ...elements[root.id].component,
        propertyValues: nextPropertyValues,
      } as any,
    })

    this.commit(elements, this.state.rootIds, this.state.selection, `Push ${prop.name} to ${master.name}`)
  }

  /** Push local visual and property overrides from a single instance layer back to its master layer. */
  pushLayerOverridesToMaster(id: string): void {
    const node = this.require(id)
    if (node.component?.kind !== 'instance') throw new Error('Choose an instance layer')
    if (this.isLocked(id) || this.history.getSnapshot().active) throw new Error('Unlock the layer and finish the active edit first')
    const root = componentRoot(this.state.elements, id)
    if (!root || root.component?.kind !== 'instance') throw new Error('Choose a component instance')
    const master = this.require(root.component.masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.isLocked(master.id)) throw new Error('Unlock the master component first')

    let elements = { ...this.state.elements }
    const sourceId = node.component.sourceId
    const masterLayer = elements[sourceId]
    if (!masterLayer) throw new Error('Master layer not found')

    const { properties = {}, style = {}, tokenBindings = {}, sharedStyleBindings = {} } = node.component.overrides
    let updatedMaster = { ...masterLayer } as any

    for (const [key, val] of Object.entries(properties)) {
      if (masterLayer.id === master.id && ['x', 'y', 'rotation'].includes(key)) continue
      if (key === 'kinetic' && masterLayer.type === 'text') {
        if (val === null) delete updatedMaster.kinetic
        else updatedMaster.kinetic = { ...(masterLayer.kinetic ?? {}), ...(val as Record<string, unknown>) }
      } else if (['variableAxes', 'openTypeFeatures', 'textOnPath'].includes(key) && val && masterLayer.type === 'text') {
        updatedMaster[key] = { ...((masterLayer as any)[key] ?? {}), ...(val as Record<string, unknown>) }
      } else {
        updatedMaster[key] = val
      }
    }

    if (Object.keys(style).length) {
      const nextStyle = { ...masterLayer.style } as any
      for (const [key, val] of Object.entries(style)) {
        if (key === 'stroke' && val && masterLayer.style.stroke) {
          nextStyle.stroke = { ...masterLayer.style.stroke, ...(val as Record<string, unknown>) }
        } else if (key === 'shader' && val && masterLayer.style.shader) {
          const shaderVal = val as any
          nextStyle.shader = {
            ...masterLayer.style.shader,
            ...shaderVal,
            params: { ...(masterLayer.style.shader.params ?? {}), ...(shaderVal.params ?? {}) },
            ...(masterLayer.style.shader.mesh || shaderVal.mesh ? { mesh: { ...(masterLayer.style.shader.mesh ?? {}), ...(shaderVal.mesh ?? {}) } } : {}),
            ...(masterLayer.style.shader.composite || shaderVal.composite ? { composite: { ...(masterLayer.style.shader.composite ?? {}), ...(shaderVal.composite ?? {}) } } : {}),
          }
        } else {
          nextStyle[key] = val
        }
      }
      updatedMaster.style = nextStyle
    }

    if (Object.keys(tokenBindings).length) {
      const nextTokens = { ...(masterLayer.tokenBindings ?? {}) } as any
      for (const [p, tokenId] of Object.entries(tokenBindings)) {
        if (tokenId === null) delete nextTokens[p]
        else nextTokens[p] = tokenId
      }
      updatedMaster.tokenBindings = Object.keys(nextTokens).length ? nextTokens : undefined
    }

    if (Object.keys(sharedStyleBindings).length) {
      const nextShared = { ...(masterLayer.sharedStyleBindings ?? {}) } as any
      for (const [k, sId] of Object.entries(sharedStyleBindings)) {
        if (sId === null) delete nextShared[k]
        else nextShared[k] = sId
      }
      updatedMaster.sharedStyleBindings = Object.keys(nextShared).length ? nextShared : undefined
    }

    validateElement(updatedMaster)
    elements[sourceId] = freezeElement(updatedMaster)

    elements[node.id] = freezeElement({
      ...node,
      component: {
        ...node.component,
        overrides: {},
      },
    })

    this.commit(elements, this.state.rootIds, this.state.selection, `Push ${node.name} overrides to ${master.name}`)
  }

  /** Push a single channel override (e.g. 'style.fill', 'cornerRadius') from an instance layer back to master. */
  /** Push a single channel override (e.g. 'style.fill', 'cornerRadius', 'kinetic.amplitude', 'shader.speed') from an instance layer back to master. */
  /** Push a single channel override (e.g. 'style.fill', 'cornerRadius', 'kinetic.amplitude', 'shader.speed') from an instance layer back to master. */
  pushPropertyOverrideToMaster(id: string, channel: string): void {
    const node = this.require(id)
    if (node.component?.kind !== 'instance') throw new Error('Choose an instance layer')
    if (this.isLocked(id) || this.history.getSnapshot().active) throw new Error('Unlock the layer and finish the active edit first')
    const root = componentRoot(this.state.elements, id)
    if (!root || root.component?.kind !== 'instance') throw new Error('Choose a component instance')
    const master = this.require(root.component.masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.isLocked(master.id)) throw new Error('Unlock the master component first')

    let elements = { ...this.state.elements }
    const sourceId = node.component.sourceId
    const masterLayer = elements[sourceId]
    if (!masterLayer) throw new Error('Master layer not found')

    const overrides = node.component.overrides
    let updatedMaster = { ...masterLayer } as any
    const nextOverrides: {
      properties?: Record<string, any>
      style?: Record<string, any>
      tokenBindings?: Record<string, any>
      sharedStyleBindings?: Record<string, any>
    } = {
      ...(overrides.properties ? { properties: { ...(overrides.properties as Record<string, any>) } } : {}),
      ...(overrides.style ? { style: { ...(overrides.style as Record<string, any>) } } : {}),
      ...(overrides.tokenBindings ? { tokenBindings: { ...(overrides.tokenBindings as Record<string, any>) } } : {}),
      ...(overrides.sharedStyleBindings ? { sharedStyleBindings: { ...(overrides.sharedStyleBindings as Record<string, any>) } } : {}),
    }

    const cleanEmpty = () => {
      if (nextOverrides.properties && Object.keys(nextOverrides.properties).length === 0) delete nextOverrides.properties
      if (nextOverrides.style && Object.keys(nextOverrides.style).length === 0) delete nextOverrides.style
      if (nextOverrides.tokenBindings && Object.keys(nextOverrides.tokenBindings).length === 0) delete nextOverrides.tokenBindings
      if (nextOverrides.sharedStyleBindings && Object.keys(nextOverrides.sharedStyleBindings).length === 0) delete nextOverrides.sharedStyleBindings
    }

    let pushedLabel = channel

    // Kinetic typography channel
    if (channel === 'kinetic' || channel === 'properties.kinetic') {
      const val = nextOverrides.properties?.kinetic
      if (val !== undefined && masterLayer.type === 'text') {
        if (val === null) delete updatedMaster.kinetic
        else updatedMaster.kinetic = { ...(masterLayer.kinetic ?? {}), ...(val as Record<string, unknown>) }
        delete nextOverrides.properties?.kinetic
      }
    } else if (channel.startsWith('kinetic.') || channel.startsWith('properties.kinetic.')) {
      const kKey = channel.replace(/^properties\./, '').replace(/^kinetic\./, '')
      pushedLabel = `kinetic ${kKey}`
      if (nextOverrides.properties?.kinetic && typeof nextOverrides.properties.kinetic === 'object' && masterLayer.type === 'text') {
        const kinetic = { ...(nextOverrides.properties.kinetic as Record<string, unknown>) }
        if (Object.hasOwn(kinetic, kKey)) {
          const val = kinetic[kKey]
          updatedMaster.kinetic = { ...(updatedMaster.kinetic ?? {}), [kKey]: val }
          delete kinetic[kKey]
          if (Object.keys(kinetic).length === 0) delete nextOverrides.properties.kinetic
          else nextOverrides.properties.kinetic = kinetic
        }
      }
    }
    // Variable font axes
    else if (channel === 'variableAxes' || channel === 'properties.variableAxes') {
      const val = nextOverrides.properties?.variableAxes
      if (val && masterLayer.type === 'text') {
        updatedMaster.variableAxes = { ...(masterLayer.variableAxes ?? {}), ...(val as Record<string, number>) }
        delete nextOverrides.properties?.variableAxes
      }
    } else if (channel.startsWith('variableAxes.') || channel.startsWith('properties.variableAxes.')) {
      const aKey = channel.replace(/^properties\./, '').replace(/^variableAxes\./, '')
      pushedLabel = `axis ${aKey}`
      if (nextOverrides.properties?.variableAxes && typeof nextOverrides.properties.variableAxes === 'object' && masterLayer.type === 'text') {
        const axes = { ...(nextOverrides.properties.variableAxes as Record<string, number>) }
        if (Object.hasOwn(axes, aKey)) {
          updatedMaster.variableAxes = { ...(updatedMaster.variableAxes ?? {}), [aKey]: axes[aKey] }
          delete axes[aKey]
          if (Object.keys(axes).length === 0) delete nextOverrides.properties.variableAxes
          else nextOverrides.properties.variableAxes = axes
        }
      }
    }
    // Shader property or subchannel
    else if (channel === 'shader' || channel === 'style.shader') {
      const val = nextOverrides.style?.shader as any
      if (val && masterLayer.style.shader) {
        updatedMaster.style = {
          ...masterLayer.style,
          shader: {
            ...masterLayer.style.shader,
            ...val,
            params: { ...(masterLayer.style.shader.params ?? {}), ...(val.params ?? {}) },
            ...(masterLayer.style.shader.mesh || val.mesh ? { mesh: { ...(masterLayer.style.shader.mesh ?? {}), ...(val.mesh ?? {}) } } : {}),
            ...(masterLayer.style.shader.composite || val.composite ? { composite: { ...(masterLayer.style.shader.composite ?? {}), ...(val.composite ?? {}) } } : {}),
            ...(masterLayer.style.shader.postProcessing || val.postProcessing ? { postProcessing: { ...(masterLayer.style.shader.postProcessing ?? {}), ...(val.postProcessing ?? {}) } } : {}),
            ...(masterLayer.style.shader.pipeline || val.pipeline ? { pipeline: val.pipeline ?? masterLayer.style.shader.pipeline } : {}),
          },
        }
        delete nextOverrides.style?.shader
      }
    } else if (channel.startsWith('shader.') || channel.startsWith('style.shader.')) {
      const sKey = channel.replace(/^style\./, '').replace(/^shader\./, '')
      pushedLabel = `shader ${sKey}`
      if (nextOverrides.style?.shader && typeof nextOverrides.style.shader === 'object' && masterLayer.style.shader) {
        const shaderObj = { ...(nextOverrides.style.shader as Record<string, any>) }
        const currentShader = { ...masterLayer.style.shader } as any
        if (sKey.startsWith('params.')) {
          const pKey = sKey.replace(/^params\./, '')
          if (shaderObj.params && Object.hasOwn(shaderObj.params, pKey)) {
            currentShader.params = { ...(currentShader.params ?? {}), [pKey]: shaderObj.params[pKey] }
            const params = { ...(shaderObj.params as Record<string, unknown>) }
            delete params[pKey]
            if (Object.keys(params).length === 0) delete shaderObj.params
            else shaderObj.params = params
          }
        } else if (sKey.startsWith('mesh.')) {
          const mKey = sKey.replace(/^mesh\./, '')
          if (shaderObj.mesh && Object.hasOwn(shaderObj.mesh, mKey)) {
            currentShader.mesh = { ...(currentShader.mesh ?? {}), [mKey]: shaderObj.mesh[mKey] }
            const mesh = { ...(shaderObj.mesh as Record<string, unknown>) }
            delete mesh[mKey]
            if (Object.keys(mesh).length === 0) delete shaderObj.mesh
            else shaderObj.mesh = mesh
          }
        } else if (['frequency', 'turbulence', 'octaves', 'displacement', 'normalPerturbation', 'noiseType', 'viewMode', 'colorFront', 'colorMid', 'colorBack', 'lacunarity', 'persistence', 'grainOverlay', 'grainMixer', 'specularStrength', 'lightAngle'].includes(sKey)) {
          if (shaderObj.params && Object.hasOwn(shaderObj.params, sKey)) {
            currentShader.params = { ...(currentShader.params ?? {}), [sKey]: shaderObj.params[sKey] }
            const params = { ...(shaderObj.params as Record<string, unknown>) }
            delete params[sKey]
            if (Object.keys(params).length === 0) delete shaderObj.params
            else shaderObj.params = params
          }
          if (shaderObj.mesh && Object.hasOwn(shaderObj.mesh, sKey)) {
            currentShader.mesh = { ...(currentShader.mesh ?? {}), [sKey]: shaderObj.mesh[sKey] }
            const mesh = { ...(shaderObj.mesh as Record<string, unknown>) }
            delete mesh[sKey]
            if (Object.keys(mesh).length === 0) delete shaderObj.mesh
            else shaderObj.mesh = mesh
          }
        } else if (Object.hasOwn(shaderObj, sKey)) {
          currentShader[sKey] = shaderObj[sKey]
          delete shaderObj[sKey]
        }
        updatedMaster.style = { ...updatedMaster.style, shader: currentShader }
        const hasShaderContent = Object.keys(shaderObj).filter(k => k !== 'kind').length > 0
        if (!hasShaderContent) delete nextOverrides.style.shader
        else nextOverrides.style.shader = shaderObj
      }
    }
    // Stroke subchannel
    else if (channel.startsWith('stroke.') || channel.startsWith('style.stroke.')) {
      const strKey = channel.replace(/^style\./, '').replace(/^stroke\./, '')
      pushedLabel = `stroke ${strKey}`
      if (nextOverrides.style?.stroke && typeof nextOverrides.style.stroke === 'object' && masterLayer.style.stroke) {
        const strokeObj = { ...(nextOverrides.style.stroke as Record<string, unknown>) }
        if (Object.hasOwn(strokeObj, strKey)) {
          updatedMaster.style = { ...updatedMaster.style, stroke: { ...updatedMaster.style.stroke, [strKey]: strokeObj[strKey] } }
          delete strokeObj[strKey]
          if (Object.keys(strokeObj).length === 0) delete nextOverrides.style.stroke
          else nextOverrides.style.stroke = strokeObj
        }
      }
    }
    // Token bindings
    else if (channel === 'tokenBindings' || channel.startsWith('tokenBindings.')) {
      const tKey = channel === 'tokenBindings' ? undefined : channel.replace(/^tokenBindings\./, '')
      pushedLabel = tKey ? `token binding ${tKey}` : 'token bindings'
      const nextTokens = { ...(masterLayer.tokenBindings ?? {}) } as any
      for (const [p, tokenId] of Object.entries(nextOverrides.tokenBindings ?? {})) {
        if (!tKey || p === tKey) {
          if (tokenId === null) delete nextTokens[p]
          else nextTokens[p] = tokenId
          if (nextOverrides.tokenBindings) delete nextOverrides.tokenBindings[p]
        }
      }
      updatedMaster.tokenBindings = Object.keys(nextTokens).length ? nextTokens : undefined
      if (nextOverrides.tokenBindings && Object.keys(nextOverrides.tokenBindings).length === 0) delete nextOverrides.tokenBindings
    }
    // Shared styles
    else if (channel === 'sharedStyleBindings' || channel.startsWith('sharedStyleBindings.')) {
      const sKey = channel === 'sharedStyleBindings' ? undefined : channel.replace(/^sharedStyleBindings\./, '')
      pushedLabel = sKey ? `shared style ${sKey}` : 'shared styles'
      const nextShared = { ...(masterLayer.sharedStyleBindings ?? {}) } as any
      for (const [k, sId] of Object.entries(nextOverrides.sharedStyleBindings ?? {})) {
        if (!sKey || k === sKey) {
          if (sId === null) delete nextShared[k]
          else nextShared[k] = sId
          if (nextOverrides.sharedStyleBindings) delete nextOverrides.sharedStyleBindings[k]
        }
      }
      updatedMaster.sharedStyleBindings = Object.keys(nextShared).length ? nextShared : undefined
      if (nextOverrides.sharedStyleBindings && Object.keys(nextOverrides.sharedStyleBindings).length === 0) delete nextOverrides.sharedStyleBindings
    }
    // Style property (e.g. fill, opacity, shadow)
    else if (channel.startsWith('style.') || (nextOverrides.style && Object.hasOwn(nextOverrides.style, channel))) {
      const sKey = channel.replace(/^style\./, '')
      pushedLabel = sKey
      if (nextOverrides.style && Object.hasOwn(nextOverrides.style, sKey)) {
        const val = nextOverrides.style[sKey]
        if (sKey === 'stroke' && val && masterLayer.style.stroke) {
          updatedMaster.style = { ...updatedMaster.style, stroke: { ...masterLayer.style.stroke, ...(val as Record<string, unknown>) } }
        } else {
          updatedMaster.style = { ...updatedMaster.style, [sKey]: val }
        }
        delete nextOverrides.style[sKey]
        if (Object.keys(nextOverrides.style).length === 0) delete nextOverrides.style
      }
    }
    // Property override (e.g. cornerRadius, text, fontSize)
    else {
      const pKey = channel.replace(/^properties\./, '')
      pushedLabel = pKey
      if (nextOverrides.properties && Object.hasOwn(nextOverrides.properties, pKey)) {
        const val = nextOverrides.properties[pKey]
        if (pKey === 'kinetic' && masterLayer.type === 'text') {
          if (val === null) delete updatedMaster.kinetic
          else updatedMaster.kinetic = { ...(masterLayer.kinetic ?? {}), ...(val as Record<string, unknown>) }
        } else if (!(masterLayer.id === master.id && ['x', 'y', 'rotation'].includes(pKey))) {
          updatedMaster[pKey] = val
        }
        delete nextOverrides.properties[pKey]
        if (Object.keys(nextOverrides.properties).length === 0) delete nextOverrides.properties
      }
    }

    cleanEmpty()
    validateElement(updatedMaster)
    elements[sourceId] = freezeElement(updatedMaster)

    elements[node.id] = freezeElement({
      ...node,
      component: {
        ...node.component,
        overrides: nextOverrides as ComponentOverrides,
      },
    })

    this.commit(elements, this.state.rootIds, this.state.selection, `Push ${pushedLabel} on ${node.name} to ${master.name}`)
  }

  /** Reset a single channel override (e.g. 'style.fill', 'cornerRadius', 'kinetic.amplitude', 'shader.speed') on an instance layer. */
  resetPropertyOverride(id: string, channel: string): void {
    const node = this.require(id)
    if (node.component?.kind !== 'instance') throw new Error('Choose an instance layer')
    if (this.isLocked(id) || this.history.getSnapshot().active) throw new Error('Unlock the layer and finish the active edit first')

    const overrides = node.component.overrides
    const nextOverrides: {
      properties?: Record<string, any>
      style?: Record<string, any>
      tokenBindings?: Record<string, any>
      sharedStyleBindings?: Record<string, any>
    } = {
      ...(overrides.properties ? { properties: { ...(overrides.properties as Record<string, any>) } } : {}),
      ...(overrides.style ? { style: { ...(overrides.style as Record<string, any>) } } : {}),
      ...(overrides.tokenBindings ? { tokenBindings: { ...(overrides.tokenBindings as Record<string, any>) } } : {}),
      ...(overrides.sharedStyleBindings ? { sharedStyleBindings: { ...(overrides.sharedStyleBindings as Record<string, any>) } } : {}),
    }

    const cleanEmpty = () => {
      if (nextOverrides.properties && Object.keys(nextOverrides.properties).length === 0) delete nextOverrides.properties
      if (nextOverrides.style && Object.keys(nextOverrides.style).length === 0) delete nextOverrides.style
      if (nextOverrides.tokenBindings && Object.keys(nextOverrides.tokenBindings).length === 0) delete nextOverrides.tokenBindings
      if (nextOverrides.sharedStyleBindings && Object.keys(nextOverrides.sharedStyleBindings).length === 0) delete nextOverrides.sharedStyleBindings
    }

    let resetLabel = channel

    // Kinetic typography channel
    if (channel === 'kinetic' || channel === 'properties.kinetic') {
      delete nextOverrides.properties?.kinetic
    } else if (channel.startsWith('kinetic.') || channel.startsWith('properties.kinetic.')) {
      const kKey = channel.replace(/^properties\./, '').replace(/^kinetic\./, '')
      resetLabel = `kinetic ${kKey}`
      if (nextOverrides.properties?.kinetic && typeof nextOverrides.properties.kinetic === 'object') {
        const kinetic = { ...(nextOverrides.properties.kinetic as Record<string, unknown>) }
        delete kinetic[kKey]
        if (Object.keys(kinetic).length === 0) delete nextOverrides.properties.kinetic
        else nextOverrides.properties.kinetic = kinetic
      }
    }
    // Variable font axis
    else if (channel === 'variableAxes' || channel === 'properties.variableAxes') {
      delete nextOverrides.properties?.variableAxes
    } else if (channel.startsWith('variableAxes.') || channel.startsWith('properties.variableAxes.')) {
      const aKey = channel.replace(/^properties\./, '').replace(/^variableAxes\./, '')
      resetLabel = `axis ${aKey}`
      if (nextOverrides.properties?.variableAxes && typeof nextOverrides.properties.variableAxes === 'object') {
        const axes = { ...(nextOverrides.properties.variableAxes as Record<string, number>) }
        delete axes[aKey]
        if (Object.keys(axes).length === 0) delete nextOverrides.properties.variableAxes
        else nextOverrides.properties.variableAxes = axes
      }
    }
    // Shader property or subchannel
    else if (channel === 'shader' || channel === 'style.shader') {
      delete nextOverrides.style?.shader
    } else if (channel.startsWith('shader.') || channel.startsWith('style.shader.')) {
      const sKey = channel.replace(/^style\./, '').replace(/^shader\./, '')
      resetLabel = `shader ${sKey}`
      if (nextOverrides.style?.shader && typeof nextOverrides.style.shader === 'object') {
        const shaderObj = { ...(nextOverrides.style.shader as Record<string, any>) }
        if (sKey.startsWith('params.')) {
          const pKey = sKey.replace(/^params\./, '')
          if (shaderObj.params) {
            const params = { ...(shaderObj.params as Record<string, unknown>) }
            delete params[pKey]
            if (Object.keys(params).length === 0) delete shaderObj.params
            else shaderObj.params = params
          }
        } else if (sKey.startsWith('mesh.')) {
          const mKey = sKey.replace(/^mesh\./, '')
          if (shaderObj.mesh) {
            const mesh = { ...(shaderObj.mesh as Record<string, unknown>) }
            delete mesh[mKey]
            if (Object.keys(mesh).length === 0) delete shaderObj.mesh
            else shaderObj.mesh = mesh
          }
        } else if (['frequency', 'turbulence', 'octaves', 'displacement', 'normalPerturbation', 'noiseType', 'viewMode', 'colorFront', 'colorMid', 'colorBack', 'lacunarity', 'persistence', 'grainOverlay', 'grainMixer', 'specularStrength', 'lightAngle'].includes(sKey)) {
          if (shaderObj.params && Object.hasOwn(shaderObj.params, sKey)) {
            const params = { ...(shaderObj.params as Record<string, unknown>) }
            delete params[sKey]
            if (Object.keys(params).length === 0) delete shaderObj.params
            else shaderObj.params = params
          }
          if (shaderObj.mesh && Object.hasOwn(shaderObj.mesh, sKey)) {
            const mesh = { ...(shaderObj.mesh as Record<string, unknown>) }
            delete mesh[sKey]
            if (Object.keys(mesh).length === 0) delete shaderObj.mesh
            else shaderObj.mesh = mesh
          }
        } else {
          delete shaderObj[sKey]
        }
        const hasShaderContent = Object.keys(shaderObj).filter(k => k !== 'kind').length > 0
        if (!hasShaderContent) delete nextOverrides.style.shader
        else nextOverrides.style.shader = shaderObj
      }
    }
    // Stroke subchannel
    else if (channel.startsWith('stroke.') || channel.startsWith('style.stroke.')) {
      const strKey = channel.replace(/^style\./, '').replace(/^stroke\./, '')
      resetLabel = `stroke ${strKey}`
      if (nextOverrides.style?.stroke && typeof nextOverrides.style.stroke === 'object') {
        const strokeObj = { ...(nextOverrides.style.stroke as Record<string, unknown>) }
        delete strokeObj[strKey]
        if (Object.keys(strokeObj).length === 0) delete nextOverrides.style.stroke
        else nextOverrides.style.stroke = strokeObj
      }
    }
    // Token bindings
    else if (channel === 'tokenBindings') {
      delete nextOverrides.tokenBindings
    } else if (channel.startsWith('tokenBindings.')) {
      const tKey = channel.replace(/^tokenBindings\./, '')
      resetLabel = `token binding ${tKey}`
      if (nextOverrides.tokenBindings) {
        delete nextOverrides.tokenBindings[tKey]
        if (Object.keys(nextOverrides.tokenBindings).length === 0) delete nextOverrides.tokenBindings
      }
    }
    // Shared styles
    else if (channel === 'sharedStyleBindings') {
      delete nextOverrides.sharedStyleBindings
    } else if (channel.startsWith('sharedStyleBindings.')) {
      const sKey = channel.replace(/^sharedStyleBindings\./, '')
      resetLabel = `shared style ${sKey}`
      if (nextOverrides.sharedStyleBindings) {
        delete nextOverrides.sharedStyleBindings[sKey]
        if (Object.keys(nextOverrides.sharedStyleBindings).length === 0) delete nextOverrides.sharedStyleBindings
      }
    }
    // Style properties
    else if (channel.startsWith('style.') || (nextOverrides.style && Object.hasOwn(nextOverrides.style, channel))) {
      const sKey = channel.replace(/^style\./, '')
      resetLabel = sKey
      if (nextOverrides.style) {
        delete nextOverrides.style[sKey]
        if (Object.keys(nextOverrides.style).length === 0) delete nextOverrides.style
      }
    }
    // Layer properties
    else {
      const pKey = channel.replace(/^properties\./, '')
      resetLabel = pKey
      if (nextOverrides.properties) {
        delete nextOverrides.properties[pKey]
        if (Object.keys(nextOverrides.properties).length === 0) delete nextOverrides.properties
      }
    }

    cleanEmpty()

    const elements = {
      ...this.state.elements,
      [id]: freezeElement({
        ...node,
        component: {
          ...node.component,
          overrides: nextOverrides as ComponentOverrides,
        },
      }),
    }
    this.commit(elements, this.state.rootIds, this.state.selection, `Reset ${resetLabel} override on ${node.name}`)
  }

  /** Automatically detect and expose dynamic properties for text, kinetic typography, shaders, and visual parameters. */
  autoExposeComponentProperties(masterId: string): void {
    const master = this.require(masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.isLocked(masterId) || this.history.getSnapshot().active) throw new Error('Unlock the master and finish the active edit first')

    const layers = subtree(this.state.elements, master.id)
    const existing = master.component.properties ?? []
    const names = new Set(existing.map(p => p.name.trim().toLowerCase()))
    const generated: ComponentProperty[] = [...existing]

    for (const layer of layers) {
      if (layer.type === 'text') {
        const textPropName = layer.id === master.id || layers.filter(l => l.type === 'text').length === 1 ? 'Text' : `${layer.name} Text`
        if (!names.has(textPropName.toLowerCase()) && !generated.some(p => p.kind === 'text' && p.sourceId === layer.id)) {
          generated.push({ id: crypto.randomUUID(), name: textPropName, kind: 'text', sourceId: layer.id, defaultValue: layer.text, targetProperty: 'text' })
          names.add(textPropName.toLowerCase())
        }
        if (layer.kinetic) {
          if (!names.has('kinetic active')) {
            generated.push({ id: crypto.randomUUID(), name: 'Kinetic Active', kind: 'boolean', sourceId: layer.id, defaultValue: layer.kinetic.enabled ?? true, targetProperty: 'kinetic.enabled' })
            names.add('kinetic active')
          }
          if (!names.has('wave amplitude')) {
            generated.push({ id: crypto.randomUUID(), name: 'Wave Amplitude', kind: 'kinetic', sourceId: layer.id, defaultValue: layer.kinetic.amplitude ?? 16, targetProperty: 'amplitude' })
            names.add('wave amplitude')
          }
          if (!names.has('wave shape')) {
            generated.push({ id: crypto.randomUUID(), name: 'Wave Shape', kind: 'kinetic', sourceId: layer.id, defaultValue: layer.kinetic.waveShape ?? 'sine', targetProperty: 'waveShape' })
            names.add('wave shape')
          }
          if (!names.has('stagger delay')) {
            generated.push({ id: crypto.randomUUID(), name: 'Stagger Delay', kind: 'kinetic', sourceId: layer.id, defaultValue: layer.kinetic.stagger ?? 40, targetProperty: 'stagger' })
            names.add('stagger delay')
          }
          if (layer.kinetic.weightModulation !== undefined && !names.has('weight modulation')) {
            generated.push({ id: crypto.randomUUID(), name: 'Weight Modulation', kind: 'kinetic', sourceId: layer.id, defaultValue: layer.kinetic.weightModulation, targetProperty: 'weightModulation' })
            names.add('weight modulation')
          }
          if (layer.kinetic.staggerMode !== undefined && !names.has('stagger mode')) {
            generated.push({ id: crypto.randomUUID(), name: 'Stagger Mode', kind: 'kinetic', sourceId: layer.id, defaultValue: layer.kinetic.staggerMode, targetProperty: 'staggerMode' })
            names.add('stagger mode')
          }
          if (layer.kinetic.horizontalAmplitude !== undefined && !names.has('horizontal amplitude')) {
            generated.push({ id: crypto.randomUUID(), name: 'Horizontal Amplitude', kind: 'kinetic', sourceId: layer.id, defaultValue: layer.kinetic.horizontalAmplitude, targetProperty: 'horizontalAmplitude' })
            names.add('horizontal amplitude')
          }
          if (layer.kinetic.scaleModulation !== undefined && !names.has('scale modulation')) {
            generated.push({ id: crypto.randomUUID(), name: 'Scale Modulation', kind: 'kinetic', sourceId: layer.id, defaultValue: layer.kinetic.scaleModulation, targetProperty: 'scaleModulation' })
            names.add('scale modulation')
          }
          if (layer.kinetic.slantModulation !== undefined && !names.has('slant modulation')) {
            generated.push({ id: crypto.randomUUID(), name: 'Slant Modulation', kind: 'kinetic', sourceId: layer.id, defaultValue: layer.kinetic.slantModulation, targetProperty: 'slantModulation' })
            names.add('slant modulation')
          }
          if (layer.kinetic.widthModulation !== undefined && !names.has('width modulation')) {
            generated.push({ id: crypto.randomUUID(), name: 'Width Modulation', kind: 'kinetic', sourceId: layer.id, defaultValue: layer.kinetic.widthModulation, targetProperty: 'widthModulation' })
            names.add('width modulation')
          }
        }
      }

      if (layer.style.shader) {
        if (!names.has('shader speed')) {
          generated.push({ id: crypto.randomUUID(), name: 'Shader Speed', kind: 'shader', sourceId: layer.id, defaultValue: layer.style.shader.speed ?? 1, targetProperty: 'speed' })
          names.add('shader speed')
        }
        if (!names.has('shader scale')) {
          generated.push({ id: crypto.randomUUID(), name: 'Shader Scale', kind: 'shader', sourceId: layer.id, defaultValue: layer.style.shader.scale ?? 1, targetProperty: 'scale' })
          names.add('shader scale')
        }
        const sParams = layer.style.shader.params as Record<string, unknown> | undefined
        if (sParams) {
          if ('frequency' in sParams && !names.has('noise frequency')) {
            generated.push({ id: crypto.randomUUID(), name: 'Noise Frequency', kind: 'shader', sourceId: layer.id, defaultValue: Number(sParams.frequency ?? 1), targetProperty: 'frequency' })
            names.add('noise frequency')
          }
          if ('turbulence' in sParams && !names.has('turbulence')) {
            generated.push({ id: crypto.randomUUID(), name: 'Turbulence', kind: 'shader', sourceId: layer.id, defaultValue: Number(sParams.turbulence ?? 0.5), targetProperty: 'turbulence' })
            names.add('turbulence')
          }
          if ('octaves' in sParams && !names.has('octaves')) {
            generated.push({ id: crypto.randomUUID(), name: 'Octaves', kind: 'shader', sourceId: layer.id, defaultValue: Number(sParams.octaves ?? 3), targetProperty: 'octaves' })
            names.add('octaves')
          }
          if ('displacement' in sParams && !names.has('displacement')) {
            generated.push({ id: crypto.randomUUID(), name: 'Displacement', kind: 'shader', sourceId: layer.id, defaultValue: Number(sParams.displacement ?? 0.4), targetProperty: 'displacement' })
            names.add('displacement')
          }
          if ('normalPerturbation' in sParams && !names.has('normal perturbation')) {
            generated.push({ id: crypto.randomUUID(), name: 'Normal Perturbation', kind: 'shader', sourceId: layer.id, defaultValue: Number(sParams.normalPerturbation ?? 0.2), targetProperty: 'normalPerturbation' })
            names.add('normal perturbation')
          }
          if ('noiseType' in sParams && typeof sParams.noiseType === 'string' && !names.has('noise generator')) {
            generated.push({ id: crypto.randomUUID(), name: 'Noise Generator', kind: 'shader', sourceId: layer.id, defaultValue: sParams.noiseType, targetProperty: 'noiseType' })
            names.add('noise generator')
          }
          if ('viewMode' in sParams && typeof sParams.viewMode === 'string' && !names.has('surface view mode')) {
            generated.push({ id: crypto.randomUUID(), name: 'Surface View Mode', kind: 'shader', sourceId: layer.id, defaultValue: sParams.viewMode, targetProperty: 'viewMode' })
            names.add('surface view mode')
          }
          if ('colorFront' in sParams && typeof sParams.colorFront === 'string' && !names.has('front color')) {
            generated.push({ id: crypto.randomUUID(), name: 'Front Color', kind: 'color', sourceId: layer.id, defaultValue: sParams.colorFront, targetProperty: 'shader.colorFront' })
            names.add('front color')
          }
          if ('colorBack' in sParams && typeof sParams.colorBack === 'string' && !names.has('back color')) {
            generated.push({ id: crypto.randomUUID(), name: 'Back Color', kind: 'color', sourceId: layer.id, defaultValue: sParams.colorBack, targetProperty: 'shader.colorBack' })
            names.add('back color')
          }
        }
        const sMesh = layer.style.shader.mesh
        if (sMesh) {
          if (sMesh.frequency !== undefined && !names.has('mesh frequency')) {
            generated.push({ id: crypto.randomUUID(), name: 'Mesh Frequency', kind: 'shader', sourceId: layer.id, defaultValue: sMesh.frequency, targetProperty: 'frequency' })
            names.add('mesh frequency')
          }
          if (sMesh.turbulence !== undefined && !names.has('mesh turbulence')) {
            generated.push({ id: crypto.randomUUID(), name: 'Mesh Turbulence', kind: 'shader', sourceId: layer.id, defaultValue: sMesh.turbulence, targetProperty: 'turbulence' })
            names.add('mesh turbulence')
          }
          if (sMesh.normalPerturbation !== undefined && !names.has('normal perturbation')) {
            generated.push({ id: crypto.randomUUID(), name: 'Normal Perturbation', kind: 'shader', sourceId: layer.id, defaultValue: sMesh.normalPerturbation, targetProperty: 'normalPerturbation' })
            names.add('normal perturbation')
          }
          if (sMesh.noiseType !== undefined && !names.has('noise generator')) {
            generated.push({ id: crypto.randomUUID(), name: 'Noise Generator', kind: 'shader', sourceId: layer.id, defaultValue: sMesh.noiseType, targetProperty: 'noiseType' })
            names.add('noise generator')
          }
          if (sMesh.viewMode !== undefined && !names.has('surface view mode')) {
            generated.push({ id: crypto.randomUUID(), name: 'Surface View Mode', kind: 'shader', sourceId: layer.id, defaultValue: sMesh.viewMode, targetProperty: 'viewMode' })
            names.add('surface view mode')
          }
        }
        if (layer.style.shader.composite && !names.has('blend mode')) {
          generated.push({ id: crypto.randomUUID(), name: 'Blend Mode', kind: 'shader', sourceId: layer.id, defaultValue: layer.style.shader.composite.blendMode ?? 'normal', targetProperty: 'blendMode' })
          names.add('blend mode')
        }
      }

      if (layer.style.fill && typeof layer.style.fill === 'string' && layer.style.fill !== 'transparent' && layer.type !== 'text') {
        const fillPropName = layer.id === master.id ? 'Fill Color' : `${layer.name} Fill`
        if (!names.has(fillPropName.toLowerCase()) && generated.filter(p => p.kind === 'color').length < 2) {
          generated.push({ id: crypto.randomUUID(), name: fillPropName, kind: 'color', sourceId: layer.id, defaultValue: layer.style.fill, targetProperty: 'fill' })
          names.add(fillPropName.toLowerCase())
        }
      }

      if (('cornerRadius' in layer) && typeof (layer as any).cornerRadius === 'number' && (layer as any).cornerRadius > 0) {
        const radiusPropName = layer.id === master.id ? 'Corner Radius' : `${layer.name} Radius`
        if (!names.has(radiusPropName.toLowerCase()) && !generated.some(p => p.kind === 'number' && p.targetProperty === 'cornerRadius')) {
          generated.push({ id: crypto.randomUUID(), name: radiusPropName, kind: 'number', sourceId: layer.id, defaultValue: (layer as any).cornerRadius, targetProperty: 'cornerRadius', min: 0, max: 100 })
          names.add(radiusPropName.toLowerCase())
        }
      }
    }

    if (generated.length === existing.length) return
    this.setComponentProperties(masterId, generated)
  }

  /** Duplicate a master component and its entire subtree as an independent new master on the 120px grid. */
  duplicateComponent(masterId: string): SceneElement {
    const master = this.require(masterId)
    if (master.component?.kind !== 'master') throw new Error('Choose a master component')
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')

    const sources = subtree(this.state.elements, master.id)
    const idMap = new Map<string, string>()
    for (const src of sources) {
      idMap.set(src.id, crypto.randomUUID())
    }

    const y = master.y
    let x = master.x + Math.ceil(master.width / 120) * 120 + 120
    const neighbors = this.getChildren(master.parentId).map(id => this.state.elements[id]).filter(node => node.visible).sort((a, b) => a.x - b.x)
    for (const neighbor of neighbors) {
      if (x < neighbor.x + neighbor.width && x + master.width > neighbor.x && y < neighbor.y + neighbor.height && y + master.height > neighbor.y) {
        x = master.x + Math.ceil((neighbor.x + neighbor.width - master.x) / 120) * 120 + 120
      }
    }

    let elements = { ...this.state.elements }
    const newRootId = idMap.get(master.id)!

    for (const src of sources) {
      const newId = idMap.get(src.id)!
      const isRoot = src.id === master.id
      const newParentId = isRoot ? master.parentId : idMap.get(src.parentId!)!
      const cloned = {
        ...src,
        id: newId,
        parentId: newParentId,
        ...(isRoot ? {
          x,
          y,
          name: `${src.name.replace(/ copy( \d+)?$/, '')} copy`,
          component: {
            kind: 'master' as const,
            ...(master.component.properties ? {
              properties: master.component.properties.map(p => {
                if (p.kind === 'variant') {
                  return {
                    ...p,
                    options: p.options.map(opt => ({
                      ...opt,
                      layers: Object.fromEntries(
                        Object.entries(opt.layers).map(([layerId, ovr]) => [idMap.get(layerId) ?? layerId, ovr])
                      ),
                    })),
                  }
                }
                return {
                  ...p,
                  sourceId: idMap.get(p.sourceId) ?? p.sourceId,
                }
              }),
            } : {}),
            ...(master.component.stateMachine ? { stateMachine: master.component.stateMachine } : {}),
          },
        } : {
          component: undefined,
        }),
        ...(src.type === 'frame' ? { children: src.children.map(cId => idMap.get(cId)!) } : {}),
      } as SceneElement

      validateElement(cloned)
      elements[newId] = freezeElement(cloned)
    }

    const siblings = [...this.getChildren(master.parentId), newRootId]
    this.ordered(elements, master.parentId, siblings)
    this.commit(elements, master.parentId === null ? siblings : this.state.rootIds, [newRootId], `Duplicate ${master.name} component`)
    return this.state.elements[newRootId]
  }

  /** Insert a pre-configured master symbol and instance for kinetic typography, shaders, or interactive canvas elements. */
  insertPresetMasterSymbol(presetKey: string, placement?: { x?: number; y?: number }): { master: SceneElement; instance: SceneElement } {
    let master: SceneElement | null = null

    if (presetKey === 'kinetic-wave-header') {
      const frameId = crypto.randomUUID()
      const textId = crypto.randomUUID()
      const x = placement?.x ?? 0
      const y = placement?.y ?? 0

      this.batch(() => {
        const frame = this.add('frame', {
          id: frameId,
          name: 'Kinetic Wave Header',
          x,
          y,
          width: 520,
          height: 140,
          cornerRadius: 16,
          clipContent: true,
          style: { fill: '#080808', stroke: { color: '#222222', width: 1, dash: [] } },
        })
        this.add('text', {
          id: textId,
          parentId: frame.id,
          name: 'Headline',
          x: 32,
          y: 44,
          text: 'INFINITE CANVAS',
          fontSize: 40,
          fontWeight: 700,
          style: { fill: '#edebe1' },
          kinetic: {
            enabled: true,
            playing: true,
            amplitude: 18,
            rotation: 0,
            duration: 900,
            stagger: 35,
            phase: 0,
            staggerMode: 'wave',
            waveShape: 'sine',
            weightModulation: 120,
          },
        })
        master = this.createComponent(frame.id)
        this.setComponentProperties(frame.id, [
          { id: crypto.randomUUID(), name: 'Headline Text', kind: 'text', sourceId: textId, defaultValue: 'INFINITE CANVAS', targetProperty: 'text' },
          { id: crypto.randomUUID(), name: 'Wave Amplitude', kind: 'kinetic', sourceId: textId, defaultValue: 18, targetProperty: 'amplitude' },
          { id: crypto.randomUUID(), name: 'Wave Shape', kind: 'kinetic', sourceId: textId, defaultValue: 'sine', targetProperty: 'waveShape' },
          { id: crypto.randomUUID(), name: 'Kinetic Active', kind: 'boolean', sourceId: textId, defaultValue: true, targetProperty: 'kinetic.enabled' },
          { id: crypto.randomUUID(), name: 'Card Fill', kind: 'color', sourceId: frame.id, defaultValue: '#080808', targetProperty: 'fill' },
        ])
      }, 'Insert Kinetic Wave Header symbol')
    } else if (presetKey === 'shader-neuro-hero') {
      const frameId = crypto.randomUUID()
      const textId = crypto.randomUUID()
      const x = placement?.x ?? 0
      const y = placement?.y ?? 0

      this.batch(() => {
        const frame = this.add('frame', {
          id: frameId,
          name: 'Neuro Noise Hero',
          x,
          y,
          width: 480,
          height: 260,
          cornerRadius: 16,
          clipContent: true,
          style: {
            fill: '#080808',
            stroke: { color: '#81adec44', width: 1, dash: [] },
            shader: {
              kind: 'neuro-noise',
              animated: true,
              speed: 0.8,
              scale: 1.2,
              rotation: 0,
              frame: 0,
              offsetX: 0,
              offsetY: 0,
              params: { colorFront: '#81adec', colorMid: '#4b75af', colorBack: '#080808', brightness: 0.1, contrast: 0.35 },
              composite: { blendMode: 'screen', opacity: 0.95 },
            },
          },
        })
        this.add('text', {
          id: textId,
          parentId: frame.id,
          name: 'Badge',
          x: 28,
          y: 200,
          text: 'NEURAL FLUID FIELD',
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: 2,
          style: { fill: '#edebe1' },
        })
        master = this.createComponent(frame.id)
        this.setComponentProperties(frame.id, [
          { id: crypto.randomUUID(), name: 'Shader Speed', kind: 'shader', sourceId: frame.id, defaultValue: 0.8, targetProperty: 'speed' },
          { id: crypto.randomUUID(), name: 'Shader Scale', kind: 'shader', sourceId: frame.id, defaultValue: 1.2, targetProperty: 'scale' },
          { id: crypto.randomUUID(), name: 'Noise Frequency', kind: 'shader', sourceId: frame.id, defaultValue: 1.5, targetProperty: 'frequency' },
          { id: crypto.randomUUID(), name: 'Turbulence', kind: 'shader', sourceId: frame.id, defaultValue: 0.75, targetProperty: 'turbulence' },
          { id: crypto.randomUUID(), name: 'Badge Text', kind: 'text', sourceId: textId, defaultValue: 'NEURAL FLUID FIELD', targetProperty: 'text' },
        ])
      }, 'Insert Neuro Noise Hero symbol')
    } else if (presetKey === 'shader-procedural-grain') {
      const rectId = crypto.randomUUID()
      const x = placement?.x ?? 0
      const y = placement?.y ?? 0

      this.batch(() => {
        const rect = this.add('rectangle', {
          id: rectId,
          name: 'Procedural Simplex Mesh',
          x,
          y,
          width: 360,
          height: 240,
          cornerRadius: 14,
          style: {
            fill: '#141414',
            stroke: { color: '#81adec66', width: 1, dash: [] },
            shader: {
              kind: 'procedural-noise',
              animated: true,
              speed: 0.6,
              scale: 1,
              rotation: 0,
              frame: 0,
              offsetX: 0,
              offsetY: 0,
              params: {
                noiseType: 'simplex',
                frequency: 2,
                octaves: 4,
                lacunarity: 2,
                persistence: 0.5,
                turbulence: 0.6,
                displacement: 0.4,
                normalPerturbation: 0.3,
                grainMixer: 0.2,
                grainOverlay: 0.15,
                colorFront: '#81adec',
                colorMid: '#4b75af',
                colorBack: '#080808',
                lightAngle: 45,
                specularStrength: 0.8,
                viewMode: 'shaded',
              },
            },
          },
        })
        master = this.createComponent(rect.id)
        this.setComponentProperties(rect.id, [
          { id: crypto.randomUUID(), name: 'Noise Frequency', kind: 'shader', sourceId: rect.id, defaultValue: 2, targetProperty: 'frequency' },
          { id: crypto.randomUUID(), name: 'Octaves', kind: 'shader', sourceId: rect.id, defaultValue: 4, targetProperty: 'octaves' },
          { id: crypto.randomUUID(), name: 'Displacement', kind: 'shader', sourceId: rect.id, defaultValue: 0.4, targetProperty: 'displacement' },
          { id: crypto.randomUUID(), name: 'Shader Speed', kind: 'shader', sourceId: rect.id, defaultValue: 0.6, targetProperty: 'speed' },
          { id: crypto.randomUUID(), name: 'Corner Radius', kind: 'number', sourceId: rect.id, defaultValue: 14, targetProperty: 'cornerRadius', min: 0, max: 100 },
        ])
      }, 'Insert Procedural Simplex Mesh symbol')
    } else {
      // Default: interactive spring button
      const frameId = crypto.randomUUID()
      const textId = crypto.randomUUID()
      const x = placement?.x ?? 0
      const y = placement?.y ?? 0

      this.batch(() => {
        const frame = this.add('frame', {
          id: frameId,
          name: 'Interactive Spring Button',
          x,
          y,
          width: 220,
          height: 52,
          cornerRadius: 10,
          style: { fill: '#81adec', stroke: { color: '#edebe1', width: 1, dash: [] } },
          layout: { direction: 'horizontal', gap: 8, padding: { top: 16, right: 24, bottom: 16, left: 24 }, justify: 'center', align: 'center' },
        })
        this.add('text', {
          id: textId,
          parentId: frame.id,
          name: 'Label',
          text: 'Get Started',
          fontSize: 14,
          fontWeight: 600,
          style: { fill: '#080808' },
        })
        master = this.createComponent(frame.id)
        this.generateInteractiveStates(frame.id)
        this.setComponentProperties(frame.id, [
          ...(this.state.elements[frame.id].component as any)?.properties ?? [],
          { id: crypto.randomUUID(), name: 'Button Label', kind: 'text', sourceId: textId, defaultValue: 'Get Started', targetProperty: 'text' },
          { id: crypto.randomUUID(), name: 'Button Color', kind: 'color', sourceId: frame.id, defaultValue: '#81adec', targetProperty: 'fill' },
          { id: crypto.randomUUID(), name: 'Corner Radius', kind: 'number', sourceId: frame.id, defaultValue: 10, targetProperty: 'cornerRadius', min: 0, max: 50 },
        ])
      }, 'Insert Interactive Spring Button symbol')
    }

    const resolvedMaster = this.state.elements[(master as any).id]
    const instance = this.createComponentInstance(resolvedMaster.id)
    return { master: resolvedMaster, instance }
  }

  /** The same checks serve the toolbar and programmatic callers. */
  booleanSelectionReason(ids = this.state.selection): string | null {
    if (this.history.getSnapshot().active) return 'Finish the active edit first.'
    if (new Set(ids).size < 2) return 'Select at least two vector shapes.'
    const nodes = [...new Set(ids)].map(id => this.state.elements[id])
    if (nodes.some(node => node?.component || (node && componentRoot(this.state.elements, node.id)?.component?.kind === 'instance'))) return 'Detach the component before combining its layers.'
    if (nodes.some(node => !node || !isVector(node))) return 'Select rectangles, ellipses, or vector paths.'
    if (nodes.some(node => node.mask)) return 'Release the mask before combining its source.'
    if (nodes.some(node => this.isLocked(node.id) || !this.isVisible(node.id))) return 'Choose visible, unlocked shapes.'
    if (nodes.some(node => node.parentId !== nodes[0].parentId)) return 'Choose shapes in the same frame.'
    return null
  }

  maskSelectionReason(ids = this.state.selection): string | null {
    if (this.history.getSnapshot().active) return 'Finish the active edit first.'
    const nodes = [...new Set(ids)].map(id => this.state.elements[id])
    if (nodes.length < 2 || nodes.some(node => !node)) return 'Select a mask shape and at least one content layer.'
    if (nodes.some(node => this.isLocked(node.id) || !this.isVisible(node.id))) return 'Choose visible, unlocked layers.'
    if (nodes.some(node => componentRoot(this.state.elements, node.id) || subtree(this.state.elements, node.id).some(child => child.component))) return 'Detach the component before grouping its layers.'
    if (nodes.some(node => node.parentId !== nodes[0].parentId)) return 'Choose layers in the same frame.'
    if (nodes.some(node => node.mask)) return 'Release the existing mask before regrouping its source.'
    if (!canMask([...nodes].sort((a, b) => b.zIndex - a.zIndex)[0])) return 'The top selected layer must be a vector shape or frame.'
    return null
  }

  /** Group atomically in parent space; every child keeps its editable geometry. */
  maskSelection(ids = this.state.selection): SceneElement {
    const reason = this.maskSelectionReason(ids)
    if (reason) throw new Error(reason)
    const nodes = [...new Set(ids)].map(id => this.require(id)).sort((a, b) => a.zIndex - b.zIndex)
    const source = nodes.at(-1)!, parentId = source.parentId
    const bounds = unionBounds(nodes.map(node => getWorldBounds({ ...this.state, elements: { ...this.state.elements, [node.id]: { ...node, parentId: null } } }, node.id)))!
    const group = createElement('frame', { name: 'Mask group', parentId, ...bounds, clipContent: false, style: { fill: null } })
    const elements = { ...this.state.elements, [group.id]: group }
    for (const node of nodes) {
      const patch = { x: node.x - bounds.x, y: node.y - bounds.y }
      elements[node.id] = freezeElement({ ...node, ...patch, tokenBindings: detachEditedBindings(node.tokenBindings, patch, node), parentId: group.id,
        ...(node.id === source.id ? { mask: { enabled: true, showOutline: false } } : {}),
      })
    }
    this.ordered(elements, group.id, nodes.map(node => node.id))
    const selected = new Set(ids), siblings = this.getChildren(parentId)
    const next = siblings.filter(id => !selected.has(id))
    next.splice(siblings.slice(0, source.zIndex).filter(id => !selected.has(id)).length, 0, group.id)
    this.ordered(elements, parentId, next)
    this.commit(elements, parentId === null ? next : this.state.rootIds, [group.id], 'Create vector mask')
    return this.state.elements[group.id]
  }

  /** Null releases the role; false temporarily reveals the original layers. */
  setMask(id: string, enabled: boolean | null, mode?: MaskClipMode): void {
    const node = this.require(id)
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')
    if (!canMask(node)) throw new Error('Only vector shapes and frames can be masks')
    if (this.isLocked(id)) throw new Error('Unlock the mask source first')
    this.requireEditableStructure(id)
    const elements = { ...this.state.elements }
    if (enabled !== null && node.parentId !== null) {
      for (const siblingId of this.getChildren(node.parentId)) {
        if (siblingId !== id && elements[siblingId].mask) {
          if (this.isLocked(siblingId)) throw new Error('Unlock the existing mask source first')
          this.requireEditableStructure(siblingId)
          elements[siblingId] = freezeElement({ ...elements[siblingId], mask: undefined })
        }
      }
    }
    elements[id] = freezeElement({
      ...node,
      mask: enabled === null ? undefined : {
        enabled,
        showOutline: node.mask?.showOutline ?? false,
        mode: mode ?? node.mask?.mode ?? 'vector',
        luminanceThreshold: node.mask?.luminanceThreshold ?? 0.5,
        inverted: node.mask?.inverted ?? false,
        isolated: node.mask?.isolated ?? false,
      },
    })
    this.commit(elements, this.state.rootIds, this.state.selection, enabled === null ? 'Release vector mask' : enabled ? 'Enable vector mask' : 'Disable vector mask')
  }

  setMaskOutline(id: string, showOutline: boolean): void {
    const node = this.require(id)
    if (!node.mask) throw new Error('Select a mask source')
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')
    this.requireEditableStructure(id)
    this.commit({ ...this.state.elements, [id]: freezeElement({ ...node, mask: { ...node.mask, showOutline } }) }, this.state.rootIds, this.state.selection, 'Toggle mask outline')
  }

  setMaskMode(id: string, mode: MaskClipMode): void {
    const node = this.require(id)
    if (!node.mask) throw new Error('Select a mask source')
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')
    this.requireEditableStructure(id)
    this.commit({
      ...this.state.elements,
      [id]: freezeElement({ ...node, mask: { ...node.mask, mode } }),
    }, this.state.rootIds, this.state.selection, `Set mask mode to ${mode}`)
  }

  setMaskInverted(id: string, inverted: boolean): void {
    const node = this.require(id)
    if (!node.mask) throw new Error('Select a mask source')
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')
    this.requireEditableStructure(id)
    this.commit({
      ...this.state.elements,
      [id]: freezeElement({ ...node, mask: { ...node.mask, inverted } }),
    }, this.state.rootIds, this.state.selection, inverted ? 'Invert mask' : 'Un-invert mask')
  }

  setMaskLuminanceThreshold(id: string, threshold: number): void {
    const node = this.require(id)
    if (!node.mask) throw new Error('Select a mask source')
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')
    this.requireEditableStructure(id)
    const clamped = Math.max(0, Math.min(1, Number(threshold.toFixed(3))))
    this.commit({
      ...this.state.elements,
      [id]: freezeElement({ ...node, mask: { ...node.mask, luminanceThreshold: clamped } }),
    }, this.state.rootIds, this.state.selection, `Set luminance threshold to ${Math.round(clamped * 100)}%`)
  }

  setMaskIsolated(id: string, isolated: boolean): void {
    const node = this.require(id)
    if (!node.mask) throw new Error('Select a mask source')
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')
    this.requireEditableStructure(id)
    const elements = { ...this.state.elements }
    if (isolated) {
      for (const elId of Object.keys(elements)) {
        if (elId !== id && elements[elId].mask?.isolated) {
          elements[elId] = freezeElement({ ...elements[elId], mask: { ...elements[elId].mask!, isolated: false } })
        }
      }
    }
    elements[id] = freezeElement({ ...node, mask: { ...node.mask, isolated } })
    this.commit(elements, this.state.rootIds, this.state.selection, isolated ? 'Isolate mask' : 'Exit mask isolation')
  }

  toggleMaskIsolation(id?: string): void {
    const targetId = id ?? this.state.selection[0]
    if (!targetId) return
    const node = this.state.elements[targetId]
    const maskNode = node?.mask ? node : node?.type === 'frame' ? node.children.map(cid => this.state.elements[cid]).find(c => c?.mask) : undefined
    if (!maskNode) return
    this.setMaskIsolated(maskNode.id, !maskNode.mask?.isolated)
  }

  getIsolatedMaskId(state = this.state): string | null {
    for (const el of Object.values(state.elements)) {
      if (el.mask?.isolated && el.mask.enabled) return el.id
    }
    return null
  }

  /** Compute before publishing so errors leave the entire selection untouched. */
  booleanSelection(operation: BooleanOperation, destructive = false, ids = this.state.selection): PathElement {
    const reason = this.booleanSelectionReason(ids)
    if (reason) throw new Error(reason)
    const operands = [...new Set(ids)].map(id => this.require(id) as VectorElement).sort((a, b) => a.zIndex - b.zIndex)
    const result = computeBoolean(operands, operation), base = operands[0]
    const node = createElement('path', {
      name: `${operation[0].toUpperCase() + operation.slice(1)}${destructive ? ' path' : ' compound'}`,
      parentId: base.parentId, ...result.bounds, d: destructive ? optimizeSvgBezierData(result.d) : result.d, viewBox: result.viewBox, fillRule: result.fillRule, style: base.style,
      ...(base.tokenBindings ? { tokenBindings: {
        ...(base.tokenBindings.fill ? { fill: base.tokenBindings.fill } : {}),
        ...(base.tokenBindings.stroke ? { stroke: base.tokenBindings.stroke } : {}),
      } } : {}),
      ...(destructive ? {} : { boolean: { operation, operands } }),
    })
    const selected = new Set(operands.map(n => n.id)), elements = { ...this.state.elements }
    for (const operand of operands) delete elements[operand.id]
    elements[node.id] = node
    const siblings = this.getChildren(base.parentId)
    // Replace at the top selected layer, retaining the order of unselected layers.
    const topIndex = operands.at(-1)!.zIndex
    const next = siblings.filter(id => !selected.has(id))
    next.splice(siblings.slice(0, topIndex).filter(id => !selected.has(id)).length, 0, node.id)
    this.ordered(elements, node.parentId, next)
    this.commit(elements, node.parentId === null ? next : this.state.rootIds, [node.id], `${operation[0].toUpperCase() + operation.slice(1)} shapes${destructive ? ' and flatten' : ''}`)
    return elements[node.id] as PathElement
  }

  private requireCompound(id: string, allowActive = false): PathElement & { boolean: BooleanCompound } {
    const node = this.require(id)
    if (!allowActive && this.history.getSnapshot().active) throw new Error('Finish the active edit first')
    if (node.type !== 'path' || !node.boolean) throw new Error('Select a boolean compound')
    if (node.component?.kind === 'instance') throw new Error('Detach the instance before editing its boolean sources')
    if (this.isLocked(id)) throw new Error('Element is locked')
    return node as PathElement & { boolean: BooleanCompound }
  }

  private refreshCompound(node: PathElement, compound: BooleanCompound, label: string): void {
    const updated = refreshBooleanElement(node, compound)
    validateElement(updated)
    this.commit({ ...this.state.elements, [node.id]: freezeElement(updated) }, this.state.rootIds, this.state.selection, label)
  }

  setBooleanOperation(id: string, operation: BooleanOperation): void {
    const node = this.requireCompound(id)
    if (node.boolean.operation === operation) return
    this.refreshCompound(node, { ...node.boolean, operation }, `Change boolean to ${operation}`)
  }

  setNestedBooleanOperation(id: string, nestedOperandId: string, operation: BooleanOperation): void {
    const node = this.requireCompound(id)
    const updateNested = (operands: readonly VectorElement[]): { found: boolean; operands: readonly VectorElement[] } => {
      let found = false
      const next = operands.map(op => {
        if (op.id === nestedOperandId && op.type === 'path' && op.boolean) {
          found = true
          if (op.boolean.operation === operation) return op
          const subResult = computeBoolean(op.boolean.operands, operation)
          return evaluateVectorElement({
            ...op,
            d: subResult.d,
            viewBox: subResult.viewBox,
            fillRule: subResult.fillRule,
            boolean: {
              ...op.boolean,
              operation,
            },
          })
        }
        if (op.type === 'path' && op.boolean) {
          const res = updateNested(op.boolean.operands)
          if (res.found) {
            found = true
            return evaluateVectorElement({
              ...op,
              boolean: { ...op.boolean, operands: res.operands },
            })
          }
        }
        return op
      })
      return { found, operands: next }
    }

    const res = updateNested(node.boolean.operands)
    if (!res.found) throw new Error('Nested compound source not found')
    this.refreshCompound(node, { ...node.boolean, operands: res.operands }, `Change nested boolean to ${operation}`)
  }

  unwrapNestedBoolean(id: string, nestedOperandId: string): void {
    const node = this.requireCompound(id)
    const unwrapIn = (operands: readonly VectorElement[]): { found: boolean; operands: readonly VectorElement[] } => {
      const idx = operands.findIndex(op => op.id === nestedOperandId)
      if (idx !== -1) {
        const nested = operands[idx]
        if (nested.type !== 'path' || !nested.boolean) throw new Error('Target is not a compound shape')
        return {
          found: true,
          operands: [
            ...operands.slice(0, idx),
            ...nested.boolean.operands,
            ...operands.slice(idx + 1),
          ],
        }
      }
      for (let i = 0; i < operands.length; i++) {
        const op = operands[i]
        if (op.type === 'path' && op.boolean) {
          const res = unwrapIn(op.boolean.operands)
          if (res.found) {
            const evaluated = evaluateVectorElement({
              ...op,
              boolean: { ...op.boolean, operands: res.operands },
            })
            return {
              found: true,
              operands: [
                ...operands.slice(0, i),
                evaluated,
                ...operands.slice(i + 1),
              ],
            }
          }
        }
      }
      return { found: false, operands }
    }

    const res = unwrapIn(node.boolean.operands)
    if (!res.found) throw new Error('Nested compound source not found')
    this.refreshCompound(node, { ...node.boolean, operands: res.operands }, `Unwrap nested boolean`)
  }

  /** Source order defines the base of subtraction and the stack when released. */
  reorderBooleanOperands(id: string, operandIds: readonly string[]): void {
    const node = this.requireCompound(id), sources = new Map(node.boolean.operands.map(source => [source.id, source]))
    if (operandIds.length !== sources.size || new Set(operandIds).size !== sources.size || operandIds.some(sourceId => !sources.has(sourceId))) throw new Error('Source order must contain every boolean source exactly once')
    if (operandIds.every((sourceId, index) => sourceId === node.boolean.operands[index].id)) return
    const operands = operandIds.map((sourceId, zIndex) => ({ ...sources.get(sourceId)!, zIndex }))
    this.refreshCompound(node, { ...node.boolean, operands }, 'Reorder boolean sources')
  }

  updateBooleanOperand(id: string, operandId: string, patch: ElementPatch<'rectangle' | 'ellipse' | 'path'>): void {
    const node = this.requireCompound(id, true)
    for (const key of ['mask', 'component', 'id', 'type', 'children', 'parentId', 'zIndex', 'boolean', 'tokenBindings', 'sharedStyleBindings', 'visible', 'locked']) {
      if (Object.hasOwn(patch, key)) throw new Error(`Cannot change source ${key}`)
    }

    const updateInOperands = (operands: readonly VectorElement[]): { found: boolean; operands: readonly VectorElement[] } => {
      let found = false
      const next = operands.map(operand => {
        if (operand.id === operandId) {
          found = true
          if (operand.type === 'path' && operand.boolean && ['d', 'viewBox', 'fillRule', 'nodes'].some(key => Object.hasOwn(patch, key))) {
            throw new Error('Release the compound to edit a nested operation')
          }
          const updated = {
            ...operand,
            ...patch,
            ...(operand.tokenBindings ? { tokenBindings: detachEditedBindings(operand.tokenBindings, patch as Record<string, unknown>, operand) } : {}),
            style: { ...operand.style, ...patch.style },
          } as VectorElement
          if (updated.type === 'path') {
            if (Object.hasOwn(patch, 'nodes') && updated.nodes) Object.assign(updated, { d: serializePath(updated.nodes) })
            else if (Object.hasOwn(patch, 'd')) delete (updated as { nodes?: unknown }).nodes
          }
          validateElement(updated)
          return updated
        }
        if (operand.type === 'path' && operand.boolean) {
          const res = updateInOperands(operand.boolean.operands)
          if (res.found) {
            found = true
            const evaluated = evaluateVectorElement({
              ...operand,
              boolean: { ...operand.boolean, operands: res.operands },
            })
            return evaluated
          }
        }
        return operand
      })
      return { found, operands: next }
    }

    const res = updateInOperands(node.boolean.operands)
    if (!res.found) throw new Error('Unknown boolean source')
    this.refreshCompound(node, { ...node.boolean, operands: res.operands }, `Edit source`)
  }

  updateBooleanOperandNodes(id: string, operandId: string, nodes: readonly PathNodes[] | readonly PathContour[]): void {
    const node = this.requireCompound(id, true)
    const d = serializePath(nodes)

    const updateInOperands = (operands: readonly VectorElement[]): { found: boolean; operands: readonly VectorElement[] } => {
      let found = false
      const next = operands.map(operand => {
        if (operand.id === operandId) {
          found = true
          let updated: VectorElement
          if (operand.type === 'path') {
            updated = {
              ...operand,
              nodes: nodes as readonly PathNodes[],
              d,
            }
          } else {
            updated = createElement('path', {
              id: operand.id,
              name: operand.name,
              parentId: operand.parentId,
              x: operand.x,
              y: operand.y,
              width: operand.width,
              height: operand.height,
              rotation: operand.rotation,
              d,
              nodes: nodes as readonly PathNodes[],
              viewBox: [0, 0, operand.width, operand.height],
              fillRule: 'nonzero',
              style: operand.style,
            })
          }
          validateElement(updated)
          return updated
        }
        if (operand.type === 'path' && operand.boolean) {
          const res = updateInOperands(operand.boolean.operands)
          if (res.found) {
            found = true
            const evaluated = evaluateVectorElement({
              ...operand,
              boolean: { ...operand.boolean, operands: res.operands },
            })
            return evaluated
          }
        }
        return operand
      })
      return { found, operands: next }
    }

    const res = updateInOperands(node.boolean.operands)
    if (!res.found) throw new Error('Unknown boolean source')
    this.refreshCompound(
      node,
      {
        ...node.boolean,
        operands: res.operands,
      },
      `Edit sub-path anchors`
    )
  }

  addBooleanOperand(id: string, operand: VectorElement, index?: number): void {
    const node = this.requireCompound(id)
    validateElement(operand)
    const current = node.boolean.operands
    const insertIdx = index !== undefined ? Math.max(0, Math.min(current.length, index)) : current.length
    const nextOperands = [...current.slice(0, insertIdx), operand, ...current.slice(insertIdx)]
    this.refreshCompound(node, { ...node.boolean, operands: nextOperands }, `Add ${operand.name} to compound`)
  }

  toggleBooleanOperandMute(id: string, operandId: string): void {
    this.toggleBooleanOperandMuted(id, operandId)
  }

  toggleBooleanOperandMuted(id: string, operandId: string): void {
    const node = this.requireCompound(id)
    const toggleIn = (compound: BooleanCompound): { found: boolean; compound: BooleanCompound } => {
      const hasDirect = compound.operands.some(op => op.id === operandId)
      if (hasDirect) {
        const muted = new Set(compound.mutedOperandIds ?? [])
        if (muted.has(operandId)) {
          muted.delete(operandId)
        } else {
          if (muted.size + 1 >= compound.operands.length) {
            throw new Error('At least one operand must remain active in the compound shape')
          }
          muted.add(operandId)
        }
        const nextMuted = Array.from(muted)
        return {
          found: true,
          compound: {
            ...compound,
            mutedOperandIds: nextMuted.length > 0 ? nextMuted : undefined,
          },
        }
      }
      for (let i = 0; i < compound.operands.length; i++) {
        const op = compound.operands[i]
        if (op.type === 'path' && op.boolean) {
          const res = toggleIn(op.boolean)
          if (res.found) {
            const updatedChild = evaluateVectorElement({
              ...op,
              boolean: res.compound,
            })
            const nextOperands = [
              ...compound.operands.slice(0, i),
              updatedChild,
              ...compound.operands.slice(i + 1),
            ]
            return {
              found: true,
              compound: { ...compound, operands: nextOperands },
            }
          }
        }
      }
      return { found: false, compound }
    }
    const res = toggleIn(node.boolean)
    if (!res.found) throw new Error('Boolean source not found')
    this.refreshCompound(node, res.compound, 'Toggle boolean source visibility')
  }

  duplicateBooleanOperand(id: string, operandId: string): void {
    const node = this.requireCompound(id)
    const duplicateIn = (operands: readonly VectorElement[]): { found: boolean; operands: readonly VectorElement[] } => {
      const idx = operands.findIndex(op => op.id === operandId)
      if (idx !== -1) {
        const target = operands[idx]
        const cloneId = crypto.randomUUID()
        const clone: VectorElement = {
          ...target,
          id: cloneId,
          name: `${target.name} Copy`,
          x: target.x + 10,
          y: target.y + 10,
        }
        validateElement(clone)
        return {
          found: true,
          operands: [
            ...operands.slice(0, idx + 1),
            clone,
            ...operands.slice(idx + 1),
          ],
        }
      }
      for (let i = 0; i < operands.length; i++) {
        const op = operands[i]
        if (op.type === 'path' && op.boolean) {
          const res = duplicateIn(op.boolean.operands)
          if (res.found) {
            const evaluated = evaluateVectorElement({
              ...op,
              boolean: { ...op.boolean, operands: res.operands },
            })
            return {
              found: true,
              operands: [
                ...operands.slice(0, i),
                evaluated,
                ...operands.slice(i + 1),
              ],
            }
          }
        }
      }
      return { found: false, operands }
    }
    const res = duplicateIn(node.boolean.operands)
    if (!res.found) throw new Error('Boolean source not found')
    this.refreshCompound(node, { ...node.boolean, operands: res.operands }, 'Duplicate boolean source')
  }

  removeBooleanOperand(id: string, operandId: string): void {
    const node = this.requireCompound(id)
    const removeIn = (operands: readonly VectorElement[]): { found: boolean; operands: readonly VectorElement[] } => {
      const idx = operands.findIndex(op => op.id === operandId)
      if (idx !== -1) {
        if (operands.length <= 2) {
          throw new Error('A boolean compound must retain at least two vector shapes. Release the compound instead.')
        }
        return {
          found: true,
          operands: operands.filter(op => op.id !== operandId),
        }
      }
      for (let i = 0; i < operands.length; i++) {
        const op = operands[i]
        if (op.type === 'path' && op.boolean) {
          const res = removeIn(op.boolean.operands)
          if (res.found) {
            const evaluated = evaluateVectorElement({
              ...op,
              boolean: { ...op.boolean, operands: res.operands },
            })
            return {
              found: true,
              operands: [
                ...operands.slice(0, i),
                evaluated,
                ...operands.slice(i + 1),
              ],
            }
          }
        }
      }
      return { found: false, operands }
    }
    const res = removeIn(node.boolean.operands)
    if (!res.found) throw new Error('Unknown boolean source')
    this.refreshCompound(node, { ...node.boolean, operands: res.operands }, 'Remove boolean operand')
  }

  groupBooleanOperands(id: string, operandIds: readonly string[], operation: BooleanOperation = 'union'): void {
    const node = this.requireCompound(id)
    const targetSet = new Set(operandIds)
    const subOperands = node.boolean.operands.filter(op => targetSet.has(op.id))
    if (subOperands.length < 2) throw new Error('Select at least two operands to group into a compound')
    const subResult = computeBoolean(subOperands, operation)
    const groupNode = createElement('path', {
      name: `${operation[0].toUpperCase() + operation.slice(1)} Compound`,
      parentId: node.parentId,
      ...subResult.bounds,
      d: subResult.d,
      viewBox: subResult.viewBox,
      fillRule: subResult.fillRule,
      style: subOperands[0].style,
      boolean: {
        operation,
        operands: subOperands,
      },
    })
    const firstIdx = node.boolean.operands.findIndex(op => targetSet.has(op.id))
    const remaining = node.boolean.operands.filter(op => !targetSet.has(op.id))
    const nextOperands = [
      ...remaining.slice(0, firstIdx),
      groupNode,
      ...remaining.slice(firstIdx),
    ]
    this.refreshCompound(node, { ...node.boolean, operands: nextOperands }, `Group operands into nested ${operation}`)
  }

  extractBooleanOperand(id: string, operandId: string): void {
    this.releaseBooleanOperand(id, operandId)
  }

  releaseBooleanOperand(id: string, operandId: string): void {
    const node = this.requireCompound(id)
    if (node.boolean.operands.length <= 2) {
      throw new Error('A boolean compound must retain at least two vector shapes. Release the entire compound instead.')
    }
    const operand = node.boolean.operands.find(op => op.id === operandId)
    if (!operand) throw new Error('Boolean source not found')
    const shape = transformedSource(operand, node)
    const sourceId = Object.hasOwn(this.state.elements, operand.id) ? crypto.randomUUID() : operand.id
    const restored = createElement('path', {
      id: sourceId,
      name: operand.name,
      parentId: node.parentId,
      ...shape.bounds,
      d: shape.d,
      viewBox: shape.viewBox,
      fillRule: operand.type === 'path' ? operand.fillRule : 'nonzero',
      style: operand.style,
      ...(operand.type === 'path' && operand.boolean ? { boolean: operand.boolean } : {}),
    })
    const remainingOperands = node.boolean.operands.filter(op => op.id !== operandId)
    const updatedCompound = refreshBooleanElement(node, { ...node.boolean, operands: remainingOperands })
    validateElement(updatedCompound)
    validateElement(restored)
    const elements = { ...this.state.elements, [node.id]: freezeElement(updatedCompound), [restored.id]: freezeElement(restored) }
    const siblings = this.getChildren(node.parentId)
    const nodeIdx = siblings.indexOf(node.id)
    const nextSiblings = [...siblings]
    nextSiblings.splice(nodeIdx + 1, 0, restored.id)
    this.ordered(elements, node.parentId, nextSiblings)
    this.commit(elements, node.parentId === null ? nextSiblings : this.state.rootIds, [restored.id], `Release ${operand.name} from compound`)
  }

  compoundMaskSelectionReason(ids = this.state.selection): string | null {
    if (this.history.getSnapshot().active) return 'Finish the active edit first.'
    const nodes = [...new Set(ids)].map(id => this.state.elements[id])
    if (nodes.length < 2 || nodes.some(node => !node)) return 'Select at least two vector shapes.'
    if (nodes.some(node => this.isLocked(node.id) || !this.isVisible(node.id))) return 'Choose visible, unlocked layers.'
    if (nodes.some(node => componentRoot(this.state.elements, node.id) || subtree(this.state.elements, node.id).some(child => child.component))) return 'Detach the component before grouping its layers.'
    if (nodes.some(node => node.parentId !== nodes[0].parentId)) return 'Choose layers in the same frame.'
    if (nodes.some(node => node.mask)) return 'Release the existing mask before regrouping.'
    const vectorNodes = nodes.filter(isVector)
    if (vectorNodes.length < 2) return 'Choose at least two vector shapes for the compound mask.'
    return null
  }

  createCompoundMask(operation: BooleanOperation = 'subtract', ids = this.state.selection): SceneElement {
    const reason = this.compoundMaskSelectionReason(ids)
    if (reason) throw new Error(reason)
    const nodes = [...new Set(ids)].map(id => this.require(id)).sort((a, b) => a.zIndex - b.zIndex)
    const parentId = nodes[0].parentId
    const bounds = unionBounds(nodes.map(n => getWorldBounds({ ...this.state, elements: { ...this.state.elements, [n.id]: { ...n, parentId: null } } }, n.id)))!
    const group = createElement('frame', { name: 'Compound mask group', parentId, ...bounds, clipContent: false, style: { fill: null } })

    const nonVectorTargets = nodes.filter(n => !isVector(n))
    let maskOperands: VectorElement[]
    let contentNodes: SceneElement[]
    if (nonVectorTargets.length > 0) {
      maskOperands = nodes.filter(isVector)
      contentNodes = nonVectorTargets
    } else if (nodes.length > 2) {
      contentNodes = [nodes[0]]
      maskOperands = nodes.slice(1).filter(isVector)
    } else {
      maskOperands = nodes.filter(isVector)
      contentNodes = []
    }

    if (maskOperands.length < 2) {
      throw new Error('Select at least two vector shapes to create a compound mask')
    }

    // Rebase operand coordinates into the group frame coordinates
    const rebasedOperands = maskOperands.map(v => ({
      ...v,
      parentId: group.id,
      x: v.x - bounds.x,
      y: v.y - bounds.y,
    }))

    const compoundResult = computeBoolean(rebasedOperands, operation)
    const maskCompound = createElement('path', {
      name: `${operation[0].toUpperCase() + operation.slice(1)} mask`,
      parentId: group.id,
      x: compoundResult.bounds.x,
      y: compoundResult.bounds.y,
      width: compoundResult.bounds.width,
      height: compoundResult.bounds.height,
      d: compoundResult.d,
      viewBox: compoundResult.viewBox,
      fillRule: compoundResult.fillRule,
      style: { fill: '#81adec' },
      boolean: { operation, operands: rebasedOperands },
      mask: { enabled: true, showOutline: true },
    })

    const elements = { ...this.state.elements, [group.id]: group, [maskCompound.id]: maskCompound }
    for (const v of maskOperands) delete elements[v.id]

    const childIds = [maskCompound.id]
    for (const target of contentNodes) {
      const patch = { x: target.x - bounds.x, y: target.y - bounds.y, parentId: group.id }
      elements[target.id] = freezeElement({ ...target, ...patch })
      childIds.push(target.id)
    }
    this.ordered(elements, group.id, childIds)

    const selected = new Set(ids), siblings = this.getChildren(parentId)
    const next = siblings.filter(id => !selected.has(id))
    next.splice(siblings.slice(0, nodes.at(-1)!.zIndex).filter(id => !selected.has(id)).length, 0, group.id)
    this.ordered(elements, parentId, next)
    this.commit(elements, parentId === null ? next : this.state.rootIds, [group.id], `Create ${operation} compound mask`)
    return this.state.elements[group.id]
  }

  setCompoundMaskOperation(id: string, operation: BooleanOperation): void {
    const node = this.require(id)
    if (node.type !== 'path' || !node.boolean || !node.mask) {
      throw new Error('Selected element is not a compound mask')
    }
    this.setBooleanOperation(id, operation)
  }

  flattenBoolean(id: string): void {
    const node = this.requireCompound(id)
    const { boolean: sources, ...path } = node
    void sources
    const optimized = { ...path, d: optimizeSvgBezierData(path.d) }
    validateElement(optimized)
    this.commit({ ...this.state.elements, [id]: freezeElement(optimized) }, this.state.rootIds, this.state.selection, 'Flatten boolean compound')
  }

  /** Release sources at the compound's current position, scale and rotation. */
  releaseBoolean(id: string): readonly string[] {
    const node = this.requireCompound(id), [vx, vy, vw, vh] = node.viewBox
    if (node.mask) throw new Error('Release the mask before releasing its boolean sources')
    const sx = node.width / vw, sy = node.height / vh, angle = node.rotation * Math.PI / 180
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const elements = { ...this.state.elements }, released: string[] = []
    for (const operand of node.boolean.operands) {
      const sourceId = Object.hasOwn(elements, operand.id) ? crypto.randomUUID() : operand.id
      let restored: VectorElement
      if (Math.abs(sx - 1) < 1e-10 && Math.abs(sy - 1) < 1e-10 && node.rotation === 0) restored = { ...operand, id: sourceId, parentId: node.parentId, x: operand.x + node.x - vx, y: operand.y + node.y - vy }
      else if (Math.abs(sx - sy) < 1e-10 || operand.rotation % 180 === 0) {
        const dx = (operand.x + operand.width / 2 - vx) * sx - node.width / 2, dy = (operand.y + operand.height / 2 - vy) * sy - node.height / 2
        const width = operand.width * sx, height = operand.height * sy
        restored = { ...operand, id: sourceId, parentId: node.parentId, x: node.x + node.width / 2 + cos * dx - sin * dy - width / 2, y: node.y + node.height / 2 + sin * dx + cos * dy - height / 2, width, height, rotation: operand.rotation + node.rotation,
          ...('cornerRadius' in operand ? { cornerRadius: operand.cornerRadius * Math.min(sx, sy) } : {}),
        }
        // Unequal scaling of rounded rectangles needs elliptical corner geometry.
        if (operand.type === 'rectangle' && operand.cornerRadius > 0 && Math.abs(sx - sy) > 1e-10) {
          const shape = transformedSource(operand, node)
          restored = createElement('path', { id: sourceId, name: operand.name, visible: operand.visible, locked: operand.locked, style: operand.style, parentId: node.parentId, ...shape.bounds, d: shape.d, viewBox: shape.viewBox, fillRule: 'nonzero' })
        }
      } else {
        const shape = transformedSource(operand, node)
        restored = createElement('path', {
          id: sourceId,
          name: operand.name,
          parentId: node.parentId,
          ...shape.bounds,
          d: shape.d,
          viewBox: shape.viewBox,
          fillRule: operand.type === 'path' ? operand.fillRule : 'nonzero',
          style: operand.style,
          ...(operand.type === 'path' && operand.boolean ? { boolean: operand.boolean } : {}),
        })
      }
      // Primitive strokes are in element pixels; paths scale their strokes
      // through the viewBox instead. Keep the fill boundary aligned on release.
      if (operand.type !== 'path' && restored.type !== 'path' && operand.style.stroke && Math.abs(sx - sy) < 1e-10 && Math.abs(sx - 1) > 1e-10) {
        restored = { ...restored, style: { ...restored.style, stroke: {
          ...operand.style.stroke, width: operand.style.stroke.width * sx, dash: operand.style.stroke.dash.map(value => value * sx),
        } } }
      }
      if (operand.tokenBindings) {
        const tokenBindings = { ...operand.tokenBindings }
        for (const property of Object.keys(tokenBindings) as TokenProperty[]) {
          if (!supportsTokenProperty(restored, property) || (property !== 'fill' && property !== 'stroke' && restored[property as keyof VectorElement] !== operand[property as keyof VectorElement])) delete tokenBindings[property]
        }
        restored = { ...restored, tokenBindings }
      }
      if (operand.sharedStyleBindings) restored = { ...restored, sharedStyleBindings: operand.sharedStyleBindings }
      validateElement(restored)
      elements[sourceId] = freezeElement(restored); released.push(sourceId)
    }
    delete elements[id]
    const siblings = [...this.getChildren(node.parentId)]
    siblings.splice(node.zIndex, 1, ...released)
    this.ordered(elements, node.parentId, siblings)
    this.commit(elements, node.parentId === null ? siblings : this.state.rootIds, released, 'Release boolean compound')
    return released
  }

  /**
   * Splits a multi-subpath vector path element into individual PathElement layers in the scene graph.
   * Preserves styles, transforms, parent relationships, and exact geometry.
   */
  splitPathToSeparateElements(id: string): string[] {
    const node = this.require(id)
    if (node.type !== 'path') throw new Error('Selected element is not a vector path')
    if (this.isLocked(id)) throw new Error('Element is locked')
    if (this.history.getSnapshot().active) throw new Error('Finish the active edit first')

    const contours: PathContour[] = node.nodes ? copyContours(node.nodes) : parsePath(node.d)
    if (contours.length <= 1) return [id]

    const newIds: string[] = []
    const sx = node.width / (node.viewBox[2] || 1)
    const sy = node.height / (node.viewBox[3] || 1)
    const angle = (node.rotation * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    this.batch(() => {
      for (let i = 0; i < contours.length; i++) {
        const contour = contours[i]
        const b = pathBounds([contour], (node.style.stroke?.width ?? 0) / 2)
        const width = b.width * sx
        const height = b.height * sy
        const dx = (b.x - node.viewBox[0]) * sx + (width - node.width) / 2
        const dy = (b.y - node.viewBox[1]) * sy + (height - node.height) / 2
        const subX = node.x + cos * dx - sin * dy - (width - node.width) / 2
        const subY = node.y + sin * dx + cos * dy - (height - node.height) / 2

        const subNode = this.add('path', {
          name: `${node.name} part ${i + 1}`,
          parentId: node.parentId,
          x: Math.round(subX * 2) / 2,
          y: Math.round(subY * 2) / 2,
          width: Math.max(1, Math.round(width * 2) / 2),
          height: Math.max(1, Math.round(height * 2) / 2),
          rotation: node.rotation,
          nodes: [contour],
          d: serializePath([contour]),
          viewBox: [b.x, b.y, b.width, b.height],
          fillRule: node.fillRule,
          style: { ...node.style },
        })
        newIds.push(subNode.id)
      }
      this.remove(id)
      this.select(newIds)
    }, `Split path into ${contours.length} layers`)

    return newIds
  }

  addToken(input: TokenInput): DesignToken {
    return this.addTokens([input])[0]
  }

  /** Clipboard and integrations can insert a whole theme atomically. */
  addTokens(inputs: readonly TokenInput[]): readonly DesignToken[] {
    if (!inputs.length) return []
    const tokens = inputs.map(input => ({ ...input, id: input.id ?? crypto.randomUUID() }) as DesignToken)
    this.setTokens([...this.state.tokens, ...tokens], tokens.length === 1 ? `Add ${tokens[0].name} token` : 'Paste tokens')
    return this.state.tokens.slice(-tokens.length)
  }

  updateToken(id: string, patch: { name?: string; value?: string | number; aliasId?: string; themeValues?: Readonly<Record<string, string | number>>; palette?: string }): void {
    const token = this.state.tokens.find(candidate => candidate.id === id)
    if (!token) throw new Error('Unknown token')
    const next = { ...token, ...patch } as DesignToken
    if (equalValue(token, next)) return
    this.setTokens(this.state.tokens.map(candidate => candidate.id === id ? next : candidate), `Edit ${token.name} token`)
  }

  duplicateToken(id: string): DesignToken {
    const token = this.state.tokens.find(candidate => candidate.id === id)
    if (!token) throw new Error('Unknown token')
    let name = `${token.name}-copy`, index = 2
    while (this.state.tokens.some(candidate => tokenVariable(candidate) === tokenVariable({ ...token, name }))) name = `${token.name}-copy-${index++}`
    return this.addToken({ ...token, id: crypto.randomUUID(), name })
  }

  removeTokens(ids: readonly string[]): void {
    const removed = new Set(ids)
    if (!this.state.tokens.some(token => removed.has(token.id))) return
    const elements = { ...this.state.elements }
    for (const node of Object.values(elements)) {
      // Values were already resolved; removing a token detaches, retaining its appearance.
      let next = releaseComponentResources(node, this.state.elements, resolveTokens(this.state.tokens, this.state.styleLibrary.activeThemeId), this.state.styleLibrary, removed, 'tokens')
      next = detachRemovedTokenBindings(next, removed)
      if (next.component?.kind === 'instance' && next.component.overrides.tokenBindings) {
        for (const [property, tokenId] of Object.entries(next.component.overrides.tokenBindings)) {
          if (tokenId !== null && removed.has(tokenId)) next = recordComponentTokenEdit(next, next, property as TokenProperty, null)
        }
      }
      if (next !== node) elements[node.id] = freezeElement(next)
    }
    const resolved = resolveTokens(this.state.tokens, this.state.styleLibrary.activeThemeId)
    const lookup = new Map(resolved.map(token => [token.id, token]))
    const tokens = validateTokens(this.state.tokens.filter(token => !removed.has(token.id)).map(token => {
      if (!token.aliasId || !removed.has(token.aliasId)) return token
      const { aliasId, ...literal } = token; void aliasId
      const themeValues = Object.fromEntries(this.state.styleLibrary.themes.map(theme => [theme.id, resolveTokens(this.state.tokens, theme.id).find(value => value.id === token.id)!.value]))
      return { ...literal, value: resolveTokens(this.state.tokens).find(value => value.id === token.id)!.value, themeValues } as DesignToken
    }))
    const styles = this.state.styleLibrary.styles.map(style => {
      if (style.kind === 'color' && style.tokenId && removed.has(style.tokenId)) {
        const { tokenId, ...literal } = style
        return { ...literal, value: lookup.get(tokenId)!.value as string }
      }
      if (style.kind === 'typography') {
        const value = { ...style.value, tokenBindings: { ...style.value.tokenBindings } }
        for (const [key, id] of Object.entries(value.tokenBindings)) if (removed.has(id)) {
          Object.assign(value, { [key]: lookup.get(id)!.value }); delete value.tokenBindings[key as TokenProperty]
        }
        return { ...style, value }
      }
      if (style.kind === 'effects') return { ...style, value: style.value.map(effect => {
        if (effect.type === 'layer-blur' || !effect.colorTokenId || !removed.has(effect.colorTokenId)) return effect
        const { colorTokenId, ...literal } = effect
        return { ...literal, color: lookup.get(colorTokenId)!.value as string }
      }) }
      return style
    })
    const styleLibrary = validateLibrary({ ...this.state.styleLibrary, styles }, tokens)
    this.publish(Object.freeze({ ...this.state, tokens, styleLibrary, elements: Object.freeze(elements) }), 'Delete tokens')
  }

  bindToken(id: string, property: TokenProperty, tokenId: string): void {
    const node = this.require(id)
    if (this.isLocked(id)) throw new Error('Element is locked')
    if (!supportsTokenProperty(node, property)) throw new Error('Unsupported token property')
    if (node.tokenBindings?.[property] === tokenId) return
    const next = this.resolveStyles({ ...node, ...(node.sharedStyleBindings ? { sharedStyleBindings: detachEditedSharedStyles(node.sharedStyleBindings, property === 'shadow' ? { style: { shadow: true } } : property === 'fill' ? { style: { fill: true } } : { [property]: true }) } : {}), ...(property === 'width' || property === 'height' ? { sizing: { ...(node.sizing ?? FIXED_SIZING), [property]: 'fixed' } } : {}), tokenBindings: { ...node.tokenBindings, [property]: tokenId } })
    validateElement(next)
    const updated = recordComponentTokenEdit(node, next, property, tokenId)
    this.commit({ ...this.state.elements, [id]: freezeElement(updated) }, this.state.rootIds, this.state.selection, `Bind ${property} token`)
  }

  detachToken(id: string, property: TokenProperty): void {
    const node = this.require(id)
    if (this.isLocked(id)) throw new Error('Element is locked')
    if (!node.tokenBindings?.[property]) return
    const tokenBindings = { ...node.tokenBindings }
    delete tokenBindings[property]
    const updated = recordComponentTokenEdit(node, { ...node, tokenBindings }, property, null)
    this.commit({ ...this.state.elements, [id]: freezeElement(updated) }, this.state.rootIds, this.state.selection, `Detach ${property} token`)
  }

  private resolveStyles(node: SceneElement, tokens = resolveTokens(this.state.tokens, this.state.styleLibrary.activeThemeId), library = this.state.styleLibrary): SceneElement {
    return resolveTokenBindings(resolveSharedStyles(node, library, tokens), tokens)
  }

  private setTokens(input: readonly DesignToken[], label: string): void {
    this.setDesignSystem(input, this.state.styleLibrary, label)
  }

  private setDesignSystem(input: readonly DesignToken[], inputLibrary: StyleLibrary, label: string): void {
    const tokens = input === this.state.tokens ? input : validateTokens(input), styleLibrary = validateLibrary(inputLibrary, tokens)
    const resolved = resolveTokens(tokens, styleLibrary.activeThemeId)
    let elements = this.state.elements
    for (const node of Object.values(elements)) {
      const next = this.resolveStyles(node, resolved, styleLibrary)
      if (next === node) continue
      validateElement(next)
      if (elements === this.state.elements) elements = { ...elements }
      ;(elements as Record<string, SceneElement>)[node.id] = freezeElement(next)
    }
    this.publish(Object.freeze({ ...this.state, tokens, styleLibrary, elements: Object.freeze(elements) }), label)
  }

  addTheme(name: string): string {
    const id = crypto.randomUUID()
    this.setDesignSystem(this.state.tokens, { ...this.state.styleLibrary, themes: [...this.state.styleLibrary.themes, { id, name }] }, 'Add theme')
    return id
  }

  setActiveTheme(id: string | null): void {
    if (id === this.state.styleLibrary.activeThemeId) return
    this.setDesignSystem(this.state.tokens, { ...this.state.styleLibrary, activeThemeId: id }, 'Switch document theme')
  }

  removeTheme(id: string): void {
    const tokens = this.state.tokens.map(token => {
      const themeValues: Record<string, string | number> = { ...token.themeValues }; delete themeValues[id]
      return { ...token, ...(token.themeValues ? { themeValues } : {}) } as DesignToken
    })
    const library = this.state.styleLibrary
    this.setDesignSystem(tokens, { ...library, themes: library.themes.filter(theme => theme.id !== id), activeThemeId: library.activeThemeId === id ? null : library.activeThemeId }, 'Delete theme')
  }

  setTokenThemeValue(id: string, themeId: string, value: string | number | undefined): void {
    const token = this.state.tokens.find(token => token.id === id)
    if (!token) throw new Error('Unknown token')
    if (!this.state.styleLibrary.themes.some(theme => theme.id === themeId)) throw new Error('Unknown theme')
    const themeValues: Record<string, string | number> = { ...token.themeValues }
    if (value === undefined) delete themeValues[themeId]; else themeValues[themeId] = value
    this.updateToken(id, { themeValues })
  }

  addSharedStyle(input: SharedStyleInput): SharedStyle {
    const style = { ...input, id: input.id ?? crypto.randomUUID() } as SharedStyle
    this.setDesignSystem(this.state.tokens, { ...this.state.styleLibrary, styles: [...this.state.styleLibrary.styles, style] }, 'Add shared style')
    return this.state.styleLibrary.styles.at(-1)!
  }

  updateSharedStyle(style: SharedStyle): void {
    const previous = this.state.styleLibrary.styles.find(candidate => candidate.id === style.id)
    if (!previous || previous.kind !== style.kind) throw new Error('Unknown or incompatible shared style')
    if (equalValue(previous, style)) return
    this.setDesignSystem(this.state.tokens, { ...this.state.styleLibrary, styles: this.state.styleLibrary.styles.map(candidate => candidate.id === style.id ? style : candidate) }, `Edit ${style.name} style`)
  }

  bindSharedStyle(id: string, kind: SharedStyleKind, styleId: string): void {
    const node = this.require(id)
    if (this.isLocked(id)) throw new Error('Element is locked')
    if (node.sharedStyleBindings?.[kind] === styleId) return
    const tokenBindings = { ...node.tokenBindings }
    if (kind === 'effects') delete tokenBindings.shadow
    if (kind === 'color') delete tokenBindings.fill
    if (kind === 'typography') for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] as const) delete tokenBindings[key]
    const next = this.resolveStyles({ ...node, tokenBindings, sharedStyleBindings: { ...node.sharedStyleBindings, [kind]: styleId } })
    validateElement(next)
    this.commit({ ...this.state.elements, [id]: freezeElement(this.recordSharedStyleBinding(node, next, kind, styleId)) }, this.state.rootIds, this.state.selection, `Bind ${kind} style`)
  }

  private recordSharedStyleBinding(node: SceneElement, next: SceneElement, kind: SharedStyleKind, id: string | null): SceneElement {
    if (node.component?.kind !== 'instance') return next
    const original = node.component.overrides
    const overrides = { ...original, properties: { ...original.properties }, style: { ...original.style }, tokenBindings: { ...original.tokenBindings } }
    if (id !== null) {
      if (kind === 'color') { delete overrides.style.fill; delete overrides.tokenBindings.fill }
      if (kind === 'effects') { delete overrides.style.effects; delete overrides.style.shadow; delete overrides.tokenBindings.shadow }
      if (kind === 'typography') for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'variableAxes', 'openTypeFeatures', 'fontKerning', 'opticalKerning', 'opticalMarginAlignment', 'showOpticalMetrics', 'textOnPath', 'textTransform', 'renderMode', 'renderOutlines', 'outlinePathD'] as const) {
        delete (overrides.properties as Record<string, unknown>)[key]
        delete (overrides.tokenBindings as Record<string, unknown>)[key]
      }
    }
    const detached = id === null ? kind === 'color' ? { style: { ...overrides.style, fill: node.style.fill } } : kind === 'effects' ? { style: { ...overrides.style, effects: node.style.effects } } : { properties: { ...overrides.properties, ...(node.type === 'text' ? { fontFamily: node.fontFamily, fontSize: node.fontSize, fontWeight: node.fontWeight, lineHeight: node.lineHeight, letterSpacing: node.letterSpacing, textAlign: node.textAlign, variableAxes: node.variableAxes, openTypeFeatures: node.openTypeFeatures, fontKerning: node.fontKerning, opticalKerning: node.opticalKerning, opticalMarginAlignment: node.opticalMarginAlignment, showOpticalMetrics: node.showOpticalMetrics, textOnPath: node.textOnPath, textTransform: node.textTransform, renderMode: node.renderMode, renderOutlines: node.renderOutlines, outlinePathD: node.outlinePathD } : {}) } } : {}
    return { ...next, component: { ...node.component, overrides: { ...overrides, ...detached, sharedStyleBindings: { ...overrides.sharedStyleBindings, [kind]: id } } } }
  }

  detachSharedStyle(id: string, kind: SharedStyleKind): void {
    const node = this.require(id)
    if (this.isLocked(id)) throw new Error('Element is locked')
    if (!node.sharedStyleBindings?.[kind]) return
    const sharedStyleBindings = { ...node.sharedStyleBindings }; delete sharedStyleBindings[kind]
    const next = this.recordSharedStyleBinding(node, { ...node, sharedStyleBindings }, kind, null)
    this.commit({ ...this.state.elements, [id]: freezeElement(next) }, this.state.rootIds, this.state.selection, `Detach ${kind} style`)
  }

  removeSharedStyle(id: string): void {
    if (!this.state.styleLibrary.styles.some(style => style.id === id)) return
    const detach = (node: SceneElement): SceneElement => {
      let next = releaseComponentResources(node, this.state.elements, resolveTokens(this.state.tokens, this.state.styleLibrary.activeThemeId), this.state.styleLibrary, new Set([id]), 'styles')
      for (const kind of ['color', 'typography', 'effects'] as const) if (next.sharedStyleBindings?.[kind] === id) {
        const sharedStyleBindings = { ...next.sharedStyleBindings }; delete sharedStyleBindings[kind]
        next = this.recordSharedStyleBinding(next, { ...next, sharedStyleBindings }, kind, null)
      }
      if (next.type === 'path' && next.boolean) next = { ...next, boolean: { ...next.boolean, operands: next.boolean.operands.map(source => detach(source) as VectorElement) } }
      return next === node ? node : freezeElement(next)
    }
    const elements = Object.fromEntries(Object.entries(this.state.elements).map(([key, node]) => [key, detach(node)]))
    const styleLibrary = validateLibrary({ ...this.state.styleLibrary, styles: this.state.styleLibrary.styles.filter(style => style.id !== id) }, this.state.tokens)
    this.publish(Object.freeze({ ...this.state, elements: Object.freeze(elements), styleLibrary }), 'Delete shared style')
  }

  setBackgroundShader(paint: ShaderPaint | null): void {
    if (paint !== null) validateShader(paint)
    if (equalValue(this.state.backgroundShader, paint) && (!this.state.backgroundLayers || this.state.backgroundLayers.length <= 1)) return
    const frozen = paint ? freezeShader(paint) : null
    this.publish(Object.freeze({
      ...this.state,
      backgroundShader: frozen,
      backgroundLayers: this.state.backgroundLayers ? (frozen ? Object.freeze([frozen, ...this.state.backgroundLayers.slice(1)]) : null) : null,
    }), 'Style canvas background')
  }

  setBackgroundLayers(layers: readonly ShaderPaint[] | null): void {
    if (layers !== null) {
      if (!Array.isArray(layers)) throw new Error('Invalid background layers')
      layers.forEach(validateShader)
    }
    const frozenLayers = layers && layers.length > 0 ? Object.freeze(layers.map(freezeShader)) : null
    const primary = frozenLayers && frozenLayers.length > 0 ? frozenLayers[0] : null
    if (equalValue(this.state.backgroundLayers, frozenLayers) && equalValue(this.state.backgroundShader, primary)) return
    this.publish(Object.freeze({ ...this.state, backgroundShader: primary, backgroundLayers: frozenLayers }), 'Update canvas background layers')
  }

  addBackgroundLayer(paint: ShaderPaint): void {
    validateShader(paint)
    const current = this.state.backgroundLayers ?? (this.state.backgroundShader ? [this.state.backgroundShader] : [])
    const frozen = freezeShader(paint)
    const nextLayers = Object.freeze([...current, frozen])
    this.publish(Object.freeze({ ...this.state, backgroundShader: nextLayers[0], backgroundLayers: nextLayers }), 'Add canvas background layer')
  }

  removeBackgroundLayer(index: number): void {
    const current = this.state.backgroundLayers ?? (this.state.backgroundShader ? [this.state.backgroundShader] : [])
    if (index < 0 || index >= current.length) return
    const nextLayers = current.filter((_, i) => i !== index)
    const frozenLayers = nextLayers.length > 0 ? Object.freeze(nextLayers) : null
    const primary = frozenLayers && frozenLayers.length > 0 ? frozenLayers[0] : null
    this.publish(Object.freeze({ ...this.state, backgroundShader: primary, backgroundLayers: frozenLayers }), 'Remove canvas background layer')
  }

  updateBackgroundLayer(index: number, paint: ShaderPaint): void {
    validateShader(paint)
    const current = this.state.backgroundLayers ?? (this.state.backgroundShader ? [this.state.backgroundShader] : [])
    if (index < 0 || index >= current.length) return
    const frozen = freezeShader(paint)
    const nextLayers = Object.freeze(current.map((layer, i) => i === index ? frozen : layer))
    this.publish(Object.freeze({ ...this.state, backgroundShader: nextLayers[0], backgroundLayers: nextLayers }), 'Update canvas background layer')
  }

  reorderBackgroundLayer(fromIndex: number, toIndex: number): void {
    const current = this.state.backgroundLayers ?? (this.state.backgroundShader ? [this.state.backgroundShader] : [])
    if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) return
    const copy = [...current]
    const [removed] = copy.splice(fromIndex, 1)
    copy.splice(toIndex, 0, removed)
    const nextLayers = Object.freeze(copy)
    this.publish(Object.freeze({ ...this.state, backgroundShader: nextLayers[0], backgroundLayers: nextLayers }), 'Reorder canvas background layers')
  }

  setComments(value: CommentDocument, label = 'Edit comments'): void {
    const comments = validateComments(value)
    if (!equalValue(this.state.comments ?? EMPTY_COMMENTS, comments)) this.publish(Object.freeze({ ...this.state, comments }), label)
  }

  setMotion(value: MotionDocument, label = 'Edit motion'): void {
    const motion = validateMotion(value, this.state.elements)
    if (!equalValue(this.state.motion ?? EMPTY_MOTION, motion)) this.publish(Object.freeze({ ...this.state, motion }), label)
  }

  setPrototype(value: PrototypeDocument, label = 'Edit prototype'): void {
    const prototype = validatePrototype(value, this.state.elements)
    if (!equalValue(this.state.prototype ?? EMPTY_PROTOTYPE, prototype)) this.publish(Object.freeze({ ...this.state, prototype }), label)
  }

  /** Enable, disable, or update the real-time physics simulation layer. */
  setPhysics(value: PhysicsDocument, label = 'Edit physics'): void {
    const physics = validatePhysicsDocument(value)
    if (!equalValue(this.state.physics, physics)) this.publish(Object.freeze({ ...this.state, physics }), label)
  }

  connectPrototype(sourceId: string, targetId: string): PrototypeInteraction {
    const value = this.state.prototype ?? EMPTY_PROTOTYPE
    const interaction: PrototypeInteraction = { id: crypto.randomUUID(), sourceId, targetId, trigger: 'click', action: 'navigate', delay: 800, transition: DEFAULT_TRANSITION }
    this.setPrototype({ ...value, interactions: [...value.interactions, interaction] }, 'Connect prototype')
    return this.state.prototype!.interactions.at(-1)!
  }

  updateInteraction(id: string, patch: Partial<Omit<PrototypeInteraction, 'id' | 'sourceId'>>): void {
    const value = this.state.prototype ?? EMPTY_PROTOTYPE
    this.setPrototype({ ...value, interactions: value.interactions.map(item => item.id === id ? { ...item, ...patch } : item) }, 'Edit interaction')
  }

  removeInteraction(id: string): void {
    const value = this.state.prototype ?? EMPTY_PROTOTYPE
    this.setPrototype({ ...value, interactions: value.interactions.filter(item => item.id !== id) }, 'Remove interaction')
  }

  toJSON(): SceneDocument {
    const registry = this.state.componentRegistry ?? buildComponentRegistry(this.state.elements)
    const doc: SceneDocument = {
      version: 1,
      ...(this.state.motion ? { motion: this.state.motion } : {}),
      ...(this.state.comments ? { comments: this.state.comments } : {}),
      tokens: this.state.tokens,
      styleLibrary: this.state.styleLibrary,
      elements: this.state.elements,
      rootIds: this.state.rootIds,
      ...(this.state.prototype ? { prototype: this.state.prototype } : {}),
      ...(this.state.physics ? { physics: this.state.physics } : {}),
      ...(this.state.backgroundShader !== undefined ? { backgroundShader: this.state.backgroundShader } : {}),
      ...(this.state.backgroundLayers && this.state.backgroundLayers.length > 0 ? { backgroundLayers: this.state.backgroundLayers } : {}),
      ...(Object.keys(registry).length > 0 ? { componentRegistry: registry } : {}),
    }
    return doc
  }

  /** Font loading changes text metrics without creating a user edit. */
  refreshLayout(): void {
    invalidateLayoutTextMetrics()
    const elements = reflowAutoLayout(this.state.elements, this.state.rootIds)
    if (elements !== this.state.elements) this.publish(Object.freeze({ ...this.state, elements: Object.freeze(elements) }), 'Refresh layout', false)
  }

  /** Validate the whole document before replacing state; invalid imports are atomic. */
  applyRemote(document: SceneDocument): void {
    const validator = new SceneStore()
    validator.load(document)
    const before = this.state, incoming = validator.getSnapshot()
    const rebase = valueRebaser(before, { ...incoming, selection: before.selection })
    const structural = !equalValue(before.rootIds, incoming.rootIds) || new Set([...Object.keys(before.elements), ...Object.keys(incoming.elements)]).size !== Object.keys(before.elements).length || Object.entries(before.elements).some(([id, node]) => {
      const next = incoming.elements[id]
      return !next || node.parentId !== next.parentId || node.zIndex !== next.zIndex || (node.type === 'frame' && next.type === 'frame' && !equalValue(node.children, next.children))
    })
    const transform = (snapshot: SceneSnapshot): SceneSnapshot => {
      const rebased = rebase(snapshot) as SceneSnapshot
      const normalized = structural ? normalizeHierarchy(rebased) : rebased
      const elements = Object.fromEntries(Object.entries(normalized.elements).map(([id, node]) => [id, freezeElement(node)]))
      return Object.freeze({ ...rebased, elements: Object.freeze(elements), rootIds: Object.freeze([...normalized.rootIds]), selection: Object.freeze(snapshot.selection.filter(id => elements[id])) })
    }
    this.history.rebase(transform)
    if (this.transaction) this.transaction.before = transform(this.transaction.before)
    // Preserve unchanged element references so unrelated canvas nodes stay memoized.
    const elements = Object.fromEntries(Object.entries(incoming.elements).map(([id, node]) => [id, equalValue(before.elements[id], node) ? before.elements[id] : node]))
    const selectable = (id: string) => {
      let node: SceneElement | undefined = elements[id]
      while (node) { if (!node.visible || node.locked) return false; node = node.parentId === null ? undefined : elements[node.parentId] }
      return Boolean(elements[id])
    }
    this.state = Object.freeze({ ...incoming, elements: Object.freeze(elements), selection: Object.freeze(before.selection.filter(selectable)) })
    this.emit()
  }

  load(document: SceneDocument): void {
    if (document.version !== 1 || !document.elements || !Array.isArray(document.rootIds)) throw new Error('Unsupported scene document')
    if (document.backgroundShader !== undefined && document.backgroundShader !== null) validateShader(document.backgroundShader)
    if (document.backgroundLayers !== undefined && document.backgroundLayers !== null) {
      if (!Array.isArray(document.backgroundLayers)) throw new Error('Invalid background layers')
      document.backgroundLayers.forEach(validateShader)
    }
    const tokens = validateTokens(document.tokens ?? [])
    const styleLibrary = validateLibrary(document.styleLibrary, tokens)
    const resolvedTokens = resolveTokens(tokens, styleLibrary.activeThemeId)
    const elements: Record<string, SceneElement> = {}
    for (const [id, node] of Object.entries(document.elements)) {
      if (id !== node.id || ['__proto__', 'prototype', 'constructor'].includes(id)) throw new Error('Invalid element ID')
      validateElement(node)
      const resolved = this.resolveStyles(node, resolvedTokens, styleLibrary)
      validateElement(resolved)
      elements[id] = freezeElement(resolved)
    }
    const visited = new Set<string>()
    const visit = (id: string, parentId: string | null, index: number) => {
      const node = elements[id]
      if (!Object.hasOwn(elements, id) || visited.has(id)) throw new Error('Missing, duplicate, or cyclic element')
      if (node.parentId !== parentId || node.zIndex !== index) throw new Error('Inconsistent hierarchy or order')
      visited.add(id)
      if (node.type === 'frame') node.children.forEach((child, i) => visit(child, id, i))
    }
    document.rootIds.forEach((id, i) => visit(id, null, i))
    if (visited.size !== Object.keys(elements).length) throw new Error('Unreachable scene elements')
    validateMaskGraph(elements)
    validateComponentGraph(elements, resolvedTokens, styleLibrary)
    if (document.componentRegistry) {
      validateComponentRegistry(document.componentRegistry, elements)
    }
    const componentRegistry = document.componentRegistry ?? buildComponentRegistry(elements)
    const motion = document.motion === undefined ? undefined : validateMotion(document.motion, elements)
    const comments = document.comments === undefined ? undefined : validateComments(document.comments)
    const prototype = document.prototype === undefined ? undefined : validatePrototype(document.prototype, elements)
    const physics = document.physics === undefined ? undefined : validatePhysicsDocument(document.physics)
    const hasLayers = document.backgroundLayers !== undefined && document.backgroundLayers !== null
    const backgroundLayers = hasLayers ? Object.freeze(document.backgroundLayers!.map(freezeShader)) : null
    const backgroundShader = document.backgroundShader ? freezeShader(document.backgroundShader) : (hasLayers && document.backgroundLayers!.length > 0 ? freezeShader(document.backgroundLayers![0]) : null)
    this.publish(Object.freeze({ version: 1, tokens, styleLibrary, ...(motion ? { motion } : {}), ...(comments ? { comments } : {}), ...(prototype ? { prototype } : {}), ...(physics ? { physics } : {}), ...(Object.keys(componentRegistry).length > 0 ? { componentRegistry } : {}), elements: Object.freeze(elements), rootIds: Object.freeze([...document.rootIds]), selection: EMPTY, backgroundShader, ...(backgroundLayers ? { backgroundLayers } : {}) }), 'Load artwork')
  }
}
