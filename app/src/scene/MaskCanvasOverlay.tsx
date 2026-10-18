import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Check, Eye, Scan, Scissors, Sparkles, Sun, X } from 'lucide-react'
import type { ViewportController } from '../canvas/ViewportController'
import type { Point } from '../canvas/types'
import { getWorldBounds, getWorldMatrix } from './geometry'
import { frameMask, isCompoundMask, maskFillRule, maskPathData, type MaskElement } from './maskGeometry'
import type { SceneStore } from './store'
import type { BooleanOperation, MaskClipMode, SceneElement } from './types'
import { useScene } from './useScene'
import './mask.css'

interface Props {
  store: SceneStore
  controller: ViewportController
}

const COMPOUND_OPS: readonly { op: BooleanOperation; label: string }[] = [
  { op: 'subtract', label: 'Sub' },
  { op: 'union', label: 'Uni' },
  { op: 'intersect', label: 'Int' },
  { op: 'exclude', label: 'Exc' },
]

export const MaskCanvasOverlay = memo(function MaskCanvasOverlay({ store, controller }: Props) {
  const state = useScene(store, snapshot => snapshot)
  const [camera, setCamera] = useState(() => controller.getSnapshot().camera)
  const isDragging = useRef(false)
  const dragStart = useRef<{ screen: Point; maskStart: Point; maskId: string } | null>(null)

  useLayoutEffect(() => {
    return controller.subscribe(snapshot => {
      setCamera(snapshot.camera)
    })
  }, [controller])

  // Locate active mask: either an isolated mask in the scene, or the mask belonging to / selected in selection
  const selectedNode = state.selection.length === 1 ? state.elements[state.selection[0]] : undefined
  let targetMask: MaskElement | undefined
  let parentFrame: SceneElement | undefined

  // First check if any mask in the entire scene has isolated === true
  for (const el of Object.values(state.elements)) {
    if (el.mask?.isolated && el.mask.enabled) {
      targetMask = el as MaskElement
      if (el.parentId) parentFrame = state.elements[el.parentId]
      break
    }
  }

  // If none isolated, check if selected node is a mask or a frame with a mask
  if (!targetMask && selectedNode) {
    if (selectedNode.mask?.enabled) {
      targetMask = selectedNode as MaskElement
      if (selectedNode.parentId) parentFrame = state.elements[selectedNode.parentId]
    } else if (selectedNode.type === 'frame') {
      const fMask = frameMask(state.elements, selectedNode)
      if (fMask) {
        targetMask = fMask
        parentFrame = selectedNode
      }
    }
  }

  // Handle Escape key to exit isolation mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && targetMask?.mask?.isolated) {
        e.preventDefault()
        store.setMaskIsolated(targetMask.id, false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [store, targetMask])

  // Drag interaction to move isolated mask directly on canvas
  const onPointerDown = useCallback((e: ReactPointerEvent<SVGGElement>, maskId: string) => {
    if (!targetMask?.mask?.isolated) return
    e.stopPropagation()
    e.preventDefault()
    const mask = state.elements[maskId]
    if (!mask) return

    isDragging.current = true
    dragStart.current = {
      screen: { x: e.clientX, y: e.clientY },
      maskStart: { x: mask.x, y: mask.y },
      maskId,
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isDragging.current || !dragStart.current) return
      const dx = (moveEvent.clientX - dragStart.current.screen.x) / camera.zoom
      const dy = (moveEvent.clientY - dragStart.current.screen.y) / camera.zoom
      const nextX = Math.round(dragStart.current.maskStart.x + dx)
      const nextY = Math.round(dragStart.current.maskStart.y + dy)
      store.update(dragStart.current.maskId, mask.type as any, { x: nextX, y: nextY } as any)
    }

    const onPointerUp = () => {
      isDragging.current = false
      dragStart.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [camera.zoom, state.elements, store, targetMask])

  if (!targetMask) return null

  const isIsolated = Boolean(targetMask.mask?.isolated)
  const mode: MaskClipMode = targetMask.mask?.mode ?? 'vector'
  const inverted = Boolean(targetMask.mask?.inverted)
  const threshold = targetMask.mask?.luminanceThreshold ?? 0.5
  const isCompound = isCompoundMask(targetMask)
  const compoundOp = targetMask.type === 'path' && targetMask.boolean ? targetMask.boolean.operation : 'subtract'

  // Calculate world bounds for positioning the on-canvas HUD
  const maskBounds = getWorldBounds(state, targetMask.id)
  const hudX = maskBounds.x * camera.zoom + camera.x
  const hudY = (maskBounds.y * camera.zoom + camera.y) > 50
    ? (maskBounds.y * camera.zoom + camera.y) - 44
    : (maskBounds.y + maskBounds.height) * camera.zoom + camera.y + 12

  // Transform coordinates for isolated stencil path
  const pathD = maskPathData(targetMask)
  const fillRule = maskFillRule(targetMask)
  const [a, b, c, d, tx, ty] = getWorldMatrix(state, targetMask.id)
  const svgTransform = `matrix(${a * camera.zoom} ${b * camera.zoom} ${c * camera.zoom} ${d * camera.zoom} ${tx * camera.zoom + camera.x} ${ty * camera.zoom + camera.y})`

  return (
    <div className="mask-isolation-overlay" data-testid="mask-isolation-overlay">
      {/* Dimmed backdrop when in full isolation mode */}
      {isIsolated && (
        <div
          className="mask-isolation-backdrop"
          onClick={() => store.setMaskIsolated(targetMask!.id, false)}
          title="Click backdrop to exit mask isolation"
        />
      )}

      {/* Top Banner when in Isolation Mode */}
      {isIsolated && (
        <div className="mask-isolation-topbar" data-testid="mask-isolation-topbar">
          <span className="mask-isolation-topbar-title">
            <Scan size={13} />
            <span>MASK ISOLATION MODE</span>
          </span>
          <span className="mask-isolation-topbar-desc">
            Editing stencil for &ldquo;{parentFrame?.name ?? targetMask.name}&rdquo;
          </span>
          <button
            type="button"
            className="mask-isolation-topbar-exit"
            onClick={() => store.setMaskIsolated(targetMask!.id, false)}
            title="Exit mask isolation mode (Esc)"
          >
            <X size={10} />
            <span>Exit (Esc)</span>
          </button>
        </div>
      )}

      {/* Floating On-Canvas Mask Controls HUD */}
      <div
        className="mask-canvas-hud"
        data-testid="mask-canvas-hud"
        style={{
          left: Math.max(16, hudX),
          top: Math.max(16, hudY),
        }}
        onClick={e => e.stopPropagation()}
      >
        <span className="mask-hud-badge" title="Active Mask Source">
          <Scissors size={10} />
          <span>{targetMask.name}</span>
        </span>

        {/* Mode Quick-Switcher */}
        <button
          type="button"
          className={`mask-hud-btn ${mode === 'vector' ? 'active' : ''}`}
          onClick={() => store.setMaskMode(targetMask!.id, 'vector')}
          title="Crisp vector clipping outline"
        >
          <Scissors size={10} />
          <span>Vector</span>
        </button>
        <button
          type="button"
          className={`mask-hud-btn ${mode === 'alpha' ? 'active' : ''}`}
          onClick={() => store.setMaskMode(targetMask!.id, 'alpha')}
          title="Alpha channel transparency mask"
        >
          <Sparkles size={10} />
          <span>Alpha</span>
        </button>
        <button
          type="button"
          className={`mask-hud-btn ${mode === 'luminance' ? 'active' : ''}`}
          onClick={() => store.setMaskMode(targetMask!.id, 'luminance')}
          title="Luminance-based gradient mask"
        >
          <Sun size={10} />
          <span>Luminance</span>
        </button>

        {/* Invert Button */}
        <button
          type="button"
          className={`mask-hud-btn ${inverted ? 'active' : ''}`}
          onClick={() => store.setMaskInverted(targetMask!.id, !inverted)}
          title={inverted ? 'Mask is inverted. Click to restore normal clipping.' : 'Invert clipping mask'}
        >
          <span>Invert</span>
          {inverted && <Check size={10} />}
        </button>

        {/* Luminance Threshold Scrubber (when in luminance mode) */}
        {mode === 'luminance' && (
          <div className="mask-hud-slider-wrap" title="Luminance threshold">
            <span>{Math.round(threshold * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={threshold}
              onChange={e => store.setMaskLuminanceThreshold(targetMask!.id, parseFloat(e.target.value))}
            />
          </div>
        )}

        {/* Compound Mask Boolean Operations */}
        {isCompound && (
          <div style={{ display: 'flex', gap: '2px' }}>
            {COMPOUND_OPS.map(({ op, label }) => (
              <button
                key={op}
                type="button"
                className={`mask-hud-btn ${compoundOp === op ? 'active' : ''}`}
                onClick={() => store.setCompoundMaskOperation(targetMask!.id, op)}
                title={`Set compound mask operation to ${op}`}
              >
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Mask Isolation Toggle */}
        <button
          type="button"
          className={`mask-hud-btn ${isIsolated ? 'active' : ''}`}
          onClick={() => store.setMaskIsolated(targetMask!.id, !isIsolated)}
          title={isIsolated ? 'Exit mask isolation view' : 'Isolate mask stencil on canvas'}
        >
          <Eye size={10} />
          <span>{isIsolated ? 'Exit' : 'Isolate'}</span>
        </button>
      </div>

      {/* When in isolation mode, render interactive SVG stencil handles directly in canvas space */}
      {isIsolated && (
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        >
          <g transform={svgTransform}>
            {/* High-visibility stencil shape with drag capability */}
            <g
              style={{ pointerEvents: 'auto', cursor: 'move' }}
              onPointerDown={e => onPointerDown(e, targetMask!.id)}
            >
              <title>Drag to reposition mask stencil</title>
              <path
                d={pathD}
                fillRule={fillRule}
                fill="#81adec"
                fillOpacity="0.22"
                stroke="#81adec"
                strokeWidth="1.5"
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </g>
        </svg>
      )}
    </div>
  )
})
