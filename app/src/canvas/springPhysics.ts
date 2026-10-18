import { clampZoom, MAX_ZOOM, MIN_ZOOM, screenToWorld } from './math.ts'
import type { Bounds, Camera, CanvasPhysicsConfig, CanvasPhysicsTelemetry, EdgeBounceState, Point, Size, SpringPresetName, Velocity2D, ViewportVelocity } from './types.ts'

export const DEFAULT_CANVAS_PHYSICS: CanvasPhysicsConfig = Object.freeze({
  preset: 'paper',
  stiffness: 240,
  damping: 28,
  mass: 1.0,
  friction: 0.935,
  minFlingVelocity: 45,
  maxFlingVelocity: 6000,
  momentumPanning: true,
  kineticZoom: true,
  edgeBouncing: true,
  rubberBandResistance: 0.55,
  edgeBounceStiffness: 280,
  edgeBounceDamping: 26,
  softBounds: null,
  boundaryOverscrollPadding: 120,
})

export const CANVAS_PHYSICS_PRESETS: Record<SpringPresetName, CanvasPhysicsConfig> = {
  paper: {
    ...DEFAULT_CANVAS_PHYSICS,
    preset: 'paper',
    stiffness: 240,
    damping: 28,
    mass: 1.0,
    friction: 0.935,
    rubberBandResistance: 0.55,
  },
  snappy: {
    ...DEFAULT_CANVAS_PHYSICS,
    preset: 'snappy',
    stiffness: 380,
    damping: 34,
    mass: 0.8,
    friction: 0.88,
    rubberBandResistance: 0.4,
    edgeBounceStiffness: 350,
  },
  fluid: {
    ...DEFAULT_CANVAS_PHYSICS,
    preset: 'fluid',
    stiffness: 160,
    damping: 19,
    mass: 1.1,
    friction: 0.965,
    rubberBandResistance: 0.7,
    edgeBounceStiffness: 200,
    edgeBounceDamping: 20,
  },
  gentle: {
    ...DEFAULT_CANVAS_PHYSICS,
    preset: 'gentle',
    stiffness: 120,
    damping: 22,
    mass: 1.25,
    friction: 0.92,
    rubberBandResistance: 0.6,
  },
  direct: {
    ...DEFAULT_CANVAS_PHYSICS,
    preset: 'direct',
    stiffness: 1000,
    damping: 80,
    mass: 1.0,
    friction: 0,
    momentumPanning: false,
    kineticZoom: false,
    edgeBouncing: false,
  },
}

export function validatePhysicsConfig(config: Partial<CanvasPhysicsConfig>): CanvasPhysicsConfig {
  const base = config.preset && CANVAS_PHYSICS_PRESETS[config.preset] ? CANVAS_PHYSICS_PRESETS[config.preset] : DEFAULT_CANVAS_PHYSICS
  return {
    preset: config.preset ?? base.preset,
    stiffness: Number.isFinite(config.stiffness) ? Math.max(10, Math.min(2000, config.stiffness!)) : base.stiffness,
    damping: Number.isFinite(config.damping) ? Math.max(1, Math.min(200, config.damping!)) : base.damping,
    mass: Number.isFinite(config.mass) ? Math.max(0.1, Math.min(10, config.mass!)) : base.mass,
    friction: Number.isFinite(config.friction) ? Math.max(0.5, Math.min(0.99, config.friction!)) : base.friction,
    minFlingVelocity: Number.isFinite(config.minFlingVelocity) ? Math.max(0, config.minFlingVelocity!) : base.minFlingVelocity,
    maxFlingVelocity: Number.isFinite(config.maxFlingVelocity) ? Math.max(100, config.maxFlingVelocity!) : base.maxFlingVelocity,
    momentumPanning: config.momentumPanning ?? base.momentumPanning,
    kineticZoom: config.kineticZoom ?? base.kineticZoom,
    edgeBouncing: config.edgeBouncing ?? base.edgeBouncing,
    rubberBandResistance: Number.isFinite(config.rubberBandResistance) ? Math.max(0.05, Math.min(0.95, config.rubberBandResistance!)) : base.rubberBandResistance,
    edgeBounceStiffness: Number.isFinite(config.edgeBounceStiffness) ? Math.max(20, Math.min(1000, config.edgeBounceStiffness!)) : base.edgeBounceStiffness,
    edgeBounceDamping: Number.isFinite(config.edgeBounceDamping) ? Math.max(1, Math.min(100, config.edgeBounceDamping!)) : base.edgeBounceDamping,
    softBounds: config.softBounds ?? base.softBounds,
    boundaryOverscrollPadding: Number.isFinite(config.boundaryOverscrollPadding) ? Math.max(0, config.boundaryOverscrollPadding!) : base.boundaryOverscrollPadding,
  }
}

interface Sample {
  x: number
  y: number
  zoom: number
  time: number
}

/**
 * Tracks movement history in a sliding time window (120ms) to compute high-precision,
 * weighted release velocities without jitter.
 */
export class VelocityTracker {
  private samples: Sample[] = []
  private readonly maxAgeMs = 120

  add(point: Point, zoom = 1, time: number = performance.now()): void {
    this.samples.push({ x: point.x, y: point.y, zoom, time })
    this.prune(time)
  }

  private prune(now: number): void {
    const cutoff = now - this.maxAgeMs
    while (this.samples.length > 0 && this.samples[0].time < cutoff) {
      this.samples.shift()
    }
  }

  getVelocity(now: number = performance.now()): { vx: number; vy: number; vz: number } {
    this.prune(now)
    if (this.samples.length < 2) return { vx: 0, vy: 0, vz: 0 }
    const latest = this.samples[this.samples.length - 1]
    // If the pointer has been stationary for over 60ms, user came to a stop
    if (now - latest.time > 60) return { vx: 0, vy: 0, vz: 0 }

    let totalWeight = 0
    let weightedVx = 0
    let weightedVy = 0
    let weightedVz = 0
    const earliestTime = this.samples[0].time
    const timeSpan = Math.max(1, latest.time - earliestTime)

    for (let i = 0; i < this.samples.length - 1; i++) {
      const s0 = this.samples[i]
      const s1 = this.samples[i + 1]
      const dt = s1.time - s0.time
      if (dt <= 0) continue

      // Weight more recent motion intervals higher
      const ageNorm = (s1.time - earliestTime) / timeSpan
      const weight = 0.2 + 0.8 * (ageNorm * ageNorm)

      const vx = ((s1.x - s0.x) / dt) * 1000
      const vy = ((s1.y - s0.y) / dt) * 1000
      // Logarithmic zoom velocity for scale-invariant inertia
      const vz = s0.zoom > 0 && s1.zoom > 0 ? ((Math.log(s1.zoom) - Math.log(s0.zoom)) / dt) * 1000 : 0

      weightedVx += vx * weight
      weightedVy += vy * weight
      weightedVz += vz * weight
      totalWeight += weight
    }

    if (totalWeight <= 0) return { vx: 0, vy: 0, vz: 0 }
    return {
      vx: weightedVx / totalWeight,
      vy: weightedVy / totalWeight,
      vz: weightedVz / totalWeight,
    }
  }

  reset(): void {
    this.samples = []
  }
}

/**
 * Standard rubber-band resistance curve:
 * Computes compressed displacement when pulling past a physical barrier.
 */
export function rubberBandDisplacement(overshoot: number, resistance: number, dimension = 300): number {
  if (overshoot <= 0) return 0
  const normalized = (overshoot * (1 - resistance)) / dimension
  return dimension * (1 - 1 / (normalized + 1))
}

/**
 * Physics engine managing continuous camera spring attraction,
 * velocity-aware momentum flinging, kinetic zoom glides, and edge bouncing.
 */
export class CanvasSpringEngine {
  private current: Camera
  private target: Camera
  private velocity: ViewportVelocity = { x: 0, y: 0, zoom: 0 }
  private config: CanvasPhysicsConfig
  private viewportSize: Size = { width: 0, height: 0 }
  private zoomAnchor: Point | null = null
  private isCoasting = false
  private isSpringing = false
  private bounceState: EdgeBounceState = {
    active: false,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zoomMin: 0,
    zoomMax: 0,
  }

  constructor(initial: Camera, config?: Partial<CanvasPhysicsConfig>) {
    this.config = validatePhysicsConfig(config ?? {})
    this.current = {
      x: Number.isFinite(initial.x) ? initial.x : 0,
      y: Number.isFinite(initial.y) ? initial.y : 0,
      zoom: Number.isFinite(initial.zoom) && initial.zoom > 0 ? initial.zoom : 1,
    }
    this.target = { ...this.current }
  }

  getConfig(): CanvasPhysicsConfig {
    return { ...this.config }
  }

  setConfig(config: Partial<CanvasPhysicsConfig>): void {
    this.config = validatePhysicsConfig({ ...this.config, ...config })
  }

  applyPreset(preset: SpringPresetName): void {
    if (CANVAS_PHYSICS_PRESETS[preset]) {
      this.config = { ...CANVAS_PHYSICS_PRESETS[preset], softBounds: this.config.softBounds }
    }
  }

  setSoftBounds(bounds: Bounds | null): void {
    this.config.softBounds = bounds
  }

  setViewportSize(size: Size): void {
    this.viewportSize = { ...size }
  }

  getCurrent(): Camera {
    return { ...this.current }
  }

  getTarget(): Camera {
    return { ...this.target }
  }

  getVelocity(): ViewportVelocity {
    return { ...this.velocity }
  }

  getBounceState(): EdgeBounceState {
    return { ...this.bounceState }
  }

  getTelemetry(): CanvasPhysicsTelemetry {
    const speed = Math.hypot(this.velocity.x, this.velocity.y)
    return {
      velocity: { x: this.velocity.x, y: this.velocity.y },
      zoomVelocity: this.velocity.zoom,
      speed,
      isCoasting: this.isCoasting,
      isSpringing: this.isSpringing,
      isBouncing: this.bounceState.active,
      bounceState: { ...this.bounceState },
    }
  }

  isOutOfBounds(): boolean {
    if (!this.config.edgeBouncing) return false
    if (this.current.zoom < MIN_ZOOM || this.current.zoom > MAX_ZOOM) return true
    if (this.config.softBounds && this.viewportSize.width > 0 && this.viewportSize.height > 0) {
      const centerScreen = { x: this.viewportSize.width / 2, y: this.viewportSize.height / 2 }
      const worldCenter = screenToWorld(centerScreen, this.current)
      const padWorld = this.config.boundaryOverscrollPadding / this.current.zoom
      const minX = this.config.softBounds.x - padWorld
      const maxX = this.config.softBounds.x + this.config.softBounds.width + padWorld
      const minY = this.config.softBounds.y - padWorld
      const maxY = this.config.softBounds.y + this.config.softBounds.height + padWorld
      if (worldCenter.x < minX || worldCenter.x > maxX || worldCenter.y < minY || worldCenter.y > maxY) {
        return true
      }
    }
    return false
  }

  isSettled(): boolean {
    return !this.isCoasting && !this.isSpringing && !this.bounceState.active && !this.isOutOfBounds()
  }

  /** Direct translation without animation, updating current and target together */
  panImmediate(delta: Point): void {
    this.current.x += delta.x
    this.current.y += delta.y
    this.target.x = this.current.x
    this.target.y = this.current.y
  }

  /** Direct zoom without animation, updating current and target together */
  zoomImmediate(zoom: number, anchor?: Point, clamp = true): void {
    const validZoom = clamp ? clampZoom(zoom) : Math.max(0.01, Math.min(100, zoom))
    if (anchor) {
      const world = screenToWorld(anchor, this.current)
      this.current.zoom = validZoom
      this.current.x = anchor.x - world.x * validZoom
      this.current.y = anchor.y - world.y * validZoom
    } else {
      this.current.zoom = validZoom
    }
    this.target = { ...this.current }
  }

  /** Start a spring animation towards a target camera position */
  setTargetCamera(camera: Camera, animate = true): void {
    this.target = {
      x: Number.isFinite(camera.x) ? camera.x : this.current.x,
      y: Number.isFinite(camera.y) ? camera.y : this.current.y,
      zoom: clampZoom(camera.zoom),
    }

    if (!animate || this.config.preset === 'direct') {
      this.current = { ...this.target }
      this.velocity = { x: 0, y: 0, zoom: 0 }
      this.isCoasting = false
      this.isSpringing = false
      return
    }

    this.isSpringing = true
    this.isCoasting = false
  }

  /** Start momentum coasting from a release fling gesture */
  fling(velocity: Velocity2D, zoomVelocity = 0, anchor?: Point): void {
    if (!this.config.momentumPanning && !this.config.kineticZoom) return

    let vx = Number.isFinite(velocity.x) ? velocity.x : 0
    let vy = Number.isFinite(velocity.y) ? velocity.y : 0
    let vz = Number.isFinite(zoomVelocity) ? zoomVelocity : 0

    const speed = Math.hypot(vx, vy)
    if (speed < this.config.minFlingVelocity) {
      vx = 0
      vy = 0
    } else if (speed > this.config.maxFlingVelocity) {
      const scale = this.config.maxFlingVelocity / speed
      vx *= scale
      vy *= scale
    }

    if (!this.config.momentumPanning) {
      vx = 0
      vy = 0
    }
    if (!this.config.kineticZoom) {
      vz = 0
    }

    if (Math.abs(vx) < 1 && Math.abs(vy) < 1 && Math.abs(vz) < 0.01) {
      return
    }

    this.velocity = { x: vx, y: vy, zoom: vz }
    this.zoomAnchor = anchor ?? (this.viewportSize.width > 0 ? { x: this.viewportSize.width / 2, y: this.viewportSize.height / 2 } : null)
    this.isCoasting = true
    this.isSpringing = false
  }

  /** Add smooth kinetic zoom impulse from wheel or pinch gesture */
  addZoomImpulse(logZoomDelta: number, anchor: Point): void {
    if (!this.config.kineticZoom) {
      const nextZoom = clampZoom(this.target.zoom * Math.exp(logZoomDelta))
      const world = screenToWorld(anchor, this.target)
      this.target = {
        zoom: nextZoom,
        x: anchor.x - world.x * nextZoom,
        y: anchor.y - world.y * nextZoom,
      }
      this.current = { ...this.target }
      return
    }

    // Convert delta into zoom velocity (per second) and add to momentum
    const impulse = logZoomDelta * 35
    this.velocity.zoom = Math.max(-12, Math.min(12, this.velocity.zoom * 0.4 + impulse))
    this.zoomAnchor = anchor
    this.isCoasting = true
    this.isSpringing = false
  }

  /** Immediately stop all motion and freeze velocity */
  stop(): void {
    this.target = { ...this.current }
    this.velocity = { x: 0, y: 0, zoom: 0 }
    this.isCoasting = false
    this.isSpringing = false
    this.bounceState = {
      active: false,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zoomMin: 0,
      zoomMax: 0,
    }
  }

  /**
   * Integrate physics step over dt seconds (typically 0.016s).
   * Semi-implicit sub-stepped Euler integration ensures total numerical stability.
   */
  step(dtSeconds: number): { camera: Camera; settled: boolean } {
    const dt = Math.max(0.001, Math.min(0.05, dtSeconds))
    const outOfBounds = this.isOutOfBounds()

    if (!this.isCoasting && !this.isSpringing && !this.bounceState.active && !outOfBounds) {
      // Stationary and at rest
      return { camera: { ...this.current }, settled: true }
    }

    // Sub-stepping for rock-solid stability at 60fps / 120fps
    const maxSubStep = 0.004
    const steps = Math.ceil(dt / maxSubStep)
    const h = dt / steps

    for (let s = 0; s < steps; s++) {
      this.integrateSubStep(h)
    }

    // Update target to track current if coasting
    if (this.isCoasting) {
      this.target = { ...this.current }
    }

    // Check settling conditions
    const speed = Math.hypot(this.velocity.x, this.velocity.y)
    const zoomSpeed = Math.abs(this.velocity.zoom)
    const distToTarget = Math.hypot(this.current.x - this.target.x, this.current.y - this.target.y)
    const zoomDistToTarget = Math.abs(Math.log(this.current.zoom) - Math.log(this.target.zoom))

    if (this.isCoasting) {
      if (speed < 1.5 && zoomSpeed < 0.005 && !this.bounceState.active && !this.isOutOfBounds()) {
        this.velocity = { x: 0, y: 0, zoom: 0 }
        this.isCoasting = false
      }
    }

    if (this.isSpringing) {
      if (distToTarget < 0.05 && zoomDistToTarget < 0.0001 && speed < 1.5 && zoomSpeed < 0.005 && !this.isOutOfBounds()) {
        this.current = { ...this.target }
        this.velocity = { x: 0, y: 0, zoom: 0 }
        this.isSpringing = false
      }
    }

    const settled = !this.isCoasting && !this.isSpringing && !this.bounceState.active && !this.isOutOfBounds()
    if (settled) {
      this.current.zoom = clampZoom(this.current.zoom)
      this.target = { ...this.current }
      this.velocity = { x: 0, y: 0, zoom: 0 }
    }

    return { camera: { ...this.current }, settled }
  }

  private integrateSubStep(h: number): void {
    const { stiffness, damping, mass, friction, edgeBouncing, edgeBounceStiffness, edgeBounceDamping, softBounds, boundaryOverscrollPadding } = this.config

    let ax = 0
    let ay = 0
    let az = 0
    let isBouncingNow = false

    // Reset bounce intensities
    const nextBounce: EdgeBounceState = {
      active: false,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zoomMin: 0,
      zoomMax: 0,
    }

    // 1. Zoom edge bounce (rubber-band past MIN_ZOOM or MAX_ZOOM)
    const currentLogZoom = Math.log(this.current.zoom)
    const minLogZoom = Math.log(MIN_ZOOM)
    const maxLogZoom = Math.log(MAX_ZOOM)

    if (edgeBouncing && (currentLogZoom < minLogZoom || currentLogZoom > maxLogZoom)) {
      isBouncingNow = true
      nextBounce.active = true
      const boundLog = currentLogZoom < minLogZoom ? minLogZoom : maxLogZoom
      const logOvershoot = currentLogZoom - boundLog
      // Spring force returning zoom to limit
      const fZoom = -edgeBounceStiffness * logOvershoot - edgeBounceDamping * this.velocity.zoom
      az += fZoom / mass

      if (currentLogZoom < minLogZoom) {
        nextBounce.zoomMin = Math.min(1, Math.abs(logOvershoot) / 0.5)
      } else {
        nextBounce.zoomMax = Math.min(1, Math.abs(logOvershoot) / 0.5)
      }
    } else if (this.isSpringing) {
      // Spring toward target zoom
      const targetLogZoom = Math.log(this.target.zoom)
      const diffLogZoom = currentLogZoom - targetLogZoom
      const fZoom = -stiffness * diffLogZoom - damping * this.velocity.zoom
      az += fZoom / mass
    } else if (this.isCoasting) {
      // Viscous decay on zoom velocity
      const decay = Math.pow(friction, h / 0.0166)
      this.velocity.zoom *= decay
    }

    // 2. Spatial boundaries & pan spring/friction forces
    let spatialBounceX = false
    let spatialBounceY = false

    if (edgeBouncing && softBounds && this.viewportSize.width > 0 && this.viewportSize.height > 0) {
      // Compute visible world center
      const centerScreen = { x: this.viewportSize.width / 2, y: this.viewportSize.height / 2 }
      const worldCenter = screenToWorld(centerScreen, this.current)

      // Bounds in world space with padding
      const padWorld = boundaryOverscrollPadding / this.current.zoom
      const minX = softBounds.x - padWorld
      const maxX = softBounds.x + softBounds.width + padWorld
      const minY = softBounds.y - padWorld
      const maxY = softBounds.y + softBounds.height + padWorld

      if (worldCenter.x < minX) {
        spatialBounceX = true
        isBouncingNow = true
        nextBounce.active = true
        const overshootScreen = (minX - worldCenter.x) * this.current.zoom
        nextBounce.left = Math.min(1, overshootScreen / 150)
        // Spring acceleration pulling camera left towards bounds
        ax += (-edgeBounceStiffness * overshootScreen - edgeBounceDamping * this.velocity.x) / mass
      } else if (worldCenter.x > maxX) {
        spatialBounceX = true
        isBouncingNow = true
        nextBounce.active = true
        const overshootScreen = (worldCenter.x - maxX) * this.current.zoom
        nextBounce.right = Math.min(1, overshootScreen / 150)
        // Spring acceleration pulling camera right towards bounds
        ax += (edgeBounceStiffness * overshootScreen - edgeBounceDamping * this.velocity.x) / mass
      }

      if (worldCenter.y < minY) {
        spatialBounceY = true
        isBouncingNow = true
        nextBounce.active = true
        const overshootScreen = (minY - worldCenter.y) * this.current.zoom
        nextBounce.top = Math.min(1, overshootScreen / 150)
        // Spring acceleration pulling camera up towards bounds
        ay += (-edgeBounceStiffness * overshootScreen - edgeBounceDamping * this.velocity.y) / mass
      } else if (worldCenter.y > maxY) {
        spatialBounceY = true
        isBouncingNow = true
        nextBounce.active = true
        const overshootScreen = (worldCenter.y - maxY) * this.current.zoom
        nextBounce.bottom = Math.min(1, overshootScreen / 150)
        // Spring acceleration pulling camera down towards bounds
        ay += (edgeBounceStiffness * overshootScreen - edgeBounceDamping * this.velocity.y) / mass
      }
    }

    if (!spatialBounceX) {
      if (this.isSpringing) {
        const dx = this.current.x - this.target.x
        ax += (-stiffness * dx - damping * this.velocity.x) / mass
      } else if (this.isCoasting) {
        const decay = Math.pow(friction, h / 0.0166)
        this.velocity.x *= decay
      }
    }

    if (!spatialBounceY) {
      if (this.isSpringing) {
        const dy = this.current.y - this.target.y
        ay += (-stiffness * dy - damping * this.velocity.y) / mass
      } else if (this.isCoasting) {
        const decay = Math.pow(friction, h / 0.0166)
        this.velocity.y *= decay
      }
    }

    this.bounceState = isBouncingNow ? nextBounce : { active: false, top: 0, right: 0, bottom: 0, left: 0, zoomMin: 0, zoomMax: 0 }

    // Integrate velocities
    this.velocity.x += ax * h
    this.velocity.y += ay * h
    this.velocity.zoom += az * h

    // Integrate positions
    this.current.x += this.velocity.x * h
    this.current.y += this.velocity.y * h

    if (Math.abs(this.velocity.zoom) > 0.0001 || isBouncingNow || this.isSpringing) {
      const prevZoom = this.current.zoom
      const newLogZoom = currentLogZoom + this.velocity.zoom * h
      const nextZoom = Math.exp(newLogZoom)
      this.current.zoom = nextZoom

      // Preserve zoom anchor point in world coordinates
      if (this.zoomAnchor && prevZoom > 0 && nextZoom > 0) {
        const anchor = this.zoomAnchor
        const ratio = nextZoom / prevZoom
        this.current.x = anchor.x - (anchor.x - this.current.x) * ratio
        this.current.y = anchor.y - (anchor.y - this.current.y) * ratio
      }
    }
  }
}
