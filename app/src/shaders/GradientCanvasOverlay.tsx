import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { RotateCw, Target, Trash2, X } from 'lucide-react'
import type { ViewportController } from '../canvas'
import { getWorldMatrix } from '../scene/geometry'
import type { SceneStore } from '../scene/store'
import type { GradientColorStop, GradientPaint } from '../scene/types'
import { useScene } from '../scene/useScene'
import {
  addGradientStop,
  freezeGradient,
  gradientToShaderPaint,
  removeGradientStop,
  updateGradientStop,
} from './gradient'
import {
  setActiveGradientStopId,
  setActiveGradientHandle,
  useActiveGradientStopId,
  useActiveGradientHandle,
} from './gradientState'

interface Point {
  x: number
  y: number
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value))
}

const MAGNETIC_SNAPS = [0, 0.25, 0.5, 0.75, 1.0]

function snapOffset(offset: number, threshold = 0.025): number {
  for (const snap of MAGNETIC_SNAPS) {
    if (Math.abs(offset - snap) <= threshold) {
      return snap
    }
  }
  return Number(clamp(0, 1, offset).toFixed(4))
}

export function GradientCanvasOverlay({
  store,
  controller,
}: {
  store: SceneStore
  controller: ViewportController
}) {
  const state = useScene(store, value => value)
  const [viewport, setViewport] = useState(() => controller.getSnapshot())
  const host = useRef<HTMLDivElement>(null)
  const ownsGesture = useRef(false)
  const activeStopId = useActiveGradientStopId()
  const activeHandle = useActiveGradientHandle()
  const [hexInputValue, setHexInputValue] = useState('')

  useLayoutEffect(() => controller.subscribe(setViewport), [controller])

  const node = state.selection.length === 1 ? state.elements[state.selection[0]] : undefined
  const isEnabled = !!node && !store.isLocked(node.id) && store.isVisible(node.id)

  const gradient: GradientPaint | null = isEnabled
    ? node.style.gradient && node.style.gradient.enabled !== false
      ? node.style.gradient
      : node.style.shader?.kind === 'multi-stop-gradient'
        ? node.style.shader.gradient ?? null
        : null
    : null

  const finishGesture = useCallback((cancel: boolean) => {
    if (!ownsGesture.current) return
    ownsGesture.current = false
    setActiveGradientHandle(null)
    if (cancel) store.cancelTransaction()
    else store.endTransaction()
  }, [store])

  useLayoutEffect(() => () => finishGesture(true), [finishGesture])

  // Deselect active stop on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveGradientStopId(null)
        setActiveGradientHandle(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!isEnabled || !node || !gradient) return null

  const matrix = getWorldMatrix(state, node.id)
  const { camera } = viewport

  // Map normalized element space [0, 1] into canvas screen pixels
  const toScreen = (point: Point): Point => {
    const [a, b, c, d, e, f] = matrix
    const lx = point.x * node.width
    const ly = point.y * node.height
    const wx = a * lx + c * ly + e
    const wy = b * lx + d * ly + f
    return {
      x: wx * camera.zoom + camera.x,
      y: wy * camera.zoom + camera.y,
    }
  }

  // Map client/pointer screen pixels into normalized element space [0, 1]
  const screenToNormalized = (clientX: number, clientY: number): Point | null => {
    const rect = host.current?.getBoundingClientRect()
    if (!rect) return null
    const screenPt = { x: clientX - rect.left, y: clientY - rect.top }
    const world = controller.screenToWorld(screenPt)
    const [a, b, c, d, e, f] = matrix
    const det = a * d - b * c
    if (Math.abs(det) < 1e-6) return null
    const x = world.x - e
    const y = world.y - f
    const lx = (d * x - c * y) / det
    const ly = (a * y - b * x) / det
    return {
      x: lx / Math.max(1, node.width),
      y: ly / Math.max(1, node.height),
    }
  }

  const applyGradient = (nextGradient: GradientPaint) => {
    const frozen = freezeGradient(nextGradient)
    const currentNode = store.getSnapshot().elements[node.id]
    if (!currentNode) return

    const styleUpdates: Record<string, unknown> = {
      gradient: frozen,
    }

    if (frozen.linkToShader || currentNode.style.shader?.kind === 'multi-stop-gradient' || frozen.type === 'angular') {
      styleUpdates.shader = gradientToShaderPaint(frozen, currentNode.style.shader ?? undefined)
    }

    store.update(currentNode.id, currentNode.type, {
      style: {
        ...currentNode.style,
        ...styleUpdates,
      },
    })
  }

  // Gradient geometry calculations
  const origin = gradient.origin
  const angleRad = (gradient.angle * Math.PI) / 180
  const dir = { x: Math.cos(angleRad), y: Math.sin(angleRad) }
  const spread = gradient.spread
  const focalLength = gradient.focalLength

  const baseDim = Math.min(node.width, node.height)
  const spreadDistNormX = (spread * 0.5 * baseDim) / node.width
  const spreadDistNormY = (spread * 0.5 * baseDim) / node.height

  // Positions in normalized space [0, 1]
  const originNorm: Point = { x: origin.x, y: origin.y }
  const angleHandleNorm: Point = {
    x: origin.x + dir.x * spreadDistNormX,
    y: origin.y + dir.y * spreadDistNormY,
  }
  const startHandleNorm: Point = {
    x: origin.x - dir.x * spreadDistNormX,
    y: origin.y - dir.y * spreadDistNormY,
  }

  const focalHandleNorm: Point = {
    x: origin.x + dir.x * ((focalLength * 0.25 * baseDim) / node.width),
    y: origin.y + dir.y * ((focalLength * 0.25 * baseDim) / node.height),
  }

  // Calculate stop positions in normalized space
  const getStopNormalizedPosition = (stop: GradientColorStop): Point => {
    const t = stop.offset
    if (gradient.type === 'linear') {
      return {
        x: startHandleNorm.x + (angleHandleNorm.x - startHandleNorm.x) * t,
        y: startHandleNorm.y + (angleHandleNorm.y - startHandleNorm.y) * t,
      }
    } else if (gradient.type === 'radial') {
      const rayStartX = focalHandleNorm.x
      const rayStartY = focalHandleNorm.y
      return {
        x: rayStartX + (angleHandleNorm.x - rayStartX) * t,
        y: rayStartY + (angleHandleNorm.y - rayStartY) * t,
      }
    } else {
      // Angular (conic) gradient
      const stopAngleRad = angleRad + (t * Math.PI * 2 * spread)
      return {
        x: origin.x + Math.cos(stopAngleRad) * spreadDistNormX,
        y: origin.y + Math.sin(stopAngleRad) * spreadDistNormY,
      }
    }
  }

  // Screen positions
  const originScreen = toScreen(originNorm)
  const angleHandleScreen = toScreen(angleHandleNorm)
  const startHandleScreen = toScreen(startHandleNorm)
  const focalHandleScreen = toScreen(focalHandleNorm)

  // Handlers for pointer drag interactions
  const handleOriginPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActiveGradientHandle('origin')
    ownsGesture.current = true
    store.beginTransaction('Move gradient origin')
  }

  const handleOriginPointerMove = (e: ReactPointerEvent) => {
    if (!ownsGesture.current || activeHandle !== 'origin') return
    const norm = screenToNormalized(e.clientX, e.clientY)
    if (!norm) return
    applyGradient({
      ...gradient,
      origin: {
        x: clamp(0, 1, norm.x),
        y: clamp(0, 1, norm.y),
      },
    })
  }

  const handleOriginPointerUp = (e: ReactPointerEvent) => {
    if (activeHandle === 'origin') {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      finishGesture(false)
    }
  }

  // Handle Angle & Spread Drag
  const handleAnglePointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActiveGradientHandle('angle')
    ownsGesture.current = true
    store.beginTransaction('Transform gradient angle & spread')
  }

  const handleAnglePointerMove = (e: ReactPointerEvent) => {
    if (!ownsGesture.current || activeHandle !== 'angle') return
    const norm = screenToNormalized(e.clientX, e.clientY)
    if (!norm) return
    const dx = (norm.x - origin.x) * node.width
    const dy = (norm.y - origin.y) * node.height
    let nextAngle = (Math.atan2(dy, dx) * 180) / Math.PI
    if (nextAngle < 0) nextAngle += 360
    if (e.shiftKey) {
      nextAngle = Math.round(nextAngle / 15) * 15
    }

    const dist = Math.sqrt(dx * dx + dy * dy)
    const nextSpread = clamp(0.1, 3.0, (dist * 2) / Math.max(1, baseDim))

    applyGradient({
      ...gradient,
      angle: Number(nextAngle.toFixed(1)),
      spread: Number(nextSpread.toFixed(3)),
    })
  }

  const handleAnglePointerUp = (e: ReactPointerEvent) => {
    if (activeHandle === 'angle') {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      finishGesture(false)
    }
  }

  // Handle Focal Length Drag (Radial)
  const handleFocalPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActiveGradientHandle('focal')
    ownsGesture.current = true
    store.beginTransaction('Adjust gradient focal length')
  }

  const handleFocalPointerMove = (e: ReactPointerEvent) => {
    if (!ownsGesture.current || activeHandle !== 'focal') return
    const norm = screenToNormalized(e.clientX, e.clientY)
    if (!norm) return
    const dx = (norm.x - origin.x) * node.width
    const dy = (norm.y - origin.y) * node.height
    const distAlongRay = (dx * dir.x + dy * dir.y) / (baseDim * 0.25)
    const nextFocal = clamp(0.0, 2.0, distAlongRay)

    applyGradient({
      ...gradient,
      focalLength: Number(nextFocal.toFixed(3)),
    })
  }

  const handleFocalPointerUp = (e: ReactPointerEvent) => {
    if (activeHandle === 'focal') {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      finishGesture(false)
    }
  }

  // Handle Stop Drag
  const handleStopPointerDown = (e: ReactPointerEvent, stopId: string) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActiveGradientStopId(stopId)
    setActiveGradientHandle('stop')
    ownsGesture.current = true
    store.beginTransaction('Move gradient color stop')
  }

  const handleStopPointerMove = (e: ReactPointerEvent, stopId: string) => {
    if (!ownsGesture.current || activeHandle !== 'stop' || activeStopId !== stopId) return
    const norm = screenToNormalized(e.clientX, e.clientY)
    if (!norm) return

    let nextT = 0.5
    if (gradient.type === 'linear') {
      const axisDx = (angleHandleNorm.x - startHandleNorm.x) * node.width
      const axisDy = (angleHandleNorm.y - startHandleNorm.y) * node.height
      const axisLenSq = axisDx * axisDx + axisDy * axisDy
      if (axisLenSq > 0.001) {
        const ptDx = (norm.x - startHandleNorm.x) * node.width
        const ptDy = (norm.y - startHandleNorm.y) * node.height
        nextT = (ptDx * axisDx + ptDy * axisDy) / axisLenSq
      }
    } else if (gradient.type === 'radial') {
      const rayDx = (angleHandleNorm.x - focalHandleNorm.x) * node.width
      const rayDy = (angleHandleNorm.y - focalHandleNorm.y) * node.height
      const rayLenSq = rayDx * rayDx + rayDy * rayDy
      if (rayLenSq > 0.001) {
        const ptDx = (norm.x - focalHandleNorm.x) * node.width
        const ptDy = (norm.y - focalHandleNorm.y) * node.height
        nextT = (ptDx * rayDx + ptDy * rayDy) / rayLenSq
      }
    } else {
      // Angular
      const dx = (norm.x - origin.x) * node.width
      const dy = (norm.y - origin.y) * node.height
      let theta = Math.atan2(dy, dx) - angleRad
      const twoPi = Math.PI * 2
      theta = ((theta % twoPi) + twoPi) % twoPi
      nextT = theta / (twoPi * Math.max(0.01, spread))
    }

    const snapped = snapOffset(nextT)
    applyGradient(updateGradientStop(gradient, stopId, { offset: snapped }))
  }

  const handleStopPointerUp = (e: ReactPointerEvent) => {
    if (activeHandle === 'stop') {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      finishGesture(false)
    }
  }

  // Click on axis/ray to add a new stop
  const handleGuideClick = (e: ReactPointerEvent) => {
    if (e.button !== 0 || ownsGesture.current) return
    e.preventDefault()
    e.stopPropagation()
    const norm = screenToNormalized(e.clientX, e.clientY)
    if (!norm) return

    let clickT = 0.5
    if (gradient.type === 'linear') {
      const axisDx = (angleHandleNorm.x - startHandleNorm.x) * node.width
      const axisDy = (angleHandleNorm.y - startHandleNorm.y) * node.height
      const axisLenSq = axisDx * axisDx + axisDy * axisDy
      if (axisLenSq > 0.001) {
        const ptDx = (norm.x - startHandleNorm.x) * node.width
        const ptDy = (norm.y - startHandleNorm.y) * node.height
        clickT = (ptDx * axisDx + ptDy * axisDy) / axisLenSq
      }
    } else if (gradient.type === 'radial') {
      const rayDx = (angleHandleNorm.x - focalHandleNorm.x) * node.width
      const rayDy = (angleHandleNorm.y - focalHandleNorm.y) * node.height
      const rayLenSq = rayDx * rayDx + rayDy * rayDy
      if (rayLenSq > 0.001) {
        const ptDx = (norm.x - focalHandleNorm.x) * node.width
        const ptDy = (norm.y - focalHandleNorm.y) * node.height
        clickT = (ptDx * rayDx + ptDy * rayDy) / rayLenSq
      }
    } else {
      const dx = (norm.x - origin.x) * node.width
      const dy = (norm.y - origin.y) * node.height
      let theta = Math.atan2(dy, dx) - angleRad
      const twoPi = Math.PI * 2
      theta = ((theta % twoPi) + twoPi) % twoPi
      clickT = theta / (twoPi * Math.max(0.01, spread))
    }

    const clampedT = snapOffset(clickT)
    store.beginTransaction('Add gradient color stop')
    const { gradient: nextGrad, newStopId } = addGradientStop(gradient, clampedT)
    applyGradient(nextGrad)
    store.endTransaction()
    setActiveGradientStopId(newStopId)
  }

  // Selected stop details for popover HUD
  const activeStop = gradient.stops.find(s => s.id === activeStopId)
  const activeStopScreen = activeStop ? toScreen(getStopNormalizedPosition(activeStop)) : null

  return (
    <div
      ref={host}
      className="gradient-canvas-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      {/* SVG Guide Overlay */}
      <svg
        className="gradient-guides-svg"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        {gradient.type === 'linear' && (
          <>
            {/* Extended faint guideline */}
            <line
              x1={startHandleScreen.x - (angleHandleScreen.x - startHandleScreen.x) * 0.25}
              y1={startHandleScreen.y - (angleHandleScreen.y - startHandleScreen.y) * 0.25}
              x2={angleHandleScreen.x + (angleHandleScreen.x - startHandleScreen.x) * 0.25}
              y2={angleHandleScreen.y + (angleHandleScreen.y - startHandleScreen.y) * 0.25}
              stroke="#81adec"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.4"
            />
            {/* Clickable gradient axis bar */}
            <line
              x1={startHandleScreen.x}
              y1={startHandleScreen.y}
              x2={angleHandleScreen.x}
              y2={angleHandleScreen.y}
              stroke="#080808"
              strokeWidth="5"
              strokeLinecap="round"
              opacity="0.3"
            />
            <line
              x1={startHandleScreen.x}
              y1={startHandleScreen.y}
              x2={angleHandleScreen.x}
              y2={angleHandleScreen.y}
              stroke="#edebe1"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{ pointerEvents: 'stroke', cursor: 'copy' }}
              onPointerDown={handleGuideClick}
            />
          </>
        )}

        {gradient.type === 'radial' && (
          <>
            {/* Guide circle for radial spread */}
            <circle
              cx={originScreen.x}
              cy={originScreen.y}
              r={Math.hypot(angleHandleScreen.x - originScreen.x, angleHandleScreen.y - originScreen.y)}
              fill="none"
              stroke="#81adec"
              strokeWidth="1.5"
              strokeDasharray="5 5"
              opacity="0.6"
            />
            {/* Radial ray from focal to spread rim */}
            <line
              x1={focalHandleScreen.x}
              y1={focalHandleScreen.y}
              x2={angleHandleScreen.x}
              y2={angleHandleScreen.y}
              stroke="#edebe1"
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{ pointerEvents: 'stroke', cursor: 'copy' }}
              onPointerDown={handleGuideClick}
            />
          </>
        )}

        {gradient.type === 'angular' && (
          <>
            {/* Conic guide circle */}
            <circle
              cx={originScreen.x}
              cy={originScreen.y}
              r={Math.hypot(angleHandleScreen.x - originScreen.x, angleHandleScreen.y - originScreen.y)}
              fill="none"
              stroke="#81adec"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.6"
              style={{ pointerEvents: 'stroke', cursor: 'copy' }}
              onPointerDown={handleGuideClick}
            />
            {/* Zero ray from center to angle handle */}
            <line
              x1={originScreen.x}
              y1={originScreen.y}
              x2={angleHandleScreen.x}
              y2={angleHandleScreen.y}
              stroke="#edebe1"
              strokeWidth="2"
            />
          </>
        )}
      </svg>

      {/* Origin Transform Handle */}
      <div
        className="gradient-handle gradient-origin-handle"
        style={{
          position: 'absolute',
          left: originScreen.x,
          top: originScreen.y,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'auto',
          zIndex: 15,
        }}
        title="Gradient Center / Origin"
        onPointerDown={handleOriginPointerDown}
        onPointerMove={handleOriginPointerMove}
        onPointerUp={handleOriginPointerUp}
      >
        <div className="gradient-handle-ring">
          <div className="gradient-handle-dot origin-dot" />
        </div>
      </div>

      {/* Angle & Spread Transform Handle */}
      <div
        className="gradient-handle gradient-angle-handle"
        style={{
          position: 'absolute',
          left: angleHandleScreen.x,
          top: angleHandleScreen.y,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'auto',
          zIndex: 16,
        }}
        title={`Gradient Angle (${Math.round(gradient.angle)}°) & Spread (${(gradient.spread * 100).toFixed(0)}%)`}
        onPointerDown={handleAnglePointerDown}
        onPointerMove={handleAnglePointerMove}
        onPointerUp={handleAnglePointerUp}
      >
        <div className="gradient-angle-badge">
          <RotateCw size={11} />
          <span>{Math.round(gradient.angle)}°</span>
        </div>
      </div>

      {/* Focal Length Handle (for Radial Gradient) */}
      {gradient.type === 'radial' && (
        <div
          className="gradient-handle gradient-focal-handle"
          style={{
            position: 'absolute',
            left: focalHandleScreen.x,
            top: focalHandleScreen.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'auto',
            zIndex: 17,
          }}
          title={`Focal Point (Offset: ${gradient.focalLength.toFixed(2)})`}
          onPointerDown={handleFocalPointerDown}
          onPointerMove={handleFocalPointerMove}
          onPointerUp={handleFocalPointerUp}
        >
          <div className="gradient-focal-badge">
            <Target size={12} />
          </div>
        </div>
      )}

      {/* Color Stop Handles */}
      {gradient.stops.map((stop, index) => {
        const stopScreen = toScreen(getStopNormalizedPosition(stop))
        const isSelected = stop.id === activeStopId
        return (
          <div
            key={stop.id}
            className={`gradient-handle gradient-stop-handle ${isSelected ? 'is-selected' : ''}`}
            style={{
              position: 'absolute',
              left: stopScreen.x,
              top: stopScreen.y,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto',
              zIndex: isSelected ? 22 : 18,
            }}
            title={`Stop ${index + 1}: ${stop.color} (${Math.round(stop.offset * 100)}%)`}
            onPointerDown={e => handleStopPointerDown(e, stop.id)}
            onPointerMove={e => handleStopPointerMove(e, stop.id)}
            onPointerUp={handleStopPointerUp}
          >
            <div
              className="gradient-stop-chip"
              style={{
                backgroundColor: stop.color,
                opacity: stop.opacity ?? 1,
              }}
            />
            {isSelected && <span className="gradient-stop-indicator" />}
          </div>
        )
      })}

      {/* Floating HUD Popover for Selected Stop */}
      {activeStop && activeStopScreen && (
        <div
          className="gradient-stop-hud"
          style={{
            position: 'absolute',
            left: activeStopScreen.x + 14,
            top: activeStopScreen.y - 18,
            pointerEvents: 'auto',
            zIndex: 30,
          }}
        >
          <div className="gradient-stop-hud-inner">
            <label className="hud-color-swatch-wrap" title="Change stop color">
              <input
                type="color"
                aria-label="Stop color picker"
                value={activeStop.color.slice(0, 7)}
                onChange={e => {
                  applyGradient(updateGradientStop(gradient, activeStop.id, { color: e.target.value }))
                }}
              />
              <span className="hud-swatch-preview" style={{ background: activeStop.color }} />
            </label>

            <input
              type="text"
              aria-label="Stop hex code"
              className="hud-hex-input"
              value={hexInputValue || activeStop.color.toUpperCase()}
              onFocus={() => setHexInputValue(activeStop.color.toUpperCase())}
              onChange={e => setHexInputValue(e.target.value)}
              onBlur={() => {
                if (/^#[\da-f]{6}$/i.test(hexInputValue)) {
                  applyGradient(updateGradientStop(gradient, activeStop.id, { color: hexInputValue.toLowerCase() }))
                }
                setHexInputValue('')
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />

            <span className="hud-offset-badge">
              {Math.round(activeStop.offset * 100)}%
            </span>

            {gradient.stops.length > 2 && (
              <button
                type="button"
                className="hud-btn-delete"
                title="Remove stop"
                aria-label="Remove stop"
                onClick={() => {
                  store.beginTransaction('Remove gradient stop')
                  applyGradient(removeGradientStop(gradient, activeStop.id))
                  store.endTransaction()
                  setActiveGradientStopId(null)
                }}
              >
                <Trash2 size={11} />
              </button>
            )}

            <button
              type="button"
              className="hud-btn-close"
              title="Close HUD"
              aria-label="Close HUD"
              onClick={() => setActiveGradientStopId(null)}
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
