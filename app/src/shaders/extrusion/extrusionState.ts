import { useSyncExternalStore } from 'react'

export type ExtrusionHandleType = 'light' | 'elevation' | 'bevel' | 'shadow' | null

let activeExtrusionHandle: ExtrusionHandleType = null
let activeExtrusionId: string | null = null
let extrusionHUDVisible = true
const listeners = new Set<() => void>()

export function getActiveExtrusionHandle(): ExtrusionHandleType {
  return activeExtrusionHandle
}

export function setActiveExtrusionHandle(handle: ExtrusionHandleType): void {
  if (activeExtrusionHandle !== handle) {
    activeExtrusionHandle = handle
    notifyExtrusionState()
  }
}

export function getActiveExtrusionId(): string | null {
  return activeExtrusionId
}

export function setActiveExtrusionId(id: string | null): void {
  if (activeExtrusionId !== id) {
    activeExtrusionId = id
    notifyExtrusionState()
  }
}

export function getExtrusionHUDVisible(): boolean {
  return extrusionHUDVisible
}

export function setExtrusionHUDVisible(visible: boolean): void {
  if (extrusionHUDVisible !== visible) {
    extrusionHUDVisible = visible
    notifyExtrusionState()
  }
}

export function subscribeExtrusionState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useActiveExtrusionHandle(): ExtrusionHandleType {
  return useSyncExternalStore(subscribeExtrusionState, getActiveExtrusionHandle, getActiveExtrusionHandle)
}

export function useActiveExtrusionId(): string | null {
  return useSyncExternalStore(subscribeExtrusionState, getActiveExtrusionId, getActiveExtrusionId)
}

export function useExtrusionHUDVisible(): boolean {
  return useSyncExternalStore(subscribeExtrusionState, getExtrusionHUDVisible, getExtrusionHUDVisible)
}

function notifyExtrusionState() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Ignore listener error
    }
  }
}
