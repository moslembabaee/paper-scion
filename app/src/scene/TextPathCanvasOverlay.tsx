import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Point } from '../canvas/types'
import type { SelectionBox } from './selectionGeometry'
import type { SceneStore } from './store'
import type { TextElement } from './types'
import {
  copyContours,
  moveAnchor,
  moveHandle,
  parsePath,
  serializePath,
  setHandleType,
} from './pathGeometry'
import type { PathContour } from './pathGeometry'
import { resolveTextPathD } from './typography'
import { updateTextCurve } from './textPathEditing'
import { useScene } from './useScene'

interface TextPathCanvasOverlayProps {
  readonly node: TextElement
  readonly store: SceneStore
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number }
  readonly box: SelectionBox
}

interface HandleTarget {
  contour: number
  anchor: number
  kind: 'anchor' | 'in' | 'out'
}

interface DragGesture {
  pointerId: number
  target: HandleTarget
  contours: PathContour[]
  originLocal: Point
  initialPos: Point
}

export const TextPathCanvasOverlay = memo(function TextPathCanvasOverlay({
  node,
  store,
  camera,
  box,
}: TextPathCanvasOverlayProps) {
  const elements = useScene(store, s => s.elements)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gestureRef = useRef<DragGesture | null>(null)
  const [activeHandle, setActiveHandle] = useState<string | null>(null)
  const frameRef = useRef<number | null>(null)
  const pendingDRef = useRef<string | null>(null)

  const d = useMemo(() => {
    return resolveTextPathD(node, elements)
  }, [node, elements])

  const contours = useMemo(() => {
    try {
      return parsePath(d)
    } catch {
      return []
    }
  }, [d])

  // Cleanup on blur / unmount
  useEffect(() => {
    const handleCancel = () => {
      if (gestureRef.current) {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
        frameRef.current = null
        pendingDRef.current = null
        gestureRef.current = null
        setActiveHandle(null)
        store.cancelTransaction()
      }
    }
    window.addEventListener('blur', handleCancel)
    return () => {
      window.removeEventListener('blur', handleCancel)
      if (gestureRef.current) {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
        store.cancelTransaction()
      }
    }
  }, [store])

  if (!node.textOnPath?.enabled || contours.length === 0) return null

  const getLocalPoint = (e: ReactPointerEvent | PointerEvent): Point | null => {
    const svg = svgRef.current
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return { x: pt.x, y: pt.y }
  }

  const flushUpdate = () => {
    frameRef.current = null
    const nextD = pendingDRef.current
    pendingDRef.current = null
    if (nextD !== null) {
      updateTextCurve(store, node.id, nextD)
    }
  }

  const handlePointerDown = (
    e: ReactPointerEvent<SVGCircleElement | SVGRectElement>,
    target: HandleTarget
  ) => {
    if (e.button !== 0 || store.isLocked(node.id)) return
    e.preventDefault()
    e.stopPropagation()

    const origin = getLocalPoint(e)
    if (!origin) return

    const anchor = contours[target.contour]?.anchors[target.anchor]
    if (!anchor) return

    const initialPos =
      target.kind === 'anchor'
        ? { x: anchor.x, y: anchor.y }
        : target.kind === 'in'
        ? anchor.in ? { ...anchor.in } : { ...anchor }
        : anchor.out ? { ...anchor.out } : { ...anchor }

    gestureRef.current = {
      pointerId: e.pointerId,
      target,
      contours: copyContours(contours),
      originLocal: origin,
      initialPos,
    }
    setActiveHandle(`${target.contour}-${target.anchor}-${target.kind}`)

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Ignored if capture unsupported
    }

    store.beginTransaction('Warp text Bézier baseline')
  }

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current
    if (!gesture || e.pointerId !== gesture.pointerId) return
    e.preventDefault()
    e.stopPropagation()

    const currentLocal = getLocalPoint(e)
    if (!currentLocal) return

    const dx = currentLocal.x - gesture.originLocal.x
    const dy = currentLocal.y - gesture.originLocal.y

    const nextContours = copyContours(gesture.contours)
    const targetAnchor = nextContours[gesture.target.contour].anchors[gesture.target.anchor]
    const newPos = { x: gesture.initialPos.x + dx, y: gesture.initialPos.y + dy }

    if (gesture.target.kind === 'anchor') {
      nextContours[gesture.target.contour].anchors[gesture.target.anchor] = moveAnchor(
        targetAnchor,
        newPos
      )
    } else {
      nextContours[gesture.target.contour].anchors[gesture.target.anchor] = moveHandle(
        targetAnchor,
        gesture.target.kind,
        newPos,
        e.altKey
      )
    }

    pendingDRef.current = serializePath(nextContours)
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(flushUpdate)
    }
  }

  const handlePointerUp = (e: ReactPointerEvent<SVGSVGElement | SVGCircleElement | SVGRectElement>) => {
    const gesture = gestureRef.current
    if (!gesture || e.pointerId !== gesture.pointerId) return
    e.preventDefault()
    e.stopPropagation()

    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const nextD = pendingDRef.current
    pendingDRef.current = null
    if (nextD !== null) {
      updateTextCurve(store, node.id, nextD)
    }

    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Ignored
    }

    gestureRef.current = null
    setActiveHandle(null)
    store.endTransaction()
  }

  const handleAnchorDoubleClick = (
    e: React.MouseEvent<SVGRectElement>,
    contourIdx: number,
    anchorIdx: number
  ) => {
    e.stopPropagation()
    e.preventDefault()
    const nextContours = copyContours(contours)
    const contour = nextContours[contourIdx]
    const anchor = contour.anchors[anchorIdx]
    if (!anchor) return

    const hasHandles = Boolean(anchor.in || anchor.out)
    if (hasHandles) {
      // Convert to sharp corner
      contour.anchors[anchorIdx] = {
        x: anchor.x,
        y: anchor.y,
        handleType: 'disconnected',
      }
    } else {
      // Convert to smooth mirrored curve
      contour.anchors[anchorIdx] = setHandleType(contour, anchorIdx, 'mirrored')
    }

    const nextD = serializePath(nextContours)
    store.beginTransaction('Toggle baseline handle smoothing')
    updateTextCurve(store, node.id, nextD)
    store.endTransaction()
  }

  // Visual sizing inversely proportional to zoom so controls remain crisp
  const zoom = Math.max(0.1, camera.zoom)
  const knotSize = 7 / zoom
  const handleRadius = 3.5 / zoom
  const strokeWidth = 1.25 / zoom
  const guideWidth = 1 / zoom

  return (
    <div
      className="text-path-canvas-overlay"
      data-testid="text-path-canvas-overlay"
      style={{
        position: 'absolute',
        left: (box.x + box.width / 2) * zoom + camera.x,
        top: (box.y + box.height / 2) * zoom + camera.y,
        width: box.width * zoom,
        height: box.height * zoom,
        transform: `translate(-50%, -50%) rotate(${box.rotation ?? 0}deg)`,
        pointerEvents: 'none',
        zIndex: 42,
      }}
      aria-hidden="true"
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${node.width} ${node.height}`}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'auto',
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Glow backdrop for baseline curve */}
        <path
          d={d}
          fill="none"
          stroke="rgba(129, 173, 236, 0.25)"
          strokeWidth={strokeWidth * 3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />

        {/* Primary Baseline Vector Curve */}
        <path
          d={d}
          fill="none"
          stroke="#81adec"
          strokeWidth={strokeWidth}
          strokeDasharray={`${5 / zoom} ${3.5 / zoom}`}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />

        {/* Control Arms and Knots */}
        {contours.map((contour, cIdx) => (
          <g key={cIdx}>
            {contour.anchors.map((anchor, aIdx) => {
              const inHandleId = `${cIdx}-${aIdx}-in`
              const outHandleId = `${cIdx}-${aIdx}-out`
              const anchorHandleId = `${cIdx}-${aIdx}-anchor`

              return (
                <g key={aIdx}>
                  {/* IN handle tangent arm */}
                  {anchor.in && (
                    <>
                      <line
                        x1={anchor.x}
                        y1={anchor.y}
                        x2={anchor.in.x}
                        y2={anchor.in.y}
                        stroke="rgba(129, 173, 236, 0.55)"
                        strokeWidth={guideWidth}
                        pointerEvents="none"
                      />
                      <circle
                        cx={anchor.in.x}
                        cy={anchor.in.y}
                        r={handleRadius}
                        fill={activeHandle === inHandleId ? '#ffffff' : '#81adec'}
                        stroke="#080808"
                        strokeWidth={strokeWidth * 0.8}
                        style={{ cursor: 'crosshair' }}
                        onPointerDown={e =>
                          handlePointerDown(e, { contour: cIdx, anchor: aIdx, kind: 'in' })
                        }
                      >
                        <title>Drag IN Bézier control handle</title>
                      </circle>
                    </>
                  )}

                  {/* OUT handle tangent arm */}
                  {anchor.out && (
                    <>
                      <line
                        x1={anchor.x}
                        y1={anchor.y}
                        x2={anchor.out.x}
                        y2={anchor.out.y}
                        stroke="rgba(129, 173, 236, 0.55)"
                        strokeWidth={guideWidth}
                        pointerEvents="none"
                      />
                      <circle
                        cx={anchor.out.x}
                        cy={anchor.out.y}
                        r={handleRadius}
                        fill={activeHandle === outHandleId ? '#ffffff' : '#81adec'}
                        stroke="#080808"
                        strokeWidth={strokeWidth * 0.8}
                        style={{ cursor: 'crosshair' }}
                        onPointerDown={e =>
                          handlePointerDown(e, { contour: cIdx, anchor: aIdx, kind: 'out' })
                        }
                      >
                        <title>Drag OUT Bézier control handle</title>
                      </circle>
                    </>
                  )}

                  {/* Anchor Knot Vertex */}
                  <rect
                    x={anchor.x - knotSize / 2}
                    y={anchor.y - knotSize / 2}
                    width={knotSize}
                    height={knotSize}
                    rx={knotSize * 0.2}
                    fill={activeHandle === anchorHandleId ? '#81adec' : '#edebe1'}
                    stroke="#080808"
                    strokeWidth={strokeWidth}
                    style={{ cursor: 'move' }}
                    onPointerDown={e =>
                      handlePointerDown(e, { contour: cIdx, anchor: aIdx, kind: 'anchor' })
                    }
                    onDoubleClick={e => handleAnchorDoubleClick(e, cIdx, aIdx)}
                  >
                    <title>Drag to warp Bézier curve knot · Double-click to toggle smooth/corner</title>
                  </rect>
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </div>
  )
})
