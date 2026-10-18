import { useLayoutEffect, useRef, useState } from 'react'
import type { ViewportController } from '../canvas/ViewportController'
import type { Bounds, Point } from '../canvas/types'
import { getWorldBounds } from '../scene/geometry'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import { EMPTY_PROTOTYPE, frameFor, TRIGGERS } from './model'

const wirePath = (a: Point, b: Point) => {
  const bend = Math.max(60, Math.abs(b.x - a.x) * .5)
  return `M${a.x},${a.y} C${a.x + bend},${a.y} ${b.x - bend},${b.y} ${b.x},${b.y}`
}

export function ConnectionWires({ store, controller, selectedId, onSelect, panMode }: {
  store: SceneStore; controller: ViewportController; selectedId: string | null; onSelect: (id: string | null) => void; panMode: boolean
}) {
  const ref = useRef<SVGSVGElement>(null)
  const state = useScene(store, value => value)
  const [camera, setCamera] = useState(() => controller.getSnapshot().camera)
  const [draft, setDraft] = useState<{ pointerId: number; sourceId: string; end: Point; targetId: string | null } | null>(null)
  const prototype = state.prototype ?? EMPTY_PROTOTYPE
  const selected = state.selection.length === 1 ? state.elements[state.selection[0]] : undefined
  const canConnect = selected && frameFor(state.elements, selected.id) && store.isVisible(selected.id)
  const screen = (bounds: Bounds): Bounds => ({ x: bounds.x * camera.zoom + camera.x, y: bounds.y * camera.zoom + camera.y, width: bounds.width * camera.zoom, height: bounds.height * camera.zoom })
  const box = (id: string) => screen(getWorldBounds(state, id))
  const output = (id: string): Point => { const b = box(id); return { x: b.x + b.width + 12, y: b.y + b.height / 2 } }
  const input = (id: string): Point => { const b = box(id); return { x: b.x - 4, y: b.y + b.height / 2 } }
  useLayoutEffect(() => controller.subscribe(value => setCamera(value.camera)), [controller])

  useLayoutEffect(() => {
    const viewport = ref.current!.parentElement!
    const select = (event: PointerEvent) => {
      if (event.button !== 0 || panMode || viewport.dataset.space === 'true' || viewport.dataset.panning === 'true' || (event.target as Element).closest('.viewport-ui')) return
      const hit = (event.target as Element).closest<HTMLElement>('[data-element-id]')
      store.select(hit?.dataset.elementId ? [hit.dataset.elementId] : [])
      onSelect(null)
    }
    viewport.addEventListener('pointerdown', select)
    return () => viewport.removeEventListener('pointerdown', select)
  }, [store, panMode, onSelect])

  const selectedBounds = canConnect ? box(selected.id) : null
  return <svg ref={ref} className="prototype-wires" aria-label="Prototype connections" data-testid="prototype-wires">
    <defs><marker id="prototype-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L7 4L1 7" fill="none" stroke="#81adec" strokeWidth="1.5" /></marker></defs>
    {prototype.startFrameId && state.elements[prototype.startFrameId] && store.isVisible(prototype.startFrameId) && (() => {
      const b = box(prototype.startFrameId)
      return <g className="prototype-start" transform={`translate(${b.x},${b.y - 48})`}><rect width="84" height="20" rx="4" /><path d="M8 6L8 14L14 10Z" /><text x="20" y="13">Flow start</text></g>
    })()}
    {prototype.interactions.filter(item => store.isVisible(item.sourceId) && store.isVisible(item.targetId)).map(item => {
      const a = output(item.sourceId), b = input(item.targetId), path = wirePath(a, b)
      const active = selectedId === item.id
      return <g key={item.id} data-testid={`connection-${item.id}`} className={`prototype-wire ${active ? 'active' : ''}`}>
        <path className="prototype-wire-line" d={path} markerEnd="url(#prototype-arrow)" />
        <path className="prototype-wire-hit viewport-ui" d={path} role="button" tabIndex={panMode ? -1 : 0} aria-label={`${TRIGGERS[item.trigger]}: ${state.elements[item.sourceId]?.name} to ${state.elements[item.targetId]?.name}`} onClick={() => { store.select([item.sourceId]); onSelect(item.id) }} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); store.select([item.sourceId]); onSelect(item.id) }
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); store.removeInteraction(item.id); onSelect(null) }
        }} />
        <circle className="prototype-wire-dot" cx={a.x} cy={a.y} r="3" />
        {active && <g className="prototype-wire-label" transform={`translate(${(a.x + b.x) / 2 - 38},${(a.y + b.y) / 2 - 12})`}><rect width="76" height="24" rx="5" /><text x="38" y="15" textAnchor="middle">{TRIGGERS[item.trigger]}</text></g>}
      </g>
    })}
    {draft && <>
      {draft.targetId && (() => { const b = box(draft.targetId); return <rect className="prototype-target" x={b.x} y={b.y} width={b.width} height={b.height} rx="2" /> })()}
      <path className="prototype-draft" d={wirePath(output(draft.sourceId), draft.targetId ? input(draft.targetId) : draft.end)} markerEnd="url(#prototype-arrow)" />
    </>}
    {selected && selectedBounds && !panMode && <g>
      <rect className="prototype-selection" x={selectedBounds.x} y={selectedBounds.y} width={selectedBounds.width} height={selectedBounds.height} />
      <g className="prototype-handle viewport-ui" data-testid="prototype-connect-handle" role="button" tabIndex={0} aria-label="Drag to connect a frame" transform={`translate(${output(selected.id).x},${output(selected.id).y})`} onKeyDown={event => { if (event.key === 'Enter') document.querySelector<HTMLButtonElement>('[data-testid="add-interaction"]')?.focus() }} onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
        setDraft({ pointerId: event.pointerId, sourceId: selected.id, end: output(selected.id), targetId: null })
      }} onPointerMove={event => {
        if (!draft || draft.pointerId !== event.pointerId) return
        const rect = ref.current!.getBoundingClientRect(), end = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const hit = document.elementsFromPoint(event.clientX, event.clientY).map(node => node.closest<HTMLElement>('[data-element-id]')).find(Boolean)
        let candidate = hit?.dataset.elementId ? state.elements[hit.dataset.elementId] : undefined
        while (candidate && candidate.type !== 'frame') candidate = candidate.parentId ? state.elements[candidate.parentId] : undefined
        const targetId = candidate?.type === 'frame' && candidate.id !== draft.sourceId && candidate.id !== frameFor(state.elements, draft.sourceId) ? candidate.id : null
        setDraft({ ...draft, end, targetId })
      }} onPointerUp={event => {
        if (!draft || draft.pointerId !== event.pointerId) return
        if (draft.targetId && !store.getHistorySnapshot().active) onSelect(store.connectPrototype(draft.sourceId, draft.targetId).id)
        setDraft(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }} onPointerCancel={() => setDraft(null)} onLostPointerCapture={() => setDraft(null)}>
        <circle r="8" /><path d="M-3 0H3M0-3V3" />
      </g>
    </g>}
  </svg>
}
