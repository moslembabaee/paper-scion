/** All screen points are local to the viewport, in CSS pixels. */
export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Bounds extends Point, Size {}

/** Translation is in screen pixels; zoom is screen pixels per world unit. */
export interface Camera extends Point {
  zoom: number
}

/** CSS/DOMMatrix order: [a, b, c, d, e, f]. */
export type ViewportMatrix = readonly [number, number, number, number, number, number]

export interface ViewportSnapshot {
  camera: Readonly<Camera>
  size: Readonly<Size>
  matrix: ViewportMatrix
  inverseMatrix: ViewportMatrix
  visibleBounds: Bounds
}

export interface MinimapItem extends Bounds {
  id: string
  name?: string
  type?: string
  color?: string
  strokeColor?: string
  strokeWidth?: number
  opacity?: number
  cornerRadius?: number
  text?: string
  isFrame?: boolean
  isSelected?: boolean
  childrenCount?: number
  zIndex?: number
}

export interface SpatialBookmark {
  id: string
  name: string
  camera: Camera
  bounds?: Bounds
  createdAt: number
  hotkey?: string
  isFrameDefault?: boolean
}

export type RadarDisplayMode = 'layers' | 'wireframe' | 'radar'

export interface Velocity2D {
  x: number
  y: number
}

export interface ViewportVelocity extends Velocity2D {
  zoom: number
}

export type SpringPresetName = 'paper' | 'snappy' | 'fluid' | 'gentle' | 'direct'

export interface CanvasPhysicsConfig {
  /** Physics preset profile name */
  preset: SpringPresetName
  /** Spring stiffness / tension (higher = faster snap to target) */
  stiffness: number
  /** Spring damping coefficient (higher = less oscillation) */
  damping: number
  /** Virtual camera mass */
  mass: number
  /** Friction coefficient for momentum coasting (0.80 - 0.98) */
  friction: number
  /** Minimum fling velocity (px/sec) required to activate momentum */
  minFlingVelocity: number
  /** Maximum fling velocity (px/sec) cap */
  maxFlingVelocity: number
  /** Enable momentum/inertia panning upon drag release */
  momentumPanning: boolean
  /** Enable kinetic zoom inertia and wheel smoothing */
  kineticZoom: boolean
  /** Enable rubber-band edge bouncing on zoom limits and canvas bounds */
  edgeBouncing: boolean
  /** Rubber-band resistance factor (0.1 - 0.9) */
  rubberBandResistance: number
  /** Edge bounce restoring spring stiffness */
  edgeBounceStiffness: number
  /** Edge bounce restoring spring damping */
  edgeBounceDamping: number
  /** Optional soft boundaries for spatial bounce in world space */
  softBounds: Bounds | null
  /** Padding in pixels around soft bounds */
  boundaryOverscrollPadding: number
}

export interface EdgeBounceState {
  active: boolean
  top: number
  right: number
  bottom: number
  left: number
  zoomMin: number
  zoomMax: number
}

export interface CanvasPhysicsTelemetry {
  velocity: Velocity2D
  zoomVelocity: number
  speed: number
  isCoasting: boolean
  isSpringing: boolean
  isBouncing: boolean
  bounceState: EdgeBounceState
}

