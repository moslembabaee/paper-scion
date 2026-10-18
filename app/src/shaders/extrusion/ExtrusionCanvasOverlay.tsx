import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Box, Compass, Eye, Layers, Sun, X } from 'lucide-react'
import type { ViewportController } from '../../canvas/ViewportController'
import type { Point } from '../../canvas/types'
import { getWorldMatrix } from '../../scene/geometry'
import type { SceneStore } from '../../scene/store'
import { useScene } from '../../scene/useScene'
import {
  setActiveExtrusionHandle,
  setActiveExtrusionId,
  setExtrusionHUDVisible,
  useActiveExtrusionHandle,
  useExtrusionHUDVisible,
} from './extrusionState.ts'
import type { ExtrusionViewMode, VectorExtrusionParams } from './types.ts'
import './extrusion.css'

interface Props {
  readonly store: SceneStore
  readonly controller: ViewportController
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value))
}

export function ExtrusionCanvasOverlay({ store, controller }: Props) {
  const state = useScene(store, s => s)
  const [viewport, setViewport] = useState(() => controller.getSnapshot())
  const hostRef = useRef<HTMLDivElement>(null)
  const ownsGesture = useRef(false)
  const activeHandle = useActiveExtrusionHandle()
  const hudVisible = useExtrusionHUDVisible()

  useLayoutEffect(() => controller.subscribe(setViewport), [controller])

  const node = state.selection.length === 1 ? state.elements[state.selection[0]] : undefined
  const isEnabled = !!node && !store.isLocked(node.id) && store.isVisible(node.id)

  const extrusionParams: VectorExtrusionParams | null = isEnabled
    ? node.style.shader?.kind === 'vector-extrusion'
      ? (node.style.shader.params as unknown as VectorExtrusionParams)
      : (node.style as any).extrusion ?? null
    : null

  const finishGesture = useCallback(
    (cancel: boolean) => {
      if (!ownsGesture.current) return
      ownsGesture.current = false
      setActiveExtrusionHandle(null)
      if (cancel) store.cancelTransaction()
      else store.endTransaction()
    },
    [store]
  )

  useLayoutEffect(() => () => finishGesture(true), [finishGesture])

  useEffect(() => {
    if (isEnabled && node && extrusionParams) {
      setActiveExtrusionId(node.id)
    } else {
      setActiveExtrusionId(null)
    }
  }, [isEnabled, node, extrusionParams])

  // Deselect on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveExtrusionHandle(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!isEnabled || !node || !extrusionParams) return null

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

  const applyParams = (nextParams: Partial<VectorExtrusionParams>) => {
    const currentNode = store.getSnapshot().elements[node.id]
    if (!currentNode) return

    const updated = {
      ...extrusionParams,
      ...nextParams,
    }

    if (currentNode.style.shader?.kind === 'vector-extrusion') {
      store.update(currentNode.id, currentNode.type, {
        style: {
          ...currentNode.style,
          shader: {
            ...currentNode.style.shader,
            params: updated,
          },
        },
      })
    } else {
      store.update(currentNode.id, currentNode.type, {
        style: {
          ...currentNode.style,
          extrusion: updated,
        } as any,
      })
    }
  }

  // Center of element in screen pixels
  const centerScreen = toScreen({ x: 0.5, y: 0.5 })
  const rightEdgeScreen = toScreen({ x: 1.0, y: 0.5 })

  // Radius for directional orbit
  const baseDim = Math.max(node.width, node.height)
  const orbitRadiusScreen = Math.max(48, (baseDim * 0.65 + 40) * camera.zoom * extrusionParams.lightDistance)

  // Light position calculations
  const azRad = (extrusionParams.lightAzimuth * Math.PI) / 180
  const elRad = (extrusionParams.lightElevation * Math.PI) / 180

  const lightScreen = {
    x: centerScreen.x + Math.cos(azRad) * orbitRadiusScreen,
    y: centerScreen.y - Math.sin(azRad) * orbitRadiusScreen,
  }

  // Shadow projection endpoint in screen space
  const shadowDistScreen = orbitRadiusScreen * 0.6 * extrusionParams.shadowLength
  const shadowScreen = {
    x: centerScreen.x - Math.cos(azRad) * shadowDistScreen,
    y: centerScreen.y + Math.sin(azRad) * shadowDistScreen,
  }

  // Bevel handle position on element perimeter
  const bevelOffsetPx = (extrusionParams.bevelWidth * camera.zoom)
  const bevelHandleScreen = {
    x: rightEdgeScreen.x - bevelOffsetPx,
    y: rightEdgeScreen.y,
  }

  // Elevation indicator arc radius
  const elevationArcRadius = orbitRadiusScreen * 0.35
  const elAngleRad = elRad
  const elevationHandleScreen = {
    x: centerScreen.x + Math.cos(azRad) * elevationArcRadius * Math.cos(elAngleRad),
    y: centerScreen.y - Math.sin(azRad) * elevationArcRadius * Math.cos(elAngleRad) - Math.sin(elAngleRad) * 24 * camera.zoom,
  }

  // Handlers for pointer drag on Light Handle
  const handleLightPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActiveExtrusionHandle('light')
    ownsGesture.current = true
    store.beginTransaction('Adjust 3D directional light source')
  }

  const handleLightPointerMove = (e: ReactPointerEvent) => {
    if (!ownsGesture.current || activeHandle !== 'light') return
    const dx = e.clientX - centerScreen.x
    const dy = -(e.clientY - centerScreen.y) // Invert Y for Cartesian angle
    let nextAzimuth = (Math.atan2(dy, dx) * 180) / Math.PI
    if (nextAzimuth < 0) nextAzimuth += 360

    if (e.shiftKey) {
      nextAzimuth = Math.round(nextAzimuth / 15) * 15
    }

    const currentDist = Math.hypot(dx, dy)
    const baseOrbit = Math.max(48, (baseDim * 0.65 + 40) * camera.zoom)
    const nextDistance = clamp(0.4, 2.0, currentDist / baseOrbit)

    applyParams({
      lightAzimuth: Number(nextAzimuth.toFixed(1)),
      lightDistance: Number(nextDistance.toFixed(2)),
    })
  }

  const handleLightPointerUp = (e: ReactPointerEvent) => {
    if (activeHandle === 'light') {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      finishGesture(false)
    }
  }

  // Elevation Handle Drag
  const handleElevationPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActiveExtrusionHandle('elevation')
    ownsGesture.current = true
    store.beginTransaction('Adjust light elevation altitude')
  }

  const handleElevationPointerMove = (e: ReactPointerEvent) => {
    if (!ownsGesture.current || activeHandle !== 'elevation') return
    const dy = centerScreen.y - e.clientY
    const nextElev = clamp(5, 90, (dy / (40 * camera.zoom)) * 45 + 45)
    applyParams({
      lightElevation: Math.round(nextElev),
    })
  }

  const handleElevationPointerUp = (e: ReactPointerEvent) => {
    if (activeHandle === 'elevation') {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      finishGesture(false)
    }
  }

  // Bevel Handle Drag
  const handleBevelPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActiveExtrusionHandle('bevel')
    ownsGesture.current = true
    store.beginTransaction('Adjust bevel depth & width')
  }

  const handleBevelPointerMove = (e: ReactPointerEvent) => {
    if (!ownsGesture.current || activeHandle !== 'bevel') return
    const dx = rightEdgeScreen.x - e.clientX
    const nextWidth = clamp(1, 50, dx / camera.zoom)
    const nextDepth = clamp(1, 50, nextWidth * 0.8)
    applyParams({
      bevelWidth: Number(nextWidth.toFixed(1)),
      bevelDepth: Number(nextDepth.toFixed(1)),
    })
  }

  const handleBevelPointerUp = (e: ReactPointerEvent) => {
    if (activeHandle === 'bevel') {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      finishGesture(false)
    }
  }

  // Shadow Handle Drag
  const handleShadowPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActiveExtrusionHandle('shadow')
    ownsGesture.current = true
    store.beginTransaction('Adjust directional shadow length')
  }

  const handleShadowPointerMove = (e: ReactPointerEvent) => {
    if (!ownsGesture.current || activeHandle !== 'shadow') return
    const dist = Math.hypot(e.clientX - centerScreen.x, e.clientY - centerScreen.y)
    const nextLength = clamp(0.1, 2.0, dist / (orbitRadiusScreen * 0.6))
    applyParams({
      shadowLength: Number(nextLength.toFixed(2)),
    })
  }

  const handleShadowPointerUp = (e: ReactPointerEvent) => {
    if (activeHandle === 'shadow') {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      finishGesture(false)
    }
  }

  const cycleViewMode = () => {
    const modes: ExtrusionViewMode[] = ['shaded', 'normal-map', 'depth', 'ambient-occlusion', 'lighting-only']
    const currentIndex = modes.indexOf(extrusionParams.viewMode)
    const nextMode = modes[(currentIndex + 1) % modes.length]
    applyParams({ viewMode: nextMode })
  }

  return (
    <div
      ref={hostRef}
      className="extrusion-canvas-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <svg
        className="extrusion-guides-svg"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <defs>
          <radialGradient id="light-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#edebe1" stopOpacity="0.8" />
            <stop offset="60%" stopColor="#81adec" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#81adec" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Orbit track ring */}
        <circle
          cx={centerScreen.x}
          cy={centerScreen.y}
          r={orbitRadiusScreen}
          fill="none"
          stroke="#81adec"
          strokeWidth="1.2"
          strokeDasharray="4 6"
          opacity="0.5"
        />

        {/* Directional Light Beam Line */}
        <line
          x1={lightScreen.x}
          y1={lightScreen.y}
          x2={centerScreen.x}
          y2={centerScreen.y}
          stroke="#edebe1"
          strokeWidth="2"
          strokeDasharray="3 3"
          opacity="0.85"
        />

        {/* Cast shadow vector line */}
        <line
          x1={centerScreen.x}
          y1={centerScreen.y}
          x2={shadowScreen.x}
          y2={shadowScreen.y}
          stroke="#080808"
          strokeWidth="2.5"
          opacity="0.75"
        />
        <line
          x1={centerScreen.x}
          y1={centerScreen.y}
          x2={shadowScreen.x}
          y2={shadowScreen.y}
          stroke="#81adec"
          strokeWidth="1.5"
          strokeDasharray="2 3"
          opacity="0.6"
        />

        {/* Light Glow Aura */}
        <circle
          cx={lightScreen.x}
          cy={lightScreen.y}
          r="24"
          fill="url(#light-glow)"
          pointerEvents="none"
        />
      </svg>

      {/* Directional Light Source Handle */}
      <div
        className={`extrusion-handle extrusion-light-handle ${activeHandle === 'light' ? 'is-active' : ''}`}
        style={{
          position: 'absolute',
          left: lightScreen.x,
          top: lightScreen.y,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'auto',
          zIndex: 25,
        }}
        title={`Directional Light (Azimuth: ${Math.round(extrusionParams.lightAzimuth)}°, Elev: ${Math.round(extrusionParams.lightElevation)}°)`}
        onPointerDown={handleLightPointerDown}
        onPointerMove={handleLightPointerMove}
        onPointerUp={handleLightPointerUp}
      >
        <div className="extrusion-light-chip">
          <Sun size={14} className="sun-icon" />
          <span className="light-azimuth-label">{Math.round(extrusionParams.lightAzimuth)}°</span>
        </div>
      </div>

      {/* Elevation Altitude Handle */}
      <div
        className="extrusion-handle extrusion-elevation-handle"
        style={{
          position: 'absolute',
          left: elevationHandleScreen.x,
          top: elevationHandleScreen.y,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'auto',
          zIndex: 22,
        }}
        title={`Light Altitude / Elevation (${Math.round(extrusionParams.lightElevation)}°)`}
        onPointerDown={handleElevationPointerDown}
        onPointerMove={handleElevationPointerMove}
        onPointerUp={handleElevationPointerUp}
      >
        <div className="extrusion-elevation-badge">
          <Compass size={11} />
          <span>{Math.round(extrusionParams.lightElevation)}°</span>
        </div>
      </div>

      {/* Directional Cast Shadow Tip Handle */}
      <div
        className="extrusion-handle extrusion-shadow-handle"
        style={{
          position: 'absolute',
          left: shadowScreen.x,
          top: shadowScreen.y,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'auto',
          zIndex: 23,
        }}
        title={`Cast Shadow Length (${extrusionParams.shadowLength.toFixed(2)}x)`}
        onPointerDown={handleShadowPointerDown}
        onPointerMove={handleShadowPointerMove}
        onPointerUp={handleShadowPointerUp}
      >
        <div className="extrusion-shadow-tip" />
      </div>

      {/* Bevel Width / Depth Handle */}
      <div
        className="extrusion-handle extrusion-bevel-handle"
        style={{
          position: 'absolute',
          left: bevelHandleScreen.x,
          top: bevelHandleScreen.y,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'auto',
          zIndex: 24,
        }}
        title={`Bevel Depth: ${extrusionParams.bevelDepth}px | Width: ${extrusionParams.bevelWidth}px`}
        onPointerDown={handleBevelPointerDown}
        onPointerMove={handleBevelPointerMove}
        onPointerUp={handleBevelPointerUp}
      >
        <div className="extrusion-bevel-marker">
          <Layers size={10} />
        </div>
      </div>

      {/* Floating HUD Widget */}
      {hudVisible && (
        <div
          className="extrusion-hud"
          style={{
            position: 'absolute',
            left: centerScreen.x + 20,
            top: centerScreen.y - (baseDim * 0.45 * camera.zoom) - 50,
            pointerEvents: 'auto',
            zIndex: 35,
          }}
        >
          <div className="extrusion-hud-inner">
            <div className="extrusion-hud-title">
              <Box size={12} className="hud-icon" />
              <span>3D EXTRUSION</span>
            </div>

            <div className="extrusion-hud-stats">
              <span className="stat-pill">Light: {Math.round(extrusionParams.lightAzimuth)}° / {Math.round(extrusionParams.lightElevation)}°</span>
              <span className="stat-pill">Bevel: {extrusionParams.bevelDepth}px</span>
            </div>

            <button
              type="button"
              className="hud-mode-toggle"
              title={`View Mode: ${extrusionParams.viewMode} (Click to cycle)`}
              onClick={cycleViewMode}
            >
              <Eye size={11} />
              <span className="mode-label">{extrusionParams.viewMode}</span>
            </button>

            <button
              type="button"
              className="hud-close-btn"
              title="Hide HUD"
              onClick={() => setExtrusionHUDVisible(false)}
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
