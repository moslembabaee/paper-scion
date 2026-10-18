import { useLayoutEffect, useRef } from 'react'
import { Check, MessageSquare } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ViewportController } from '../canvas/ViewportController'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import { anchorAt, anchorPoint } from './model'
import type { CommentAnchor, CommentThread } from './types'

export function CommentOverlay({ store, controller, threads, unread, activeId, draft, placing, onSelect, onPlace }: {
  store: SceneStore; controller: ViewportController; threads: readonly CommentThread[]; unread: ReadonlySet<string>; activeId: string | null; draft: CommentAnchor | null; placing: boolean
  onSelect: (thread: CommentThread) => void; onPlace: (anchor: CommentAnchor) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const pins = useRef(new Map<string, HTMLButtonElement>())
  const scene = useScene(store, state => state.elements)
  const repaint = useRef(() => {})
  const down = useRef<{ id: number; x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const anchors = new Map(threads.map(thread => [thread.id, thread.anchor]))
    if (draft) anchors.set('draft', draft)
    const paint = () => {
      const state = store.getSnapshot(), { camera } = controller.getSnapshot()
      for (const [id, pin] of pins.current) {
        const anchor = anchors.get(id)
        if (!anchor) continue
        const point = anchorPoint(state, anchor)
        pin.style.transform = `translate3d(${point.x * camera.zoom + camera.x}px, ${point.y * camera.zoom + camera.y}px, 0)`
      }
    }
    repaint.current = paint
    paint()
    return controller.subscribe(paint)
  }, [store, controller, threads, draft])
  useLayoutEffect(() => { repaint.current() }, [scene])
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = root.current!.closest<HTMLElement>('.canvas-viewport')!
    if (event.button !== 0 || viewport.dataset.space === 'true' || viewport.dataset.panning === 'true') { down.current = null; return }
    event.stopPropagation()
    if (event.pointerType === 'touch') event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    down.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = down.current; down.current = null
    if (!start || start.id !== event.pointerId || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5) return
    event.stopPropagation()
    const viewport = root.current!.closest<HTMLElement>('.canvas-viewport')!, rect = viewport.getBoundingClientRect(), inset = viewport.dataset.rulers === 'true' ? 20 : 0
    const point = controller.screenToWorld({ x: event.clientX - rect.left - inset, y: event.clientY - rect.top - inset })
    onPlace(anchorAt(store.getSnapshot(), point))
  }
  return <div ref={root} className="comment-overlay" data-testid="comment-overlay">
    {placing && <div className="comment-placement" data-testid="comment-placement" data-canvas-pointer-tool onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerCancel={() => { down.current = null }} />}
    {threads.map((thread, index) => <button key={thread.id} ref={element => { if (element) pins.current.set(thread.id, element); else pins.current.delete(thread.id) }} className="comment-pin viewport-ui" data-testid="comment-pin" data-active={thread.id === activeId} data-resolved={thread.status === 'resolved'} data-unread={unread.has(thread.id)} aria-label={`Comment ${index + 1}${thread.status === 'resolved' ? ', resolved' : ''}${unread.has(thread.id) ? ', unread' : ''}`} aria-pressed={thread.id === activeId} title={`Comment ${index + 1} · ${thread.status}`} onClick={() => onSelect(thread)}><span>{thread.status === 'resolved' ? <Check size={13} /> : index + 1}</span>{unread.has(thread.id) && <i />}</button>)}
    {draft && <button ref={element => { if (element) pins.current.set('draft', element); else pins.current.delete('draft') }} className="comment-pin comment-pin-draft viewport-ui" aria-label="New comment location" data-active="true"><span><MessageSquare size={13} /></span></button>}
  </div>
}
