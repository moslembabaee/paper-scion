import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { Point } from '../canvas/types'
import { copyContours, moveAnchor, moveHandle, parsePath, pathBounds, serializePath } from './pathGeometry'
import type { PathContour } from './pathGeometry'
import type { SceneStore } from './store'
import type { TextElement } from './types'
import { generatePathPreset } from './typography'
import { updateTextCurve } from './textPathEditing'
import { useScene } from './useScene'

interface Handle { contour: number; anchor: number; kind: 'anchor' | 'in' | 'out' }
interface Gesture {
  pointerId: number
  handle: Handle
  contours: PathContour[]
  origin: Point
  point: Point
  moved: boolean
}

/** Edit the actual vector's coordinates; canvas rendering handles its frame transforms. */
export function TextPathEditor({ store, node }: { store: SceneStore; node: TextElement }) {
  const linked = useScene(store, state => node.textOnPath?.pathId ? state.elements[node.textOnPath.pathId] : undefined)
  const source = linked?.type === 'path' ? linked : undefined
  const top = node.textOnPath
  const d = source?.d ?? (top?.preset === 'custom' && top.pathData?.trim()
    ? top.pathData : generatePathPreset(top?.preset ?? 'wave', node.width, node.height))
  const contours = useMemo(() => {
    try { return parsePath(d) } catch { return [] }
  }, [d])
  const bounds = useMemo(() => {
    const box = pathBounds(contours, 0)
    return pathBounds(contours, Math.max(box.width, box.height, 20) * .14)
  }, [contours])
  const [gestureBounds, setGestureBounds] = useState<typeof bounds | null>(null)
  const view = gestureBounds ?? bounds
  const unit = Math.max(view.width / 240, view.height / 144)
  const svg = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const frame = useRef<number | null>(null)
  const pending = useRef<string | null>(null)
  const gridId = useId()
  const locked = source ? store.isLocked(source.id) || !!source.boolean : store.isLocked(node.id)

  const write = (pathData: string) => updateTextCurve(store, node.id, pathData)
  const flush = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    const next = pending.current
    pending.current = null
    if (next !== null) write(next)
  }
  const finish = (cancel: boolean) => {
    if (!gesture.current) return
    if (cancel) {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      pending.current = null
    } else flush()
    gesture.current = null
    if (cancel) store.cancelTransaction()
    else store.endTransaction()
    setGestureBounds(null)
  }
  useEffect(() => {
    const cancel = () => {
      if (!gesture.current) return
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      pending.current = null
      gesture.current = null
      store.cancelTransaction()
      setGestureBounds(null)
    }
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('blur', cancel); cancel() }
  }, [store])

  const pointAt = (event: PointerEvent): Point | null => {
    const matrix = svg.current?.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y }
  }
  const edit = (base: PathContour[], handle: Handle, point: Point, independent = false) => {
    const next = copyContours(base)
    const anchor = next[handle.contour].anchors[handle.anchor]
    next[handle.contour].anchors[handle.anchor] = handle.kind === 'anchor'
      ? moveAnchor(anchor, point) : moveHandle(anchor, handle.kind, point, independent)
    return serializePath(next)
  }
  const start = (event: PointerEvent<SVGCircleElement>, handle: Handle) => {
    if (locked || event.button !== 0 || store.getHistorySnapshot().active) return
    const origin = pointAt(event)
    if (!origin) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    const anchor = contours[handle.contour].anchors[handle.anchor]
    gesture.current = {
      pointerId: event.pointerId, handle, contours, origin,
      point: handle.kind === 'anchor' ? anchor : anchor[handle.kind]!, moved: false,
    }
    setGestureBounds(bounds)
    svg.current?.setPointerCapture(event.pointerId)
    store.beginTransaction(source ? 'Deform linked text path' : 'Deform text curve')
  }
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const active = gesture.current
    if (!active || event.pointerId !== active.pointerId) return
    const point = pointAt(event)
    if (!point) return
    const dx = point.x - active.origin.x, dy = point.y - active.origin.y
    if (!active.moved && Math.hypot(dx, dy) < unit * 2) return
    active.moved = true
    pending.current = edit(active.contours, active.handle, { x: active.point.x + dx, y: active.point.y + dy }, event.altKey)
    // Pointer events can arrive faster than a display frame; publish at most once per frame.
    if (frame.current === null) frame.current = requestAnimationFrame(flush)
  }
  const keyDown = (event: KeyboardEvent<SVGCircleElement>, handle: Handle) => {
    if (event.key === 'Escape') { event.stopPropagation(); finish(true); return }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (!delta || locked || store.getHistorySnapshot().active) return
    event.preventDefault()
    event.stopPropagation()
    const anchor = contours[handle.contour].anchors[handle.anchor]
    const point = handle.kind === 'anchor' ? anchor : anchor[handle.kind]!
    const step = event.shiftKey ? 10 : 1
    write(edit(contours, handle, { x: point.x + delta[0] * step, y: point.y + delta[1] * step }, event.altKey))
  }
  const handle = (point: Point, selection: Handle, label: string) => <circle
    key={selection.kind}
    className={`text-curve-handle is-${selection.kind}`}
    cx={point.x} cy={point.y} r={unit * (selection.kind === 'anchor' ? 4 : 3.5)}
    role="button" tabIndex={locked ? -1 : 0} aria-disabled={locked} aria-label={label}
    onPointerDown={event => start(event, selection)} onKeyDown={event => keyDown(event, selection)}
  ><title>{label} · Drag or use arrow keys · Shift for 10 units · Alt for independent handles</title></circle>

  return <div className="text-curve-editor">
    <div className="text-curve-heading"><span>LIVE CURVE</span><span>{source ? 'LINKED VECTOR' : 'LOCAL CURVE'}</span></div>
    <svg ref={svg} className="text-curve-preview" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      aria-label="Interactive text curve editor" onPointerMove={move}
      onPointerUp={event => { if (event.pointerId === gesture.current?.pointerId) finish(false) }}
      onPointerCancel={event => { if (event.pointerId === gesture.current?.pointerId) finish(true) }}
      onLostPointerCapture={event => { if (event.pointerId === gesture.current?.pointerId) finish(true) }}>
      <defs><pattern id={gridId} width="120" height="120" patternUnits="userSpaceOnUse"><path d="M 120 0 H 0 V 120" fill="none" stroke="currentColor" strokeWidth={unit * .5} /></pattern></defs>
      <rect x={view.x} y={view.y} width={view.width} height={view.height} fill={`url(#${gridId})`} className="text-curve-grid" />
      <path d={contours.length ? d : ''} className="text-curve-baseline" fill="none" vectorEffect="non-scaling-stroke" />
      {contours.map((contour, ci) => <g key={ci}>{contour.anchors.map((anchor, ai) => <g key={ai}>
        {(['in', 'out'] as const).map(kind => anchor[kind] && <path key={kind} className="text-curve-tangent" d={`M ${anchor.x} ${anchor.y} L ${anchor[kind].x} ${anchor[kind].y}`} vectorEffect="non-scaling-stroke" />)}
        {(['in', 'out'] as const).map(kind => anchor[kind] && handle(anchor[kind], { contour: ci, anchor: ai, kind }, `Curve ${ci + 1} anchor ${ai + 1} ${kind} handle`))}
        {handle(anchor, { contour: ci, anchor: ai, kind: 'anchor' }, `Curve ${ci + 1} anchor ${ai + 1}`)}
      </g>)}</g>)}
    </svg>
    <p className="typo-hint">{locked ? 'Unlock or flatten the linked vector to edit its curve.' : 'Drag anchors or handles. Arrow keys nudge · Shift ×10 · Esc cancels.'}</p>
  </div>
}
