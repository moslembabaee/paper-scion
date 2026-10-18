import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Pipette, RotateCcw, X } from 'lucide-react'
import type { ViewportController } from '../canvas'
import { getWorldMatrix } from '../scene/geometry'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import { freezeShader } from './catalog'
import { clampUnit, evaluateGridMesh, gridVertexPosition, interpolateMeshColor, meshToSurface, surfaceToMesh } from './mesh'
import { MeshAnchorHandle } from './MeshAnchorHandle'
import {
  setMeshActiveAnchor,
  setMeshActiveGridVertex,
  setMeshPlacementMode,
  useMeshActiveAnchor,
  useMeshActiveGridVertex,
  useMeshPlacementMode,
} from './meshState'
import type { MeshAnchor, MeshGridVertex } from './types'

function MeshGridCanvasVertex({
  index,
  row,
  col,
  vertex,
  selected,
  position,
  onSelect,
  onColorChange,
  onTangentChange,
  onSampleField,
}: {
  index: number
  row: number
  col: number
  vertex: MeshGridVertex
  selected: boolean
  position: { x: number; y: number }
  onSelect: () => void
  onColorChange: (color: string) => void
  onTangentChange: (tx: number, ty: number) => void
  onSampleField: () => void
}) {
  const [showPopover, setShowPopover] = useState(true)
  const [hexInput, setHexInput] = useState(vertex.color.toUpperCase())
  const colorInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origTx: number; origTy: number } | null>(null)

  useEffect(() => {
    setHexInput(vertex.color.toUpperCase())
  }, [vertex.color])

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onSelect()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origTx: vertex.tx,
      origTy: vertex.ty,
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.stopPropagation()
    const dx = (e.clientX - drag.startX) / 80
    const dy = (e.clientY - drag.startY) / 80
    const nextTx = Math.max(-1, Math.min(1, drag.origTx + dx))
    const nextTy = Math.max(-1, Math.min(1, drag.origTy + dy))
    onTangentChange(nextTx, nextTy)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    }
  }

  return (
    <div
      className="mesh-anchor-container viewport-ui"
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        zIndex: selected ? 20 : 2,
      }}
    >
      <button
        type="button"
        className={`mesh-anchor ${selected ? 'selected' : ''}`}
        style={{ background: vertex.color }}
        aria-pressed={selected}
        aria-label={`Grid vertex ${row + 1},${col + 1}`}
        title={`Grid Vertex ${row + 1},${col + 1} (${vertex.color}) · Click to select, drag to adjust tangent, double-click to pick color`}
        onClick={e => { e.stopPropagation(); onSelect() }}
        onDoubleClick={e => { e.stopPropagation(); colorInputRef.current?.click() }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <span>{index + 1}</span>
      </button>

      <input
        ref={colorInputRef}
        type="color"
        value={vertex.color.slice(0, 7)}
        style={{ display: 'none' }}
        aria-label={`Pick color for grid vertex ${row + 1},${col + 1}`}
        onChange={e => onColorChange(e.currentTarget.value + vertex.color.slice(7))}
      />

      {selected && showPopover && (
        <div
          className="mesh-handle-popover viewport-ui"
          role="dialog"
          aria-label={`Grid vertex ${row + 1},${col + 1} controls`}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className="mesh-handle-popover-header">
            <span className="mesh-handle-popover-title">
              V{row + 1},{col + 1}
            </span>
            <div className="mesh-handle-popover-color-row">
              <label className="mesh-popover-swatch" style={{ background: vertex.color }} title="Click to pick color">
                <input
                  type="color"
                  value={vertex.color.slice(0, 7)}
                  aria-label={`Color for grid vertex ${row + 1},${col + 1}`}
                  onChange={e => onColorChange(e.currentTarget.value + vertex.color.slice(7))}
                />
              </label>
              <input
                className="mesh-popover-hex"
                value={hexInput}
                spellCheck={false}
                maxLength={9}
                aria-label={`Hex color for grid vertex ${row + 1},${col + 1}`}
                onChange={e => setHexInput(e.currentTarget.value.toUpperCase())}
                onBlur={e => {
                  const hex = e.currentTarget.value.trim()
                  if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(hex)) {
                    onColorChange(hex)
                  } else {
                    setHexInput(vertex.color.toUpperCase())
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setShowPopover(false)
                }}
              />
            </div>
            <button
              type="button"
              className="mesh-popover-sample"
              title="Sample surrounding bicubic field at this vertex"
              aria-label={`Sample field color for grid vertex ${row + 1},${col + 1}`}
              onClick={onSampleField}
            >
              <Pipette size={11} />
            </button>
            <button
              type="button"
              className="mesh-popover-sample"
              title="Reset tangent handles to zero"
              aria-label="Reset tangent"
              onClick={() => onTangentChange(0, 0)}
            >
              <RotateCcw size={11} />
            </button>
            <button
              type="button"
              className="mesh-popover-close"
              title="Dismiss popover"
              aria-label="Close vertex popover"
              onClick={() => setShowPopover(false)}
            >
              <X size={11} />
            </button>
          </div>

          <div className="mesh-handle-popover-radius">
            <span>TX</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={vertex.tx}
              aria-label={`Tangent X for vertex ${row + 1},${col + 1}`}
              onChange={e => onTangentChange(parseFloat(e.currentTarget.value), vertex.ty)}
            />
            <output>{vertex.tx > 0 ? `+${vertex.tx.toFixed(2)}` : vertex.tx.toFixed(2)}</output>
          </div>
          <div className="mesh-handle-popover-radius">
            <span>TY</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={vertex.ty}
              aria-label={`Tangent Y for vertex ${row + 1},${col + 1}`}
              onChange={e => onTangentChange(vertex.tx, parseFloat(e.currentTarget.value))}
            />
            <output>{vertex.ty > 0 ? `+${vertex.ty.toFixed(2)}` : vertex.ty.toFixed(2)}</output>
          </div>
        </div>
      )}
    </div>
  )
}

export function MeshCanvasOverlay({ store, controller }: { store: SceneStore; controller: ViewportController }) {
  const state = useScene(store, value => value)
  const [viewport, setViewport] = useState(() => controller.getSnapshot())
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 })
  const host = useRef<HTMLDivElement>(null)
  const ownsGesture = useRef(false)
  const ownsRadiusGesture = useRef(false)
  const activeAnchor = useMeshActiveAnchor()
  const activeGridVertex = useMeshActiveGridVertex()
  const placementMode = useMeshPlacementMode()

  useLayoutEffect(() => controller.subscribe(setViewport), [controller])
  const node = state.selection.length === 1 ? state.elements[state.selection[0]] : undefined
  const paint = node ? node.style.shader : state.selection.length === 0 ? state.backgroundShader : null
  const enabled = paint?.kind === 'mesh-gradient' && !!paint.mesh && (!node || (!store.isLocked(node.id) && store.isVisible(node.id)))

  // The material excludes the rulers; controller.size includes them.
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const resize = () => setSurfaceSize({ width: element.clientWidth, height: element.clientHeight })
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled])

  const finish = useCallback((cancel: boolean) => {
    if (!ownsGesture.current) return
    ownsGesture.current = false
    if (cancel) store.cancelTransaction()
    else store.endTransaction()
  }, [store])

  useLayoutEffect(() => () => finish(true), [finish])

  // Cancel placement mode on Escape
  useEffect(() => {
    if (!placementMode) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMeshPlacementMode(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [placementMode])

  if (!enabled || paint?.kind !== 'mesh-gradient' || !paint.mesh) return null
  const mesh = paint.mesh
  const grid = mesh.grid
  const matrix = node ? getWorldMatrix(state, node.id) : null
  const { camera } = viewport

  const toScreen = (point: { x: number; y: number }) => {
    const p = meshToSurface(point, paint)
    if (!node || !matrix) return { x: p.x * surfaceSize.width, y: p.y * surfaceSize.height }
    const [a, b, c, d, e, f] = matrix
    const x = p.x * node.width, y = p.y * node.height
    return { x: (a * x + c * y + e) * camera.zoom + camera.x, y: (b * x + d * y + f) * camera.zoom + camera.y }
  }

  const screenToMeshCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const rect = host.current?.getBoundingClientRect()
    if (!rect) return null
    const point = { x: clientX - rect.left, y: clientY - rect.top }
    if (!node || !matrix) {
      return surfaceToMesh({ x: point.x / Math.max(1, rect.width), y: point.y / Math.max(1, rect.height) }, paint)
    }
    const world = controller.screenToWorld(point)
    const [a, b, c, d, e, f] = matrix
    const det = a * d - b * c
    if (Math.abs(det) < 1e-6) return null
    const x = world.x - e
    const y = world.y - f
    const surfaceX = (d * x - c * y) / det / Math.max(0.001, node.width)
    const surfaceY = (a * y - b * x) / det / Math.max(0.001, node.height)
    return surfaceToMesh({ x: surfaceX, y: surfaceY }, paint)
  }

  const addVertexAtPoint = (clientX: number, clientY: number) => {
    const currentNode = node ? store.getSnapshot().elements[node.id] : undefined
    const current = node ? currentNode?.style.shader : store.getSnapshot().backgroundShader
    if (current?.kind !== 'mesh-gradient' || !current.mesh || current.mesh.anchors.length >= 10) return
    const meshPoint = screenToMeshCoords(clientX, clientY)
    if (!meshPoint) return
    const sampledColor = interpolateMeshColor(current.mesh.anchors, current.params.colors, meshPoint)
    const newAnchor: MeshAnchor = { x: clampUnit(meshPoint.x), y: clampUnit(meshPoint.y), radius: 0.65 }
    store.beginTransaction('Add mesh anchor')
    const nextColors = [...current.params.colors, sampledColor]
    const nextAnchors = [...current.mesh.anchors, newAnchor]
    const next = freezeShader({
      ...current,
      params: { ...current.params, colors: nextColors },
      mesh: { ...current.mesh, anchors: nextAnchors },
    })
    if (currentNode) store.update(currentNode.id, currentNode.type, { style: { shader: next } })
    else store.setBackgroundShader(next)
    store.endTransaction()
    setMeshActiveAnchor(nextAnchors.length - 1)
    setMeshPlacementMode(false)
  }

  const handleColorChange = (index: number, color: string) => {
    const currentNode = node ? store.getSnapshot().elements[node.id] : undefined
    const current = node ? currentNode?.style.shader : store.getSnapshot().backgroundShader
    if (current?.kind !== 'mesh-gradient' || !current.mesh) return
    store.beginTransaction('Change mesh stop color')
    const nextColors = current.params.colors.map((c, i) => i === index ? color : c)
    const next = freezeShader({
      ...current,
      params: { ...current.params, colors: nextColors },
    })
    if (currentNode) store.update(currentNode.id, currentNode.type, { style: { shader: next } })
    else store.setBackgroundShader(next)
    store.endTransaction()
  }

  const handleGridColorChange = (index: number, color: string) => {
    const currentNode = node ? store.getSnapshot().elements[node.id] : undefined
    const current = node ? currentNode?.style.shader : store.getSnapshot().backgroundShader
    if (current?.kind !== 'mesh-gradient' || !current.mesh?.grid) return
    store.beginTransaction('Change grid vertex color')
    const vertices = current.mesh.grid.vertices.map((v, i) => i === index ? { ...v, color } : v)
    const next = freezeShader({
      ...current,
      mesh: {
        ...current.mesh,
        grid: { ...current.mesh.grid, vertices },
      },
    })
    if (currentNode) store.update(currentNode.id, currentNode.type, { style: { shader: next } })
    else store.setBackgroundShader(next)
    store.endTransaction()
  }

  const handleGridTangentChange = (index: number, tx: number, ty: number) => {
    const currentNode = node ? store.getSnapshot().elements[node.id] : undefined
    const current = node ? currentNode?.style.shader : store.getSnapshot().backgroundShader
    if (current?.kind !== 'mesh-gradient' || !current.mesh?.grid) return
    if (!ownsGesture.current) {
      ownsGesture.current = true
      store.beginTransaction('Adjust grid vertex tangent')
    }
    const vertices = current.mesh.grid.vertices.map((v, i) =>
      i === index ? { ...v, tx: Math.max(-1, Math.min(1, tx)), ty: Math.max(-1, Math.min(1, ty)) } : v
    )
    const next = freezeShader({
      ...current,
      mesh: {
        ...current.mesh,
        grid: { ...current.mesh.grid, vertices },
      },
    })
    if (currentNode) store.update(currentNode.id, currentNode.type, { style: { shader: next } })
    else store.setBackgroundShader(next)
  }

  const handleGridSampleField = (index: number) => {
    const currentNode = node ? store.getSnapshot().elements[node.id] : undefined
    const current = node ? currentNode?.style.shader : store.getSnapshot().backgroundShader
    if (current?.kind !== 'mesh-gradient' || !current.mesh?.grid) return
    const { rows, cols } = current.mesh.grid
    const r = Math.floor(index / cols)
    const c = index % cols
    const pos = gridVertexPosition(r, c, rows, cols)
    const sampled = evaluateGridMesh(current.mesh.grid, pos.x, pos.y)
    handleGridColorChange(index, sampled)
  }

  const handleRadiusStart = () => {
    if (store.getHistorySnapshot().active) return
    ownsRadiusGesture.current = true
    store.beginTransaction('Change mesh anchor radius')
  }

  const handleRadiusEnd = () => {
    if (ownsRadiusGesture.current) {
      ownsRadiusGesture.current = false
      store.endTransaction()
    }
  }

  const handleRadiusChange = (index: number, radius: number) => {
    const currentNode = node ? store.getSnapshot().elements[node.id] : undefined
    const current = node ? currentNode?.style.shader : store.getSnapshot().backgroundShader
    if (current?.kind !== 'mesh-gradient' || !current.mesh) return
    const nextAnchors = current.mesh.anchors.map((a, i) => i === index ? { ...a, radius: Math.max(0.1, Math.min(2.0, radius)) } : a)
    const next = freezeShader({
      ...current,
      mesh: { ...current.mesh, anchors: nextAnchors },
    })
    if (currentNode) store.update(currentNode.id, currentNode.type, { style: { shader: next } })
    else store.setBackgroundShader(next)
  }

  const handleDelete = (index: number) => {
    const currentNode = node ? store.getSnapshot().elements[node.id] : undefined
    const current = node ? currentNode?.style.shader : store.getSnapshot().backgroundShader
    if (current?.kind !== 'mesh-gradient' || !current.mesh || current.mesh.anchors.length <= 2) return
    store.beginTransaction('Delete mesh stop')
    const nextColors = current.params.colors.filter((_, i) => i !== index)
    const nextAnchors = current.mesh.anchors.filter((_, i) => i !== index)
    const next = freezeShader({
      ...current,
      params: { ...current.params, colors: nextColors },
      mesh: { ...current.mesh, anchors: nextAnchors },
    })
    if (currentNode) store.update(currentNode.id, currentNode.type, { style: { shader: next } })
    else store.setBackgroundShader(next)
    store.endTransaction()
    setMeshActiveAnchor(Math.max(0, index - 1))
  }

  const handleSampleField = (index: number) => {
    const currentNode = node ? store.getSnapshot().elements[node.id] : undefined
    const current = node ? currentNode?.style.shader : store.getSnapshot().backgroundShader
    if (current?.kind !== 'mesh-gradient' || !current.mesh) return
    const targetAnchor = current.mesh.anchors[index]
    if (!targetAnchor) return
    const others = current.mesh.anchors.filter((_, i) => i !== index)
    const otherColors = current.params.colors.filter((_, i) => i !== index)
    const interp = current.mesh.interpolation ?? 'bicubic'
    const sampled = interpolateMeshColor(others, otherColors, targetAnchor, interp)
    handleColorChange(index, sampled)
  }

  const active = Math.min(activeAnchor, mesh.anchors.length - 1)
  const activeG = grid ? Math.min(activeGridVertex, grid.vertices.length - 1) : 0
  const activeGridV = grid?.vertices[activeG]

  return (
    <div
      ref={host}
      className="mesh-canvas-overlay"
      data-testid="mesh-canvas-overlay"
      data-placement-mode={placementMode ? 'true' : undefined}
      aria-label="Canvas mesh anchors"
      onClick={e => {
        if (!placementMode) return
        if ((e.target as Element).closest('.mesh-anchor-container, .mesh-handle-popover, .mesh-anchor, .mesh-placement-banner')) return
        e.preventDefault()
        e.stopPropagation()
        addVertexAtPoint(e.clientX, e.clientY)
      }}
      onDoubleClick={e => {
        if (placementMode || grid) return
        if ((e.target as Element).closest('.mesh-anchor-container, .mesh-handle-popover, .mesh-anchor, .mesh-placement-banner')) return
        addVertexAtPoint(e.clientX, e.clientY)
      }}
    >
      {placementMode && !grid && (
        <div className="mesh-placement-banner viewport-ui" role="status">
          <span className="mesh-placement-dot" />
          <span>Click anywhere to place mesh vertex · Double-click on canvas also adds stop</span>
          <button
            type="button"
            aria-label="Cancel vertex placement"
            onClick={() => setMeshPlacementMode(false)}
          >
            <X size={12} />
            <span>Cancel <kbd>Esc</kbd></span>
          </button>
        </div>
      )}

      {/* Grid Mesh Topology Rendering */}
      {grid && (
        <>
          <svg className="mesh-canvas-grid-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {/* Grid lines */}
            {Array.from({ length: grid.rows }, (_, r) =>
              Array.from({ length: grid.cols - 1 }, (_, c) => {
                const p1 = toScreen(gridVertexPosition(r, c, grid.rows, grid.cols))
                const p2 = toScreen(gridVertexPosition(r, c + 1, grid.rows, grid.cols))
                return <line key={`gh-${r}-${c}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#81adec" strokeOpacity="0.45" strokeWidth="1.5" />
              })
            )}
            {Array.from({ length: grid.cols }, (_, c) =>
              Array.from({ length: grid.rows - 1 }, (_, r) => {
                const p1 = toScreen(gridVertexPosition(r, c, grid.rows, grid.cols))
                const p2 = toScreen(gridVertexPosition(r + 1, c, grid.rows, grid.cols))
                return <line key={`gv-${r}-${c}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#81adec" strokeOpacity="0.45" strokeWidth="1.5" />
              })
            )}
            {/* Active grid vertex tangent handle stick */}
            {activeGridV && (() => {
              const r = Math.floor(activeG / grid.cols)
              const c = activeG % grid.cols
              const pos = toScreen(gridVertexPosition(r, c, grid.rows, grid.cols))
              const tEnd = toScreen({
                x: gridVertexPosition(r, c, grid.rows, grid.cols).x + activeGridV.tx * 0.12,
                y: gridVertexPosition(r, c, grid.rows, grid.cols).y + activeGridV.ty * 0.12,
              })
              return (
                <g key={`tangent-${activeG}`}>
                  <line x1={pos.x} y1={pos.y} x2={tEnd.x} y2={tEnd.y} stroke="#81adec" strokeWidth="2" strokeDasharray="4 3" />
                  <circle cx={tEnd.x} cy={tEnd.y} r="5" fill="#81adec" stroke="#080808" strokeWidth="1.5" />
                </g>
              )
            })()}
          </svg>

          {/* Grid Vertex Handles */}
          {grid.vertices.map((vertex, index) => {
            const r = Math.floor(index / grid.cols)
            const c = index % grid.cols
            const pos = toScreen(gridVertexPosition(r, c, grid.rows, grid.cols))
            return (
              <MeshGridCanvasVertex
                key={`grid-v-${index}`}
                index={index}
                row={r}
                col={c}
                vertex={vertex}
                selected={index === activeG}
                position={pos}
                onSelect={() => setMeshActiveGridVertex(index)}
                onColorChange={color => handleGridColorChange(index, color)}
                onTangentChange={(tx, ty) => {
                  handleGridTangentChange(index, tx, ty)
                  finish(false)
                }}
                onSampleField={() => handleGridSampleField(index)}
              />
            )
          })}
        </>
      )}

      {/* Freeform Mesh Anchors Rendering */}
      {!grid && mesh.anchors.map((anchor, index) => {
        const position = toScreen(anchor)
        return (
          <MeshAnchorHandle
            key={`${node?.id ?? 'background'}-${index}`}
            index={index}
            selected={index === active}
            color={paint.params.colors[index]}
            anchor={anchor}
            style={{ left: position.x, top: position.y }}
            showCanvasControls={true}
            onSelect={idx => setMeshActiveAnchor(idx)}
            onColorChange={color => handleColorChange(index, color)}
            onRadiusChange={radius => handleRadiusChange(index, radius)}
            onRadiusStart={handleRadiusStart}
            onRadiusEnd={handleRadiusEnd}
            onDelete={mesh.anchors.length > 2 ? () => handleDelete(index) : undefined}
            onSampleField={() => handleSampleField(index)}
            project={(clientX, clientY) => {
              const rect = host.current!.getBoundingClientRect()
              const point = { x: clientX - rect.left, y: clientY - rect.top }
              if (!node || !matrix) return surfaceToMesh({ x: point.x / Math.max(1, rect.width), y: point.y / Math.max(1, rect.height) }, paint)
              const world = controller.screenToWorld(point)
              const [a, b, c, d, e, f] = matrix, det = a * d - b * c
              const x = world.x - e, y = world.y - f
              return surfaceToMesh({ x: (d * x - c * y) / det / Math.max(0.001, node.width), y: (a * y - b * x) / det / Math.max(0.001, node.height) }, paint)
            }}
            onStart={() => {
              if (store.getHistorySnapshot().active) return false
              ownsGesture.current = true
              store.beginTransaction('Move mesh anchor')
            }}
            onEnd={finish}
            onMove={point => {
              const currentNode = node ? store.getSnapshot().elements[node.id] : undefined
              const current = node ? currentNode?.style.shader : store.getSnapshot().backgroundShader
              if (current?.kind !== 'mesh-gradient' || !current.mesh || (node && (!currentNode || store.isLocked(node.id) || !store.isVisible(node.id)))) return
              const next = freezeShader({
                ...current,
                mesh: {
                  ...current.mesh,
                  anchors: current.mesh.anchors.map((value, i) => i === index ? { ...value, ...point } : value),
                },
              })
              if (currentNode) store.update(currentNode.id, currentNode.type, { style: { shader: next } })
              else store.setBackgroundShader(next)
            }}
          />
        )
      })}
    </div>
  )
}
