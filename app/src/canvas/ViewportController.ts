import { cameraMatrix, clampZoom, fitBounds, inverseCameraMatrix, screenToWorld, visibleBounds, worldToScreen, zoomAt } from './math.ts'
import { CanvasSpringEngine, DEFAULT_CANVAS_PHYSICS } from './springPhysics.ts'
import type { Bounds, Camera, CanvasPhysicsConfig, CanvasPhysicsTelemetry, Point, Size, SpringPresetName, Velocity2D, ViewportMatrix, ViewportSnapshot } from './types.ts'

type Listener = (snapshot: ViewportSnapshot) => void
type PhysicsListener = (telemetry: CanvasPhysicsTelemetry) => void

const raf = typeof requestAnimationFrame !== 'undefined'
  ? requestAnimationFrame
  : (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number

const caf = typeof cancelAnimationFrame !== 'undefined'
  ? cancelAnimationFrame
  : (id: number) => clearTimeout(id)

/**
 * A physics-driven camera controller.
 * Input drives a high-precision spring and momentum engine.
 * One RAF batches all DOM transforms and canvas updates at 60fps+.
 */
export class ViewportController {
  private camera: Camera
  private target: Camera
  private size: Size = { width: 0, height: 0 }
  private listeners = new Set<Listener>()
  private physicsListeners = new Set<PhysicsListener>()
  private frame: number | null = null
  private previousTime: number | null = null
  private reducedMotion = false
  private engine: CanvasSpringEngine

  constructor(initial: Camera = { x: 0, y: 0, zoom: 1 }, physicsConfig?: Partial<CanvasPhysicsConfig>) {
    this.camera = this.validate(initial)
    this.target = { ...this.camera }
    this.engine = new CanvasSpringEngine(this.camera, physicsConfig ?? DEFAULT_CANVAS_PHYSICS)
  }

  private validate(camera: Camera): Camera {
    return {
      x: Number.isFinite(camera.x) ? camera.x : 0,
      y: Number.isFinite(camera.y) ? camera.y : 0,
      zoom: clampZoom(camera.zoom),
    }
  }

  getSnapshot = (): ViewportSnapshot => ({
    camera: { ...this.camera },
    size: { ...this.size },
    matrix: cameraMatrix(this.camera) as ViewportMatrix,
    inverseMatrix: inverseCameraMatrix(this.camera) as ViewportMatrix,
    visibleBounds: visibleBounds(this.camera, this.size),
  })

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => { this.listeners.delete(listener) }
  }

  subscribePhysics = (listener: PhysicsListener): (() => void) => {
    this.physicsListeners.add(listener)
    listener(this.engine.getTelemetry())
    return () => { this.physicsListeners.delete(listener) }
  }

  getPhysicsConfig(): CanvasPhysicsConfig {
    return this.engine.getConfig()
  }

  setPhysicsConfig(config: Partial<CanvasPhysicsConfig>): void {
    this.engine.setConfig(config)
  }

  applyPhysicsPreset(preset: SpringPresetName): void {
    this.engine.applyPreset(preset)
  }

  setSoftBounds(bounds: Bounds | null): void {
    this.engine.setSoftBounds(bounds)
  }

  getPhysicsTelemetry(): CanvasPhysicsTelemetry {
    return this.engine.getTelemetry()
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value
    if (value) {
      this.engine.applyPreset('direct')
    } else {
      this.engine.applyPreset('paper')
    }
  }

  resize(size: Size): void {
    // Keep the same world point in the center when panels or window sizes change.
    if (this.size.width > 0 && this.size.height > 0) {
      const dx = (size.width - this.size.width) / 2
      const dy = (size.height - this.size.height) / 2
      this.engine.panImmediate({ x: dx, y: dy })
      this.camera = this.engine.getCurrent()
      this.target = this.engine.getTarget()
    }
    this.size = { ...size }
    this.engine.setViewportSize(size)
    this.notify()
  }

  setCamera(camera: Camera, animate = true): void {
    this.target = this.validate(camera)
    if (!animate || this.reducedMotion) {
      this.engine.setTargetCamera(this.target, false)
      this.camera = { ...this.target }
      this.notify()
      return
    }
    this.engine.setTargetCamera(this.target, true)
    this.schedule()
  }

  panBy(delta: Point, animate = false): void {
    if (!animate || this.reducedMotion) {
      this.engine.panImmediate(delta)
      this.camera = this.engine.getCurrent()
      this.target = this.engine.getTarget()
      this.notify()
      return
    }
    this.setCamera({ ...this.target, x: this.target.x + delta.x, y: this.target.y + delta.y }, true)
  }

  zoomTo(zoom: number, anchor: Point = this.center(), animate = true): void {
    this.setCamera(zoomAt(this.target, zoom, anchor), animate)
  }

  zoomBy(factor: number, anchor: Point = this.center()): void {
    this.zoomTo(this.target.zoom * factor, anchor)
  }

  centerOn(point: Point, animate = true): void {
    this.setCamera({
      x: this.size.width / 2 - point.x * this.target.zoom,
      y: this.size.height / 2 - point.y * this.target.zoom,
      zoom: this.target.zoom,
    }, animate)
  }

  fit(bounds: Bounds, padding = 80, animate = true): void {
    this.setCamera(fitBounds(bounds, this.size, padding), animate)
  }

  /** Launch momentum coasting with initial release velocity */
  fling(velocity: Velocity2D, zoomVelocity = 0, anchor?: Point): void {
    if (this.reducedMotion) return
    this.engine.fling(velocity, zoomVelocity, anchor)
    if (!this.engine.isSettled()) {
      this.schedule()
    }
  }

  /** Add smooth kinetic zoom impulse from wheel or pinch gesture */
  addZoomImpulse(logZoomDelta: number, anchor: Point = this.center()): void {
    if (this.reducedMotion) {
      this.zoomBy(Math.exp(logZoomDelta), anchor)
      return
    }
    this.engine.addZoomImpulse(logZoomDelta, anchor)
    this.schedule()
  }

  /** Stop interpolation and momentum immediately before a direct gesture to prevent camera jumps */
  stop(): void {
    this.engine.stop()
    this.camera = this.engine.getCurrent()
    this.target = this.engine.getTarget()
    if (this.frame !== null) {
      caf(this.frame)
      this.frame = null
    }
    this.previousTime = null
    this.notify()
  }

  worldToScreen(point: Point): Point { return worldToScreen(point, this.camera) }
  screenToWorld(point: Point): Point { return screenToWorld(point, this.camera) }
  private center(): Point { return { x: this.size.width / 2, y: this.size.height / 2 } }

  private notify(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
    if (this.physicsListeners.size > 0) {
      const telemetry = this.engine.getTelemetry()
      for (const listener of this.physicsListeners) listener(telemetry)
    }
  }

  private schedule(): void {
    if (this.frame === null) this.frame = raf(this.tick)
  }

  private tick = (time: number): void => {
    this.frame = null
    const dt = this.previousTime === null ? 1000 / 60 : Math.min(64, time - this.previousTime)
    this.previousTime = time

    const { camera, settled } = this.engine.step(dt / 1000)
    this.camera = camera
    this.target = this.engine.getTarget()

    this.notify()

    if (!settled) {
      this.schedule()
    } else {
      this.previousTime = null
    }
  }

  dispose(): void {
    if (this.frame !== null) caf(this.frame)
    this.frame = null
    this.previousTime = null
    this.listeners.clear()
    this.physicsListeners.clear()
    this.engine.stop()
  }
}
