import { memo, useLayoutEffect, useRef, useState } from 'react'
import type { ViewportController } from '../canvas'
import type { Point } from '../canvas/types'
import { getWorldBounds } from './geometry'
import { isWithinSelection, measureBounds, measurementHit } from './measurementGeometry'
import { selectionBounds } from './selectionGeometry'
import type { SceneStore } from './store'
import { useScene } from './useScene'
import './measurement.css'

const CANVAS = '@canvas-boundary'

/** Alt hover is sampled once per frame; pointer moves within one target do not re-render the scene. */
export const MeasurementHUD = memo(function MeasurementHUD({ store, controller, suppressed }: { store: SceneStore; controller: ViewportController; suppressed: boolean }) {
  const ref = useRef<SVGSVGElement>(null)
  const state = useScene(store, snapshot => snapshot)
  const [viewportState, setViewportState] = useState(() => controller.getSnapshot())
  const [targetId, setTargetId] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (suppressed) return
    const overlay = ref.current!, viewport = overlay.closest<HTMLElement>('.canvas-viewport')!
    let alt = false, pointer: Point | null = null, frame: number | null = null
    const update = () => {
      frame = null
      if (!alt || !pointer || store.getHistorySnapshot().active || viewport.dataset.space === 'true' || viewport.dataset.panning === 'true' || document.querySelector('[aria-modal="true"]')) { setTargetId(null); return }
      const rect = overlay.getBoundingClientRect()
      const local = { x: pointer.x - rect.left, y: pointer.y - rect.top }
      if (local.x < 0 || local.y < 0 || local.x > rect.width || local.y > rect.height) { setTargetId(null); return }
      const hitUI = document.elementFromPoint(pointer.x, pointer.y)?.closest('.viewport-ui, button, input, textarea, select, [role="dialog"], [role="menu"]')
      const snapshot = store.getSnapshot()
      if (hitUI || !snapshot.selection.length) { setTargetId(null); return }
      const hit = measurementHit(snapshot, controller.screenToWorld(local))
      setTargetId(hit && isWithinSelection(snapshot, hit) ? null : hit ?? CANVAS)
    }
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(update) }
    const move = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; alt = event.altKey; schedule() }
    const leave = () => { pointer = null; setTargetId(null) }
    const keydown = (event: KeyboardEvent) => { alt = event.altKey; schedule() }
    const keyup = (event: KeyboardEvent) => { alt = event.altKey; if (!alt) setTargetId(null); schedule() }
    const blur = () => { alt = false; leave() }
    const unsubscribeCamera = controller.subscribe(snapshot => { setViewportState(snapshot); schedule() })
    const unsubscribeScene = store.subscribe(schedule)
    viewport.addEventListener('pointermove', move)
    viewport.addEventListener('pointerleave', leave)
    document.addEventListener('keydown', keydown)
    document.addEventListener('keyup', keyup)
    window.addEventListener('blur', blur)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      unsubscribeCamera(); unsubscribeScene()
      viewport.removeEventListener('pointermove', move)
      viewport.removeEventListener('pointerleave', leave)
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', blur)
      blur()
    }
  }, [store, controller, suppressed])

  const selected = selectionBounds(state, state.selection)
  const target = targetId === CANVAS ? viewportState.visibleBounds : targetId && state.elements[targetId] ? getWorldBounds(state, targetId) : null
  const show = !suppressed && selected && target
  const { camera, size } = viewportState
  const screen = (point: Point): Point => ({ x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y })
  return <svg ref={ref} className="measurement-hud" aria-hidden="true" data-testid="measurement-hud" data-visible={!!show} data-measure-target={show ? targetId === CANVAS ? 'canvas' : targetId : undefined}>
    {show && <>
      {targetId !== CANVAS && <rect className="measurement-target" x={target.x * camera.zoom + camera.x} y={target.y * camera.zoom + camera.y} width={target.width * camera.zoom} height={target.height * camera.zoom} />}
      {measureBounds(selected, target).map((guide, index) => {
        const start = screen(guide.start), end = screen(guide.end), startEdge = screen(guide.startEdge), endEdge = screen(guide.endEdge)
        const horizontal = guide.axis === 'horizontal'
        const aligned = guide.distance < .005
        const label = `${Number(guide.distance.toFixed(1))} px`
        const width = label.length * 6 + 12
        const midX = (start.x + end.x) / 2, midY = (start.y + end.y) / 2
        const x = Math.max(width / 2 + 4, Math.min(size.width - width / 2 - 4, midX + (horizontal ? 0 : width / 2 + 8)))
        const y = Math.max(14, Math.min(size.height - 14, midY - (horizontal ? 12 : 0)))
        return <g key={index} className={aligned ? 'distance-guide is-aligned' : 'distance-guide'} data-axis={guide.axis} data-distance={Number(guide.distance.toFixed(3))}>
          <path className="measurement-projection" d={`M${startEdge.x} ${startEdge.y}L${start.x} ${start.y} M${endEdge.x} ${endEdge.y}L${end.x} ${end.y}`} />
          <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          <path d={horizontal ? `M${start.x} ${start.y - 3}v6 M${end.x} ${end.y - 3}v6` : `M${start.x - 3} ${start.y}h6 M${end.x - 3} ${end.y}h6`} />
          <rect className="measurement-badge" x={x - width / 2} y={y - 9} width={width} height={18} rx={3} />
          <text x={x} y={y} dominantBaseline="central" textAnchor="middle">{label}</text>
        </g>
      })}
    </>}
  </svg>
})
