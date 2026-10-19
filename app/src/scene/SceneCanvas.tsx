import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { CanvasViewport, unionBounds } from '../canvas'
import type { ViewportController } from '../canvas'
import type { Camera, Point } from '../canvas/types'
import { getWorldBounds } from './geometry'
import { SceneRenderer } from './SceneRenderer'
import { SelectionOverlay } from './SelectionOverlay'
import type { SceneStore } from './store'
import { useScene } from './useScene'
import { PenOverlay } from './PenOverlay'
import { AgentOverlay } from '../mcp/AgentOverlay'
import type { AgentActivity } from '../mcp/protocol'
import { ShaderSurface } from '../shaders/ShaderSurface'
import { MeshCanvasOverlay } from '../shaders/MeshCanvasOverlay'
import { GradientCanvasOverlay } from '../shaders/GradientCanvasOverlay'
import { MaskCanvasOverlay } from './MaskCanvasOverlay'
import { useArrangeShortcuts } from './useArrangeShortcuts'
import { measurementHit } from './measurementGeometry'
import { vectorContainsPoint } from './booleanGeometry'
import { worldToLocal } from './maskGeometry'
import { CollaborationOverlay } from '../collaboration/CollaborationOverlay'
import type { CollaborationSession } from '../collaboration/session'
import { Sparkles } from 'lucide-react'
import { CanvasContextMenu } from './CanvasContextMenu'
import { PhysicsOverlay } from '../physics/PhysicsOverlay'
import { InteractiveCanvasOverlay } from './InteractiveCanvasOverlay'

export function SceneCanvas({ store, controller, grid, panMode, penMode = false, onExitPen, initialCamera, agentActivity, prototypeOverlay, collaboration, annotationOverlay, commentMode = false, interactiveMode = false, onExitInteractiveMode, physicsMode = false, onExitPhysicsMode }: { store: SceneStore; controller: ViewportController; grid: boolean; panMode: boolean; penMode?: boolean; onExitPen?: () => void; initialCamera?: Camera; agentActivity?: AgentActivity | null; prototypeOverlay?: ReactNode; collaboration?: CollaborationSession | null; annotationOverlay?: ReactNode; commentMode?: boolean; interactiveMode?: boolean; onExitInteractiveMode?: () => void; physicsMode?: boolean; onExitPhysicsMode?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldPos: Point } | null>(null)

  const pathEditingTarget = useSyncExternalStore(
    store.subscribePathEditingTarget,
    store.getPathEditingTarget,
    store.getPathEditingTarget
  )
  const effectiveEditingId = pathEditingTarget?.id ?? editingId
  const effectiveOperandId = pathEditingTarget?.operandId
  const isEditingPath = Boolean(effectiveEditingId)

  useLayoutEffect(() => {
    let active = true
    const refresh = () => { if (active) store.refreshLayout() }
    void document.fonts.ready.then(refresh)
    document.fonts.addEventListener('loadingdone', refresh)
    return () => { active = false; document.fonts.removeEventListener('loadingdone', refresh) }
  }, [store])
  const interactionDisabled = Boolean(prototypeOverlay) || commentMode || interactiveMode || physicsMode
  if (interactionDisabled) {
    if (editingId !== null) setEditingId(null)
    if (pathEditingTarget !== null) store.setPathEditingTarget(null)
  }
  useArrangeShortcuts(store, controller, !interactionDisabled && !penMode && !isEditingPath)

  const enterPath = useCallback((id: string | undefined, operandId?: string) => {
    if (store.getHistorySnapshot().active) return
    const node = id ? store.getSnapshot().elements[id] : undefined
    if (node?.type === 'path' && !store.isLocked(node.id) && store.isVisible(node.id)) {
      store.select([node.id])
      if (operandId && node.boolean) {
        store.setSelectedCompoundOperand({ compoundId: node.id, operandId })
      }
      store.setPathEditingTarget({ id: node.id, operandId })
      setEditingId(node.id)
    }
  }, [store])

  const exitPath = useCallback(() => {
    setEditingId(null)
    store.setPathEditingTarget(null)
    onExitPen?.()
  }, [store, onExitPen])

  useLayoutEffect(() => {
    if (interactionDisabled) return
    const viewport = hostRef.current!.querySelector<HTMLElement>('.canvas-viewport')!
    const doubleClick = (event: MouseEvent) => {
      if (panMode || penMode || isEditingPath || viewport.dataset.space === 'true' || viewport.dataset.panning === 'true' || (event.target as Element).closest('.viewport-ui')) return
      const rect = viewport.getBoundingClientRect()
      const worldPoint = controller.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top })
      const hit = measurementHit(store.getSnapshot(), worldPoint, true)
      if (!hit) {
        enterPath(undefined)
        return
      }
      const hitNode = store.getSnapshot().elements[hit]
      if (hitNode?.type === 'path' && hitNode.boolean) {
        const selectedOp = store.getSelectedCompoundOperand()
        let targetOperandId: string | undefined = selectedOp?.compoundId === hit ? selectedOp.operandId : undefined
        if (!targetOperandId) {
          const localPoint = hitNode.parentId === null ? worldPoint : worldToLocal(store.getSnapshot(), hitNode.parentId, worldPoint)
          for (const op of [...hitNode.boolean.operands].reverse()) {
            if (vectorContainsPoint(op, localPoint)) {
              targetOperandId = op.id
              break
            }
          }
        }
        enterPath(hit, targetOperandId ?? hitNode.boolean.operands[0]?.id)
      } else {
        enterPath(hit)
      }
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || (event.target as Element).closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      if (event.key === 'Enter' && !penMode && !panMode && !isEditingPath) {
        event.preventDefault()
        const selId = store.getSnapshot().selection[0]
        const selNode = selId ? store.getSnapshot().elements[selId] : undefined
        if (selNode?.type === 'path' && selNode.boolean) {
          const selOp = store.getSelectedCompoundOperand()
          const opId = selOp?.compoundId === selId ? selOp.operandId : selNode.boolean.operands[0]?.id
          enterPath(selId, opId)
        } else {
          enterPath(selId)
        }
      }
    }
    const handleContextMenu = (event: MouseEvent) => {
      if (panMode || penMode || (event.target as Element).closest('.viewport-ui, button, input, textarea, select, [role="dialog"], [role="menu"]')) return
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const worldPos = controller.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top })
      const hit = measurementHit(store.getSnapshot(), worldPos, true)
      const currentSelection = store.getSnapshot().selection
      if (hit) {
        if (!currentSelection.includes(hit)) {
          store.select([hit])
        }
      } else {
        store.select([])
      }
      setContextMenu({ x: event.clientX, y: event.clientY, worldPos })
    }
    const handleDragOver = (event: DragEvent) => {
      const types = event.dataTransfer?.types
      if (types && (Array.from(types).includes('application/paper-component-master-id') || Array.from(types).includes('application/paper-component-preset'))) {
        event.preventDefault()
        event.dataTransfer!.dropEffect = 'copy'
      }
    }
    const handleDrop = (event: DragEvent) => {
      const masterId = event.dataTransfer?.getData('application/paper-component-master-id')
      const presetKey = event.dataTransfer?.getData('application/paper-component-preset')
      if (!masterId && !presetKey) return
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const worldPos = controller.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top })

      if (masterId) {
        const master = store.getSnapshot().elements[masterId]
        if (master) {
          const snappedX = Math.round((worldPos.x - master.width / 2) / 120) * 120
          const snappedY = Math.round((worldPos.y - master.height / 2) / 120) * 120
          const instance = store.createComponentInstance(masterId, { x: snappedX, y: snappedY })
          store.select([instance.id])
        }
      } else if (presetKey) {
        const snappedX = Math.round(worldPos.x / 120) * 120
        const snappedY = Math.round(worldPos.y / 120) * 120
        const { instance } = store.insertPresetMasterSymbol(presetKey, { x: snappedX, y: snappedY })
        store.select([instance.id])
      }
    }
    viewport.addEventListener('dblclick', doubleClick); document.addEventListener('keydown', keydown); viewport.addEventListener('contextmenu', handleContextMenu)
    viewport.addEventListener('dragover', handleDragOver)
    viewport.addEventListener('drop', handleDrop)
    const unsubscribe = store.subscribe(() => {
      if (!editingId) return
      const state = store.getSnapshot(), node = state.elements[editingId]
      if (node?.type !== 'path' || node.boolean || store.isLocked(editingId) || !store.isVisible(editingId) || state.selection.length !== 1 || state.selection[0] !== editingId) setEditingId(null)
    })
    return () => {
      unsubscribe()
      viewport.removeEventListener('dblclick', doubleClick)
      document.removeEventListener('keydown', keydown)
      viewport.removeEventListener('contextmenu', handleContextMenu)
      viewport.removeEventListener('dragover', handleDragOver)
      viewport.removeEventListener('drop', handleDrop)
    }
  }, [store, controller, panMode, penMode, editingId, interactionDisabled])
  const elements = useScene(store, state => state.elements)
  const rootIds = useScene(store, state => state.rootIds)
  const backgroundShader = useScene(store, state => state.backgroundShader)
  const backgroundLayers = useScene(store, state => state.backgroundLayers)
  const activeBackgroundLayers = (backgroundLayers && backgroundLayers.length > 0)
    ? backgroundLayers
    : (backgroundShader ? [backgroundShader] : [])
  const selection = useScene(store, state => state.selection)
  const items = useMemo(() => {
    const state = store.getSnapshot()
    const selSet = new Set(selection)
    return rootIds.filter(id => store.isVisible(id)).map(id => {
      const el = elements[id]
      const bounds = getWorldBounds(state, id)
      const isFrame = el.type === 'frame'
      return {
        id,
        ...bounds,
        name: el.name || (isFrame ? 'Frame' : el.type),
        type: el.type,
        color: el.style.fill ?? (isFrame ? '#141414' : '#edebe1'),
        strokeColor: el.style.stroke ? el.style.stroke.color : (isFrame ? '#282828' : undefined),
        strokeWidth: el.style.stroke ? el.style.stroke.width : (isFrame ? 1 : undefined),
        opacity: el.style.opacity ?? 1,
        cornerRadius: (el as any).cornerRadius ?? 0,
        text: el.type === 'text' ? (el as any).text : undefined,
        isFrame,
        isSelected: selSet.has(id),
        childrenCount: isFrame ? ((el as any).children?.length ?? 0) : 0,
        zIndex: el.zIndex,
      }
    })
  }, [store, rootIds, elements, selection])
  const bounds = useMemo(() => unionBounds(items), [items])
  return (
    <div ref={hostRef} style={{ display: 'contents' }}>
      <CanvasViewport controller={controller} initialCamera={initialCamera} contentBounds={bounds} minimapItems={items} gridVisible={grid} panMode={panMode} onSelectFrame={(id) => store.select([id])} background={activeBackgroundLayers.length > 0 && (
        <div className="canvas-background-layers" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none' }}>
          {activeBackgroundLayers.map((layer, index) => (
            <ShaderSurface
              key={`bg-layer-${index}-${layer.kind}`}
              paint={layer}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                mixBlendMode: layer.composite?.blendMode ?? 'normal',
                opacity: layer.composite?.opacity ?? 1,
              }}
            />
          ))}
        </div>
      )} overlay={<>{collaboration && <CollaborationOverlay session={collaboration} store={store} controller={controller} />}<AgentOverlay store={store} controller={controller} activity={agentActivity} />{annotationOverlay}{commentMode ? null : prototypeOverlay ?? (physicsMode ? <PhysicsOverlay store={store} controller={controller} onExit={onExitPhysicsMode} /> : interactiveMode ? <InteractiveCanvasOverlay store={store} controller={controller} onExit={onExitInteractiveMode} /> : !panMode && (penMode || (effectiveEditingId && elements[effectiveEditingId]?.type === 'path' && !store.isLocked(effectiveEditingId) && store.isVisible(effectiveEditingId))) ? <PenOverlay key={`${effectiveEditingId ?? 'new'}-${effectiveOperandId ?? 'root'}-${penMode}`} store={store} controller={controller} editingId={effectiveEditingId} operandId={effectiveOperandId} penMode={penMode} onFinish={exitPath} /> : <><SelectionOverlay store={store} controller={controller} panMode={panMode} onEditPath={enterPath} />{!panMode && <MeshCanvasOverlay store={store} controller={controller} />}{!panMode && <GradientCanvasOverlay store={store} controller={controller} />}{!panMode && <MaskCanvasOverlay store={store} controller={controller} />}</>)}</>}>
        <SceneRenderer store={store} interactive={!panMode && !commentMode && !interactiveMode && !physicsMode} />
      </CanvasViewport>
      {interactiveMode && (
        <div className="interactive-canvas-status" data-testid="interactive-canvas-status">
          <Sparkles size={12} />
          <span>INTERACTIVE PREVIEW</span>
          <span className="interactive-preview-hint">Hover, press, and click components to test micro-interactions</span>
          <button className="quiet-button interactive-preview-exit" onClick={onExitInteractiveMode}>Exit (Esc)</button>
        </div>
      )}
      {contextMenu && (
        <CanvasContextMenu
          store={store}
          controller={controller}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onEditPath={enterPath}
        />
      )}
    </div>
  )
}
