import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, Waves, X } from 'lucide-react'
import type { ViewportController } from '../canvas/ViewportController'
import type { Point } from '../canvas/types'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import { containBody, DEFAULT_PHYSICS, magneticTarget, PHYSICS_PRESETS, PhysicsClock, stepPhysics } from './simulation'
import type { PhysicsBody, PhysicsSettings } from './simulation'
import { createPhysicsScene } from './scene'
import './physics.css'

const controls = [
  { key: 'mass', label: 'Mass', min: .2, max: 5, step: .1, unit: 'kg' },
  { key: 'stiffness', label: 'Stiffness', min: 20, max: 400, step: 5, unit: 'N/m' },
  { key: 'damping', label: 'Damping', min: 1, max: 40, step: 1, unit: 'N·s/m' },
  { key: 'restitution', label: 'Bounce', min: 0, max: 1, step: .05, unit: '' },
] as const

export function PhysicsOverlay({ store, controller, onExit }: { store: SceneStore; controller: ViewportController; onExit?: () => void }) {
  const overlay = useRef<HTMLDivElement>(null)
  const world = useRef<SVGGElement>(null)
  const readout = useRef<HTMLOutputElement>(null)
  const snapshot = useScene(store, state => state)
  const scene = useMemo(() => createPhysicsScene(store, snapshot), [store, snapshot])
  const [settings, setSettings] = useState<PhysicsSettings>(DEFAULT_PHYSICS)
  const [preset, setPreset] = useState('balanced')
  const [paused, setPaused] = useState(false)
  const settingsRef = useRef(settings)
  const pausedRef = useRef(paused)
  const runtime = useRef({ wake: () => {}, reset: () => {}, cancelDrag: () => {}, paint: () => {} })
  useLayoutEffect(() => { settingsRef.current = settings; pausedRef.current = paused; if (paused) runtime.current.cancelDrag(); runtime.current.paint(); runtime.current.wake() }, [settings, paused])

  useLayoutEffect(() => {
    const root = overlay.current!
    const viewport = root.closest<HTMLElement>('.canvas-viewport')!
    const nodes = new Map(Array.from(viewport.querySelectorAll<HTMLElement>('.viewport-world .scene-node')).map(node => [node.dataset.elementId!, node]))
    const lines = new Map(Array.from(root.querySelectorAll<SVGLineElement>('[data-spring]')).map(line => [line.dataset.spring!, line]))
    const magnets = new Map(Array.from(root.querySelectorAll<SVGCircleElement>('[data-magnet]')).map(circle => [circle.dataset.magnet!, circle]))
    const originals = new Map(scene.bodies.map(body => { const node = nodes.get(body.id); return [body.id, { translate: node?.style.translate ?? '', willChange: node?.style.willChange ?? '' }] }))
    const clock = new PhysicsClock()
    const positions = new Float64Array(scene.bodies.length * 2)
    let frame = 0, last = 0, stillFrames = 0
    let drag: { body: PhysicsBody; pointerId: number; offset: Point; last: Point; time: number } | null = null
    let disposed = false
    const paint = () => {
      let speed = 0
      for (const body of scene.bodies) {
        const dx = body.x - body.home.x, dy = body.y - body.home.y
        const node = nodes.get(body.id), basis = scene.basis.get(body.id)!
        // Inverse parent rotation maps world displacement into nested local coordinates.
        if (node) { node.style.translate = `${basis.a * dx + basis.b * dy}px ${basis.c * dx + basis.d * dy}px`; node.style.willChange = 'translate' }
        const line = lines.get(body.id)
        if (line) { line.setAttribute('x2', String(body.x + body.width / 2)); line.setAttribute('y2', String(body.y + body.height / 2)); line.style.visibility = settingsRef.current.tether ? 'visible' : 'hidden' }
        const target = !settingsRef.current.tether && settingsRef.current.magnets ? magneticTarget(body, scene.arena) : null
        const magnet = magnets.get(body.id)
        if (magnet) { magnet.style.visibility = target ? 'visible' : 'hidden'; if (target) { magnet.setAttribute('cx', String(target.x + body.width / 2)); magnet.setAttribute('cy', String(target.y + body.height / 2)) } }
        speed = Math.max(speed, Math.hypot(body.vx, body.vy))
      }
      if (readout.current) readout.current.value = `${Math.round(speed)} px/s`
    }
    const tick = (now: number) => {
      frame = 0
      if (disposed || pausedRef.current || document.hidden) { last = 0; return }
      scene.bodies.forEach((body, index) => { positions[index * 2] = body.x; positions[index * 2 + 1] = body.y })
      let active = false
      clock.advance(last ? (now - last) / 1000 : 1 / 60, () => { active = stepPhysics(scene.bodies, scene.arena, settingsRef.current) || active })
      last = now
      paint()
      const moved = scene.bodies.some((body, index) => Math.hypot(body.x - positions[index * 2], body.y - positions[index * 2 + 1]) > .001)
      stillFrames = moved || drag ? 0 : stillFrames + 1
      if ((active || drag) && stillFrames < 60) frame = requestAnimationFrame(tick)
      else { last = 0; clock.reset() }
    }
    const wake = () => { stillFrames = 0; if (!frame && !pausedRef.current && !document.hidden && !disposed) frame = requestAnimationFrame(tick) }
    const point = (event: PointerEvent): Point => {
      const rect = root.getBoundingClientRect()
      return controller.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    const finish = (cancel = false) => {
      if (!drag) return
      const previous = drag; drag = null
      previous.body.held = false
      if (cancel || performance.now() - previous.time > 90) { previous.body.vx = 0; previous.body.vy = 0 }
      root.dataset.dragging = 'false'
      if (root.hasPointerCapture(previous.pointerId)) root.releasePointerCapture(previous.pointerId)
      wake()
    }
    const down = (event: PointerEvent) => {
      if (drag || pausedRef.current || event.button !== 0 || viewport.dataset.space === 'true' || viewport.dataset.panning === 'true' || viewport.dataset.panMode === 'true' || (event.target as Element).closest('.viewport-ui')) return
      const p = point(event)
      const body = [...scene.bodies].reverse().find(body => p.x >= body.x && p.x <= body.x + body.width && p.y >= body.y && p.y <= body.y + body.height)
      if (!body) return
      event.preventDefault(); event.stopPropagation()
      body.held = true; body.vx = 0; body.vy = 0
      drag = { body, pointerId: event.pointerId, offset: { x: p.x - body.x, y: p.y - body.y }, last: { x: body.x, y: body.y }, time: performance.now() }
      root.setPointerCapture(event.pointerId); root.dataset.dragging = 'true'; wake()
    }
    const move = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return
      const p = point(event), now = performance.now(), dt = Math.max(.004, (now - drag.time) / 1000)
      const body = drag.body
      body.x = p.x - drag.offset.x; body.y = p.y - drag.offset.y
      containBody(body, scene.arena, 0)
      body.vx = Math.max(-2400, Math.min(2400, (body.x - drag.last.x) / dt))
      body.vy = Math.max(-2400, Math.min(2400, (body.y - drag.last.y) / dt))
      drag.last = { x: body.x, y: body.y }; drag.time = now
      paint(); wake()
    }
    const up = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) finish(event.type !== 'pointerup') }
    const blur = () => { finish(true); last = 0; clock.reset() }
    const visibility = () => { blur(); if (!document.hidden) wake() }
    const camera = () => {
      const { x, y, zoom } = controller.getSnapshot().camera
      world.current?.setAttribute('transform', `translate(${x} ${y}) scale(${zoom})`)
    }
    const unsubscribeCamera = controller.subscribe(camera)
    camera(); paint()
    runtime.current = { wake, paint, cancelDrag: () => finish(true), reset: () => {
      finish(true)
      cancelAnimationFrame(frame); frame = 0
      for (const body of scene.bodies) { body.x = body.home.x; body.y = body.home.y; body.vx = 0; body.vy = 0 }
      clock.reset(); last = 0; paint()
    } }
    root.addEventListener('pointerdown', down)
    root.addEventListener('pointermove', move)
    root.addEventListener('pointerup', up)
    root.addEventListener('pointercancel', up)
    root.addEventListener('lostpointercapture', up)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      disposed = true; finish(true); cancelAnimationFrame(frame); unsubscribeCamera()
      runtime.current = { wake: () => {}, reset: () => {}, cancelDrag: () => {}, paint: () => {} }
      for (const [id, original] of originals) { const node = nodes.get(id); if (node) { node.style.translate = original.translate; node.style.willChange = original.willChange } }
      root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', up); root.removeEventListener('lostpointercapture', up)
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility)
    }
  }, [scene, controller])


  return <div ref={overlay} className="physics-overlay" data-testid="physics-overlay" data-canvas-pointer-tool onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onExit?.() } }}>
    <svg className="physics-guides" aria-hidden="true"><g ref={world}>
      <rect className="physics-arena" {...scene.arena} />
      {scene.bodies.map(body => <g key={body.id}>
        <circle className="physics-anchor" cx={body.home.x + body.width / 2} cy={body.home.y + body.height / 2} r={4} />
        <line className="physics-spring" data-spring={body.id} x1={body.home.x + body.width / 2} y1={body.home.y + body.height / 2} x2={body.home.x + body.width / 2} y2={body.home.y + body.height / 2} />
        <circle className="physics-magnet" data-magnet={body.id} r={10} />
      </g>)}
    </g></svg>
    <section className="physics-panel viewport-ui" aria-label="Spring dynamics" data-testid="physics-panel">
      <header><span><Waves size={15} />Spring dynamics</span><button aria-label="Close physics simulation" onClick={onExit}><X size={15} /></button></header>
      <div className="physics-status"><span className={paused ? '' : 'physics-live'} />{paused ? 'PAUSED' : 'SIMULATION PREVIEW'}<output ref={readout} aria-label="Maximum velocity">0 px/s</output></div>
      <p>Drag and release to feel the motion. Select layers before opening to isolate them.</p>
      <div className="physics-presets" role="group" aria-label="Physics presets">{Object.entries(PHYSICS_PRESETS).map(([key, value]) => <button key={key} aria-pressed={preset === key} onClick={() => { setPreset(key); setSettings(current => ({ ...current, mass: value.mass, stiffness: value.stiffness, damping: value.damping, restitution: value.restitution })) }}>{value.label}</button>)}</div>
      <div className="physics-parameters">{controls.map(control => <label key={control.key}>
        <span>{control.label}<output>{Number(settings[control.key].toFixed(2))} <small>{control.unit}</small></output></span>
        <input type="range" aria-label={control.label} min={control.min} max={control.max} step={control.step} value={settings[control.key]} onChange={event => { setPreset('custom'); setSettings(current => ({ ...current, [control.key]: Number(event.target.value) })) }} />
      </label>)}</div>
      <div className="physics-options">{([{ key: 'tether', label: 'Spring to origin' }, { key: 'magnets', label: 'Magnetic grid · 120 px' }, { key: 'collisions', label: 'Node collisions' }] as const).map(option => <label key={option.key} title={option.key === 'magnets' && settings.tether ? 'Turn off Spring to origin to snap to the grid' : undefined}><input type="checkbox" checked={settings[option.key]} disabled={option.key === 'magnets' && settings.tether} onChange={event => setSettings(current => ({ ...current, [option.key]: event.target.checked }))} />{option.label}</label>)}</div>
      <div className="physics-actions"><button onClick={() => setPaused(value => !value)}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? 'Resume' : 'Pause'}</button><button onClick={() => runtime.current.reset()}><RotateCcw size={13} />Reset</button></div>
      <footer>{scene.bodies.length ? `${scene.bodies.length} ${scene.bodies.length === 1 ? 'body' : 'bodies'}${scene.omitted ? ` · ${scene.omitted} over limit` : ''} · Exit restores your design` : 'Select an unlocked, visible layer to simulate.'}</footer>
    </section>
  </div>
}
