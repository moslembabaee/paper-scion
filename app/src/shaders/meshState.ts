import { useSyncExternalStore } from 'react'

type MeshStateListener = () => void

let activeAnchorIndex = 0
let activeGridVertexIndex = 0
let placementModeActive = false
const listeners = new Set<MeshStateListener>()

export function getMeshActiveAnchor(): number {
  return activeAnchorIndex
}

export function setMeshActiveAnchor(index: number): void {
  if (activeAnchorIndex !== index) {
    activeAnchorIndex = Math.max(0, index)
    notifyMeshState()
  }
}

export function getMeshActiveGridVertex(): number {
  return activeGridVertexIndex
}

export function setMeshActiveGridVertex(index: number): void {
  if (activeGridVertexIndex !== index) {
    activeGridVertexIndex = Math.max(0, index)
    notifyMeshState()
  }
}

export function getMeshPlacementMode(): boolean {
  return placementModeActive
}

export function setMeshPlacementMode(active: boolean): void {
  if (placementModeActive !== active) {
    placementModeActive = active
    notifyMeshState()
  }
}

export function subscribeMeshState(listener: MeshStateListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useMeshActiveAnchor(): number {
  return useSyncExternalStore(subscribeMeshState, getMeshActiveAnchor, getMeshActiveAnchor)
}

export function useMeshActiveGridVertex(): number {
  return useSyncExternalStore(subscribeMeshState, getMeshActiveGridVertex, getMeshActiveGridVertex)
}

export function useMeshPlacementMode(): boolean {
  return useSyncExternalStore(subscribeMeshState, getMeshPlacementMode, getMeshPlacementMode)
}

function notifyMeshState() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Ignore listener errors during unmount or teardown
    }
  }
}

