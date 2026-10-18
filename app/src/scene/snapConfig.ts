export interface SnapConfig {
  /** Master toggle for smart guides and snapping */
  enabled: boolean
  /** Snap to bounding box edges (left, right, top, bottom) */
  snapToEdges: boolean
  /** Snap to bounding box centers (horizontal & vertical) */
  snapToCenters: boolean
  /** Equidistant distribution hints across adjacent sibling nodes */
  snapToDistribution: boolean
  /** Snap element width and height to match sibling dimensions during resize */
  snapToDimensions: boolean
  /** Snap to engineering grid lines */
  snapToGrid: boolean
  /** Snap to rotation angles (cardinal 0, 45, 90... and 15° increments) */
  snapToRotation: boolean
  /** Snap to artboard boundaries and centers */
  snapToArtboards: boolean
  /** Major grid size in world pixels */
  gridMajor: number
  /** Minor grid subdivision size in world pixels */
  gridMinor: number
  /** Snap threshold in screen pixels (converted by threshold / zoom into world units) */
  screenThreshold: number
  /** Rotation snap threshold in degrees */
  rotationThreshold: number
  /** Default rotation step interval in degrees */
  rotationStep: number
  /** Maximum number of active guide lines to display simultaneously */
  maxGuides: number
}

export const DEFAULT_SNAP_CONFIG: Readonly<SnapConfig> = Object.freeze({
  enabled: true,
  snapToEdges: true,
  snapToCenters: true,
  snapToDistribution: true,
  snapToDimensions: true,
  snapToGrid: false,
  snapToRotation: true,
  snapToArtboards: true,
  gridMajor: 120,
  gridMinor: 24,
  screenThreshold: 8,
  rotationThreshold: 3,
  rotationStep: 15,
  maxGuides: 16,
})

const STORAGE_KEY = 'paper.snapConfig.v1'
const storage = typeof window !== 'undefined' ? window.localStorage : null

type Listener = (config: SnapConfig) => void
const listeners = new Set<Listener>()

let currentConfig: SnapConfig = { ...DEFAULT_SNAP_CONFIG }

// Load persisted configuration on startup
try {
  const saved = storage?.getItem(STORAGE_KEY)
  if (saved) {
    const parsed = JSON.parse(saved) as Partial<SnapConfig>
    currentConfig = {
      ...DEFAULT_SNAP_CONFIG,
      ...parsed,
    }
  }
} catch {
  // Storage unavailable or invalid JSON; fallback to defaults
}

/** Get the active snap configuration. */
export function getSnapConfig(): SnapConfig {
  return { ...currentConfig }
}

/** Update the snap configuration and notify subscribers. */
export function setSnapConfig(partial: Partial<SnapConfig>): SnapConfig {
  currentConfig = {
    ...currentConfig,
    ...partial,
  }
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(currentConfig))
  } catch {
    // Storage restricted or unavailable
  }
  for (const listener of listeners) {
    try {
      listener(currentConfig)
    } catch {
      // Ignore listener error
    }
  }
  return { ...currentConfig }
}

/** Toggle master smart guides and snapping on/off. */
export function toggleSnapEnabled(): boolean {
  const updated = setSnapConfig({ enabled: !currentConfig.enabled })
  return updated.enabled
}

/** Toggle distribution snapping on/off. */
export function toggleDistributionSnap(): boolean {
  const updated = setSnapConfig({ snapToDistribution: !currentConfig.snapToDistribution })
  return updated.snapToDistribution
}

/** Toggle grid snapping on/off. */
export function toggleGridSnap(): boolean {
  const updated = setSnapConfig({ snapToGrid: !currentConfig.snapToGrid })
  return updated.snapToGrid
}

/** Toggle rotation snapping on/off. */
export function toggleRotationSnap(): boolean {
  const updated = setSnapConfig({ snapToRotation: !currentConfig.snapToRotation })
  return updated.snapToRotation
}

/** Toggle artboard boundaries snapping on/off. */
export function toggleArtboardSnap(): boolean {
  const updated = setSnapConfig({ snapToArtboards: !currentConfig.snapToArtboards })
  return updated.snapToArtboards
}

/** Reset snap configuration to defaults. */
export function resetSnapConfig(): SnapConfig {
  return setSnapConfig(DEFAULT_SNAP_CONFIG)
}

/** Subscribe to snap configuration changes. */
export function subscribeSnapConfig(listener: Listener): () => void {
  listeners.add(listener)
  try {
    listener(currentConfig)
  } catch {
    // Initial listener call
  }
  return () => {
    listeners.delete(listener)
  }
}
