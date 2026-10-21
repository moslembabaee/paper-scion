import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, Combine, Diamond, Component as Diamonds, Layers, PenTool, Plus, RotateCcw, Sparkles, Unlink } from 'lucide-react'
import type { ViewportController } from '../canvas'
import type { Bounds, Point } from '../canvas/types'
import { getWorldBounds, getWorldMatrix } from './geometry'
import { captureOrigins, moveGeometry, resizedBox, resizeGeometry, rotateGeometry, selectionBounds, selectionBox, selectionRoots } from './selectionGeometry'
import type { ResizeHandle, SelectionBox, TransformOrigin } from './selectionGeometry'
import { computeSnap } from './snapEngine'
import type { SnapGuide } from './snapEngine'
import { SnapGuides } from './SnapGuides'
import { SpatialBoundsIndex } from './spatialIndex'
import { getSnapConfig } from './snapConfig'
import type { SceneStore } from './store'
import type { AutoLayout, BooleanOperation, ElementGeometry, FrameElement } from './types'
import { transformedSource } from './booleanGeometry'
import { AutoLayoutHandles } from './AutoLayoutHandles'
import { calculateAutoLayoutReorderIndex, findAutoLayoutDropTarget, getAutoLayoutDropIndicator } from './autoLayout'
import type { AutoLayoutDropIndicator } from './autoLayout'
import { dragSpacing, layoutHandleCursor } from './layoutHandles'
import type { SpacingProperty } from './layoutHandles'
import { componentRoot } from './components'
import { useScene } from './useScene'
import './selection.css'
import { MeasurementHUD } from './MeasurementHUD'
import { measurementHit } from './measurementGeometry'
import { CanvasTypographyScrubber } from './CanvasTypographyScrubber'
import { TextPathCanvasOverlay } from './TextPathCanvasOverlay'
import { getLayoutGridSnapTargets } from './layoutGridGeometry'

type HandleId = ResizeHandle | 'rotate'
const HANDLES: readonly { id: ResizeHandle; x: number; y: number; angle: number }[] = [
  { id: 'nw', x: 0, y: 0, angle: 45 }, { id: 'n', x: .5, y: 0, angle: 90 },
  { id: 'ne', x: 1, y: 0, angle: 135 }, { id: 'e', x: 1, y: .5, angle: 0 },
  { id: 'se', x: 1, y: 1, angle: 45 }, { id: 's', x: .5, y: 1, angle: 90 },
  { id: 'sw', x: 0, y: 1, angle: 135 }, { id: 'w', x: 0, y: .5, angle: 0 },
]
const resizeCursor = (angle: number) => ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][((Math.round(angle / 45) % 4) + 4) % 4]
interface Gesture {
  pointerId: number
  start: Point
  screenStart: Point
  origins: TransformOrigin[]
  initialSelection: readonly string[]
  targets: Bounds[]
  spatialIndex?: SpatialBoundsIndex
  moved: boolean
  cursor: string
}
type Drag = Gesture & (
  | { type: 'marquee'; additive: boolean; candidates: { id: string; bounds: Bounds }[] }
  | { type: 'move'; bounds: Bounds }
  | { type: 'resize'; box: SelectionBox; handle: ResizeHandle }
  | { type: 'rotate'; box: SelectionBox; startAngle: number }
  | { type: 'spacing'; id: string; layout: AutoLayout; property: SpacingProperty; axis: 'x' | 'y'; sign: number; rotation: number }
)
interface Props { store: SceneStore; controller: ViewportController; panMode: boolean; onEditPath?: (id: string, operandId?: string) => void }

/** Screen-space affordances; scene hits and viewport navigation remain unobstructed. */
export const SelectionOverlay = memo(function SelectionOverlay({ store, controller, panMode, onEditPath }: Props) {
  const state = useScene(store, snapshot => snapshot)
  const [camera, setCamera] = useState(() => controller.getSnapshot().camera)
  const [guides, setGuides] = useState<SnapGuide[]>([])
  const [marquee, setMarquee] = useState<Bounds | null>(null)
  const [activeCursor, setActiveCursor] = useState<string | null>(null)
  const [activeSpacing, setActiveSpacing] = useState<SpacingProperty | null>(null)
  const [dropIndicator, setDropIndicator] = useState<AutoLayoutDropIndicator | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const box = selectionBox(state, state.selection)
  const selectedNode = state.selection.length === 1 ? state.elements[state.selection[0]] : undefined

  const selectedOperandInfo = useSyncExternalStore(
    store.subscribeSelectedCompoundOperand,
    store.getSelectedCompoundOperand,
    store.getSelectedCompoundOperand
  )
  const highlightedSourceId = useSyncExternalStore(
    store.subscribeHighlightedBooleanSource,
    store.getHighlightedBooleanSource,
    store.getHighlightedBooleanSource
  )

  const activeOperand =
    selectedNode?.type === 'path' && selectedNode.boolean && selectedOperandInfo?.compoundId === selectedNode.id
      ? store.getCompoundOperand(selectedNode.id, selectedOperandInfo.operandId)
      : null
  const hoveredOperand =
    selectedNode?.type === 'path' && selectedNode.boolean && highlightedSourceId && highlightedSourceId !== activeOperand?.id
      ? store.getCompoundOperand(selectedNode.id, highlightedSourceId)
      : null

  const activeOperandTransform =
    activeOperand && selectedNode?.type === 'path'
      ? transformedSource(activeOperand, selectedNode)
      : null
  const hoveredOperandTransform =
    hoveredOperand && selectedNode?.type === 'path'
      ? transformedSource(hoveredOperand, selectedNode)
      : null

  useLayoutEffect(() => controller.subscribe(snapshot => setCamera(snapshot.camera)), [controller])

  useLayoutEffect(() => {
    const overlay = overlayRef.current!
    const viewport = overlay.closest<HTMLElement>('.canvas-viewport')!
    let drag: Drag | null = null
    let frame: number | null = null
    let pending: PointerEvent | null = null
    const worldPoint = (event: PointerEvent): Point => {
      const rect = overlay.getBoundingClientRect()
      return controller.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    const update = (origins: TransformOrigin[], geometry: (origin: TransformOrigin) => ElementGeometry) => store.batch(() => {
      for (const origin of origins) {
        const node = store.getSnapshot().elements[origin.id]
        if (node && store.isVisible(node.id) && !store.isLocked(node.id)) store.update(node.id, node.type, geometry(origin))
      }
    })
    const reset = (restore = false) => {
      const previous = drag
      drag = null
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      pending = null
      if (previous) {
        if (previous.type !== 'marquee') {
          if (restore) store.cancelTransaction()
          else store.endTransaction()
        }
        if (restore) store.select(previous.initialSelection)
      }
      if (previous && overlay.hasPointerCapture(previous.pointerId)) overlay.releasePointerCapture(previous.pointerId)
      setGuides([])
      setMarquee(null)
      setActiveCursor(null)
      setActiveSpacing(null)
      setDropIndicator(null)
    }
    const applyPointer = (event: PointerEvent) => {
      if (!drag) return
      // Preserve click selection, and avoid rounding/snapping before a real drag.
      if (!drag.moved && Math.hypot(event.clientX - drag.screenStart.x, event.clientY - drag.screenStart.y) < 2) return
      drag.moved = true
      const point = worldPoint(event)
      const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y }
      const zoom = controller.getSnapshot().camera.zoom
      if (drag.type === 'spacing') {
        const current = store.getSnapshot().elements[drag.id]
        const layout = dragSpacing(drag.layout, drag.property, drag.axis, drag.sign, drag.rotation, delta, event.shiftKey, event.altKey)
        if (current?.type === 'frame' && current.layout && !store.isLocked(drag.id)) {
          const c = current.layout
          if (c.gap !== layout.gap || c.padding.top !== layout.padding.top || c.padding.right !== layout.padding.right || c.padding.bottom !== layout.padding.bottom || c.padding.left !== layout.padding.left) {
            store.update(drag.id, 'frame', { layout })
          }
        }
      } else if (drag.type === 'marquee') {
        const bounds = { x: Math.min(drag.start.x, point.x), y: Math.min(drag.start.y, point.y), width: Math.abs(delta.x), height: Math.abs(delta.y) }
        setMarquee(bounds)
        const hits = drag.candidates.filter(({ bounds: b }) => b.x < bounds.x + bounds.width && b.x + b.width > bounds.x && b.y < bounds.y + bounds.height && b.y + b.height > bounds.y).map(candidate => candidate.id)
        const snapshot = store.getSnapshot()
        store.select(selectionRoots(snapshot, [...(drag.additive ? drag.initialSelection : []), ...hits]))
      } else if (drag.type === 'move') {
        if (event.shiftKey) {
          if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0
          else delta.x = 0
        }
        const snapCfg = getSnapConfig()
        if (!event.altKey && snapCfg.enabled) {
          const snap = computeSnap({ ...drag.bounds, x: drag.bounds.x + delta.x, y: drag.bounds.y + delta.y }, drag.targets, snapCfg.screenThreshold / zoom, {
            xAnchors: event.shiftKey && delta.x === 0 ? [] : undefined,
            yAnchors: event.shiftKey && delta.y === 0 ? [] : undefined,
            distances: !event.shiftKey,
          })
          delta.x += snap.dx
          delta.y += snap.dy
          setGuides(snap.guides)
        } else setGuides([])

        // Real-time auto-layout hierarchy reordering and drop indicator
        if (drag.origins.length === 1) {
          const origin = drag.origins[0]
          const curState = store.getSnapshot()
          const node = curState.elements[origin.id]
          if (node && !store.isLocked(node.id)) {
            const center = { x: origin.center.x + delta.x, y: origin.center.y + delta.y }
            const currentParent = node.parentId ? curState.elements[node.parentId] : null
            const isInAutoLayout = currentParent?.type === 'frame' && !!currentParent.layout

            if (isInAutoLayout && currentParent) {
              const parentBounds = getWorldBounds(curState, currentParent.id)
              const margin = 24
              if (
                center.x >= parentBounds.x - margin &&
                center.x <= parentBounds.x + parentBounds.width + margin &&
                center.y >= parentBounds.y - margin &&
                center.y <= parentBounds.y + parentBounds.height + margin
              ) {
                const [a, b, c, d, e, f] = getWorldMatrix(curState, currentParent.id)
                const det = a * d - b * c
                if (Math.abs(det) > 1e-9) {
                  const dx = center.x - e, dy = center.y - f
                  const localX = (d * dx - c * dy) / det
                  const localY = (-b * dx + a * dy) / det
                  const targetIndex = calculateAutoLayoutReorderIndex(currentParent, curState.elements, origin.id, { x: localX, y: localY })
                  const children = currentParent.children
                  const currentIndex = children.indexOf(origin.id)
                  if (targetIndex !== currentIndex && targetIndex >= 0 && targetIndex <= children.length) {
                    store.reorder(origin.id, targetIndex)
                  }
                  const refreshedState = store.getSnapshot()
                  const indicator = getAutoLayoutDropIndicator(
                    refreshedState.elements[currentParent.id] as FrameElement,
                    refreshedState.elements,
                    targetIndex,
                    refreshedState,
                  )
                  setDropIndicator(indicator)
                }
              } else {
                const dropTarget = findAutoLayoutDropTarget(curState, center, [origin.id])
                if (dropTarget) {
                  store.reparent(origin.id, dropTarget.frameId, dropTarget.insertIndex)
                  setDropIndicator(dropTarget.indicator)
                } else {
                  setDropIndicator(null)
                }
              }
            } else {
              const dropTarget = findAutoLayoutDropTarget(curState, center, [origin.id])
              if (dropTarget) {
                store.reparent(origin.id, dropTarget.frameId, dropTarget.insertIndex)
                setDropIndicator(dropTarget.indicator)
              } else {
                setDropIndicator(null)
              }
            }
          }
        }

        update(drag.origins, origin => moveGeometry(origin, delta))
      } else if (drag.type === 'resize') {
        let after = resizedBox(drag.box, drag.handle, delta, event.shiftKey)
        const snapCfg = getSnapConfig()
        // Edge snapping uses the moving handle only, preserving its fixed anchor.
        if (!event.altKey && !event.shiftKey && snapCfg.enabled && Math.abs(drag.box.rotation % 360) < 1e-6) {
          const snap = computeSnap(after, drag.targets, snapCfg.screenThreshold / zoom, {
            xAnchors: drag.handle.includes('e') ? [1] : drag.handle.includes('w') ? [0] : [],
            yAnchors: drag.handle.includes('s') ? [1] : drag.handle.includes('n') ? [0] : [], distances: false,
          })
          after = resizedBox(drag.box, drag.handle, { x: delta.x + snap.dx, y: delta.y + snap.dy }, false)
          setGuides(snap.guides)
        } else setGuides([])
        const before = drag.box
        update(drag.origins, origin => resizeGeometry(origin, before, after))
      } else {
        const center = { x: drag.box.x + drag.box.width / 2, y: drag.box.y + drag.box.height / 2 }
        let degrees = (Math.atan2(point.y - center.y, point.x - center.x) - drag.startAngle) * 180 / Math.PI
        if (event.shiftKey) degrees = Math.round(degrees / 15) * 15
        update(drag.origins, origin => rotateGeometry(origin, center, degrees))
      }
    }
    const down = (event: PointerEvent) => {
      if (panMode || event.button !== 0 || event.pointerType === 'touch' || drag || viewport.dataset.space === 'true' || viewport.dataset.panning === 'true') return
      const target = event.target
      if (!(target instanceof Element) || target.closest('.viewport-ui, input, textarea, select, button, a, [contenteditable="true"]')) return
      const rect = overlay.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientY < rect.top) return
      const initial = store.getSnapshot()
      const initialSelection = initial.selection
      const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as HandleId | undefined
      const spacingHandle = target.closest<HTMLElement>('[data-layout-handle]')
      const point = worldPoint(event)
      const nodeId = handle || spacingHandle ? null : measurementHit(initial, point, true)
      const gesture: Gesture = { pointerId: event.pointerId, start: point, screenStart: { x: event.clientX, y: event.clientY }, initialSelection, targets: [], origins: [], moved: false, cursor: 'move' }
      if (spacingHandle) {
        const node = initial.selection.length === 1 ? initial.elements[initial.selection[0]] : undefined
        const bounds = selectionBox(initial, initial.selection)
        if (node?.type !== 'frame' || !node.layout || !bounds || store.isLocked(node.id)) return
        const axis = spacingHandle.dataset.axis as 'x' | 'y'
        const property = spacingHandle.dataset.property as SpacingProperty
        drag = { ...gesture, type: 'spacing', id: node.id, layout: node.layout, property, axis, sign: Number(spacingHandle.dataset.sign), rotation: bounds.rotation, cursor: layoutHandleCursor(axis, bounds.rotation) }
        setActiveSpacing(property)
      } else if (handle) {
        const bounds = selectionBox(initial, initial.selection)
        if (!bounds) return
        if (handle === 'rotate') drag = { ...gesture, type: 'rotate', box: bounds, cursor: 'crosshair', startAngle: Math.atan2(point.y - bounds.y - bounds.height / 2, point.x - bounds.x - bounds.width / 2) }
        else drag = { ...gesture, type: 'resize', box: bounds, handle, cursor: resizeCursor(bounds.rotation + HANDLES.find(h => h.id === handle)!.angle) }
      } else if (nodeId) {
        if (!store.isVisible(nodeId) || store.isLocked(nodeId)) return
        if (event.shiftKey) {
          store.select(initialSelection.includes(nodeId) ? initialSelection.filter(id => id !== nodeId) : [...initialSelection, nodeId])
          return
        }
        if (!initialSelection.includes(nodeId)) store.select([nodeId])
        const bounds = selectionBounds(store.getSnapshot(), store.getSnapshot().selection)!
        drag = { ...gesture, type: 'move', bounds }
      } else if (target.closest('.sel-box')) {
        const bounds = selectionBounds(initial, initial.selection)
        if (!bounds) return
        drag = { ...gesture, type: 'move', bounds }
      } else {
        if (!event.shiftKey) store.select([])
        drag = { ...gesture, type: 'marquee', additive: event.shiftKey, cursor: 'crosshair', candidates: Object.keys(initial.elements).filter(id => store.isVisible(id) && !store.isLocked(id)).map(id => ({ id, bounds: getWorldBounds(initial, id) })) }
      }
      if (drag.type !== 'marquee') {
        const snapshot = store.getSnapshot()
        store.beginTransaction(drag.type === 'spacing' ? 'Adjust layout spacing' : drag.type === 'move' ? 'Move elements' : drag.type === 'resize' ? 'Resize elements' : 'Rotate elements')
        if (drag.type !== 'spacing') {
          drag.origins = captureOrigins(snapshot, snapshot.selection)
          const selected = new Set(drag.origins.map(origin => origin.id))
          const elementTargets = Object.values(snapshot.elements).filter(node => {
            if (!store.isVisible(node.id)) return false
            let current: typeof node | undefined = node
            while (current) {
              if (selected.has(current.id)) return false
              current = current.parentId === null ? undefined : snapshot.elements[current.parentId]
            }
            return true
          }).map(node => getWorldBounds(snapshot, node.id))

          const gridTargets: Bounds[] = []
          for (const node of Object.values(snapshot.elements)) {
            if (node.type === 'frame' && store.isVisible(node.id) && !selected.has(node.id) && node.layoutGrids?.length) {
              const frameWorldBounds = getWorldBounds(snapshot, node.id)
              gridTargets.push(...getLayoutGridSnapTargets(node, frameWorldBounds))
            }
          }

          drag.targets = [...elementTargets, ...gridTargets]
        }
      }
      controller.stop()
      const focusTarget = spacingHandle ?? viewport
      focusTarget.focus({ preventScroll: true })
      event.preventDefault()
      overlay.setPointerCapture(event.pointerId)
      setActiveCursor(drag.cursor)
    }
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      pending = event
      if (frame === null) frame = requestAnimationFrame(() => {
        frame = null
        const latest = pending
        pending = null
        if (latest) applyPointer(latest)
      })
    }
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      if (event.type === 'pointerup') applyPointer(event)
      reset(event.type === 'pointercancel')
    }
    const lostCapture = () => reset(true)
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      if (event.key === 'Escape' && (drag || viewport.contains(document.activeElement))) {
        event.preventDefault()
        if (drag) reset(true)
        else store.select([])
      }
    }
    const blur = () => reset(true)
    viewport.addEventListener('pointerdown', down)
    viewport.addEventListener('pointermove', move)
    viewport.addEventListener('pointerup', up)
    viewport.addEventListener('pointercancel', up)
    overlay.addEventListener('lostpointercapture', lostCapture)
    document.addEventListener('keydown', keydown)
    window.addEventListener('blur', blur)
    return () => {
      viewport.removeEventListener('pointerdown', down)
      viewport.removeEventListener('pointermove', move)
      viewport.removeEventListener('pointerup', up)
      viewport.removeEventListener('pointercancel', up)
      overlay.removeEventListener('lostpointercapture', lostCapture)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('blur', blur)
      reset(true)
    }
  }, [store, controller, panMode])

  const compRoot = selectedNode ? componentRoot(state.elements, selectedNode.id) : undefined
  const isMaster = selectedNode?.component?.kind === 'master'
  const isInstance = compRoot?.component?.kind === 'instance'
  const hasLocalOverrides = selectedNode?.component?.kind === 'instance' && (
    Object.keys(selectedNode.component.overrides.properties ?? {}).length > 0 ||
    Object.keys(selectedNode.component.overrides.style ?? {}).length > 0 ||
    (selectedNode.id === selectedNode.component.instanceId && Object.keys(selectedNode.component.propertyValues ?? {}).length > 0)
  )
  const canMakeComponent = state.selection.length > 1 && !store.selectionComponentCreationReason(state.selection)
  const badgeTop = box ? ((box.y * camera.zoom + camera.y) > 36 ? box.y * camera.zoom + camera.y - 30 : (box.y + box.height) * camera.zoom + camera.y + 8) : 0

  return <div ref={overlayRef} className="selection-overlay" data-testid="selection-overlay" style={{ cursor: activeCursor ?? undefined }} data-transforming={activeCursor !== null}>
    <SnapGuides guides={guides} camera={camera} />
    {(hoveredOperandTransform || activeOperandTransform) && (
      <svg className="snap-guides-svg" aria-hidden="true">
        {hoveredOperandTransform && (
          <path
            d={hoveredOperandTransform.d}
            className="sel-operand-outline is-hovered"
            vectorEffect="non-scaling-stroke"
            transform={`matrix(${camera.zoom} 0 0 ${camera.zoom} ${camera.x} ${camera.y})`}
          />
        )}
        {activeOperandTransform && (
          <path
            d={activeOperandTransform.d}
            className="sel-operand-outline"
            vectorEffect="non-scaling-stroke"
            transform={`matrix(${camera.zoom} 0 0 ${camera.zoom} ${camera.x} ${camera.y})`}
          />
        )}
      </svg>
    )}
    {marquee && <div className="marquee-rect" data-testid="marquee-rect" style={{ left: marquee.x * camera.zoom + camera.x, top: marquee.y * camera.zoom + camera.y, width: marquee.width * camera.zoom, height: marquee.height * camera.zoom }} />}
    {!panMode && box && <div className="sel-box" data-testid="selection-box" aria-label="Selection bounds" style={{ left: box.x * camera.zoom + camera.x, top: box.y * camera.zoom + camera.y, width: box.width * camera.zoom, height: box.height * camera.zoom, transform: `rotate(${box.rotation}deg)` }}>
      {HANDLES.map(handle => <div key={handle.id} data-handle={handle.id} className="sel-handle" title={`Resize ${handle.id.toUpperCase()} · Shift for proportions`} style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%`, cursor: resizeCursor(box.rotation + handle.angle) }} />)}
      <div data-handle="rotate" className="sel-rotate-handle" title="Rotate · Shift for 15° increments" />
      {selectedNode?.type === 'frame' && <AutoLayoutHandles frame={selectedNode} state={state} store={store} zoom={camera.zoom} rotation={box.rotation} active={activeSpacing} />}
    </div>}
    {!panMode && dropIndicator && (
      <div
        className={`layout-drop-indicator ${dropIndicator.axis === 'vertical' ? 'is-vertical' : 'is-horizontal'}`}
        data-testid="auto-layout-drop-indicator"
        style={{
          left: dropIndicator.world.x * camera.zoom + camera.x,
          top: dropIndicator.world.y * camera.zoom + camera.y,
          width: Math.max(2, dropIndicator.world.width * camera.zoom),
          height: Math.max(2, dropIndicator.world.height * camera.zoom),
          transform: dropIndicator.world.rotation ? `rotate(${dropIndicator.world.rotation}deg)` : undefined,
          transformOrigin: '0 0',
        }}
      />
    )}
    {!panMode && box && isMaster && selectedNode && !activeCursor && (
      <div
        className="sel-component-badge is-master"
        data-testid="sel-master-badge"
        style={{
          left: box.x * camera.zoom + camera.x,
          top: badgeTop,
        }}
      >
        <div className="sel-component-badge-inner">
          <span className="sel-component-badge-tag" title={selectedNode.name}>
            <Diamonds size={11} />
            <span>Master: {selectedNode.name}</span>
          </span>
          <button
            type="button"
            className="sel-component-btn primary"
            title="Insert instance on canvas"
            onClick={e => {
              e.stopPropagation()
              const inst = store.createComponentInstance(selectedNode.id)
              store.select([inst.id])
            }}
          >
            <Plus size={10} />
            <span>Instance</span>
          </button>
          <button
            type="button"
            className="sel-component-btn"
            title="Auto-expose detected properties"
            onClick={e => {
              e.stopPropagation()
              store.autoExposeComponentProperties(selectedNode.id)
            }}
          >
            <Sparkles size={10} />
          </button>
        </div>
      </div>
    )}
    {!panMode && box && isInstance && selectedNode && compRoot && !activeCursor && (
      <div
        className="sel-component-badge is-instance"
        data-testid="sel-instance-badge"
        style={{
          left: box.x * camera.zoom + camera.x,
          top: badgeTop,
        }}
      >
        <div className="sel-component-badge-inner">
          <span className="sel-component-badge-tag" title={selectedNode.name}>
            <Diamond size={10} />
            <span>Instance: {selectedNode.name}</span>
          </span>
          <button
            type="button"
            className="sel-component-btn"
            title="Locate master symbol on canvas"
            onClick={e => {
              e.stopPropagation()
              const masterId = compRoot.component?.kind === 'instance' ? compRoot.component.masterId : compRoot.id
              store.select([masterId])
              controller.fit(getWorldBounds(store.getSnapshot(), masterId))
            }}
          >
            <ArrowUpRight size={10} />
            <span>Master</span>
          </button>
          <button
            type="button"
            className="sel-component-btn"
            title="Detach instance into editable layers (Alt+Cmd+B)"
            onClick={e => {
              e.stopPropagation()
              store.detachComponentInstance(selectedNode.id)
            }}
          >
            <Unlink size={10} />
            <span>Detach</span>
          </button>
          {hasLocalOverrides && (
            <>
              <span className="sel-component-badge-overrides" title="Local overrides present">Overridden</span>
              <button
                type="button"
                className="sel-component-btn"
                title="Reset local overrides to master"
                onClick={e => {
                  e.stopPropagation()
                  store.resetComponentOverrides(selectedNode.id)
                }}
              >
                <RotateCcw size={10} />
              </button>
            </>
          )}
        </div>
      </div>
    )}
    {!panMode && box && canMakeComponent && !activeCursor && (
      <div
        className="sel-component-badge is-group"
        data-testid="sel-create-component-badge"
        style={{
          left: box.x * camera.zoom + camera.x,
          top: badgeTop,
        }}
      >
        <div className="sel-component-badge-inner">
          <button
            type="button"
            className="sel-component-btn primary"
            title="Create master component symbol from selection (Alt+Cmd+K)"
            onClick={e => {
              e.stopPropagation()
              const comp = store.createComponentFromSelection(state.selection)
              store.select([comp.id])
            }}
          >
            <Diamonds size={11} />
            <span>Create Component ({state.selection.length} layers)</span>
          </button>
        </div>
      </div>
    )}
    {!panMode && box && selectedNode?.type === 'frame' && selectedNode.layout && !isMaster && !isInstance && !canMakeComponent && !activeCursor && (
      <div
        className="sel-component-badge is-autolayout"
        data-testid="sel-autolayout-badge"
        style={{
          left: box.x * camera.zoom + camera.x,
          top: badgeTop,
        }}
      >
        <div className="sel-component-badge-inner">
          <span className="sel-component-badge-tag" title={`Auto-Layout (${selectedNode.layout.direction})`}>
            {selectedNode.layout.direction === 'horizontal' ? <ArrowRight size={11} /> : <ArrowDown size={11} />}
            <span>Auto Layout</span>
          </span>
          <button
            type="button"
            className="sel-component-btn"
            title={`Direction: ${selectedNode.layout.direction}. Click to toggle.`}
            onClick={e => {
              e.stopPropagation()
              const currentLayout = selectedNode.layout
              if (!currentLayout) return
              const dir = currentLayout.direction === 'horizontal' ? 'vertical' : 'horizontal'
              store.update(selectedNode.id, 'frame', { layout: { ...currentLayout, direction: dir } })
            }}
          >
            <span>{selectedNode.layout.direction === 'horizontal' ? 'Horizontal' : 'Vertical'}</span>
          </button>
          <span className="sel-badge-stat" title={`Gap: ${selectedNode.layout.gap}px`}>
            Gap {selectedNode.layout.gap}
          </span>
        </div>
      </div>
    )}
    {!panMode && box && selectedNode?.type === 'text' && selectedNode.textOnPath?.enabled && !activeCursor && (
      <TextPathCanvasOverlay node={selectedNode} store={store} camera={camera} box={box} />
    )}
    {!panMode && box && selectedNode?.type === 'text' && !activeCursor && (
      <CanvasTypographyScrubber node={selectedNode} store={store} camera={camera} box={box} />
    )}
    {!panMode && box && selectedNode?.type === 'path' && !selectedNode.boolean && !activeCursor && (
      <div
        className="sel-vector-badge"
        data-testid="sel-vector-badge"
        style={{
          left: box.x * camera.zoom + camera.x,
          top: (box.y + box.height) * camera.zoom + camera.y + 8,
        }}
      >
        <button
          type="button"
          className="vector-edit-btn"
          data-testid="vector-edit-btn"
          onClick={e => {
            e.stopPropagation()
            onEditPath?.(selectedNode.id)
          }}
          title="Edit vector path nodes (Hotkey: Enter or double-click)"
        >
          <PenTool size={11} />
          <span>Edit Vector Path</span>
          <kbd>↵</kbd>
        </button>
      </div>
    )}
    {!panMode && box && selectedNode?.type === 'path' && selectedNode.boolean && !activeCursor && (
      <div
        className="sel-component-badge is-compound"
        data-testid="sel-compound-badge"
        style={{
          left: box.x * camera.zoom + camera.x,
          top: badgeTop,
        }}
      >
        <div className="sel-component-badge-inner">
          <span
            className="sel-component-badge-tag"
            title={`Compound Shape (${selectedNode.boolean.operation}) · ${selectedNode.boolean.operands.length} sources`}
          >
            <Combine size={11} />
            <span>Compound: {selectedNode.boolean.operation}</span>
          </span>
          {(['union', 'subtract', 'intersect', 'exclude'] as const).map(op => {
            const symbols: Record<BooleanOperation, string> = {
              union: '∪',
              subtract: '∖',
              intersect: '∩',
              exclude: '⊕',
            }
            const isCurrent = selectedNode.boolean!.operation === op
            return (
              <button
                key={op}
                type="button"
                className={`sel-component-btn ${isCurrent ? 'primary' : ''}`}
                title={`Switch live boolean operator to ${op.toUpperCase()} (${symbols[op]})`}
                onClick={e => {
                  e.stopPropagation()
                  store.setBooleanOperation(selectedNode.id, op)
                }}
              >
                <span>{symbols[op]}</span>
                <span>{op[0].toUpperCase() + op.slice(1)}</span>
              </button>
            )
          })}
          <button
            type="button"
            className="sel-component-btn"
            title="Cycle active sub-element operand"
            onClick={e => {
              e.stopPropagation()
              const operands = selectedNode.boolean!.operands
              if (operands.length === 0) return
              const currentId = selectedOperandInfo?.operandId
              const currentIdx = operands.findIndex(op => op.id === currentId)
              const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % operands.length
              const nextOp = operands[nextIdx]
              store.setSelectedCompoundOperand({ compoundId: selectedNode.id, operandId: nextOp.id })
              store.highlightBooleanSource(nextOp.id)
            }}
          >
            <Layers size={10} />
            <span>Sub-element</span>
          </button>
          {activeOperand && (
            <button
              type="button"
              className="sel-component-btn"
              data-testid="sel-edit-anchors-btn"
              title={`Edit sub-path anchors of ${activeOperand.name}`}
              onClick={e => {
                e.stopPropagation()
                if (onEditPath) onEditPath(selectedNode.id, activeOperand.id)
                else store.setPathEditingTarget({ id: selectedNode.id, operandId: activeOperand.id })
              }}
            >
              <PenTool size={10} />
              <span>Edit Anchors</span>
            </button>
          )}
          <button
            type="button"
            className="sel-component-btn"
            title="Release editable source layers"
            disabled={!!selectedNode.mask}
            onClick={e => {
              e.stopPropagation()
              store.releaseBoolean(selectedNode.id)
            }}
          >
            <Unlink size={10} />
            <span>Release</span>
          </button>
        </div>
      </div>
    )}
    {!panMode && box && selectedNode?.type === 'path' && selectedNode.boolean && activeOperand && activeOperandTransform && !activeCursor && (
      <div
        className="sel-operand-box"
        data-testid="sel-operand-box"
        style={{
          left: activeOperandTransform.bounds.x * camera.zoom + camera.x,
          top: activeOperandTransform.bounds.y * camera.zoom + camera.y,
          width: Math.max(12, activeOperandTransform.bounds.width * camera.zoom),
          height: Math.max(12, activeOperandTransform.bounds.height * camera.zoom),
        }}
        title={`Drag to reposition ${activeOperand.name} · Double-click to edit anchors`}
        onDoubleClick={e => {
          e.stopPropagation()
          e.preventDefault()
          if (onEditPath) onEditPath(selectedNode.id, activeOperand.id)
          else store.setPathEditingTarget({ id: selectedNode.id, operandId: activeOperand.id })
        }}
        onPointerDown={e => {
          e.stopPropagation()
          e.preventDefault()
          const startX = activeOperand.x
          const startY = activeOperand.y
          const screenStart = { x: e.clientX, y: e.clientY }
          const compoundId = selectedNode.id
          const operandId = activeOperand.id
          const sx = selectedNode.viewBox[2] / selectedNode.width
          const sy = selectedNode.viewBox[3] / selectedNode.height

          store.beginTransaction('Move boolean operand')

          const onPointerMove = (moveEv: PointerEvent) => {
            const dx = (moveEv.clientX - screenStart.x) / camera.zoom
            const dy = (moveEv.clientY - screenStart.y) / camera.zoom
            store.updateBooleanOperand(compoundId, operandId, {
              x: Math.round((startX + dx * sx) * 100) / 100,
              y: Math.round((startY + dy * sy) * 100) / 100,
            })
          }

          const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
            store.endTransaction()
          }

          window.addEventListener('pointermove', onPointerMove)
          window.addEventListener('pointerup', onPointerUp)
        }}
      >
        <div className="sel-operand-tag">
          <span>{activeOperand.name}</span>
          <span style={{ opacity: 0.6 }}>({activeOperand.type})</span>
          <button
            type="button"
            className="sel-operand-edit-anchor-btn"
            title={`Edit sub-path anchors of ${activeOperand.name}`}
            onClick={e => {
              e.stopPropagation()
              if (onEditPath) onEditPath(selectedNode.id, activeOperand.id)
              else store.setPathEditingTarget({ id: selectedNode.id, operandId: activeOperand.id })
            }}
          >
            <PenTool size={9} />
          </button>
        </div>
      </div>
    )}
    <MeasurementHUD store={store} controller={controller} suppressed={panMode || activeCursor !== null} />
  </div>
})
