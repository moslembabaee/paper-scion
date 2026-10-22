import { useLayoutEffect, useRef, useState } from 'react'
import type { ViewportController } from '../canvas/ViewportController.ts'
import type { Point } from '../canvas/types.ts'
import type { SceneStore } from './store.ts'
import { componentRoot } from './components.ts'
import { measurementHit } from './measurementGeometry.ts'
import { findDelayedTransition, getEffectiveStateMachine, resolveNextState } from './stateMachine.ts'
import { springCSS, springDuration } from '../prototype/spring.ts'
import type { ComponentLink, ComponentStateMachine, ComponentStateTransition, SceneElement } from './types.ts'

type InstanceElement = SceneElement & {
  component: Extract<ComponentLink, { kind: 'instance' }>
}

export function InteractiveCanvasOverlay({
  store,
  controller,
  onExit,
}: {
  store: SceneStore
  controller: ViewportController
  onExit?: () => void
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const hoveredInstanceId = useRef<string | null>(null)
  const pressedInstanceId = useRef<string | null>(null)
  const focusedInstanceId = useRef<string | null>(null)
  const originalStates = useRef<Map<string, string | null>>(new Map())
  const activeTransitions = useRef<Map<string, number>>(new Map())
  const delayedTimers = useRef<Map<string, number>>(new Map())
  const [hoveredBadge, setHoveredBadge] = useState<{ id: string; name: string; state: string } | null>(null)

  // Apply spring styling to instance DOM node
  const applySpringStyle = (instanceId: string, transition: ComponentStateTransition) => {
    const element = document.querySelector<HTMLElement>(`[data-element-id="${instanceId}"]`)
    if (!element) return
    const duration = springDuration(transition.spring)
    const easing = springCSS(transition.spring, duration)
    element.style.transition = `all ${duration}ms ${easing}`
    const oldTimeout = activeTransitions.current.get(instanceId)
    if (oldTimeout) window.clearTimeout(oldTimeout)
    const timeout = window.setTimeout(() => {
      element.style.transition = ''
      activeTransitions.current.delete(instanceId)
    }, duration + 50)
    activeTransitions.current.set(instanceId, timeout)
  }

  const cancelDelay = (instanceId: string) => {
    const timer = delayedTimers.current.get(instanceId)
    if (timer) {
      window.clearTimeout(timer)
      delayedTimers.current.delete(instanceId)
    }
  }

  const scheduleDelay = (
    instanceId: string,
    master: SceneElement,
    machine: ComponentStateMachine,
    state: string
  ) => {
    cancelDelay(instanceId)
    const delayed = findDelayedTransition(machine, state)
    if (!delayed) return
    const delayMs = delayed.delay ?? 300
    const timer = window.setTimeout(() => {
      delayedTimers.current.delete(instanceId)
      applySpringStyle(instanceId, delayed)
      store.setComponentActiveState(instanceId, delayed.targetState, false)
      setHoveredBadge({ id: instanceId, name: master.name, state: delayed.targetState })
      scheduleDelay(instanceId, master, machine, delayed.targetState)
    }, delayMs)
    delayedTimers.current.set(instanceId, timer)
  }

  useLayoutEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return

    const worldPoint = (event: PointerEvent): Point => {
      const rect = overlay.getBoundingClientRect()
      return controller.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    }

    const findInstance = (event: PointerEvent): { root: InstanceElement; master: SceneElement; machine: ComponentStateMachine } | null => {
      const snapshot = store.getSnapshot()
      const hit = measurementHit(snapshot, worldPoint(event), true)
      if (!hit) return null
      const root = componentRoot(snapshot.elements, hit)
      if (root?.component?.kind !== 'instance') return null
      const master = snapshot.elements[root.component.masterId]
      const machine = getEffectiveStateMachine(master)
      if (!machine) return null
      return { root: root as InstanceElement, master, machine }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const instance = findInstance(event)
      const currentHoveredId = hoveredInstanceId.current

      if (!instance) {
        if (currentHoveredId) {
          // Exiting previous instance
          cancelDelay(currentHoveredId)
          const prevInstance = store.getSnapshot().elements[currentHoveredId]
          if (prevInstance && prevInstance.component?.kind === 'instance') {
            const master = store.getSnapshot().elements[prevInstance.component.masterId]
            const machine = getEffectiveStateMachine(master)
            if (machine) {
              const currentHoverState = prevInstance.component.activeState ?? machine.initial
              const exitTransition = resolveNextState(machine, currentHoverState, 'on-hover-end')
              if (exitTransition) {
                applySpringStyle(currentHoveredId, exitTransition.transition)
                store.setComponentActiveState(currentHoveredId, exitTransition.targetState, false)
                scheduleDelay(currentHoveredId, master, machine, exitTransition.targetState)
              } else {
                const baseState = originalStates.current.get(currentHoveredId) ?? machine.initial
                const fallbackTransition = machine.transitions.find(t => t.fromState === currentHoverState && t.targetState === baseState)
                if (fallbackTransition) applySpringStyle(currentHoveredId, fallbackTransition)
                store.setComponentActiveState(currentHoveredId, baseState, false)
              }
            }
          }
          hoveredInstanceId.current = null
          setHoveredBadge(null)
        }
        return
      }

      const { root, master, machine } = instance
      if (currentHoveredId !== root.id) {
        // Exiting old instance if any
        if (currentHoveredId && currentHoveredId !== root.id) {
          cancelDelay(currentHoveredId)
          const prevInstance = store.getSnapshot().elements[currentHoveredId]
          if (prevInstance && prevInstance.component?.kind === 'instance') {
            const prevMaster = store.getSnapshot().elements[prevInstance.component.masterId]
            const prevMachine = getEffectiveStateMachine(prevMaster)
            if (prevMachine) {
              const base = originalStates.current.get(currentHoveredId) ?? prevMachine.initial
              store.setComponentActiveState(currentHoveredId, base, false)
            }
          }
        }

        hoveredInstanceId.current = root.id
        if (!originalStates.current.has(root.id)) {
          originalStates.current.set(root.id, root.component.activeState ?? null)
        }

        const currentState = root.component.activeState ?? machine.initial
        if (currentState === 'disabled') {
          setHoveredBadge({ id: root.id, name: master.name, state: 'disabled' })
          return
        }
        const next = resolveNextState(machine, currentState, 'on-hover')
        if (next) {
          applySpringStyle(root.id, next.transition)
          store.setComponentActiveState(root.id, next.targetState, false)
          setHoveredBadge({ id: root.id, name: master.name, state: next.targetState })
          scheduleDelay(root.id, master, machine, next.targetState)
        } else {
          setHoveredBadge({ id: root.id, name: master.name, state: currentState })
          scheduleDelay(root.id, master, machine, currentState)
        }
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const instance = findInstance(event)
      if (!instance) return
      const { root, master, machine } = instance
      const currentState = root.component.activeState ?? machine.initial
      if (currentState === 'disabled') return
      pressedInstanceId.current = root.id
      cancelDelay(root.id)
      const next = resolveNextState(machine, currentState, 'on-pointerdown') ?? resolveNextState(machine, currentState, 'while-pressed')
      if (next) {
        applySpringStyle(root.id, next.transition)
        store.setComponentActiveState(root.id, next.targetState, false)
        setHoveredBadge({ id: root.id, name: master.name, state: next.targetState })
        scheduleDelay(root.id, master, machine, next.targetState)
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const pressedId = pressedInstanceId.current
      pressedInstanceId.current = null
      const instance = findInstance(event)
      if (!instance || (pressedId && instance.root.id !== pressedId)) {
        if (pressedId) {
          cancelDelay(pressedId)
          const pressedEl = store.getSnapshot().elements[pressedId]
          if (pressedEl && pressedEl.component?.kind === 'instance') {
            const master = store.getSnapshot().elements[pressedEl.component.masterId]
            const machine = getEffectiveStateMachine(master)
            if (machine) {
              const base = originalStates.current.get(pressedId) ?? machine.initial
              store.setComponentActiveState(pressedId, base, false)
            }
          }
        }
        return
      }

      const { root, master, machine } = instance
      const currentState = root.component.activeState ?? machine.initial
      if (currentState === 'disabled') return

      // Handle focus change on click if instance has focused state
      if (focusedInstanceId.current && focusedInstanceId.current !== root.id) {
        const prevFocused = store.getSnapshot().elements[focusedInstanceId.current]
        if (prevFocused && prevFocused.component?.kind === 'instance') {
          const prevMaster = store.getSnapshot().elements[prevFocused.component.masterId]
          const prevMachine = getEffectiveStateMachine(prevMaster)
          if (prevMachine) {
            const curState = prevFocused.component.activeState ?? prevMachine.initial
            const blurNext = resolveNextState(prevMachine, curState, 'on-blur')
            if (blurNext) {
              applySpringStyle(prevFocused.id, blurNext.transition)
              store.setComponentActiveState(prevFocused.id, blurNext.targetState, false)
            } else {
              const base = originalStates.current.get(prevFocused.id) ?? prevMachine.initial
              store.setComponentActiveState(prevFocused.id, base, false)
            }
          }
        }
        focusedInstanceId.current = null
      }

      // Check on-click transition first, then on-pointerup, then on-focus if not already focused
      const nextTransition = resolveNextState(machine, currentState, 'on-click') ??
        resolveNextState(machine, currentState, 'on-pointerup') ??
        (machine.states.includes('focused') && currentState !== 'focused' ? resolveNextState(machine, currentState, 'on-focus') : null)
      if (nextTransition) {
        if (nextTransition.targetState === 'focused') {
          focusedInstanceId.current = root.id
        }
        applySpringStyle(root.id, nextTransition.transition)
        store.setComponentActiveState(root.id, nextTransition.targetState, false)
        setHoveredBadge({ id: root.id, name: master.name, state: nextTransition.targetState })
        scheduleDelay(root.id, master, machine, nextTransition.targetState)
      } else if (currentState === 'pressed') {
        // Return to hover or initial
        const returnState = machine.states.includes('hover') ? 'hover' : machine.initial
        const returnTransition = machine.transitions.find(t => t.fromState === 'pressed' && t.targetState === returnState)
        if (returnTransition) applySpringStyle(root.id, returnTransition)
        store.setComponentActiveState(root.id, returnState, false)
        setHoveredBadge({ id: root.id, name: master.name, state: returnState })
        scheduleDelay(root.id, master, machine, returnState)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onExit?.()
      } else if (event.key === 'Tab') {
        event.preventDefault()
        const snapshot = store.getSnapshot()
        const instanceRoots = Object.values(snapshot.elements).filter(
          el => el.component?.kind === 'instance' && el.component.instanceId === el.id
        )
        if (instanceRoots.length === 0) return
        const currentIndex = focusedInstanceId.current
          ? instanceRoots.findIndex(el => el.id === focusedInstanceId.current)
          : -1
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? instanceRoots.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % instanceRoots.length

        // Blur previous
        if (focusedInstanceId.current) {
          const prevTarget = snapshot.elements[focusedInstanceId.current]
          if (prevTarget && prevTarget.component?.kind === 'instance') {
            const prevMaster = snapshot.elements[prevTarget.component.masterId]
            const prevMachine = getEffectiveStateMachine(prevMaster)
            if (prevMachine) {
              const curState = prevTarget.component.activeState ?? prevMachine.initial
              const blurNext = resolveNextState(prevMachine, curState, 'on-blur')
              if (blurNext) {
                applySpringStyle(prevTarget.id, blurNext.transition)
                store.setComponentActiveState(prevTarget.id, blurNext.targetState, false)
              } else {
                const base = originalStates.current.get(prevTarget.id) ?? prevMachine.initial
                store.setComponentActiveState(prevTarget.id, base, false)
              }
            }
          }
        }

        const nextTarget = instanceRoots[nextIndex]
        focusedInstanceId.current = nextTarget.id
        if (!originalStates.current.has(nextTarget.id)) {
          originalStates.current.set(nextTarget.id, (nextTarget.component as any).activeState ?? null)
        }
        const nextMaster = snapshot.elements[(nextTarget.component as any).masterId]
        const nextMachine = getEffectiveStateMachine(nextMaster)
        if (nextMachine) {
          const curState = (nextTarget.component as any).activeState ?? nextMachine.initial
          if (curState !== 'disabled') {
            const focusNext = resolveNextState(nextMachine, curState, 'on-focus')
            if (focusNext) {
              applySpringStyle(nextTarget.id, focusNext.transition)
              store.setComponentActiveState(nextTarget.id, focusNext.targetState, false)
              setHoveredBadge({ id: nextTarget.id, name: nextMaster.name, state: focusNext.targetState })
              scheduleDelay(nextTarget.id, nextMaster, nextMachine, focusNext.targetState)
            } else {
              setHoveredBadge({ id: nextTarget.id, name: nextMaster.name, state: curState })
            }
          }
        }
      }
    }

    overlay.addEventListener('pointermove', handlePointerMove)
    overlay.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      overlay.removeEventListener('pointermove', handlePointerMove)
      overlay.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('keydown', handleKeyDown)

      // Restore instances to original states
      for (const [id, original] of originalStates.current) {
        store.setComponentActiveState(id, original, false)
      }
      for (const timeout of activeTransitions.current.values()) {
        window.clearTimeout(timeout)
      }
      for (const timeout of delayedTimers.current.values()) {
        window.clearTimeout(timeout)
      }
    }
  }, [store, controller, onExit])

  return (
    <div
      ref={overlayRef}
      className="interactive-canvas-overlay"
      data-testid="interactive-canvas-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'auto',
        cursor: 'pointer',
        zIndex: 50,
      }}
    >
      {hoveredBadge && (
        <div className="interactive-instance-pill" data-testid="interactive-instance-pill">
          <span className="pill-dot" />
          <span className="pill-name">{hoveredBadge.name}</span>
          <span className="pill-arrow">/</span>
          <span className="pill-state">{hoveredBadge.state}</span>
        </div>
      )}
    </div>
  )
}
