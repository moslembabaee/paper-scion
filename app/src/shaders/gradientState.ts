import { useSyncExternalStore } from 'react'

type GradientStateListener = () => void

let activeGradientStopId: string | null = null
let activeGradientHandle: 'origin' | 'angle' | 'focal' | 'stop' | null = null
let gradientPopoverVisible = false
const listeners = new Set<GradientStateListener>()

export function getActiveGradientStopId(): string | null {
  return activeGradientStopId
}

export function setActiveGradientStopId(stopId: string | null): void {
  if (activeGradientStopId !== stopId) {
    activeGradientStopId = stopId
    notifyGradientState()
  }
}

export function getActiveGradientHandle(): 'origin' | 'angle' | 'focal' | 'stop' | null {
  return activeGradientHandle
}

export function setActiveGradientHandle(handle: 'origin' | 'angle' | 'focal' | 'stop' | null): void {
  if (activeGradientHandle !== handle) {
    activeGradientHandle = handle
    notifyGradientState()
  }
}

export function getGradientPopoverVisible(): boolean {
  return gradientPopoverVisible
}

export function setGradientPopoverVisible(visible: boolean): void {
  if (gradientPopoverVisible !== visible) {
    gradientPopoverVisible = visible
    notifyGradientState()
  }
}

export function subscribeGradientState(listener: GradientStateListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useActiveGradientStopId(): string | null {
  return useSyncExternalStore(subscribeGradientState, getActiveGradientStopId, getActiveGradientStopId)
}

export function useActiveGradientHandle(): 'origin' | 'angle' | 'focal' | 'stop' | null {
  return useSyncExternalStore(subscribeGradientState, getActiveGradientHandle, getActiveGradientHandle)
}

export function useGradientPopoverVisible(): boolean {
  return useSyncExternalStore(subscribeGradientState, getGradientPopoverVisible, getGradientPopoverVisible)
}

function notifyGradientState() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Ignore listener errors during unmount or teardown
    }
  }
}
