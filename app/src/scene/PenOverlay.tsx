import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ViewportController } from '../canvas/ViewportController'
import type { Point } from '../canvas/types'
import { getWorldMatrix } from './geometry'
import { bendSegment, canJoinSelection, canSplitAnchor, convertSegmentCurveMode, copyContours, evaluateSegmentCurvature, insertPathAnchor, isSmoothNode, joinPathAnchors, moveAnchor, moveHandle, moveQuadApex, nearestPathSegment, parsePath, pathBounds, reversePathContour, roundPathContours, segmentPoint, serializePath, setHandleType, snapPathPoint, snapToGrid, splitContoursAtSelection, toggleNodeCornerSmooth } from './pathGeometry'
import type { AnchorSelection, CurveMode, PathAnchor, PathContour } from './pathGeometry'
import { PathNodeInspector } from './PathNodeInspector'
import type { NodeAction } from './PathNodeInspector'
import { sceneVertexIndex, VertexIndex } from './vertexSnapping'
import type { SnapVertex } from './vertexSnapping'
import { PathDraftHistory } from './pathDraftHistory'
import { getPixelSnap, subscribePixelSnap, togglePixelSnap } from './pixelSnap'
import { getSnapConfig } from './snapConfig'
import type { SceneStore } from './store'
import { vectorToContours } from './booleanGeometry'
import type { PathElement, VectorElement } from './types'
import { useScene } from './useScene'
import './pen.css'

interface Session { contours: PathContour[]; id: string | null; parentId: string | null }
interface Gesture {
  pointerId: number
  contour: number
  anchor: number
  handle?: 'in' | 'out' | 'quadApex'
  start: Point
  original: PathAnchor
  moved: boolean
  creating: boolean
  bending?: boolean
  segment?: number
  t?: number
  originalA?: PathAnchor
  originalB?: PathAnchor
  mode?: CurveMode
  closing?: boolean
}
interface Props { store: SceneStore; controller: ViewportController; editingId: string | null; operandId?: string | null; penMode: boolean; onFinish: () => void }
const mapPoint = (matrix: readonly number[], p: Point): Point => ({ x: matrix[0] * p.x + matrix[2] * p.y + matrix[4], y: matrix[1] * p.x + matrix[3] * p.y + matrix[5] })
const inversePoint = (matrix: readonly number[], p: Point): Point => {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2], x = p.x - matrix[4], y = p.y - matrix[5]
  return { x: (matrix[3] * x - matrix[2] * y) / determinant, y: (-matrix[1] * x + matrix[0] * y) / determinant }
}

function operandLocalToWorld(operand: VectorElement, p: Point, parentMatrix: readonly number[] | null): Point {
  const normX = (operand.type === 'path' ? (p.x - operand.viewBox[0]) * operand.width / operand.viewBox[2] : p.x) - operand.width / 2
  const normY = (operand.type === 'path' ? (p.y - operand.viewBox[1]) * operand.height / operand.viewBox[3] : p.y) - operand.height / 2
  const rad = operand.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad)
  const parentX = operand.x + operand.width / 2 + cos * normX - sin * normY
  const parentY = operand.y + operand.height / 2 + sin * normX + cos * normY
  return parentMatrix ? mapPoint(parentMatrix, { x: parentX, y: parentY }) : { x: parentX, y: parentY }
}

function worldToOperandLocal(operand: VectorElement, world: Point, parentMatrix: readonly number[] | null): Point {
  const parentPoint = parentMatrix ? inversePoint(parentMatrix, world) : world
  const dx = parentPoint.x - (operand.x + operand.width / 2)
  const dy = parentPoint.y - (operand.y + operand.height / 2)
  const rad = -operand.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad)
  const normX = cos * dx - sin * dy
  const normY = sin * dx + cos * dy
  if (operand.type === 'path') {
    return {
      x: (normX + operand.width / 2) / operand.width * operand.viewBox[2] + operand.viewBox[0],
      y: (normY + operand.height / 2) / operand.height * operand.viewBox[3] + operand.viewBox[1],
    }
  }
  return {
    x: normX + operand.width / 2,
    y: normY + operand.height / 2,
  }
}

function CombineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="8" height="8" x="2" y="2" rx="2" />
      <path d="M14 2c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2" />
      <path d="M20 2c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2" />
      <rect width="8" height="8" x="14" y="14" rx="2" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

/** Draft geometry is transient. Pointer updates are coalesced to one animation frame. */
export function PenOverlay({ store, controller, editingId, operandId, penMode, onFinish }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [initial] = useState(() => {
    const node = editingId ? store.getSnapshot().elements[editingId] : undefined
    const session: Session = { contours: [], id: null, parentId: null }
    if (node?.type !== 'path' || store.isLocked(node.id) || !store.isVisible(node.id)) return { session, error: '' }
    if (operandId && node.boolean) {
      const operand = store.getCompoundOperand(node.id, operandId)
      if (operand) {
        try {
          return {
            session: {
              contours: vectorToContours(operand),
              id: node.id,
              parentId: node.parentId,
            },
            error: '',
          }
        } catch (error) {
          return { session, error: (error as Error).message }
        }
      }
    }
    try { return { session: { contours: node.nodes ? copyContours(node.nodes) : parsePath(node.d), id: node.id, parentId: node.parentId }, error: '' } }
    catch (error) { return { session, error: (error as Error).message } }
  })
  const [session, setSession] = useState(initial.session)
  const sessionRef = useRef<Session>(initial.session)
  const geometryRevision = useRef(0)
  const finishRef = useRef<() => void>(() => {})
  const draftHistory = useRef(new PathDraftHistory())
  const [draftHistoryState, setDraftHistoryState] = useState({ canUndo: false, canRedo: false })
  const draftUndoRef = useRef<(redo?: boolean) => void>(() => {})
  const callbackRef = useRef(onFinish)
  useLayoutEffect(() => { callbackRef.current = onFinish }, [onFinish])
  const [hover, setHover] = useState<Point | null>(null)
  const [hoverSegment, setHoverSegment] = useState<{ contour: number; segment: number; t: number; point: Point; curvature?: { radius: number; curvature: number } } | null>(null)
  const [curveMode, setCurveMode] = useState<CurveMode>('cubic')
  const [isBending, setIsBending] = useState(false)
  const [selected, setSelected] = useState<AnchorSelection[]>([])
  const selectedRef = useRef(selected)
  const editRef = useRef<(action: NodeAction, value?: number) => void>(() => {})
  const [vertexSnap, setVertexSnap] = useState(true)
  const vertexSnapRef = useRef(vertexSnap)
  useLayoutEffect(() => { vertexSnapRef.current = vertexSnap }, [vertexSnap])
  const [snapTarget, setSnapTarget] = useState<SnapVertex | null>(null)
  const [snapping, setSnapping] = useState(getPixelSnap)
  const snappingRef = useRef(snapping)
  useLayoutEffect(() => { snappingRef.current = snapping }, [snapping])
  const [gridSnap, setGridSnap] = useState(() => getSnapConfig().snapToGrid)
  const gridSnapRef = useRef(gridSnap)
  useLayoutEffect(() => { gridSnapRef.current = gridSnap }, [gridSnap])
  useEffect(() => subscribePixelSnap(setSnapping), [])
  const [error, setError] = useState(initial.error)
  const redraw = () => {
    geometryRevision.current++
    const session = sessionRef.current
    setSession({ ...session, contours: copyContours(session.contours) })
    const { canUndo, canRedo } = draftHistory.current
    setDraftHistoryState(previous => previous.canUndo === canUndo && previous.canRedo === canRedo ? previous : { canUndo, canRedo })
  }
  const state = useScene(store, value => value)
  const [camera, setCamera] = useState(() => controller.getSnapshot().camera)
  const node = session.id ? state.elements[session.id] as PathElement | undefined : undefined
  const operand = operandId && node?.type === 'path' && node.boolean ? store.getCompoundOperand(node.id, operandId) : null
  const parentMatrix = node ? (node.parentId ? getWorldMatrix(state, node.parentId) : null) : (session.parentId && state.elements[session.parentId] ? getWorldMatrix(state, session.parentId) : null)
  const worldMatrix = node?.type === 'path' ? getWorldMatrix(state, node.id) : parentMatrix
  const selectionKeys = new Set(selected.map(p => `${p.contour}:${p.anchor}`))
  const toWorld = (p: Point): Point => {
    if (operand) return operandLocalToWorld(operand, p, parentMatrix)
    if (node?.type === 'path') return mapPoint(worldMatrix!, { x: (p.x - node.viewBox[0]) * node.width / node.viewBox[2], y: (p.y - node.viewBox[1]) * node.height / node.viewBox[3] })
    return worldMatrix ? mapPoint(worldMatrix, p) : p
  }
  const screen = (p: Point): Point => { const world = toWorld(p); return { x: world.x * camera.zoom + camera.x, y: world.y * camera.zoom + camera.y } }
  const screenContours = session.contours.map(c => ({
    ...c,
    anchors: c.anchors.map(a => ({
      ...screen(a),
      ...(a.in ? { in: screen(a.in) } : {}),
      ...(a.out ? { out: screen(a.out) } : {}),
      ...(a.quadApex ? { quadApex: screen(a.quadApex) } : {}),
      curveMode: a.curveMode,
    })),
  }))
  const previewContours = roundPathContours(session.contours).map(c => ({
    ...c,
    anchors: c.anchors.map(a => ({
      ...screen(a),
      ...(a.in ? { in: screen(a.in) } : {}),
      ...(a.out ? { out: screen(a.out) } : {}),
      ...(a.quadApex ? { quadApex: screen(a.quadApex) } : {}),
      curveMode: a.curveMode,
    })),
  }))

  const siblingGhostPaths: { id: string; d: string }[] = []
  if (operand && node?.type === 'path' && node.boolean) {
    for (const sib of node.boolean.operands) {
      if (sib.id === operand.id) continue
      try {
        const contours = vectorToContours(sib)
        const ghostContours = contours.map(c => ({
          ...c,
          anchors: c.anchors.map(a => {
            const worldPt = operandLocalToWorld(sib, a, parentMatrix)
            const screenPt = { x: worldPt.x * camera.zoom + camera.x, y: worldPt.y * camera.zoom + camera.y }
            const inPt = a.in ? (() => {
              const w = operandLocalToWorld(sib, a.in, parentMatrix)
              return { x: w.x * camera.zoom + camera.x, y: w.y * camera.zoom + camera.y }
            })() : undefined
            const outPt = a.out ? (() => {
              const w = operandLocalToWorld(sib, a.out, parentMatrix)
              return { x: w.x * camera.zoom + camera.x, y: w.y * camera.zoom + camera.y }
            })() : undefined
            return {
              ...screenPt,
              ...(inPt ? { in: inPt } : {}),
              ...(outPt ? { out: outPt } : {}),
              curveMode: a.curveMode,
            }
          }),
        }))
        siblingGhostPaths.push({ id: sib.id, d: serializePath(ghostContours) })
      } catch {
        // ignore malformed sibling paths
      }
    }
  }

  useLayoutEffect(() => {
    const root = rootRef.current!, viewport = root.closest<HTMLElement>('.canvas-viewport')!
    let gesture: Gesture | null = null, frame = 0, pending: PointerEvent | null = null
    let dragBefore: PathContour[] | null = null
    const localPoint = (event: PointerEvent): Point => {
      const rect = root.getBoundingClientRect(), world = controller.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top })
      const s = sessionRef.current, state = store.getSnapshot(), n = s.id ? state.elements[s.id] : undefined
      const op = operandId && n?.type === 'path' && n.boolean ? store.getCompoundOperand(n.id, operandId) : null
      if (op) {
        const pMat = n?.parentId ? getWorldMatrix(state, n.parentId) : null
        return worldToOperandLocal(op, world, pMat)
      }
      if (n?.type === 'path') {
        const p = inversePoint(getWorldMatrix(state, n.id), world)
        return { x: p.x / n.width * n.viewBox[2] + n.viewBox[0], y: p.y / n.height * n.viewBox[3] + n.viewBox[1] }
      }
      return s.parentId ? inversePoint(getWorldMatrix(state, s.parentId), world) : world
    }
    const worldPoint = (p: Point): Point => {
      const s = sessionRef.current, state = store.getSnapshot(), n = s.id ? state.elements[s.id] : undefined
      const op = operandId && n?.type === 'path' && n.boolean ? store.getCompoundOperand(n.id, operandId) : null
      if (op) {
        const pMat = n?.parentId ? getWorldMatrix(state, n.parentId) : null
        return operandLocalToWorld(op, p, pMat)
      }
      if (n?.type === 'path') return mapPoint(getWorldMatrix(state, n.id), { x: (p.x - n.viewBox[0]) * n.width / n.viewBox[2], y: (p.y - n.viewBox[1]) * n.height / n.viewBox[3] })
      return s.parentId ? mapPoint(getWorldMatrix(state, s.parentId), p) : p
    }
    const snapPointToLocal = (pt: Point): Point => {
      const s = sessionRef.current, state = store.getSnapshot(), n = s.id ? state.elements[s.id] : undefined
      const op = operandId && n?.type === 'path' && n.boolean ? store.getCompoundOperand(n.id, operandId) : null
      if (op) {
        const pMat = n?.parentId ? getWorldMatrix(state, n.parentId) : null
        return worldToOperandLocal(op, pt, pMat)
      }
      if (n?.type === 'path') {
        const p = inversePoint(getWorldMatrix(state, n.id), pt)
        return { x: p.x / n.width * n.viewBox[2] + n.viewBox[0], y: p.y / n.height * n.viewBox[3] + n.viewBox[1] }
      }
      return s.parentId ? inversePoint(getWorldMatrix(state, s.parentId), pt) : pt
    }
    let indexedElements: ReturnType<SceneStore['getSnapshot']>['elements'] | null = null
    let vertexIndex = new VertexIndex([])
    let ownIndex = new VertexIndex([]), ownRevision = -1, ownGesture: Gesture | null = null
    const snap = (event: PointerEvent, point = localPoint(event)): Point => {
      if (!vertexSnapRef.current || event.altKey || event.shiftKey || gesture && (gesture.handle || gesture.creating || penMode)) {
        setSnapTarget(null)
        const base = snapPathPoint(point, snappingRef.current && !event.altKey)
        if (gridSnapRef.current && !event.altKey && !event.shiftKey && !gesture?.handle) {
          const world = worldPoint(base)
          const zoom = controller.getSnapshot().camera.zoom
          const res = snapToGrid(world, true, 120, 24, 8, zoom)
          if (res.snapped) {
            return snapPointToLocal(res.point)
          }
        }
        return base
      }
      const s = sessionRef.current, state = store.getSnapshot(), zoom = controller.getSnapshot().camera.zoom
      if (!gesture && indexedElements !== state.elements) { vertexIndex = sceneVertexIndex(state, s.id); indexedElements = state.elements }
      const world = worldPoint(point)
      // Stationary anchors do not change during a drag. Index once per gesture,
      // excluding every selected anchor so a multi-selection cannot catch itself.
      if (ownGesture !== gesture || !gesture && ownRevision !== geometryRevision.current) {
        const moving = new Set(gesture ? selectedRef.current.map(p => `${p.contour}:${p.anchor}`) : [])
        const n = s.id ? state.elements[s.id] : undefined
        const matrix = n ? getWorldMatrix(state, n.id) : s.parentId ? getWorldMatrix(state, s.parentId) : null
        const toWorld = (p: Point): Point => {
          const op = operandId && n?.type === 'path' && n.boolean ? store.getCompoundOperand(n.id, operandId) : null
          if (op) {
            const pMat = n?.parentId ? getWorldMatrix(state, n.parentId) : null
            return operandLocalToWorld(op, p, pMat)
          }
          const local = n?.type === 'path' ? { x: (p.x - n.viewBox[0]) * n.width / n.viewBox[2], y: (p.y - n.viewBox[1]) * n.height / n.viewBox[3] } : p
          return matrix ? mapPoint(matrix, local) : local
        }
        ownIndex = new VertexIndex(s.contours.flatMap((c, ci) => c.anchors.flatMap((a, ai) => moving.has(`${ci}:${ai}`) ? [] : [{ ...toWorld(a), label: ci === s.contours.length - 1 && ai === 0 && !c.closed && c.anchors.length > 1 ? 'Close path' : 'Path vertex' }])))
        ownGesture = gesture; ownRevision = geometryRevision.current
      }
      const ownTarget = ownIndex.nearest(world, zoom), otherTarget = vertexIndex.nearest(world, zoom)
      const distance = (p: Point) => (p.x - world.x) ** 2 + (p.y - world.y) ** 2
      const target = ownTarget && (!otherTarget || distance(ownTarget) <= distance(otherTarget)) ? ownTarget : otherTarget
      setSnapTarget(target)
      if (!target) {
        const base = snapPathPoint(point, snappingRef.current)
        if (gridSnapRef.current && !event.altKey) {
          const res = snapToGrid(world, true, 120, 24, 8, zoom)
          if (res.snapped) {
            setSnapTarget({ x: res.point.x, y: res.point.y, label: res.type === 'major' ? '120px Grid' : '24px Grid' })
            return snapPointToLocal(res.point)
          }
        }
        return base
      }
      return snapPointToLocal(target)
    }
    const publish = () => {
      const s = sessionRef.current, node = s.id ? store.getSnapshot().elements[s.id] : undefined
      if (node?.type === 'path' && !store.isLocked(node.id) && store.isVisible(node.id)) {
        if (operandId && node.boolean) {
          store.updateBooleanOperandNodes(node.id, operandId, s.contours)
        } else if (!node.boolean) {
          store.update(node.id, 'path', { nodes: s.contours })
        }
      }
      redraw()
    }
    const chooseMany = (selection: AnchorSelection[]) => { selectedRef.current = selection; setSelected(selection) }
    const choose = (contour: number, anchor: number) => chooseMany(contour < 0 ? [] : [{ contour, anchor }])
    const normalize = () => {
      if (operandId) return
      const s = sessionRef.current, node = s.id ? store.getSnapshot().elements[s.id] : undefined
      if (node?.type !== 'path' || node.boolean || store.isLocked(node.id) || !store.isVisible(node.id) || !s.contours.some(c => c.anchors.length > 1)) return
      const bounds = pathBounds(s.contours, (node.style.stroke?.width ?? 0) / 2)
      const sx = node.width / node.viewBox[2], sy = node.height / node.viewBox[3]
      const width = bounds.width * sx, height = bounds.height * sy
      const dx = (bounds.x - node.viewBox[0]) * sx + (width - node.width) / 2
      const dy = (bounds.y - node.viewBox[1]) * sy + (height - node.height) / 2
      const angle = node.rotation * Math.PI / 180
      store.update(node.id, 'path', { x: node.x + Math.cos(angle) * dx - Math.sin(angle) * dy - (width - node.width) / 2, y: node.y + Math.sin(angle) * dx + Math.cos(angle) * dy - (height - node.height) / 2, width, height, viewBox: [bounds.x, bounds.y, bounds.width, bounds.height] })
    }
    const stopGesture = (cancel = false) => {
      setIsBending(false)
      if (frame) cancelAnimationFrame(frame)
      frame = 0; pending = null
      const previous = gesture; gesture = null
      setSnapTarget(null)
      if (previous && dragBefore && cancel) sessionRef.current.contours = dragBefore
      if (previous?.creating && dragBefore && !cancel) draftHistory.current.record(dragBefore, sessionRef.current.contours)
      if (previous?.bending && dragBefore && !cancel && previous.moved && !sessionRef.current.id) {
        draftHistory.current.record(dragBefore, sessionRef.current.contours)
      }
      dragBefore = null
      if (previous && !previous.creating) {
        if (cancel || (previous.bending && !previous.moved)) {
          if (sessionRef.current.id) store.cancelTransaction()
        } else {
          if (previous.moved || penMode) normalize()
          if (sessionRef.current.id) store.endTransaction()
        }
      }
      if (previous && root.hasPointerCapture(previous.pointerId)) root.releasePointerCapture(previous.pointerId)
      if (cancel) chooseMany(selectedRef.current.filter(p => sessionRef.current.contours[p.contour]?.anchors[p.anchor]))
      redraw()
    }
    const undoDraft = (redo = false) => {
      if (sessionRef.current.id) return
      if (gesture) { stopGesture(true); return }
      const next = redo ? draftHistory.current.redo(sessionRef.current.contours) : draftHistory.current.undo(sessionRef.current.contours)
      if (next) { sessionRef.current.contours = next; chooseMany([]); setHover(null); redraw() }
    }
    draftUndoRef.current = undoDraft
    const editSelected = (action: NodeAction, value?: number) => {
      stopGesture()
      const s = sessionRef.current, selected = selectedRef.current
      if (!selected.length && action !== 'toggle-closed' && action !== 'split-to-layers' && action !== 'reverse') return
      const before = !s.id ? copyContours(s.contours) : null
      store.batch(() => {
        if (action === 'delete') {
          const removed = new Set(selected.map(p => `${p.contour}:${p.anchor}`))
          s.contours = s.contours.map((c, ci) => ({ ...c, anchors: c.anchors.filter((_, ai) => !removed.has(`${ci}:${ai}`)) })).filter(c => c.anchors.length > 1)
          chooseMany([])
          if (s.id && !s.contours.length) { store.remove(s.id); callbackRef.current(); return }
        } else if (action === 'split') {
          if (selected.length === 1) {
            const sel = selected[0]
            const c = s.contours[sel.contour]
            if (canSplitAnchor(c, sel.anchor)) {
              s.contours = splitContoursAtSelection(s.contours, sel)
              chooseMany([])
            }
          }
        } else if (action === 'join') {
          if (canJoinSelection(s.contours, selected)) {
            const res = joinPathAnchors(s.contours, selected)
            if (res.joined) {
              s.contours = res.contours
              chooseMany([])
            }
          }
        } else if (action === 'reverse') {
          const contourIdx = selected.length && selected.every(p => p.contour === selected[0].contour) ? selected[0].contour : s.contours.length - 1
          const contour = s.contours[contourIdx]
          if (contour) {
            s.contours[contourIdx] = reversePathContour(contour)
            chooseMany([])
          }
        } else if (action === 'split-to-layers') {
          if (s.contours.length > 1) {
            if (s.id) {
              store.splitPathToSeparateElements(s.id)
              callbackRef.current()
              return
            } else {
              const validContours = s.contours.filter(c => c.anchors.length > 1)
              if (validContours.length > 1) {
                let parentId = s.parentId
                if (parentId && !store.getSnapshot().elements[parentId]) parentId = null
                const newIds: string[] = []
                for (let i = 0; i < validContours.length; i++) {
                  const c = validContours[i]
                  const b = pathBounds([c])
                  const sub = store.add('path', {
                    name: `Pen path part ${i + 1}`,
                    parentId: parentId ?? undefined,
                    x: b.x,
                    y: b.y,
                    width: Math.max(1, b.width),
                    height: Math.max(1, b.height),
                    nodes: [c],
                    viewBox: [b.x, b.y, b.width, b.height],
                    style: {
                      fill: c.closed ? '#81adec' : null,
                      stroke: { color: '#080808', width: 2, dash: [] },
                    },
                  })
                  newIds.push(sub.id)
                }
                store.select(newIds)
                callbackRef.current()
                return
              }
            }
          }
        } else if (action === 'toggle-closed') {
          const contourIdx = selected.length && selected.every(p => p.contour === selected[0].contour) ? selected[0].contour : s.contours.length - 1
          const contour = s.contours[contourIdx]
          if (contour?.anchors.length > 1) contour.closed = !contour.closed
        } else if (action === 'toggle-smooth') {
          for (const p of selected) {
            const c = s.contours[p.contour], a = c?.anchors[p.anchor]
            if (c && a) c.anchors[p.anchor] = toggleNodeCornerSmooth(a, c, p.anchor)
          }
        } else if (action === 'curve-mode') {
          const targetMode: CurveMode = value === 1 ? 'quadratic' : value === 0 ? 'cubic' : (curveMode === 'cubic' ? 'quadratic' : 'cubic')
          setCurveMode(targetMode)
          for (const p of selected) {
            const c = s.contours[p.contour], a = c?.anchors[p.anchor]
            if (c && a) convertSegmentCurveMode(c, p.anchor, targetMode)
          }
        } else if (action === 'quad-apex-x' || action === 'quad-apex-y') {
          if (value !== undefined && Number.isFinite(value)) {
            for (const p of selected) {
              const c = s.contours[p.contour]
              const a = c?.anchors[p.anchor]
              const nextIdx = (p.anchor + 1) % c.anchors.length
              const b = c?.anchors[nextIdx]
              if (a && b && a.quadApex) {
                const nextApex = {
                  x: action === 'quad-apex-x' ? value : a.quadApex.x,
                  y: action === 'quad-apex-y' ? value : a.quadApex.y,
                }
                const updated = moveQuadApex(a, b, nextApex)
                c.anchors[p.anchor] = updated.a
                c.anchors[nextIdx] = updated.b
              }
            }
          }
        } else if (action === 'insert') {
          const p = selected[0], c = s.contours[p.contour]
          if (!c || (!c.closed && p.anchor === c.anchors.length - 1)) return
          if (c.anchors.some(a => a.cornerRadius)) return
          choose(p.contour, insertPathAnchor(c, p.anchor, .5))
        } else for (const p of selected) {
          const c = s.contours[p.contour], a = c?.anchors[p.anchor]
          if (!a) continue
          if (action === 'corner') c.anchors[p.anchor] = { x: a.x, y: a.y, cornerRadius: a.cornerRadius ?? 0, handleType: 'disconnected' }
          else if (action === 'radius' && value !== undefined && Number.isFinite(value)) {
            c.anchors[p.anchor] = { x: a.x, y: a.y, cornerRadius: Math.max(0, value), handleType: 'disconnected' }
          } else if ((action === 'x' || action === 'y') && value !== undefined && Number.isFinite(value)) c.anchors[p.anchor] = moveAnchor(a, { x: action === 'x' ? value : a.x, y: action === 'y' ? value : a.y })
          else if (action === 'mirrored' || action === 'asymmetric' || action === 'disconnected') c.anchors[p.anchor] = setHandleType(c, p.anchor, action)
        }
        publish(); normalize()
      }, action === 'delete' ? 'Delete path nodes' : action === 'insert' ? 'Insert path node' : action === 'split' ? 'Split path anchor' : action === 'join' ? 'Join path endpoints' : action === 'reverse' ? 'Reverse path contour' : action === 'split-to-layers' ? 'Separate subpaths into layers' : action === 'toggle-closed' ? 'Toggle subpath closure' : action === 'toggle-smooth' ? 'Toggle corner/smooth' : action === 'curve-mode' ? 'Toggle curve mode' : 'Edit path nodes')
      if (before) { draftHistory.current.record(before, s.contours); redraw() }
    }
    editRef.current = editSelected
    const commit = () => {
      const s = sessionRef.current
      if (s.id || s.contours.every(c => c.anchors.length < 2)) return
      const contours = s.contours.filter(c => c.anchors.length > 1), bounds = pathBounds(contours)
      store.batch(() => {
        let parentId = s.parentId
        if (parentId && !store.getSnapshot().elements[parentId]) parentId = null
        const container = parentId ? null : store.add('frame', { name: 'Vector', ...bounds, clipContent: false, style: { fill: null } })
        const path = store.add('path', { name: 'Pen path', parentId: parentId ?? container!.id, x: container ? 0 : bounds.x, y: container ? 0 : bounds.y, width: bounds.width, height: bounds.height, nodes: contours, viewBox: [bounds.x, bounds.y, bounds.width, bounds.height], style: { fill: contours.some(c => c.closed) ? '#81adec' : null, stroke: { color: '#080808', width: 2, dash: [] } } })
        store.select([path.id])
        s.id = path.id
      }, 'Draw vector path')
    }
    const finish = () => { stopGesture(); commit(); callbackRef.current() }
    finishRef.current = finish
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType === 'touch' || viewport.dataset.space === 'true' || viewport.dataset.panning === 'true' || gesture || event.detail > 1) return
      const target = event.target as Element
      if (target.closest('.viewport-ui')) return
      const s = sessionRef.current
      if (editingId && !s.contours.length) return
      if (s.id && (store.isLocked(s.id) || !store.isVisible(s.id) || store.getHistorySnapshot().active)) return
      event.preventDefault(); viewport.focus({ preventScroll: true }); controller.stop()
      if (indexedElements !== store.getSnapshot().elements) {
        vertexIndex = sceneVertexIndex(store.getSnapshot(), s.id); indexedElements = store.getSnapshot().elements
      }
      let contourIndex: number, anchorIndex: number, handle: 'in' | 'out' | 'quadApex' | undefined
      const control = target.closest<SVGElement>('[data-anchor]')
      if (control) {
        contourIndex = Number(control.dataset.contour); anchorIndex = Number(control.dataset.anchor); handle = control.dataset.control as typeof handle
        const contour = s.contours[contourIndex]
        if (!penMode && event.shiftKey && !handle) {
          const exists = selectedRef.current.some(p => p.contour === contourIndex && p.anchor === anchorIndex)
          chooseMany(exists ? selectedRef.current.filter(p => p.contour !== contourIndex || p.anchor !== anchorIndex) : [...selectedRef.current, { contour: contourIndex, anchor: anchorIndex }])
          return
        }
        if (event.altKey && !handle) {
          const anchor = contour.anchors[anchorIndex]
          const before = copyContours(s.contours)
          store.batch(() => {
            contour.anchors[anchorIndex] = toggleNodeCornerSmooth(anchor, contour, anchorIndex)
            publish()
            normalize()
          }, 'Toggle node corner/smooth')
          if (!s.id) draftHistory.current.record(before, s.contours)
          choose(contourIndex, anchorIndex)
          return
        }
        if (penMode && !handle && anchorIndex === 0 && !contour.closed && contour.anchors.length > 1) { store.batch(() => { contour.closed = true; publish(); normalize() }, 'Close vector path'); finish(); return }
      } else {
        const rect = root.getBoundingClientRect()
        const screenPt = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const map = (p: Point) => {
          const world = toWorld(p)
          return controller.worldToScreen(world)
        }
        const rendered = roundPathContours(s.contours)
        const hit = s.contours.length ? nearestPathSegment(rendered, screenPt, map, 14) : null
        if (hit && (!penMode || event.altKey || s.contours[hit.contour]?.closed)) {
          const contour = s.contours[hit.contour]
          if (s.id) store.beginTransaction('Bend path curvature')
          dragBefore = copyContours(s.contours)
          const origA = { ...contour.anchors[hit.segment] }
          const origB = { ...contour.anchors[(hit.segment + 1) % contour.anchors.length] }
          const segMode: CurveMode = event.altKey ? (curveMode === 'cubic' ? 'quadratic' : 'cubic') : (origA.curveMode ?? curveMode)
          gesture = {
            pointerId: event.pointerId,
            contour: hit.contour,
            anchor: hit.segment,
            segment: hit.segment,
            t: hit.t,
            start: localPoint(event),
            original: origA,
            originalA: origA,
            originalB: origB,
            mode: segMode,
            moved: false,
            creating: false,
            bending: true,
          }
          chooseMany([{ contour: hit.contour, anchor: hit.segment }, { contour: hit.contour, anchor: (hit.segment + 1) % contour.anchors.length }])
          setIsBending(true)
          setHover(null)
          setHoverSegment(null)
          root.setPointerCapture(event.pointerId)
          redraw()
          return
        }

        if (!penMode) { choose(-1, -1); return }
        const before = copyContours(s.contours)
        if (!s.contours.length) {
          // Hit-test under the drawing surface so paths stay inside the clicked frame.
          s.parentId = null
          const hitElement = document.elementsFromPoint(event.clientX, event.clientY).map(e => e.closest<HTMLElement>('[data-element-id]')).find(Boolean)
          let candidate = hitElement?.dataset.elementId ? store.getSnapshot().elements[hitElement.dataset.elementId] : undefined
          if (candidate && candidate.type !== 'frame') candidate = candidate.parentId ? store.getSnapshot().elements[candidate.parentId] : undefined
          if (candidate?.type === 'frame' && !store.isLocked(candidate.id)) s.parentId = candidate.id
        }
        let contour = s.contours.at(-1)
        if (!contour || contour.closed) { contour = { anchors: [], closed: false }; s.contours.push(contour) }
        contourIndex = s.contours.length - 1
        let p = snap(event)
        const first = contour.anchors[0]
        if (first && !contour.closed && contour.anchors.length > 1 && Math.hypot(p.x - first.x, p.y - first.y) < 1e-8) {
          store.batch(() => { contour.closed = true; publish(); normalize() }, 'Close vector path'); finish(); return
        }
        const last = contour.anchors.at(-1)
        if (event.shiftKey && last) {
          const angle = Math.round(Math.atan2(p.y - last.y, p.x - last.x) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(p.x - last.x, p.y - last.y)
          p = { x: last.x + Math.cos(angle) * length, y: last.y + Math.sin(angle) * length }
        }
        if (s.id) store.beginTransaction('Extend vector path')
        dragBefore = before
        contour.anchors.push({ ...p, curveMode })
        anchorIndex = contour.anchors.length - 1
      }
      if (control) {
        if (s.id) store.beginTransaction('Edit path points')
        dragBefore = copyContours(s.contours)
      }
      const anchor = s.contours[contourIndex].anchors[anchorIndex]
      gesture = { pointerId: event.pointerId, contour: contourIndex, anchor: anchorIndex, handle, start: localPoint(event), original: { ...anchor }, moved: false, creating: !s.id }
      if (handle || !selectedRef.current.some(p => p.contour === contourIndex && p.anchor === anchorIndex)) choose(contourIndex, anchorIndex)
      if (penMode) publish(); else redraw()
      setHover(null); root.setPointerCapture(event.pointerId)
    }
    const applyMove = (event: PointerEvent) => {
      let p = localPoint(event)
      if (gesture && !gesture.moved) {
        const start = worldPoint(gesture.start), current = worldPoint(p)
        if (Math.hypot(current.x - start.x, current.y - start.y) * controller.getSnapshot().camera.zoom < 2) return
      }
      if (gesture?.bending) {
        gesture.moved = true
        p = snap(event, p)
        const bent = bendSegment(gesture.originalA!, gesture.originalB!, gesture.t!, p, gesture.mode)
        const contour = sessionRef.current.contours[gesture.contour]
        const nextIdx = (gesture.segment! + 1) % contour.anchors.length
        contour.anchors[gesture.segment!].out = bent.out
        contour.anchors[nextIdx].in = bent.in
        contour.anchors[gesture.segment!].curveMode = bent.mode
        if (bent.quadApex) contour.anchors[gesture.segment!].quadApex = bent.quadApex
        else contour.anchors[gesture.segment!].quadApex = undefined
        publish()
        return
      }
      if (gesture && !gesture.handle && !gesture.creating && !penMode) {
        // Snap the anchor, preserving where on its hit area the drag began.
        const candidate = { x: gesture.original.x + p.x - gesture.start.x, y: gesture.original.y + p.y - gesture.start.y }
        const snapped = snap(event, candidate)
        p = { x: gesture.start.x + snapped.x - gesture.original.x, y: gesture.start.y + snapped.y - gesture.original.y }
      } else p = snap(event, p)
      if (!gesture) { setHover(penMode ? p : null); return }
      const g = gesture, s = sessionRef.current, anchor = s.contours[g.contour]?.anchors[g.anchor]
      if (!anchor) return
      g.moved = true
      if (event.shiftKey && (g.handle || g.creating || penMode)) {
        const angle = Math.round(Math.atan2(p.y - anchor.y, p.x - anchor.x) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(p.x - anchor.x, p.y - anchor.y)
        p = { x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length }
      }
      if (g.handle === 'quadApex') {
        const c = s.contours[g.contour]
        const nextIdx = (g.anchor + 1) % c.anchors.length
        const updated = moveQuadApex(c.anchors[g.anchor], c.anchors[nextIdx], p)
        c.anchors[g.anchor] = updated.a
        c.anchors[nextIdx] = updated.b
      } else if (g.handle) {
        s.contours[g.contour].anchors[g.anchor] = moveHandle(g.original, g.handle, p, event.altKey)
      } else if (g.creating || penMode) {
        anchor.out = p; anchor.in = event.altKey ? undefined : { x: 2 * anchor.x - p.x, y: 2 * anchor.y - p.y }
        anchor.handleType = event.altKey ? 'disconnected' : 'mirrored'; anchor.cornerRadius = 0
        anchor.curveMode = curveMode
        if (curveMode === 'quadratic' && anchor.out) {
          anchor.quadApex = { x: anchor.x + 1.5 * (anchor.out.x - anchor.x), y: anchor.y + 1.5 * (anchor.out.y - anchor.y) }
        } else {
          anchor.quadApex = undefined
        }
      } else {
        let dx = p.x - g.start.x, dy = p.y - g.start.y
        if (event.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
        for (const chosen of selectedRef.current) {
          const original = dragBefore?.[chosen.contour]?.anchors[chosen.anchor]
          if (original) s.contours[chosen.contour].anchors[chosen.anchor] = moveAnchor(original, { x: original.x + dx, y: original.y + dy })
        }
      }
      publish()
    }
    const move = (event: PointerEvent) => {
      if (gesture && gesture.pointerId !== event.pointerId) return
      if ((event.target as Element).closest('.viewport-ui') || viewport.dataset.space === 'true' || viewport.dataset.panning === 'true') { setSnapTarget(null); setHoverSegment(null); return }
      pending = event
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (pending) applyMove(pending); pending = null })
      if (!gesture && (!viewport.dataset.space || viewport.dataset.space === 'false') && (!viewport.dataset.panning || viewport.dataset.panning === 'false')) {
        const rect = root.getBoundingClientRect()
        const screenPt = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const map = (p: Point) => {
          const world = toWorld(p)
          return controller.worldToScreen(world)
        }
        const rendered = roundPathContours(sessionRef.current.contours)
        const hit = sessionRef.current.contours.length ? nearestPathSegment(rendered, screenPt, map, 14) : null
        if (hit && (!penMode || event.altKey || sessionRef.current.contours[hit.contour]?.closed)) {
          const a = rendered[hit.contour].anchors[hit.segment]
          const b = rendered[hit.contour].anchors[(hit.segment + 1) % rendered[hit.contour].anchors.length]
          const pt = segmentPoint(a, b, hit.t)
          const curvature = (a.out || b.in) ? evaluateSegmentCurvature(a, b, hit.t) : undefined
          setHoverSegment({
            contour: hit.contour,
            segment: hit.segment,
            t: hit.t,
            point: pt,
            curvature: curvature ? { radius: curvature.radius, curvature: curvature.curvature } : undefined,
          })
        } else {
          setHoverSegment(null)
        }
      }
    }
    const up = (event: PointerEvent) => { if (gesture?.pointerId === event.pointerId) { if (event.type === 'pointerup') applyMove(event); stopGesture(event.type === 'pointercancel') } }
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector('[aria-modal="true"]') || (event.target as Element).closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [data-token-ui]')) return
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z' && !sessionRef.current.id) {
        event.preventDefault(); event.stopImmediatePropagation(); undoDraft(event.shiftKey); return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault(); event.stopImmediatePropagation()
        chooseMany(sessionRef.current.contours.flatMap((c, ci) => c.anchors.map((_, ai) => ({ contour: ci, anchor: ai })))); return
      }
      if (!gesture && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 's') {
        if (selectedRef.current.length > 0) {
          event.preventDefault(); event.stopImmediatePropagation()
          editSelected('toggle-smooth'); return
        }
      }
      if (!gesture && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'q') {
        if (selectedRef.current.length > 0) {
          event.preventDefault(); event.stopImmediatePropagation()
          editSelected('curve-mode'); return
        }
      }
      if (!gesture && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'c') {
        const s = sessionRef.current
        const activeContour = s.contours.at(-1)
        if (activeContour && !activeContour.closed && activeContour.anchors.length > 1) {
          event.preventDefault(); event.stopImmediatePropagation()
          editSelected('toggle-closed')
          return
        }
        if (selectedRef.current.length > 0) {
          event.preventDefault(); event.stopImmediatePropagation()
          editSelected('corner')
          return
        }
      }
      if (!gesture && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'x') {
        if (selectedRef.current.length === 1) {
          const p = selectedRef.current[0]
          const c = sessionRef.current.contours[p.contour]
          if (c && canSplitAnchor(c, p.anchor)) {
            event.preventDefault(); event.stopImmediatePropagation()
            editSelected('split'); return
          }
        }
      }
      if (!gesture && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'j') {
        if (canJoinSelection(sessionRef.current.contours, selectedRef.current)) {
          event.preventDefault(); event.stopImmediatePropagation()
          editSelected('join'); return
        }
      }
      if (!gesture && !event.ctrlKey && !event.metaKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation()
        if (!selectedRef.current.length || store.getHistorySnapshot().active) return
        const delta = event.shiftKey ? 10 : 1
        const before = !sessionRef.current.id ? copyContours(sessionRef.current.contours) : null
        store.batch(() => {
          for (const chosen of selectedRef.current) {
            const c = sessionRef.current.contours[chosen.contour], a = c?.anchors[chosen.anchor]
            if (a) c.anchors[chosen.anchor] = moveAnchor(a, { x: a.x + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0), y: a.y + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0) })
          }
          publish(); normalize()
        }, 'Nudge path nodes')
        if (before) { draftHistory.current.record(before, sessionRef.current.contours); redraw() }
        return
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (gesture) stopGesture(true); else finish() }
      if (event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); finish() }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "'" || event.key === '"' || event.code === 'Quote')) { event.preventDefault(); togglePixelSnap(); return }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault(); event.stopImmediatePropagation(); stopGesture()
        editSelected('delete')
      }
    }
    const doubleClick = (event: MouseEvent) => {
      if ((event.target as Element).closest('.viewport-ui') || viewport.dataset.space === 'true' || viewport.dataset.panning === 'true') return
      if (penMode) { finish(); return }
      if (store.getHistorySnapshot().active) return
      event.preventDefault(); event.stopPropagation()
      const control = (event.target as Element).closest<SVGElement>('[data-anchor]')
      if (control) {
        choose(Number(control.dataset.contour), Number(control.dataset.anchor))
        const a = sessionRef.current.contours[Number(control.dataset.contour)].anchors[Number(control.dataset.anchor)]
        editSelected(a.in || a.out ? 'corner' : 'mirrored'); return
      }
      const rect = root.getBoundingClientRect(), state = store.getSnapshot(), s = sessionRef.current, n = s.id ? state.elements[s.id] : undefined
      if (n?.type !== 'path') return
      const map = (p: Point) => controller.worldToScreen(toWorld(p))
      const rendered = roundPathContours(s.contours)
      const hit = nearestPathSegment(rendered, { x: event.clientX - rect.left, y: event.clientY - rect.top }, map)
      if (hit) store.batch(() => {
        if (s.contours[hit.contour].anchors.some(a => a.cornerRadius)) s.contours[hit.contour] = rendered[hit.contour]
        choose(hit.contour, insertPathAnchor(s.contours[hit.contour], hit.segment, hit.t)); publish(); normalize()
      }, 'Insert path node')
    }
    const blur = () => stopGesture(true)
    const lostCapture = () => { if (gesture) stopGesture(true) }
    root.addEventListener('pointerdown', down); viewport.addEventListener('pointermove', move)
    root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up); root.addEventListener('lostpointercapture', lostCapture)
    root.addEventListener('dblclick', doubleClick); document.addEventListener('keydown', keydown, true); window.addEventListener('blur', blur)
    const unsubscribeCamera = controller.subscribe(snapshot => setCamera(snapshot.camera))
    const unsubscribeStore = store.subscribe(() => {
      const s = sessionRef.current, node = s.id ? store.getSnapshot().elements[s.id] : undefined
      if (!gesture && !store.getHistorySnapshot().active && node?.type === 'path') {
        try {
          if (operandId && node.boolean) {
            const op = store.getCompoundOperand(node.id, operandId)
            if (op) {
              s.contours = vectorToContours(op)
              setError('')
              chooseMany(selectedRef.current.filter(p => s.contours[p.contour]?.anchors[p.anchor]))
            }
          } else if (!node.boolean) {
            s.contours = node.nodes ? copyContours(node.nodes) : parsePath(node.d)
            setError('')
            chooseMany(selectedRef.current.filter(p => s.contours[p.contour]?.anchors[p.anchor]))
          }
        } catch (e) { setError((e as Error).message) }
      }
      redraw()
    })
    return () => {
      root.removeEventListener('pointerdown', down); viewport.removeEventListener('pointermove', move)
      root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', up); root.removeEventListener('lostpointercapture', lostCapture)
      root.removeEventListener('dblclick', doubleClick); document.removeEventListener('keydown', keydown, true); window.removeEventListener('blur', blur)
      unsubscribeCamera(); unsubscribeStore(); stopGesture(); commit()
    }
  }, [store, controller, editingId, operandId, penMode])

  let preview = serializePath(previewContours)
  const lastContour = screenContours.at(-1), last = lastContour?.anchors.at(-1)
  const isClosingHover = penMode && hover && lastContour && !lastContour.closed && lastContour.anchors.length > 1 && Math.hypot(screen(hover).x - screenContours.at(-1)!.anchors[0].x, screen(hover).y - screenContours.at(-1)!.anchors[0].y) < 20
  if (penMode && hover && last && !lastContour!.closed) {
    const next = isClosingHover ? screenContours.at(-1)!.anchors[0] : screen(hover)
    preview += last.out ? ` C ${last.out.x} ${last.out.y} ${next.x} ${next.y} ${next.x} ${next.y}` : ` L ${next.x} ${next.y}`
    if (isClosingHover) preview += ' Z'
  }
  const activeContour = session.contours.at(-1)
  const hasOpenContour = activeContour && !activeContour.closed && activeContour.anchors.length > 1

  return <div ref={rootRef} className={`pen-overlay ${penMode ? 'is-pen' : 'is-path-edit'} ${isBending ? 'is-bending-curve' : ''}`} data-testid="pen-overlay">
    {operand && node?.type === 'path' && node.boolean && (
      <div className="compound-isolation-topbar viewport-ui" data-testid="compound-isolation-topbar">
        <span className="compound-isolation-topbar-title">
          <CombineIcon />
          <span>COMPOUND SUB-PATH ISOLATION</span>
        </span>
        <span className="compound-isolation-topbar-desc">
          Editing <strong>{operand.name}</strong> sub-path in <em>{node.name}</em> ({node.boolean.operation.toUpperCase()})
        </span>
        <button
          type="button"
          className="compound-isolation-topbar-exit"
          data-testid="compound-isolation-exit-btn"
          title="Exit sub-path isolation mode (Esc or Enter)"
          onClick={() => finishRef.current()}
        >
          <CloseIcon />
          <span>Done (Esc)</span>
        </button>
      </div>
    )}
    <svg className="pen-geometry" aria-label="Path anchors and Bézier handles">
      {siblingGhostPaths.map(ghost => (
        <path
          key={ghost.id}
          className="compound-ghost-operand"
          data-testid={`compound-ghost-${ghost.id}`}
          d={ghost.d}
        />
      ))}
      <path className="pen-preview" data-testid="pen-preview" d={preview} />
      {snapTarget && <g className="pen-snap-target" data-testid="pen-snap-target" transform={`translate(${snapTarget.x * camera.zoom + camera.x} ${snapTarget.y * camera.zoom + camera.y})`}><circle r="8" /><path d="M-12 0H-5M5 0H12M0-12V-5M0 5V12" /><text x="14" y="-12">{snapTarget.label}</text></g>}
      {hoverSegment && (
        <g>
          <circle className="pen-curvature-handle" data-testid="pen-curvature-handle" cx={screen(hoverSegment.point).x} cy={screen(hoverSegment.point).y} r={6} />
          {hoverSegment.curvature && Number.isFinite(hoverSegment.curvature.radius) && hoverSegment.curvature.radius < 5000 && (
            <text className="pen-curvature-label" x={screen(hoverSegment.point).x + 10} y={screen(hoverSegment.point).y - 8}>
              R: {Math.round(hoverSegment.curvature.radius)}px
            </text>
          )}
        </g>
      )}
      {penMode && hasOpenContour && screenContours.at(-1)?.anchors[0] && (
        <circle className="pen-close-indicator" cx={screenContours.at(-1)!.anchors[0].x} cy={screenContours.at(-1)!.anchors[0].y} r={12} />
      )}
      {screenContours.map((c, ci) => c.anchors.map((a, ai) => {
        const isSmooth = isSmoothNode(session.contours[ci]?.anchors[ai])
        const nextAnchor = c.anchors[(ai + 1) % c.anchors.length]
        const showQuadApex = a.curveMode === 'quadratic' && a.quadApex && (c.closed || ai < c.anchors.length - 1)
        return (
          <g key={`${ci}-${ai}`}>
            {showQuadApex && (penMode || selectionKeys.has(`${ci}:${ai}`) || selectionKeys.has(`${ci}:${(ai + 1) % c.anchors.length}`)) && (
              <g key={`quad-${ci}-${ai}`}>
                <line x1={a.x} y1={a.y} x2={a.quadApex!.x} y2={a.quadApex!.y} className="pen-handle-line is-quad" />
                <line x1={a.quadApex!.x} y1={a.quadApex!.y} x2={nextAnchor.x} y2={nextAnchor.y} className="pen-handle-line is-quad" />
                <polygon
                  points={`${a.quadApex!.x},${a.quadApex!.y - 5} ${a.quadApex!.x + 5},${a.quadApex!.y} ${a.quadApex!.x},${a.quadApex!.y + 5} ${a.quadApex!.x - 5},${a.quadApex!.y}`}
                  className="pen-control pen-quad-apex"
                  data-contour={ci}
                  data-anchor={ai}
                  data-control="quadApex"
                  aria-label={`Subpath ${ci + 1}, quadratic apex control point between node ${ai + 1} and ${(ai + 1) % c.anchors.length + 1}`}
                />
              </g>
            )}
            {(penMode || selectionKeys.has(`${ci}:${ai}`)) && (['in', 'out'] as const).map(handle => {
              if (handle === 'out' && a.curveMode === 'quadratic' && a.quadApex) return null
              const prevAnchor = c.anchors[(ai + c.anchors.length - 1) % c.anchors.length]
              if (handle === 'in' && prevAnchor?.curveMode === 'quadratic' && prevAnchor?.quadApex) return null
              return a[handle] ? (
                <g key={handle}>
                  <line x1={a.x} y1={a.y} x2={a[handle].x} y2={a[handle].y} className="pen-handle-line" />
                  <circle cx={a[handle].x} cy={a[handle].y} r={4} className="pen-control" data-contour={ci} data-anchor={ai} data-control={handle} aria-label={`Subpath ${ci + 1}, ${handle === 'in' ? 'incoming' : 'outgoing'} handle ${ai + 1}`} />
                </g>
              ) : null
            })}
            <rect
              x={a.x - 4}
              y={a.y - 4}
              width={8}
              height={8}
              rx={isSmooth ? 4 : 0}
              ry={isSmooth ? 4 : 0}
              className={`pen-anchor ${selectionKeys.has(`${ci}:${ai}`) ? 'is-active' : ''} ${isSmooth ? 'is-smooth' : 'is-corner'}`}
              data-contour={ci}
              data-anchor={ai}
              aria-label={`Subpath ${ci + 1}, ${isSmooth ? 'smooth' : 'corner'} anchor ${ai + 1}`}
            />
          </g>
        )
      }))}
    </svg>
    {penMode && hover && (
      <div
        className="pen-cursor-hud"
        style={{ left: screen(hover).x, top: screen(hover).y }}
        aria-hidden="true"
      >
        <div className="pen-cursor-hud-coords">
          <span>X: {Math.round(hover.x)}</span>
          <span>Y: {Math.round(hover.y)}</span>
        </div>
        <div className="pen-cursor-hud-meta">
          <span>{curveMode.toUpperCase()}</span>
          {snapTarget && <span className="pen-cursor-hud-snap">⚡ {snapTarget.label}</span>}
          {isClosingHover && <span className="pen-cursor-hud-snap">↩ CLOSE</span>}
        </div>
      </div>
    )}
    {!penMode && <PathNodeInspector contours={session.contours} selection={selected} title={operand ? `SUB-PATH: ${operand.name.toUpperCase()}` : undefined} onEdit={(action, value) => editRef.current(action, value)} />}
    <div className="pen-help viewport-ui" role="status">
      <span className="pen-tool-label">{operand ? `SUB-PATH: ${operand.name.toUpperCase()}` : editingId ? 'EDIT PATH' : 'PEN'}</span>
      <span>{error || (penMode ? 'Click for corner · Drag for curve · Drag curve to bend · Click 1st point to close' : 'Drag curve to bend · Shift-click to select · Alt+Click to toggle smooth')}</span>
      {!session.id && <>
        <button disabled={!draftHistoryState.canUndo} aria-label="Undo pen point" title="Undo draft edit · Ctrl/⌘Z" onClick={() => draftUndoRef.current()}>Undo</button>
        <button disabled={!draftHistoryState.canRedo} aria-label="Redo pen point" title="Redo draft edit · Ctrl/⌘⇧Z" onClick={() => draftUndoRef.current(true)}>Redo</button>
      </>}
      {selected.length > 0 && <>
        <button onClick={() => editRef.current('toggle-smooth')} title="Toggle Corner vs Smooth Bézier curvature · S">Smooth/Corner <kbd>S</kbd></button>
        <button onClick={() => editRef.current('curve-mode')} title="Toggle Cubic vs Quadratic Bézier · Q">{curveMode === 'quadratic' ? 'Quadratic' : 'Cubic'} <kbd>Q</kbd></button>
      </>}
      {selected.length === 1 && canSplitAnchor(session.contours[selected[0].contour], selected[0].anchor) && (
        <button onClick={() => editRef.current('split')} title="Split path at anchor · X">Split <kbd>X</kbd></button>
      )}
      {canJoinSelection(session.contours, selected) && (
        <button onClick={() => editRef.current('join')} title="Join open endpoints · J">Join <kbd>J</kbd></button>
      )}
      {hasOpenContour && (
        <button onClick={() => editRef.current('toggle-closed')} title="Close subpath · C">Close path <kbd>C</kbd></button>
      )}
      <button aria-pressed={snapping} onClick={() => togglePixelSnap()} title="Snap to half pixels · ⌘⇧'">Pixel snap</button>
      <button aria-pressed={vertexSnap} onClick={() => { setVertexSnap(value => !value); setSnapTarget(null) }} title="Snap to nearby path anchors and shape vertices · Hold Alt to bypass">Vertex snap</button>
      <button aria-pressed={gridSnap} onClick={() => setGridSnap(value => !value)} title="Snap to 120px / 24px engineering grid lines">120px Grid</button>
      <button className="pen-btn-done" onClick={() => finishRef.current()}>Done <kbd>↵</kbd></button>
    </div>
  </div>
}
