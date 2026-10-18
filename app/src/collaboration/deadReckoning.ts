import type { Point } from '../canvas/types.ts'

export interface DeadReckoningConfig {
  /** Maximum forward prediction window in ms before damping to zero (default: 220ms) */
  readonly predictionWindowMs?: number
  /** Teleport threshold in world units: jumps larger than this snap immediately (default: 1200) */
  readonly teleportThreshold?: number
  /** Damping / stiffness time constant for exponential convergence in ms (default: 45ms) */
  readonly stiffnessMs?: number
  /** Velocity exponential smoothing weight [0..1] (default: 0.65) */
  readonly velocityWeight?: number
}

export interface DeadReckoningResult {
  readonly point: Point
  readonly velocity: Point
  readonly moving: boolean
}

export interface EdgeProjection {
  readonly isOffscreen: boolean
  readonly edgePoint: Point
  readonly angleRad: number
  readonly angleDeg: number
  readonly distance: number
}

const DEFAULT_CONFIG: Required<DeadReckoningConfig> = {
  predictionWindowMs: 220,
  teleportThreshold: 1200,
  stiffnessMs: 45,
  velocityWeight: 0.65,
}

/**
 * Normalizes timestamps to the performance.now() monotonic clock domain.
 * If an epoch timestamp (Date.now()) is passed, preserves relative flight latency.
 */
export function normalizeTimestamp(ts?: number): number {
  if (ts === undefined || !Number.isFinite(ts)) return performance.now()
  if (ts > 1e11) {
    const epochDelta = Date.now() - ts
    return Math.max(0, performance.now() - Math.max(0, epochDelta))
  }
  return ts
}

/**
 * High-precision dead-reckoning interpolator for peer cursors and active points.
 * Combines velocity estimation from discrete network updates, forward dead-reckoning
 * projection to eliminate network latency lag, and critically damped convergence.
 */
export class DeadReckoningCursor {
  private current: Point = { x: 0, y: 0 }
  private target: Point = { x: 0, y: 0 }
  private velocity: Point = { x: 0, y: 0 }
  private lastSampleTime = 0
  private initialized = false
  private readonly config: Required<DeadReckoningConfig>

  constructor(initialPoint?: Point, config?: DeadReckoningConfig, timestamp?: number) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    if (initialPoint) {
      this.reset(initialPoint, timestamp)
    }
  }

  reset(point: Point, timestamp: number = performance.now()): void {
    const effectiveTs = normalizeTimestamp(timestamp)
    this.current = { ...point }
    this.target = { ...point }
    this.velocity = { x: 0, y: 0 }
    this.lastSampleTime = effectiveTs
    this.initialized = true
  }

  update(point: Point, timestamp: number = performance.now()): void {
    const effectiveTs = normalizeTimestamp(timestamp)
    if (!this.initialized) {
      this.reset(point, effectiveTs)
      return
    }

    const dist = Math.hypot(point.x - this.target.x, point.y - this.target.y)
    if (dist > this.config.teleportThreshold) {
      this.reset(point, effectiveTs)
      return
    }

    const rawDt = (effectiveTs - this.lastSampleTime) / 1000
    if (rawDt > 0.35) {
      this.velocity = { x: 0, y: 0 }
    }
    const dtSec = Math.max(0.001, Math.min(0.25, rawDt > 0.35 ? 0.033 : rawDt))

    // Instantaneous velocity
    const instVx = (point.x - this.target.x) / dtSec
    const instVy = (point.y - this.target.y) / dtSec

    // Smooth velocity with exponential moving average
    const w = this.config.velocityWeight
    this.velocity = {
      x: this.velocity.x * (1 - w) + instVx * w,
      y: this.velocity.y * (1 - w) + instVy * w,
    }

    // Clamp peak velocity to prevent runaway projection from packet bursts (max 8000 px/sec)
    const speed = Math.hypot(this.velocity.x, this.velocity.y)
    if (speed > 8000) {
      const scale = 8000 / speed
      this.velocity.x *= scale
      this.velocity.y *= scale
    }

    this.target = { ...point }
    this.lastSampleTime = effectiveTs
  }

  step(
    currentTime: number = performance.now(),
    dtMs = 16.67,
    zoom = 1,
    reducedMotion = false
  ): DeadReckoningResult {
    if (!this.initialized) {
      return { point: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, moving: false }
    }

    if (reducedMotion) {
      this.current = { ...this.target }
      this.velocity = { x: 0, y: 0 }
      return { point: { ...this.target }, velocity: { x: 0, y: 0 }, moving: false }
    }

    const effectiveCurrent = normalizeTimestamp(currentTime)
    const sampleTime = this.lastSampleTime > 1e11 ? normalizeTimestamp(this.lastSampleTime) : this.lastSampleTime
    const elapsedMs = Math.max(0, effectiveCurrent - sampleTime)
    const windowMs = this.config.predictionWindowMs

    let predictedX = this.target.x
    let predictedY = this.target.y

    if (elapsedMs < windowMs) {
      // Quadratic decay damping towards 0 as we reach the prediction horizon
      const damping = Math.pow(Math.max(0, 1 - elapsedMs / windowMs), 1.8)
      const forwardSec = elapsedMs / 1000
      predictedX += this.velocity.x * forwardSec * damping
      predictedY += this.velocity.y * forwardSec * damping
    } else {
      // Damped out, velocity decays to zero
      this.velocity.x *= 0.5
      this.velocity.y *= 0.5
    }

    // Critically damped convergence factor
    const alpha = 1 - Math.exp(-Math.min(64, dtMs) / this.config.stiffnessMs)
    this.current.x += (predictedX - this.current.x) * alpha
    this.current.y += (predictedY - this.current.y) * alpha

    const deltaX = predictedX - this.current.x
    const deltaY = predictedY - this.current.y
    const screenDelta = Math.hypot(deltaX, deltaY) * zoom
    const moving = screenDelta > 0.15 || Math.hypot(this.velocity.x, this.velocity.y) * zoom > 5

    if (!moving && elapsedMs >= windowMs) {
      this.current = { ...this.target }
      this.velocity = { x: 0, y: 0 }
    }

    return {
      point: { x: this.current.x, y: this.current.y },
      velocity: { ...this.velocity },
      moving,
    }
  }

  getPoint(): Point {
    return { ...this.current }
  }

  getTarget(): Point {
    return { ...this.target }
  }

  getVelocity(): Point {
    return { ...this.velocity }
  }
}

/**
 * Projects a canvas world point onto the screen viewport edge when off-screen.
 * Returns normalized angle, screen coordinates along the edge, and distance.
 */
export function projectEdgePosition(
  worldPoint: Point,
  camera: { x: number; y: number; zoom: number },
  viewportSize: { width: number; height: number },
  margin = 32
): EdgeProjection {
  const screenX = worldPoint.x * camera.zoom + camera.x
  const screenY = worldPoint.y * camera.zoom + camera.y

  const isInside =
    screenX >= margin &&
    screenX <= viewportSize.width - margin &&
    screenY >= margin &&
    screenY <= viewportSize.height - margin

  if (isInside) {
    return {
      isOffscreen: false,
      edgePoint: { x: screenX, y: screenY },
      angleRad: 0,
      angleDeg: 0,
      distance: 0,
    }
  }

  const cx = viewportSize.width / 2
  const cy = viewportSize.height / 2
  const dx = screenX - cx
  const dy = screenY - cy

  const angleRad = Math.atan2(dy, dx)
  const angleDeg = (angleRad * 180) / Math.PI
  const distance = Math.hypot(dx, dy)

  const halfW = Math.max(10, cx - margin)
  const halfH = Math.max(10, cy - margin)

  // Ray-box intersection from center (cx, cy) in direction (dx, dy)
  let t = Infinity
  if (Math.abs(dx) > 1e-4) {
    const tx = (dx > 0 ? halfW : -halfW) / dx
    if (tx > 0 && Math.abs(dy * tx) <= halfH) {
      t = Math.min(t, tx)
    }
  }
  if (Math.abs(dy) > 1e-4) {
    const ty = (dy > 0 ? halfH : -halfH) / dy
    if (ty > 0 && Math.abs(dx * ty) <= halfW) {
      t = Math.min(t, ty)
    }
  }

  if (!Number.isFinite(t) || t <= 0) {
    t = 1
  }

  const edgeX = Math.max(margin, Math.min(viewportSize.width - margin, cx + dx * t))
  const edgeY = Math.max(margin, Math.min(viewportSize.height - margin, cy + dy * t))

  return {
    isOffscreen: true,
    edgePoint: { x: edgeX, y: edgeY },
    angleRad,
    angleDeg,
    distance,
  }
}

/**
 * Formats peer coordinates for display in engineering badges.
 * Adjusts precision according to viewport zoom level.
 */
export function formatCursorCoordinates(x: number, y: number, zoom: number): string {
  if (zoom >= 2) {
    return `X: ${x.toFixed(1)}  Y: ${y.toFixed(1)}`
  }
  return `X: ${Math.round(x)}  Y: ${Math.round(y)}`
}

/**
 * Detects whether coordinates are aligned with the canvas engineering grid (default 120px major grid).
 */
export function isNearGrid(x: number, y: number, gridSize = 120, threshold = 1.5): boolean {
  const remX = Math.abs(x % gridSize)
  const remY = Math.abs(y % gridSize)
  const nearX = remX <= threshold || (gridSize - remX) <= threshold
  const nearY = remY <= threshold || (gridSize - remY) <= threshold
  return nearX && nearY
}

/**
 * Computes zoom-aware scale factor for cursors, labels, and bounding box badges.
 * Maintains legibility and crisp visual weight across wide zoom range (0.05x to 32x).
 */
export function computeZoomScale(zoom: number): number {
  if (zoom < 0.25) return 1.25
  if (zoom < 0.5) return 1.12
  if (zoom > 4) return 0.92
  return 1
}
