import type { Point } from '../canvas/types.ts'
import type {
  CollisionArena,
  DragState,
  MagneticTarget,
  PhysicsBody,
  PhysicsBodyInput,
  PhysicsConfig,
  PhysicsImpulse,
  PhysicsPreset,
  PhysicsStats,
} from './types.ts'
import {
  DEFAULT_PHYSICS_CONFIG,
  ENGINEERING_GRID_SIZE,
  PHYSICS_LIMITS,
  PHYSICS_PRESETS,
  clampValue,
  validatePhysicsConfig,
} from './constants.ts'

export class PhysicsEngine {
  private config: PhysicsConfig
  private bodies: Map<string, PhysicsBody> = new Map()
  private arena: CollisionArena
  private magneticTargets: Map<string, MagneticTarget> = new Map()
  private impulses: PhysicsImpulse[] = []
  private dragState: DragState | null = null
  private fpsTracker: { frameCount: number; lastTime: number; currentFps: number } = {
    frameCount: 0,
    lastTime: performance.now(),
    currentFps: 60,
  }

  constructor(initialConfig?: Partial<PhysicsConfig>, initialArena?: CollisionArena) {
    this.config = validatePhysicsConfig(initialConfig ?? DEFAULT_PHYSICS_CONFIG)
    this.arena = initialArena ?? {
      minX: -2000,
      minY: -2000,
      maxX: 2000,
      maxY: 2000,
    }
  }

  public getConfig(): PhysicsConfig {
    return this.config
  }

  public setConfig(patch: Partial<PhysicsConfig>): void {
    this.config = validatePhysicsConfig({ ...this.config, ...patch })
  }

  public applyPreset(preset: PhysicsPreset): void {
    if (preset === 'custom') {
      this.config = { ...this.config, preset: 'custom' }
      return
    }
    const def = PHYSICS_PRESETS[preset]
    if (!def) return
    this.config = validatePhysicsConfig({
      ...this.config,
      preset,
      stiffness: def.stiffness,
      damping: def.damping,
      mass: def.mass,
      restitution: def.restitution,
      friction: def.friction,
      ...(def.magneticRadius !== undefined ? { magneticRadius: def.magneticRadius } : {}),
      ...(def.magneticStrength !== undefined ? { magneticStrength: def.magneticStrength } : {}),
      ...(def.gravity !== undefined ? { gravity: def.gravity } : {}),
    })
  }

  public getArena(): CollisionArena {
    return this.arena
  }

  public setArena(arena: CollisionArena): void {
    this.arena = { ...arena }
  }

  public addBody(input: PhysicsBodyInput): PhysicsBody {
    const width = Math.max(1, input.width)
    const height = Math.max(1, input.height)
    const radius = Math.max(width, height) / 2
    const body: PhysicsBody = {
      id: input.id,
      name: input.name ?? input.id,
      type: input.type ?? 'rectangle',
      x: input.x,
      y: input.y,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      mass: clampValue(input.mass ?? this.config.mass, PHYSICS_LIMITS.mass[0], PHYSICS_LIMITS.mass[1]),
      width,
      height,
      radius,
      restX: input.restX ?? input.x,
      restY: input.restY ?? input.y,
      pinned: input.pinned ?? false,
      isDragging: false,
      magnetic: input.magnetic ?? true,
      preset: input.preset ?? this.config.preset,
      lastCollisionVelocity: 0,
      lastCollisionTime: 0,
      settled: true,
    }
    this.bodies.set(input.id, body)
    return body
  }

  public removeBody(id: string): void {
    if (this.dragState?.bodyId === id) {
      this.dragState = null
    }
    this.bodies.delete(id)
  }

  public getBody(id: string): PhysicsBody | undefined {
    return this.bodies.get(id)
  }

  public getBodies(): PhysicsBody[] {
    return Array.from(this.bodies.values())
  }

  public clearBodies(): void {
    this.dragState = null
    this.bodies.clear()
  }

  public addMagneticTarget(target: MagneticTarget): void {
    this.magneticTargets.set(target.id, { ...target })
  }

  public removeMagneticTarget(id: string): void {
    this.magneticTargets.delete(id)
  }

  public clearMagneticTargets(): void {
    this.magneticTargets.clear()
  }

  public getMagneticTargets(): MagneticTarget[] {
    return Array.from(this.magneticTargets.values())
  }

  public applyImpulse(x: number, y: number, radius = 320, strength = 1800): void {
    const impulse: PhysicsImpulse = {
      id: `impulse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x,
      y,
      radius: Math.max(50, radius),
      strength: Math.max(100, strength),
      timestamp: performance.now(),
    }
    this.impulses.push(impulse)

    // Direct kick to nearby bodies for immediate visceral response
    for (const body of this.bodies.values()) {
      if (body.pinned || body.isDragging) continue
      const cx = body.x + body.width / 2
      const cy = body.y + body.height / 2
      const dx = cx - x
      const dy = cy - y
      const dist = Math.hypot(dx, dy)
      if (dist < impulse.radius && dist > 0.1) {
        const factor = (1 - dist / impulse.radius) ** 1.5
        const force = (impulse.strength * factor) / body.mass
        body.vx += (dx / dist) * force
        body.vy += (dy / dist) * force
        body.settled = false
      }
    }
  }

  public getActiveImpulses(): readonly PhysicsImpulse[] {
    return this.impulses
  }

  public cleanOldImpulses(maxAgeMs = 800): void {
    const now = performance.now()
    this.impulses = this.impulses.filter(imp => now - imp.timestamp < maxAgeMs)
  }

  // ==========================================
  // Draggable Canvas Nodes with Inertia
  // ==========================================

  public startDrag(id: string, worldPos: Point): boolean {
    const body = this.bodies.get(id)
    if (!body || body.pinned) return false

    body.isDragging = true
    body.settled = false
    body.vx = 0
    body.vy = 0

    this.dragState = {
      bodyId: id,
      startPointer: { ...worldPos },
      startBodyPos: { x: body.x, y: body.y },
      dragOffset: { x: worldPos.x - body.x, y: worldPos.y - body.y },
      pointerHistory: [{ pos: { ...worldPos }, time: performance.now() }],
    }
    return true
  }

  public updateDrag(worldPos: Point): void {
    if (!this.dragState) return
    const body = this.bodies.get(this.dragState.bodyId)
    if (!body) return

    const now = performance.now()
    // Move body directly with pointer
    body.x = worldPos.x - this.dragState.dragOffset.x
    body.y = worldPos.y - this.dragState.dragOffset.y

    // Maintain a rolling 120ms pointer history window
    this.dragState.pointerHistory.push({ pos: { ...worldPos }, time: now })
    const cutoff = now - 120
    this.dragState.pointerHistory = this.dragState.pointerHistory.filter(entry => entry.time >= cutoff)
  }

  public endDrag(): { id: string; velocity: Point } | null {
    if (!this.dragState) return null
    const { bodyId, pointerHistory } = this.dragState
    const body = this.bodies.get(bodyId)
    this.dragState = null

    if (!body) return null
    body.isDragging = false

    // Calculate throw velocity from rolling pointer window
    let vx = 0
    let vy = 0
    if (pointerHistory.length >= 2) {
      const oldest = pointerHistory[0]
      const newest = pointerHistory[pointerHistory.length - 1]
      // Fast pointer samples still carry momentum; bound their effective interval
      // rather than discarding flicks shorter than a display frame.
      const dt = Math.max(0.004, (newest.time - oldest.time) / 1000)
      if (performance.now() - newest.time <= 120) {
        vx = (newest.pos.x - oldest.pos.x) / dt
        vy = (newest.pos.y - oldest.pos.y) / dt
      }
    }

    // Safety clamp throw velocity
    const speed = Math.hypot(vx, vy)
    if (speed > PHYSICS_LIMITS.maxVelocity) {
      const ratio = PHYSICS_LIMITS.maxVelocity / speed
      vx *= ratio
      vy *= ratio
    }

    body.vx = vx
    body.vy = vy
    body.settled = Math.hypot(vx, vy) < 1.0

    return { id: bodyId, velocity: { x: vx, y: vy } }
  }

  public cancelDrag(): void {
    if (!this.dragState) return
    const body = this.bodies.get(this.dragState.bodyId)
    if (body) {
      body.isDragging = false
    }
    this.dragState = null
  }

  public isDragging(id?: string): boolean {
    if (!this.dragState) return false
    return id ? this.dragState.bodyId === id : true
  }

  // ==========================================
  // Reset & Scatter
  // ==========================================

  public resetToRest(): void {
    for (const body of this.bodies.values()) {
      body.x = body.restX
      body.y = body.restY
      body.vx = 0
      body.vy = 0
      body.ax = 0
      body.ay = 0
      body.settled = true
      body.lastCollisionVelocity = 0
    }
  }

  public scatter(speed = 600): void {
    for (const body of this.bodies.values()) {
      if (body.pinned || body.isDragging) continue
      const angle = Math.random() * Math.PI * 2
      const mag = speed * (0.6 + Math.random() * 0.8)
      body.vx = Math.cos(angle) * mag
      body.vy = Math.sin(angle) * mag
      body.settled = false
    }
  }

  public getKineticEnergy(): number {
    let energy = 0
    for (const body of this.bodies.values()) {
      if (body.pinned) continue
      energy += 0.5 * body.mass * (body.vx * body.vx + body.vy * body.vy)
    }
    return energy
  }

  // ==========================================
  // Numerical Integration Step
  // ==========================================

  public step(dtSeconds: number): PhysicsStats {
    const startTime = performance.now()
    this.cleanOldImpulses()

    // Measure FPS
    this.fpsTracker.frameCount++
    if (startTime - this.fpsTracker.lastTime >= 500) {
      this.fpsTracker.currentFps = Math.round(
        (this.fpsTracker.frameCount * 1000) / (startTime - this.fpsTracker.lastTime)
      )
      this.fpsTracker.frameCount = 0
      this.fpsTracker.lastTime = startTime
    }

    // Bound delta time to prevent large-step explosion
    const clampedDt = Math.max(0.001, Math.min(0.05, dtSeconds))
    const subSteps = Math.max(1, this.config.subSteps)
    const subDt = clampedDt / subSteps

    const k = this.config.stiffness
    const c = this.config.damping
    const friction = this.config.friction
    const restitution = this.config.restitution
    const gravity = this.config.gravity

    for (let s = 0; s < subSteps; s++) {
      // 1. Accumulate forces
      for (const body of this.bodies.values()) {
        if (body.pinned || body.isDragging) {
          body.ax = 0
          body.ay = 0
          continue
        }

        let fx = 0
        let fy = 0

        // External gravity
        if (this.config.gravityMode === 'down') {
          fy += body.mass * 980
        } else if (this.config.gravityMode === 'up') {
          fy -= body.mass * 980
        } else if (this.config.gravityMode === 'center') {
          const arenaCenterX = (this.arena.minX + this.arena.maxX) / 2
          const arenaCenterY = (this.arena.minY + this.arena.maxY) / 2
          const cdx = arenaCenterX - (body.x + body.width / 2)
          const cdy = arenaCenterY - (body.y + body.height / 2)
          const cdist = Math.hypot(cdx, cdy)
          if (cdist > 10) {
            const pull = Math.min(800, (body.mass * 600000) / (cdist * cdist))
            fx += (cdx / cdist) * pull
            fy += (cdy / cdist) * pull
          }
        } else if (gravity.x !== 0 || gravity.y !== 0) {
          fx += body.mass * gravity.x
          fy += body.mass * gravity.y
        }

        // Air & surface friction
        fx -= body.vx * friction * 60
        fy -= body.vy * friction * 60

        // Spring-mass-damper restoring force towards anchor (restX, restY)
        const dx = body.x - body.restX
        const dy = body.y - body.restY
        const springFx = -k * dx - c * body.vx
        const springFy = -k * dy - c * body.vy
        fx += springFx
        fy += springFy

        // Magnetic Snapping Targets
        if (body.magnetic) {
          // A. Discrete magnetic targets
          for (const target of this.magneticTargets.values()) {
            const tdx = target.x - (body.x + body.width / 2)
            const tdy = target.y - (body.y + body.height / 2)
            const dist = Math.hypot(tdx, tdy)
            if (dist < target.radius && dist > 0.01) {
              const weight = (1 - dist / target.radius) ** 2
              const pull = weight * target.strength * k * 1.5
              fx += (tdx / dist) * pull
              fy += (tdy / dist) * pull
              // Extra velocity dissipation within magnetic capture field
              fx -= body.vx * weight * c * 0.4
              fy -= body.vy * weight * c * 0.4
              target.active = true
            }
          }

          // B. 120px Engineering Grid Magnetic Snapping
          if (this.config.magneticGrid) {
            const cx = body.x + body.width / 2
            const cy = body.y + body.height / 2
            const snapGridX = Math.round(cx / ENGINEERING_GRID_SIZE) * ENGINEERING_GRID_SIZE
            const snapGridY = Math.round(cy / ENGINEERING_GRID_SIZE) * ENGINEERING_GRID_SIZE

            const gdx = snapGridX - cx
            const gdy = snapGridY - cy
            const gdist = Math.hypot(gdx, gdy)

            if (gdist < this.config.magneticRadius && gdist > 0.01) {
              const weight = (1 - gdist / this.config.magneticRadius) ** 2
              const magForce = weight * this.config.magneticStrength * k
              fx += (gdx / gdist) * magForce
              fy += (gdy / gdist) * magForce

              // Magnetic latch damping
              fx -= body.vx * weight * c * 0.5
              fy -= body.vy * weight * c * 0.5

              // Snapping latch lock-in
              if (gdist < 3.5 && Math.hypot(body.vx, body.vy) < 20) {
                body.x = snapGridX - body.width / 2
                body.y = snapGridY - body.height / 2
                body.vx *= 0.1
                body.vy *= 0.1
              }
            }
          }
        }

        body.ax = fx / body.mass
        body.ay = fy / body.mass
      }

      // 2. Symplectic Euler integration
      for (const body of this.bodies.values()) {
        if (body.pinned || body.isDragging) continue

        body.vx += body.ax * subDt
        body.vy += body.ay * subDt

        // Safety clamp max velocity
        const speed = Math.hypot(body.vx, body.vy)
        if (speed > PHYSICS_LIMITS.maxVelocity) {
          const ratio = PHYSICS_LIMITS.maxVelocity / speed
          body.vx *= ratio
          body.vy *= ratio
        }

        body.x += body.vx * subDt
        body.y += body.vy * subDt
      }

      // 3. Velocity-based Collision Boundaries
      const boundaryMode = this.config.boundaryMode
      if (boundaryMode !== 'none') {
        const { minX, minY, maxX, maxY } = this.arena

        for (const body of this.bodies.values()) {
          if (body.pinned || body.isDragging) continue

          if (boundaryMode === 'bounce') {
            // Left Wall
            if (body.x < minX) {
              body.x = minX
              if (body.vx < 0) {
                body.lastCollisionVelocity = Math.abs(body.vx)
                body.lastCollisionTime = performance.now()
                body.vx = -body.vx * restitution
                body.vy *= 1 - friction
              }
            }
            // Right Wall
            if (body.x + body.width > maxX) {
              body.x = maxX - body.width
              if (body.vx > 0) {
                body.lastCollisionVelocity = Math.abs(body.vx)
                body.lastCollisionTime = performance.now()
                body.vx = -body.vx * restitution
                body.vy *= 1 - friction
              }
            }
            // Top Wall
            if (body.y < minY) {
              body.y = minY
              if (body.vy < 0) {
                body.lastCollisionVelocity = Math.abs(body.vy)
                body.lastCollisionTime = performance.now()
                body.vy = -body.vy * restitution
                body.vx *= 1 - friction
              }
            }
            // Bottom Wall
            if (body.y + body.height > maxY) {
              body.y = maxY - body.height
              if (body.vy > 0) {
                body.lastCollisionVelocity = Math.abs(body.vy)
                body.lastCollisionTime = performance.now()
                body.vy = -body.vy * restitution
                body.vx *= 1 - friction
              }
            }
          } else if (boundaryMode === 'clamp') {
            if (body.x < minX) {
              body.x = minX
              body.vx = 0
            } else if (body.x + body.width > maxX) {
              body.x = maxX - body.width
              body.vx = 0
            }
            if (body.y < minY) {
              body.y = minY
              body.vy = 0
            } else if (body.y + body.height > maxY) {
              body.y = maxY - body.height
              body.vy = 0
            }
          } else if (boundaryMode === 'wrap') {
            const arenaWidth = maxX - minX
            const arenaHeight = maxY - minY
            if (arenaWidth > 10 && arenaHeight > 10) {
              if (body.x + body.width < minX) body.x += arenaWidth
              else if (body.x > maxX) body.x -= arenaWidth
              if (body.y + body.height < minY) body.y += arenaHeight
              else if (body.y > maxY) body.y -= arenaHeight
            }
          }
        }
      }

      // 4. Inter-Node Elastic Collisions
      if (this.config.interNodeCollisions) {
        const bodyArray = Array.from(this.bodies.values())
        const len = bodyArray.length
        for (let i = 0; i < len; i++) {
          const a = bodyArray[i]
          for (let j = i + 1; j < len; j++) {
            const b = bodyArray[j]
            if (a.pinned && b.pinned) continue

            // Circle collision approximation using average radius
            const ax = a.x + a.width / 2
            const ay = a.y + a.height / 2
            const bx = b.x + b.width / 2
            const by = b.y + b.height / 2

            const dx = bx - ax
            const dy = by - ay
            const dist = Math.hypot(dx, dy)
            const minDist = a.radius + b.radius

            if (dist < minDist && dist > 0.001) {
              const nx = dx / dist
              const ny = dy / dist
              const overlap = minDist - dist

              // Positional separation based on inverse mass
              if (!a.pinned && !b.pinned) {
                const totalMass = a.mass + b.mass
                const wa = b.mass / totalMass
                const wb = a.mass / totalMass
                if (!a.isDragging) {
                  a.x -= nx * overlap * wa
                  a.y -= ny * overlap * wa
                }
                if (!b.isDragging) {
                  b.x += nx * overlap * wb
                  b.y += ny * overlap * wb
                }
              } else if (!a.pinned && !a.isDragging) {
                a.x -= nx * overlap
                a.y -= ny * overlap
              } else if (!b.pinned && !b.isDragging) {
                b.x += nx * overlap
                b.y += ny * overlap
              }

              // Elastic velocity impulse resolution
              const rvx = b.vx - a.vx
              const rvy = b.vy - a.vy
              const velAlongNormal = rvx * nx + rvy * ny

              if (velAlongNormal < 0) {
                const e = Math.min(restitution, 0.95)
                const invMassA = a.pinned ? 0 : 1 / a.mass
                const invMassB = b.pinned ? 0 : 1 / b.mass
                const invMassSum = invMassA + invMassB

                if (invMassSum > 0) {
                  const j = -(1 + e) * velAlongNormal / invMassSum
                  const impulseX = nx * j
                  const impulseY = ny * j

                  if (!a.pinned && !a.isDragging) {
                    a.vx -= impulseX * invMassA
                    a.vy -= impulseY * invMassA
                    a.lastCollisionVelocity = Math.max(a.lastCollisionVelocity, Math.abs(j * invMassA))
                    a.lastCollisionTime = performance.now()
                  }
                  if (!b.pinned && !b.isDragging) {
                    b.vx += impulseX * invMassB
                    b.vy += impulseY * invMassB
                    b.lastCollisionVelocity = Math.max(b.lastCollisionVelocity, Math.abs(j * invMassB))
                    b.lastCollisionTime = performance.now()
                  }
                }
              }
            }
          }
        }
      }

      // 5. Settling detection
      for (const body of this.bodies.values()) {
        if (body.pinned || body.isDragging) {
          body.settled = true
          continue
        }
        const distFromRest = Math.hypot(body.x - body.restX, body.y - body.restY)
        const speed = Math.hypot(body.vx, body.vy)
        body.settled = distFromRest < 0.25 && speed < 1.5
      }
    }

    const duration = performance.now() - startTime

    let activeBodies = 0
    let settledBodies = 0
    let totalKineticEnergy = 0
    let maxVelocity = 0

    for (const body of this.bodies.values()) {
      const speed = Math.hypot(body.vx, body.vy)
      maxVelocity = Math.max(maxVelocity, speed)
      if (body.settled) {
        settledBodies++
      } else {
        activeBodies++
      }
      totalKineticEnergy += 0.5 * body.mass * (speed * speed)
    }

    return {
      fps: this.fpsTracker.currentFps,
      stepDuration: duration,
      activeBodies,
      settledBodies,
      totalKineticEnergy,
      maxVelocity,
    }
  }
}
