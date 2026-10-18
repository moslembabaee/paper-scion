import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import {
  Bookmark,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Radio,
} from 'lucide-react'
import { unionBounds } from './math.ts'
import type { Bounds, MinimapItem, Point, RadarDisplayMode, SpatialBookmark, ViewportSnapshot } from './types.ts'
import type { ViewportController } from './ViewportController.ts'
import { subscribeTheme } from '../design-system/theme.ts'
import {
  computeRadarLayout,
  getViewportHandles,
  hitTestHandle,
  hitTestRect,
  calculateNewViewportFromHandleDrag,
  getRadarGridLines,
  minimapToWorld,
  type RadarLayout,
  type ViewportHandle,
  type ViewportHandleId,
} from './radarMath.ts'
import { FrameJumpList } from './FrameJumpList.tsx'
import { SpatialShortcutOverlay } from './SpatialShortcutOverlay.tsx'

export interface MinimapProps {
  controller: ViewportController
  items: readonly MinimapItem[]
  contentBounds?: Bounds
  onSelectFrame?: (id: string) => void
  onToggleMinimap?: () => void
  className?: string
}

const STORAGE_KEY_BOOKMARKS = 'paper_canvas_bookmarks'

function loadSavedBookmarks(): SpatialBookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BOOKMARKS)
    if (raw) return JSON.parse(raw)
  } catch {
    // Ignore storage parse issues
  }
  return []
}

function persistBookmarks(bookmarks: SpatialBookmark[]) {
  try {
    localStorage.setItem(STORAGE_KEY_BOOKMARKS, JSON.stringify(bookmarks))
  } catch {
    // Ignore storage quota issues
  }
}

export function Minimap({
  controller,
  items,
  contentBounds,
  onSelectFrame,
  onToggleMinimap,
  className = '',
}: MinimapProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const toggleMinimized = useCallback(() => {
    setIsMinimized((prev) => {
      const next = !prev
      onToggleMinimap?.()
      return next
    })
  }, [onToggleMinimap])
  const [showJumpList, setShowJumpList] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [displayMode, setDisplayMode] = useState<RadarDisplayMode>('layers')
  const [bookmarks, setBookmarks] = useState<SpatialBookmark[]>(loadSavedBookmarks)

  // Current camera telemetry for live header readout
  const [telemetry, setTelemetry] = useState<{ x: number; y: number; zoom: number }>({
    x: 0,
    y: 0,
    zoom: 1,
  })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeLayoutRef = useRef<RadarLayout>({ scale: 1, x: 0, y: 0, width: 224, height: 140 })
  const activeHandlesRef = useRef<readonly ViewportHandle[]>([])
  const activeViewportRectRef = useRef<Bounds>({ x: 0, y: 0, width: 0, height: 0 })

  // Drag interaction state
  const dragInteractionRef = useRef<{
    pointerId: number
    mode: 'viewport' | 'handle' | 'navigate'
    handleId?: ViewportHandleId
    initialMinimapPoint: Point
    initialVisibleBounds: Bounds
    initialCamera: { x: number; y: number; zoom: number }
  } | null>(null)

  // Dimensions based on expanded/standard state
  const width = isExpanded ? 320 : 224
  const height = isExpanded ? 200 : 136
  const inset = 12

  // Frame items count for jump-list badge
  const frameCount = useMemo(
    () => items.filter((i) => i.isFrame || i.type === 'frame').length,
    [items]
  )

  // Persist bookmarks when changed
  const handleAddBookmark = useCallback(
    (name: string) => {
      const snap = controller.getSnapshot()
      const newBookmark: SpatialBookmark = {
        id: crypto.randomUUID(),
        name,
        camera: snap.camera,
        bounds: snap.visibleBounds,
        createdAt: Date.now(),
      }
      setBookmarks((prev) => {
        const next = [newBookmark, ...prev]
        persistBookmarks(next)
        return next
      })
    },
    [controller]
  )

  const handleDeleteBookmark = useCallback((id: string) => {
    setBookmarks((prev) => {
      const next = prev.filter((b) => b.id !== id)
      persistBookmarks(next)
      return next
    })
  }, [])

  // Live Canvas Rendering Engine (60fps)
  useEffect(() => {
    const paint = (snapshot: ViewportSnapshot) => {
      if (isMinimized) return
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio
        canvas.height = height * ratio
      }

      const { camera, visibleBounds } = snapshot
      setTelemetry({
        x: Math.round(-camera.x / camera.zoom),
        y: Math.round(-camera.y / camera.zoom),
        zoom: camera.zoom,
      })

      // Union of all items + current visible bounds to keep navigator in frame
      const effectiveBounds = unionBounds([...items, visibleBounds])
      const layout = computeRadarLayout(effectiveBounds, width, height, inset)
      activeLayoutRef.current = layout

      ctx.save()
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, width, height)

      // 1. Radar Backdrop
      ctx.fillStyle = '#080808'
      ctx.fillRect(0, 0, width, height)

      // 2. 120px World Grid projected on Minimap
      const { vertical, horizontal } = getRadarGridLines(layout, effectiveBounds, 120)
      ctx.strokeStyle = 'rgba(237, 235, 225, 0.05)'
      ctx.lineWidth = 0.5
      for (const vx of vertical) {
        ctx.beginPath()
        ctx.moveTo(vx, 0)
        ctx.lineTo(vx, height)
        ctx.stroke()
      }
      for (const hy of horizontal) {
        ctx.beginPath()
        ctx.moveTo(0, hy)
        ctx.lineTo(width, hy)
        ctx.stroke()
      }

      // 3. Radar Scope Mode Visuals (if active or subtle accent)
      const centerScreenX = (width / 2)
      const centerScreenY = (height / 2)
      if (displayMode === 'radar') {
        ctx.save()
        ctx.strokeStyle = 'rgba(129, 173, 236, 0.15)'
        ctx.lineWidth = 0.75
        for (const radius of [30, 60, 90, 120]) {
          ctx.beginPath()
          ctx.arc(centerScreenX, centerScreenY, radius, 0, Math.PI * 2)
          ctx.stroke()
        }
        // Crosshairs
        ctx.beginPath()
        ctx.moveTo(centerScreenX - 10, centerScreenY)
        ctx.lineTo(centerScreenX + 10, centerScreenY)
        ctx.moveTo(centerScreenX, centerScreenY - 10)
        ctx.lineTo(centerScreenX, centerScreenY + 10)
        ctx.stroke()
        ctx.restore()
      }

      // 4. Live Scaled Layer Thumbnails
      for (const item of items) {
        const ix = item.x * layout.scale + layout.x
        const iy = item.y * layout.scale + layout.y
        const iw = Math.max(1.5, item.width * layout.scale)
        const ih = Math.max(1.5, item.height * layout.scale)

        const isFrame = item.isFrame || item.type === 'frame'
        const isSelected = item.isSelected

        if (displayMode === 'wireframe') {
          // Clean vector wireframe mode
          ctx.strokeStyle = isSelected ? '#81adec' : isFrame ? '#444444' : 'rgba(237, 235, 225, 0.3)'
          ctx.lineWidth = isSelected ? 1.5 : 1
          ctx.strokeRect(ix, iy, iw, ih)
        } else {
          // Rich Layer Thumbnails Mode
          if (isFrame) {
            // Frame container styling
            ctx.fillStyle = '#141414'
            ctx.fillRect(ix, iy, iw, ih)
            ctx.strokeStyle = isSelected ? '#81adec' : '#282828'
            ctx.lineWidth = isSelected ? 1.5 : 1
            ctx.strokeRect(ix, iy, iw, ih)

            // Header bar
            ctx.fillStyle = '#202020'
            ctx.fillRect(ix, iy, iw, Math.min(3, ih))

            // Frame Name Label if sufficiently sized
            if (iw >= 28 && ih >= 16 && item.name) {
              ctx.font = '500 7px ui-monospace, SFMono-Regular, monospace'
              ctx.fillStyle = isSelected ? '#81adec' : '#edebe1'
              const label = item.name.length > 12 ? `${item.name.slice(0, 10)}…` : item.name
              ctx.fillText(label, ix + 2, Math.max(8, iy - 2))
            }
          } else if (item.type === 'ellipse') {
            ctx.fillStyle = item.color ?? 'rgba(237, 235, 225, 0.25)'
            ctx.beginPath()
            ctx.ellipse(ix + iw / 2, iy + ih / 2, iw / 2, ih / 2, 0, 0, Math.PI * 2)
            ctx.fill()
            if (item.strokeColor) {
              ctx.strokeStyle = item.strokeColor
              ctx.lineWidth = 1
              ctx.stroke()
            }
          } else if (item.type === 'text') {
            // Stylized micro typographic bar
            ctx.fillStyle = item.color ?? '#edebe1'
            const barH = Math.min(ih, 2)
            ctx.fillRect(ix, iy + ih / 2 - barH / 2, Math.max(4, iw), barH)
          } else {
            // Rectangle / Path / Component Shape
            ctx.fillStyle = item.color ?? 'rgba(237, 235, 225, 0.18)'
            if (item.cornerRadius && item.cornerRadius > 0 && ctx.roundRect) {
              ctx.beginPath()
              ctx.roundRect(ix, iy, iw, ih, Math.min(item.cornerRadius * layout.scale, 4))
              ctx.fill()
              if (item.strokeColor) {
                ctx.strokeStyle = item.strokeColor
                ctx.lineWidth = 1
                ctx.stroke()
              }
            } else {
              ctx.fillRect(ix, iy, iw, ih)
              if (item.strokeColor) {
                ctx.strokeStyle = item.strokeColor
                ctx.lineWidth = 1
                ctx.strokeRect(ix, iy, iw, ih)
              }
            }
          }

          // Active selection highlight glow
          if (isSelected) {
            ctx.strokeStyle = '#81adec'
            ctx.lineWidth = 1.5
            ctx.strokeRect(ix - 1, iy - 1, iw + 2, ih + 2)
            // 4 corner highlight dots
            ctx.fillStyle = '#81adec'
            ctx.fillRect(ix - 2, iy - 2, 3, 3)
            ctx.fillRect(ix + iw - 1, iy - 2, 3, 3)
            ctx.fillRect(ix - 2, iy + ih - 1, 3, 3)
            ctx.fillRect(ix + iw - 1, iy + ih - 1, 3, 3)
          }
        }
      }

      // 5. Two-Way Synchronized Viewport Bounding Rectangle
      const vx = visibleBounds.x * layout.scale + layout.x
      const vy = visibleBounds.y * layout.scale + layout.y
      const vw = Math.max(8, visibleBounds.width * layout.scale)
      const vh = Math.max(6, visibleBounds.height * layout.scale)
      const viewportRect: Bounds = { x: vx, y: vy, width: vw, height: vh }
      activeViewportRectRef.current = viewportRect

      // Viewport shaded fill
      ctx.fillStyle = 'rgba(129, 173, 236, 0.10)'
      ctx.fillRect(vx, vy, vw, vh)

      // Viewport boundary stroke
      ctx.strokeStyle = '#81adec'
      ctx.lineWidth = 1.25
      ctx.strokeRect(vx, vy, vw, vh)

      // Center crosshair pip inside viewport
      const vcx = vx + vw / 2
      const vcy = vy + vh / 2
      ctx.strokeStyle = '#81adec'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(vcx - 3, vcy)
      ctx.lineTo(vcx + 3, vcy)
      ctx.moveTo(vcx, vcy - 3)
      ctx.lineTo(vcx, vcy + 3)
      ctx.stroke()

      // Corner bracket accents
      const bracketSize = Math.min(4, vw / 4, vh / 4)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      // Top-left
      ctx.moveTo(vx, vy + bracketSize)
      ctx.lineTo(vx, vy)
      ctx.lineTo(vx + bracketSize, vy)
      // Top-right
      ctx.moveTo(vx + vw - bracketSize, vy)
      ctx.lineTo(vx + vw, vy)
      ctx.lineTo(vx + vw, vy + bracketSize)
      // Bottom-left
      ctx.moveTo(vx, vy + vh - bracketSize)
      ctx.lineTo(vx, vy + vh)
      ctx.lineTo(vx + bracketSize, vy + vh)
      // Bottom-right
      ctx.moveTo(vx + vw - bracketSize, vy + vh)
      ctx.lineTo(vx + vw, vy + vh)
      ctx.lineTo(vx + vw, vy + vh - bracketSize)
      ctx.stroke()

      // 6. Viewport 8-Directional Zoom & Resize Handles
      const handles = getViewportHandles(viewportRect)
      activeHandlesRef.current = handles

      for (const h of handles) {
        const isCorner = ['nw', 'ne', 'se', 'sw'].includes(h.id)
        if (isCorner) {
          // Corner square handles
          ctx.fillStyle = '#81adec'
          ctx.strokeStyle = '#080808'
          ctx.lineWidth = 1
          ctx.fillRect(h.x - 2.5, h.y - 2.5, 5, 5)
          ctx.strokeRect(h.x - 2.5, h.y - 2.5, 5, 5)
        } else {
          // Midpoint edge handle ticks
          ctx.fillStyle = '#81adec'
          const isVert = h.id === 'w' || h.id === 'e'
          const pw = isVert ? 2 : 6
          const ph = isVert ? 6 : 2
          ctx.fillRect(h.x - pw / 2, h.y - ph / 2, pw, ph)
        }
      }

      ctx.restore()
    }

    const unsubscribe = controller.subscribe(paint)
    const unsubscribeTheme = subscribeTheme(() => paint(controller.getSnapshot()))
    return () => {
      unsubscribe()
      unsubscribeTheme()
    }
  }, [controller, items, width, height, inset, displayMode, isMinimized])

  // Coordinate conversion helper from client mouse coordinates to minimap canvas space
  const getMinimapPoint = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    }
  }, [width, height])

  // Pointer interactions on Minimap
  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    controller.stop()

    const clientPoint: Point = { x: event.clientX, y: event.clientY }
    const minimapPoint = getMinimapPoint(clientPoint.x, clientPoint.y)
    const snapshot = controller.getSnapshot()

    // 1. Check if user clicked any of the 8 resize handles
    const hitHandle = hitTestHandle(minimapPoint, activeHandlesRef.current, 7)
    if (hitHandle) {
      dragInteractionRef.current = {
        pointerId: event.pointerId,
        mode: 'handle',
        handleId: hitHandle.id,
        initialMinimapPoint: minimapPoint,
        initialVisibleBounds: snapshot.visibleBounds,
        initialCamera: { ...snapshot.camera },
      }
      return
    }

    // 2. Check if user clicked inside the viewport bounding rectangle (pan mode)
    if (hitTestRect(minimapPoint, activeViewportRectRef.current)) {
      dragInteractionRef.current = {
        pointerId: event.pointerId,
        mode: 'viewport',
        initialMinimapPoint: minimapPoint,
        initialVisibleBounds: snapshot.visibleBounds,
        initialCamera: { ...snapshot.camera },
      }
      return
    }

    // 3. User clicked outside the viewport box: immediate center navigation
    dragInteractionRef.current = {
      pointerId: event.pointerId,
      mode: 'navigate',
      initialMinimapPoint: minimapPoint,
      initialVisibleBounds: snapshot.visibleBounds,
      initialCamera: { ...snapshot.camera },
    }
    const worldPoint = minimapToWorld(minimapPoint, activeLayoutRef.current)
    controller.centerOn(worldPoint, false)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const minimapPoint = getMinimapPoint(event.clientX, event.clientY)
    const drag = dragInteractionRef.current

    // Dynamically update cursor when hovering
    if (!drag) {
      const hit = hitTestHandle(minimapPoint, activeHandlesRef.current, 7)
      if (hit) {
        canvas.style.cursor = hit.cursor
      } else if (hitTestRect(minimapPoint, activeViewportRectRef.current)) {
        canvas.style.cursor = 'grab'
      } else {
        canvas.style.cursor = 'crosshair'
      }
      return
    }

    if (drag.pointerId !== event.pointerId) return

    if (drag.mode === 'handle' && drag.handleId) {
      // Dynamic Zoom Frustum Resize Manipulation
      const newBounds = calculateNewViewportFromHandleDrag(
        drag.handleId,
        minimapPoint,
        drag.initialVisibleBounds,
        activeLayoutRef.current,
        controller.getSnapshot().size
      )
      controller.fit(newBounds, 0, false)
    } else if (drag.mode === 'viewport') {
      // Dragging viewport rectangle pans canvas 1:1 in world coordinates
      canvas.style.cursor = 'grabbing'
      const dxMinimap = minimapPoint.x - drag.initialMinimapPoint.x
      const dyMinimap = minimapPoint.y - drag.initialMinimapPoint.y
      const layout = activeLayoutRef.current
      const dxWorld = dxMinimap / layout.scale
      const dyWorld = dyMinimap / layout.scale
      const zoom = drag.initialCamera.zoom

      controller.setCamera(
        {
          x: drag.initialCamera.x - dxWorld * zoom,
          y: drag.initialCamera.y - dyWorld * zoom,
          zoom,
        },
        false
      )
    } else if (drag.mode === 'navigate') {
      // Free drag panning on map
      const worldPoint = minimapToWorld(minimapPoint, activeLayoutRef.current)
      controller.centerOn(worldPoint, false)
    }
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragInteractionRef.current?.pointerId === event.pointerId) {
      dragInteractionRef.current = null
      if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair'
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // Wheel zoom directly over Minimap
  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const minimapPoint = getMinimapPoint(event.clientX, event.clientY)
    const worldPoint = minimapToWorld(minimapPoint, activeLayoutRef.current)
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
    controller.zoomBy(factor, controller.worldToScreen(worldPoint))
  }

  // Double click resets zoom to fit all
  const handleDoubleClick = () => {
    const bounds = contentBounds ?? unionBounds(items)
    controller.fit(bounds, 60, true)
  }

  const toggleRef = useRef(toggleMinimized)
  toggleRef.current = toggleMinimized

  // Global spatial keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      if (isInput) return

      if (e.key === 'm' || e.key === 'M') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          toggleRef.current()
        }
      } else if (e.key === 'b' || e.key === 'B') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          setShowJumpList((prev) => !prev)
        }
      } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setShowShortcuts((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <div
        className={`viewport-minimap radar-hud-container ${isExpanded ? 'is-expanded' : ''} ${
          isMinimized ? 'is-minimized' : ''
        } ${className}`}
        data-testid="viewport-minimap"
      >
        {/* Radar HUD Header */}
        <div className="minimap-heading radar-hud-header">
          <div className="radar-header-left">
            <span className="minimap-live radar-pulse" aria-hidden="true" />
            <span className="radar-title">RADAR</span>
            <span className="radar-coord-tag">
              X:{telemetry.x} Y:{telemetry.y}
            </span>
          </div>

          <div className="radar-header-actions">
            {/* Display Mode Toggle */}
            {!isMinimized && (
              <button
                className={`radar-icon-btn ${displayMode === 'wireframe' ? 'active' : ''}`}
                title={`Display Mode: ${displayMode} (Click to cycle)`}
                aria-label="Toggle Radar Display Mode"
                onClick={() =>
                  setDisplayMode((m) =>
                    m === 'layers' ? 'wireframe' : m === 'wireframe' ? 'radar' : 'layers'
                  )
                }
              >
                {displayMode === 'radar' ? (
                  <Radio size={12} />
                ) : (
                  <Layers size={12} />
                )}
              </button>
            )}

            {/* Jump-List Toggle */}
            <button
              className={`radar-icon-btn ${showJumpList ? 'active' : ''}`}
              title="Frame & Bookmark Jump-List (B)"
              aria-label="Open Frame Jump-List"
              onClick={() => setShowJumpList((prev) => !prev)}
            >
              <Bookmark size={12} />
              {frameCount > 0 && <span className="radar-btn-pill">{frameCount}</span>}
            </button>

            {/* Spatial Shortcuts Overlay Trigger */}
            <button
              className="radar-icon-btn"
              title="Spatial Shortcuts Reference (?)"
              aria-label="Spatial Shortcuts Overlay"
              onClick={() => setShowShortcuts(true)}
            >
              <HelpCircle size={12} />
            </button>

            {/* Expand / Collapse Dimension */}
            {!isMinimized && (
              <button
                className="radar-icon-btn"
                title={isExpanded ? 'Standard view' : 'Expand radar'}
                aria-label={isExpanded ? 'Standard view' : 'Expand radar'}
                onClick={() => setIsExpanded((prev) => !prev)}
              >
                {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
            )}

            {/* Minimize / Restore Toggle */}
            <button
              className="radar-icon-btn"
              title={isMinimized ? 'Expand Radar HUD (M)' : 'Minimize Radar HUD (M)'}
              aria-label={isMinimized ? 'Expand Radar HUD' : 'Minimize Radar HUD'}
              onClick={toggleMinimized}
            >
              {isMinimized ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>
        </div>

        {/* Radar Minimap Canvas */}
        {!isMinimized && (
          <div className="radar-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="minimap-map radar-canvas"
              data-testid="minimap-canvas"
              role="button"
              tabIndex={0}
              aria-label="Spatial canvas radar minimap. Click or drag to pan; drag handles to zoom; wheel to zoom."
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onLostPointerCapture={handlePointerUp}
              onWheel={handleWheel}
              onDoubleClick={handleDoubleClick}
              onKeyDown={(event) => {
                const delta = {
                  ArrowLeft: { x: 80, y: 0 },
                  ArrowRight: { x: -80, y: 0 },
                  ArrowUp: { x: 0, y: 80 },
                  ArrowDown: { x: 0, y: -80 },
                }[event.key]
                if (delta) {
                  event.preventDefault()
                  controller.panBy(delta)
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  controller.fit(contentBounds ?? unionBounds(items))
                }
              }}
            />

            {/* Telemetry Zoom HUD Pip */}
            <div className="radar-telemetry-badge" title="Current Zoom Scale">
              <span>{Math.round(telemetry.zoom * 100)}%</span>
            </div>
          </div>
        )}

        {/* Quick Zoom Stepper Bar at bottom */}
        {!isMinimized && (
          <div className="radar-footer-controls">
            <button
              className="radar-footer-btn"
              title="Zoom out"
              onClick={() => controller.zoomBy(1 / 1.25)}
            >
              <Minus size={11} />
            </button>
            <button
              className="radar-footer-btn radar-fit-btn"
              title="Fit all content"
              onClick={() => controller.fit(contentBounds ?? unionBounds(items))}
            >
              Fit
            </button>
            <button
              className="radar-footer-btn"
              title="Zoom to 100%"
              onClick={() => controller.zoomTo(1)}
            >
              100%
            </button>
            <button
              className="radar-footer-btn"
              title="Zoom in"
              onClick={() => controller.zoomBy(1.25)}
            >
              <Plus size={11} />
            </button>
          </div>
        )}

        {/* Frame Bookmark Jump List Drawer */}
        {showJumpList && (
          <FrameJumpList
            items={items}
            controller={controller}
            bookmarks={bookmarks}
            onAddBookmark={handleAddBookmark}
            onDeleteBookmark={handleDeleteBookmark}
            onSelectFrame={onSelectFrame}
            onClose={() => setShowJumpList(false)}
          />
        )}
      </div>

      {/* Spatial Shortcut Modal Overlay */}
      <SpatialShortcutOverlay
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        controller={controller}
        contentBounds={contentBounds ?? unionBounds(items)}
        onToggleMinimap={toggleMinimized}
        onOpenJumpList={() => {
          setIsMinimized(false)
          setShowJumpList(true)
        }}
      />
    </>
  )
}
