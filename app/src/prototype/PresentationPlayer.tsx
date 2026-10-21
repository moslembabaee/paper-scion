import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, Ref } from 'react'
import { ArrowLeft, Eye, Monitor, Pause, Play, RotateCcw, Smartphone, Sparkles, X } from 'lucide-react'
import { Dialog } from '../workspace/Dialog'
import { SceneRenderer } from '../scene/SceneRenderer'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import { DEFAULT_TRANSITION, easingCSS, easingCurve, easeProgress, EMPTY_PROTOTYPE, isDescendant, isVisible, matchedLayers, presentationExtent, smartKeyframes, transitionDuration, transitionFrames, transitionProgress } from './model'
import type { PrototypeInteraction, PrototypeTransition } from './types'
import { componentRoot } from '../scene/components'
import { getEffectiveStateMachine, resolveNextState } from '../scene/stateMachine'
import { DEFAULT_SPRING, springCSS as componentSpringCSS, springDuration as componentSpringDuration, springProgress } from './spring'
import type { ComponentStateTrigger } from '../scene/types'
import { computeScreenDiff, evaluateSmartMatrix, interpolateColor, interpolateSmartPath, smartTransitionProgress } from './smartAnimate'
import { SmartAnimateOverlay } from './SmartAnimateOverlay'
import { SmartGhostOverlay } from './SmartGhostOverlay'

interface Playback { frameId: string; overlayId: string | null }
interface Motion { fromId: string | null; toId: string; overlay: boolean; transition: PrototypeTransition; scrollTop: number; scrollLeft: number }
const DEVICE_SIZES = { phone: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } }

export function PresentationPlayer({ store, onClose }: { store: SceneStore; onClose: () => void }) {
  const state = useScene(store, value => value), prototype = state.prototype ?? EMPTY_PROTOTYPE
  const frames = Object.values(state.elements).filter(node => node.type === 'frame' && isVisible(state.elements, node.id))
  const initial = prototype.startFrameId && isVisible(state.elements, prototype.startFrameId) ? prototype.startFrameId : frames.find(frame => frame.parentId === null)?.id ?? frames[0]?.id ?? ''
  const [playback, setPlayback] = useState<Playback>({ frameId: initial, overlayId: null })
  const [history, setHistory] = useState<Playback[]>([])
  const [motion, setMotion] = useState<Motion | null>(null)
  const [smartHudOpen, setSmartHudOpen] = useState(false)
  const [scrubProgress, setScrubProgress] = useState<number | null>(null)
  const [showGhosts, setShowGhosts] = useState(false)
  const [lastScreenPair, setLastScreenPair] = useState<{ fromId: string; toId: string; transition: PrototypeTransition } | null>(null)
  const [playing, setPlaying] = useState(true)
  const [hotspots, setHotspots] = useState(false)
  const [flashHotspots, setFlashHotspots] = useState(false)
  const flashTimer = useRef(0)
  const [delayEpoch, setDelayEpoch] = useState(0)
  const [available, setAvailable] = useState({ width: 800, height: 600 })
  const areaRef = useRef<HTMLDivElement>(null), currentRef = useRef<HTMLDivElement>(null), previousRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null), previousOverlayRef = useRef<HTMLDivElement>(null)
  const busy = useRef(false), scrollFrame = useRef(0), suppressClick = useRef(false)
  const gesture = useRef<{ pointerId: number; x: number; y: number; interaction: PrototypeInteraction | null } | null>(null)
  const frame = state.elements[playback.frameId]
  const activeFrameId = playback.overlayId ?? playback.frameId
  const size = prototype.device === 'none' ? { width: frame?.width ?? 720, height: frame?.height ?? 480 } : DEVICE_SIZES[prototype.device]
  const bezel = prototype.device === 'none' ? 0 : prototype.device === 'desktop' ? 28 : 36
  const scale = Math.min(1, Math.max(.05, (available.width - 64) / (size.width + bezel)), Math.max(.05, (available.height - 64) / (size.height + bezel)))
  const interactions = useMemo(() => prototype.interactions.filter(item => isDescendant(state.elements, item.sourceId, activeFrameId) && isVisible(state.elements, item.sourceId) && isVisible(state.elements, item.targetId)), [prototype.interactions, state.elements, activeFrameId])
  const delayScope = useRef<{ frameId: string; epoch: number; interactions: typeof interactions; remaining: Map<string, number> } | null>(null)

  const defaultSmartPair = useMemo(() => {
    const smartInteraction = prototype.interactions.find(item =>
      (item.sourceId === playback.frameId || isDescendant(state.elements, item.sourceId, playback.frameId)) &&
      item.transition.kind === 'smart' &&
      isVisible(state.elements, item.targetId)
    )
    if (smartInteraction) {
      return {
        fromId: playback.frameId,
        toId: smartInteraction.targetId,
        transition: smartInteraction.transition,
      }
    }
    const anyInteraction = prototype.interactions.find(item =>
      (item.sourceId === playback.frameId || isDescendant(state.elements, item.sourceId, playback.frameId)) &&
      isVisible(state.elements, item.targetId)
    )
    if (anyInteraction) {
      return {
        fromId: playback.frameId,
        toId: anyInteraction.targetId,
        transition: anyInteraction.transition.kind === 'smart' ? anyInteraction.transition : { ...anyInteraction.transition, kind: 'smart' as const },
      }
    }
    if (frames.length >= 2) {
      const other = frames.find(f => f.id !== playback.frameId) ?? frames[1]
      return {
        fromId: playback.frameId,
        toId: other.id,
        transition: { ...DEFAULT_TRANSITION, kind: 'smart' as const },
      }
    }
    return null
  }, [prototype.interactions, playback.frameId, state.elements, frames])

  const effectiveScreenPair = lastScreenPair ?? defaultSmartPair

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(areaRef.current!); return () => observer.disconnect()
  }, [])
  useEffect(() => () => { cancelAnimationFrame(scrollFrame.current); window.clearTimeout(flashTimer.current) }, [])

  const cancelMotion = useCallback(() => {
    cancelAnimationFrame(scrollFrame.current)
    for (const ref of [currentRef, previousRef, overlayRef, previousOverlayRef]) ref.current?.getAnimations({ subtree: true }).forEach(animation => animation.cancel())
    busy.current = false; setMotion(null)
  }, [])

  const execute = useCallback((interaction: PrototypeInteraction) => {
    if (!playing || !state.elements[interaction.targetId]) return
    if (busy.current) cancelMotion()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const transition = reduced ? { ...interaction.transition, kind: 'instant' as const } : interaction.transition
    if (interaction.action === 'scroll') {
      const layer = playback.overlayId ? overlayRef.current : currentRef.current
      const scroller = layer?.querySelector<HTMLElement>('.prototype-screen-scroll')
      const target = [...(layer?.querySelectorAll<HTMLElement>('[data-element-id]') ?? [])].find(element => element.dataset.elementId === interaction.targetId)
      if (!scroller || !target) return
      const a = scroller.getBoundingClientRect(), b = target.getBoundingClientRect()
      const start = { x: scroller.scrollLeft, y: scroller.scrollTop }
      const end = {
        x: Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, start.x + (b.left - a.left) / scale)),
        y: Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, start.y + (b.top - a.top) / scale)),
      }
      const duration = transitionDuration(transition)
      cancelAnimationFrame(scrollFrame.current)
      if (duration === 0) { scroller.scrollLeft = end.x; scroller.scrollTop = end.y; return }
      busy.current = true
      const startTime = performance.now()
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startTime) / duration)
        const eased = transitionProgress(progress, transition, duration)
        scroller.scrollLeft = start.x + (end.x - start.x) * eased
        scroller.scrollTop = start.y + (end.y - start.y) * eased
        if (progress < 1) scrollFrame.current = requestAnimationFrame(tick)
        else busy.current = false
      }
      scrollFrame.current = requestAnimationFrame(tick)
      return
    }
    const overlay = interaction.action === 'overlay', fromId = overlay ? playback.overlayId : playback.frameId
    if (interaction.targetId === fromId) return
    setHistory(previous => [...previous.slice(-99), playback])
    busy.current = true
    const previous = overlay ? overlayRef.current : currentRef.current
    const scrollTop = previous?.querySelector<HTMLElement>('.prototype-screen-scroll')?.scrollTop ?? 0
    const scrollLeft = previous?.querySelector<HTMLElement>('.prototype-screen-scroll')?.scrollLeft ?? 0
    setLastScreenPair({ fromId: fromId ?? playback.frameId, toId: interaction.targetId, transition })
    setMotion({ fromId, toId: interaction.targetId, overlay, transition, scrollTop, scrollLeft })
    setPlayback(overlay ? { ...playback, overlayId: interaction.targetId } : { frameId: interaction.targetId, overlayId: null })
  }, [cancelMotion, playing, state.elements, playback, scale])

  useLayoutEffect(() => {
    if (!motion) return
    const incoming = motion.overlay ? overlayRef.current : currentRef.current, outgoing = motion.overlay ? previousOverlayRef.current : previousRef.current
    if (!incoming) { busy.current = false; setMotion(null); return }
    const previousScroll = outgoing?.querySelector<HTMLElement>('.prototype-screen-scroll')
    if (previousScroll) { previousScroll.scrollTop = motion.scrollTop; previousScroll.scrollLeft = motion.scrollLeft }
    let active = true
    const animations: Animation[] = []
    const duration = transitionDuration(motion.transition)
    const options: KeyframeAnimationOptions = { duration, easing: duration ? easingCSS(motion.transition, duration) : 'linear', fill: 'both' }
    const animate = (element: HTMLElement | null, keyframes: Keyframe[]) => { if (element) animations.push(element.animate(keyframes, options)) }
    const keyframes = transitionFrames(motion.transition)
    if (motion.transition.kind === 'smart' && motion.fromId && outgoing) {
      const screenDiff = computeScreenDiff(state.elements, motion.fromId, motion.toId)
      const pairs = matchedLayers(state.elements, motion.fromId, motion.toId), matched = new Set<string>()
      const oldNodes = [...outgoing.querySelectorAll<HTMLElement>('[data-element-id]')], newNodes = [...incoming.querySelectorAll<HTMLElement>('[data-element-id]')]
      const oldIndex = new Map(oldNodes.map(node => [node.dataset.elementId, node]))
      const newIndex = new Map(newNodes.map(node => [node.dataset.elementId, node]))
      const pairIndex = new Map(pairs.map(pair => [pair.to.id, pair]))
      const fromFrame = state.elements[motion.fromId], toFrame = state.elements[motion.toId]
      const incomingFit = incoming.clientWidth / toFrame.width, outgoingFit = outgoing.clientWidth / fromFrame.width

      const morphTargets: { pair: (typeof screenDiff.matched)[number]; pathDom: SVGPathElement; originalD: string; tempPath?: boolean; originalShape?: SVGElement }[] = []
      for (const pair of screenDiff.matched) {
        if (pair.geometryDiff.isMorphable && pair.geometryDiff.preparedMorph) {
          const element = newIndex.get(pair.to.id)
          const svg = element?.querySelector<SVGSVGElement>('.scene-vector')
          let pathDom = svg?.querySelector<SVGPathElement>('path')
          let tempPath = false
          let originalShape: SVGElement | undefined
          if (!pathDom && svg && pair.geometryDiff.toD) {
            const shape = svg.querySelector<SVGElement>('rect, ellipse')
            if (shape) {
              shape.style.display = 'none'
              pathDom = document.createElementNS('http://www.w3.org/2000/svg', 'path')
              pathDom.setAttribute('d', pair.geometryDiff.toD)
              pathDom.setAttribute('fill', pair.to.style.fill ?? 'currentColor')
              if (pair.to.style.stroke) {
                pathDom.setAttribute('stroke', pair.to.style.stroke.color)
                pathDom.setAttribute('stroke-width', String(pair.to.style.stroke.width))
              }
              svg.appendChild(pathDom)
              tempPath = true
              originalShape = shape
            }
          }
          if (pathDom && pair.geometryDiff.toD) {
            morphTargets.push({ pair, pathDom, originalD: pair.geometryDiff.toD, tempPath, originalShape })
          }
        }
      }

      let morphRafId = 0
      if (morphTargets.length > 0 && duration > 0) {
        const morphStart = performance.now()
        const morphTick = (now: number) => {
          if (!active) return
          const elapsed = now - morphStart
          const rawProgress = Math.min(1, Math.max(0, elapsed / duration))
          const easedT = motion.transition.easing === 'spring'
            ? springProgress(rawProgress, motion.transition.spring ?? DEFAULT_SPRING, duration)
            : easeProgress(rawProgress, easingCurve(motion.transition))
          const clampedT = Math.max(0, Math.min(1, easedT))

          for (const item of morphTargets) {
            const morphedD = interpolateSmartPath(item.pair.geometryDiff.preparedMorph, clampedT)
            if (morphedD) {
              item.pathDom.setAttribute('d', morphedD)
            }
          }

          if (rawProgress < 1) {
            morphRafId = requestAnimationFrame(morphTick)
          }
        }
        morphRafId = requestAnimationFrame(morphTick)
      }

      for (const pair of pairs) {
        const element = newIndex.get(pair.to.id)
        const oldElement = oldIndex.get(pair.from.id)
        if (!element || !oldElement) continue
        matched.add(pair.to.id)
        const from = pair.from, to = pair.to
        const parent = to.id === motion.toId ? undefined : pairIndex.get(to.parentId!)
        animate(element, smartKeyframes(from, to, parent, outgoingFit / incomingFit, motion.scrollTop / incomingFit, motion.scrollLeft / incomingFit))
        const paint = element.querySelector<HTMLElement>(':scope > .scene-content')
        animate(paint, [{ opacity: from.style.opacity }, { opacity: to.style.opacity }])
        if (from.type === 'frame' && to.type === 'frame') animate(paint, [{ backgroundColor: from.style.fill ?? 'transparent', borderRadius: `${from.cornerRadius}px` }, { backgroundColor: to.style.fill ?? 'transparent', borderRadius: `${to.cornerRadius}px` }])
        if (from.type === 'text' && to.type === 'text') animate(element.querySelector<HTMLElement>('.scene-text'), [{ color: from.style.fill ?? 'transparent' }, { color: to.style.fill ?? 'transparent' }])
        const svg = element.querySelector<SVGElement>('.scene-vector > rect, .scene-vector > ellipse, .scene-vector > path')
        if (svg) animations.push(svg.animate([{ fill: from.style.fill ?? 'transparent' }, { fill: to.style.fill ?? 'transparent' }], options))
      }
      for (const element of newNodes) if (!matched.has(element.dataset.elementId!)) animate(element, [{ opacity: 0 }, { opacity: 1 }])
      animate(outgoing, [{ opacity: 1 }, { opacity: 0 }])

      const finish = () => {
        if (active) {
          cancelAnimationFrame(morphRafId)
          for (const item of morphTargets) {
            if (item.tempPath) {
              item.pathDom.remove()
              if (item.originalShape) item.originalShape.style.display = ''
            } else {
              item.pathDom.setAttribute('d', item.originalD)
            }
          }
          busy.current = false
          setMotion(null)
        }
      }
      void Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(finish)
      return () => {
        active = false
        cancelAnimationFrame(morphRafId)
        for (const item of morphTargets) {
          if (item.tempPath) {
            item.pathDom.remove()
            if (item.originalShape) item.originalShape.style.display = ''
          } else {
            item.pathDom.setAttribute('d', item.originalD)
          }
        }
        for (const animation of animations) animation.cancel()
      }
    } else {
      animate(incoming, keyframes.incoming)
      if (outgoing) { if (motion.transition.kind === 'slide-out') outgoing.style.zIndex = '2'; animate(outgoing, keyframes.outgoing) }
    }
    const finish = () => { if (active) { busy.current = false; setMotion(null) } }
    void Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(finish)
    return () => { active = false; for (const animation of animations) animation.cancel() }
  }, [motion, state.elements])

  useLayoutEffect(() => {
    if (scrubProgress === null || !effectiveScreenPair || motion) return
    const container = currentRef.current
    if (!container) return

    const screenDiff = computeScreenDiff(state.elements, effectiveScreenPair.fromId, effectiveScreenPair.toId)
    const transition = effectiveScreenPair.transition
    const duration = transitionDuration(transition)
    const easedT = smartTransitionProgress(scrubProgress, transition, duration)
    const clampedProgress = Math.max(0, Math.min(1, easedT))

    const nodes = [...container.querySelectorAll<HTMLElement>('[data-element-id]')]
    const nodeIndex = new Map(nodes.map(n => [n.dataset.elementId!, n]))

    const cleanedStyles: { element: HTMLElement; originalTransform: string; originalOpacity: string }[] = []
    const cleanedMorphs: { pathDom: SVGPathElement; originalD: string; tempPath?: boolean; originalShape?: SVGElement }[] = []

    for (const pair of screenDiff.matched) {
      const element = nodeIndex.get(pair.to.id) ?? nodeIndex.get(pair.from.id)
      if (!element) continue

      cleanedStyles.push({
        element,
        originalTransform: element.style.transform,
        originalOpacity: element.style.opacity,
      })

      const matrix = evaluateSmartMatrix(pair.from, pair.to, easedT)
      element.style.transform = matrix
      element.style.transformOrigin = '0 0'

      const opacity = pair.from.style.opacity + (pair.to.style.opacity - pair.from.style.opacity) * clampedProgress
      element.style.opacity = String(opacity)

      const paint = element.querySelector<HTMLElement>(':scope > .scene-content')
      if (paint && (pair.from.style.fill || pair.to.style.fill)) {
        paint.style.backgroundColor = interpolateColor(pair.from.style.fill, pair.to.style.fill, clampedProgress)
        if ('cornerRadius' in pair.from && 'cornerRadius' in pair.to) {
          const rFrom = (pair.from as { cornerRadius?: number }).cornerRadius ?? 0
          const rTo = (pair.to as { cornerRadius?: number }).cornerRadius ?? 0
          paint.style.borderRadius = `${rFrom + (rTo - rFrom) * clampedProgress}px`
        }
      }

      if (pair.geometryDiff.isMorphable && pair.geometryDiff.preparedMorph) {
        const svg = element.querySelector<SVGSVGElement>('.scene-vector')
        let pathDom = svg?.querySelector<SVGPathElement>('path')
        let tempPath = false
        let originalShape: SVGElement | undefined
        if (!pathDom && svg && pair.geometryDiff.toD) {
          const shape = svg.querySelector<SVGElement>('rect, ellipse')
          if (shape) {
            shape.style.display = 'none'
            pathDom = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            pathDom.setAttribute('d', pair.geometryDiff.toD)
            pathDom.setAttribute('fill', pair.to.style.fill ?? 'currentColor')
            svg.appendChild(pathDom)
            tempPath = true
            originalShape = shape
          }
        }
        if (pathDom) {
          const originalD = pathDom.getAttribute('d') ?? pair.geometryDiff.toD ?? ''
          cleanedMorphs.push({ pathDom, originalD, tempPath, originalShape })
          const morphedD = interpolateSmartPath(pair.geometryDiff.preparedMorph, clampedProgress)
          if (morphedD) {
            pathDom.setAttribute('d', morphedD)
          }
        }
      }
    }

    return () => {
      for (const item of cleanedStyles) {
        item.element.style.transform = item.originalTransform
        item.element.style.transformOrigin = ''
        item.element.style.opacity = item.originalOpacity
        const paint = item.element.querySelector<HTMLElement>(':scope > .scene-content')
        if (paint) {
          paint.style.backgroundColor = ''
          paint.style.borderRadius = ''
        }
      }
      for (const item of cleanedMorphs) {
        if (item.tempPath) {
          item.pathDom.remove()
          if (item.originalShape) item.originalShape.style.display = ''
        } else {
          item.pathDom.setAttribute('d', item.originalD)
        }
      }
    }
  }, [scrubProgress, effectiveScreenPair, state.elements, motion])

  useEffect(() => {
    if (!delayScope.current || delayScope.current.frameId !== activeFrameId || delayScope.current.interactions !== interactions || delayScope.current.epoch !== delayEpoch) {
      delayScope.current = { frameId: activeFrameId, epoch: delayEpoch, interactions, remaining: new Map(interactions.filter(item => item.trigger === 'delay').map(item => [item.id, item.delay])) }
    }
    if (!playing || motion) return
    const scope = delayScope.current, started = performance.now()
    const timers = interactions.filter(item => scope.remaining.has(item.id)).map(item => window.setTimeout(() => {
      scope.remaining.delete(item.id)
      execute(item)
    }, Math.max(16, scope.remaining.get(item.id)!)))
    return () => {
      timers.forEach(window.clearTimeout)
      const elapsed = performance.now() - started
      for (const [id, remaining] of scope.remaining) scope.remaining.set(id, Math.max(0, remaining - elapsed))
    }
  }, [playing, motion, interactions, execute, activeFrameId, delayEpoch])

  useEffect(() => store.subscribe(() => {
    const snapshot = store.getSnapshot()
    if (isVisible(snapshot.elements, playback.frameId) && (!playback.overlayId || isVisible(snapshot.elements, playback.overlayId))) return
    const visibleFrames = Object.values(snapshot.elements).filter(node => node.type === 'frame' && isVisible(snapshot.elements, node.id))
    const start = snapshot.prototype?.startFrameId
    const next = start && isVisible(snapshot.elements, start) ? start : visibleFrames.find(node => node.parentId === null)?.id ?? visibleFrames[0]?.id ?? ''
    cancelMotion(); setPlayback({ frameId: next, overlayId: null }); setHistory([])
  }), [store, playback, cancelMotion])

  const lookup = (target: EventTarget | null, trigger: PrototypeInteraction['trigger']) => {
    let element = target instanceof Element ? target.closest<HTMLElement>('[data-element-id]') : null
    while (element) {
      const found = interactions.find(item => item.sourceId === element!.dataset.elementId && item.trigger === trigger)
      if (found) return found
      element = element.parentElement?.closest<HTMLElement>('[data-element-id]') ?? null
    }
    return null
  }
  const restart = () => {
    cancelMotion()
    const scroller = currentRef.current?.querySelector<HTMLElement>('.prototype-screen-scroll')
    if (scroller) { scroller.scrollTop = 0; scroller.scrollLeft = 0 }
    setDelayEpoch(value => value + 1)
    setPlayback({ frameId: initial, overlayId: null }); setHistory([]); setPlaying(true)
  }
  const back = () => {
    cancelMotion()
    const previous = history.at(-1)
    if (previous) { setPlayback(previous); setHistory(value => value.slice(0, -1)) }
  }
  const pointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    suppressClick.current = false
    const interaction = lookup(event.target, 'drag')
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, interaction }
    if (interaction) { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }
  }
  const triggerComponentTransition = (target: EventTarget | null, trigger: ComponentStateTrigger) => {
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-element-id]') : null
    const id = element?.dataset.elementId
    if (!id) return false
    const snapshot = store.getSnapshot()
    const root = componentRoot(snapshot.elements, id)
    if (root?.component?.kind !== 'instance') return false
    const master = snapshot.elements[root.component.masterId]
    const machine = getEffectiveStateMachine(master)
    if (!machine) return false
    const currentState = root.component.activeState ?? machine.initial
    const next = resolveNextState(machine, currentState, trigger)
    if (next) {
      const dom = element.closest<HTMLElement>(`[data-element-id="${root.id}"]`)
      if (dom) {
        const duration = componentSpringDuration(next.transition.spring)
        const easing = componentSpringCSS(next.transition.spring, duration)
        dom.style.transition = `all ${duration}ms ${easing}`
        window.setTimeout(() => { dom.style.transition = '' }, duration + 50)
      }
      store.setComponentActiveState(root.id, next.targetState, false)
      return true
    }
    return false
  }
  const overlaySize = (id: string) => { const node = state.elements[id]; return { width: Math.min(node.width, size.width * .9), height: Math.min(node.height, size.height * .9) } }

  return <Dialog className="prototype-player" labelledBy="prototype-player-title" onClose={onClose}>
    <header className="prototype-player-header"><div><span className="prototype-player-kicker">PAPER / PRESENTATION</span><h2 id="prototype-player-title">{frame?.name ?? 'No frames yet'}</h2></div><button className="quiet-button" aria-label="Close presentation" onClick={onClose}><X size={18} /></button></header>
    <div className="prototype-player-area" ref={areaRef}>
      {frame ? <div className={`prototype-device device-${prototype.device}`} style={{ width: size.width + bezel, height: size.height + bezel, transform: `scale(${scale})` }}>
        {prototype.device === 'phone' && <div className="prototype-device-island" aria-hidden="true" />}
        {prototype.device === 'desktop' && <div className="prototype-device-camera" aria-hidden="true" />}
        <div className={`prototype-display ${hotspots || flashHotspots ? 'show-hotspots' : ''}`} data-testid="prototype-display" data-frame-id={playback.frameId} data-overlay-id={playback.overlayId ?? ''} data-playing={playing} style={{ width: size.width, height: size.height }} onClick={event => {
          if (suppressClick.current) { suppressClick.current = false; return }
          const interaction = lookup(event.target, 'click'); if (interaction) execute(interaction)
          else {
            const handled = triggerComponentTransition(event.target, 'on-click')
            if (!handled && !hotspots) {
              setFlashHotspots(true)
              window.clearTimeout(flashTimer.current)
              flashTimer.current = window.setTimeout(() => setFlashHotspots(false), 450)
            }
          }
        }} onPointerOver={event => {
          if (event.pointerType === 'touch') return
          const interaction = lookup(event.target, 'hover')
          const source = interaction && [...event.currentTarget.querySelectorAll<HTMLElement>('[data-element-id]')].find(node => node.dataset.elementId === interaction.sourceId)
          if (interaction && !(event.relatedTarget instanceof Node && source?.contains(event.relatedTarget))) execute(interaction)
          else triggerComponentTransition(event.target, 'on-hover')
        }} onPointerDown={event => {
          pointerDown(event)
          triggerComponentTransition(event.target, 'while-pressed')
        }} onPointerUp={event => {
          const drag = gesture.current; gesture.current = null
          if (drag?.pointerId === event.pointerId && drag.interaction && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 24) { suppressClick.current = true; execute(drag.interaction) }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }} onPointerCancel={() => { gesture.current = null }} onKeyDown={event => {
          if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.hasAttribute('data-hotspot')) { event.preventDefault(); const interaction = lookup(event.target, 'click'); if (interaction) execute(interaction) }
        }}>
          {motion && !motion.overlay && motion.fromId && <PlayerLayer ref={previousRef} store={store} frameId={motion.fromId} width={size.width} height={size.height} inert />}
          <PlayerLayer key={playback.frameId} ref={currentRef} store={store} frameId={playback.frameId} width={size.width} height={size.height} inert={!!playback.overlayId} />
          {playback.overlayId && <div className="prototype-overlay-backdrop" onClick={event => { if (event.target === event.currentTarget && playing) { event.stopPropagation(); back() } }}>
            {motion?.overlay && motion.fromId && <PlayerLayer ref={previousOverlayRef} store={store} frameId={motion.fromId} {...overlaySize(motion.fromId)} overlay inert />}
            <PlayerLayer key={playback.overlayId} ref={overlayRef} store={store} frameId={playback.overlayId} {...overlaySize(playback.overlayId)} overlay />
          </div>}
          {showGhosts && effectiveScreenPair && (
            <SmartGhostOverlay
              screenDiff={computeScreenDiff(state.elements, effectiveScreenPair.fromId, effectiveScreenPair.toId)}
              width={size.width}
              height={size.height}
            />
          )}
        </div>
      </div> : <div className="prototype-player-empty"><Monitor size={32} /><p>Add a frame to present your design.</p></div>}
    </div>
    <footer className="prototype-player-footer"><div className="prototype-playback-controls"><button className="quiet-button" aria-label="Go back" disabled={!history.length && !playback.overlayId} onClick={back}><ArrowLeft size={16} /></button><button className="quiet-button" aria-label="Restart prototype" onClick={restart}><RotateCcw size={15} /></button><button className="prototype-play-toggle" aria-label={playing ? 'Pause prototype' : 'Resume prototype'} onClick={() => { cancelMotion(); setPlaying(value => !value) }}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><span>{playing ? 'Playing' : 'Paused'}</span></div><span className="prototype-player-screen" role="status">{playback.overlayId ? `Overlay · ${state.elements[playback.overlayId]?.name}` : `${frames.findIndex(node => node.id === playback.frameId) + 1} / ${frames.length}`}</span><div className="prototype-player-options">{effectiveScreenPair && <button className={`quiet-button ${smartHudOpen ? 'active' : ''}`} aria-label="Smart Animate Inspector" title="Smart Animate Morph & Physics Inspector" onClick={() => setSmartHudOpen(!smartHudOpen)}><Sparkles size={15} /></button>}<button className={`quiet-button ${hotspots ? 'active' : ''}`} aria-label="Show interaction hotspots" aria-pressed={hotspots} onClick={() => setHotspots(!hotspots)}><Eye size={16} /></button>{prototype.device === 'phone' ? <Smartphone size={13} /> : <Monitor size={13} />}<span>{Math.round(scale * 100)}%</span></div></footer>
    {smartHudOpen && effectiveScreenPair && (
      <SmartAnimateOverlay
        store={store}
        fromFrameId={effectiveScreenPair.fromId}
        toFrameId={effectiveScreenPair.toId}
        transition={effectiveScreenPair.transition}
        onUpdateTransition={patch => {
          const interaction = prototype.interactions.find(i =>
            (i.sourceId === effectiveScreenPair.fromId || isDescendant(state.elements, i.sourceId, effectiveScreenPair.fromId)) &&
            i.targetId === effectiveScreenPair.toId
          )
          if (interaction) {
            store.updateInteraction(interaction.id, { transition: { ...interaction.transition, ...patch } })
          }
          if (lastScreenPair) {
            setLastScreenPair({ ...lastScreenPair, transition: { ...lastScreenPair.transition, ...patch } })
          }
        }}
        scrubProgress={scrubProgress}
        onScrub={setScrubProgress}
        showGhosts={showGhosts}
        onToggleGhosts={setShowGhosts}
        onClose={() => setSmartHudOpen(false)}
      />
    )}
  </Dialog>
}

function PlayerLayer({ store, frameId, width, height, overlay = false, inert = false, ref }: {
  store: SceneStore; frameId: string; width: number; height: number; overlay?: boolean; inert?: boolean; ref: Ref<HTMLDivElement>
}) {
  const state = useScene(store, value => value), node = state.elements[frameId]
  const layerRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => layerRef.current!, [])
  useLayoutEffect(() => {
    const sources = (state.prototype?.interactions ?? []).filter(item => item.trigger !== 'delay' && isDescendant(state.elements, item.sourceId, frameId))
    const sourceIndex = new Map<string, { trigger: PrototypeInteraction['trigger']; clickable: boolean }>()
    for (const source of sources) {
      const old = sourceIndex.get(source.sourceId)
      sourceIndex.set(source.sourceId, { trigger: old?.trigger ?? source.trigger, clickable: old?.clickable || source.trigger === 'click' })
    }
    const elements = [...(layerRef.current?.querySelectorAll<HTMLElement>('[data-element-id]') ?? [])]
    for (const element of elements) {
      const source = sourceIndex.get(element.dataset.elementId!)
      if (source) {
        element.dataset.hotspot = source.trigger
        if (source.clickable) { element.tabIndex = 0; element.setAttribute('role', 'button') }
      }
    }
    return () => { for (const element of elements) { delete element.dataset.hotspot; element.removeAttribute('tabindex'); element.removeAttribute('role') } }
  }, [frameId, state.prototype, state.elements])
  const extent = useMemo(() => presentationExtent(state, frameId), [state, frameId])
  if (!node) return null
  const factor = width / node.width
  return <div ref={layerRef} className={`prototype-layer ${overlay ? 'is-overlay' : ''}`} style={{ width, height, background: node.style.fill ?? undefined }} inert={inert}>
    <div className="prototype-screen-scroll" style={{ width, height }}>
      <div className="prototype-screen-content" style={{ width: extent.width * factor, height: extent.height * factor }}><div style={{ position: 'absolute', width: node.width, height: extent.height, transform: `scale(${factor})`, transformOrigin: '0 0' }}><SceneRenderer store={store} frameId={frameId} /></div></div>
    </div>
  </div>
}
