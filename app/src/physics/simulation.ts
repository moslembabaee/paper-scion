import type { Bounds, Point } from '../canvas/types.ts'

export interface PhysicsSettings {
  mass: number
  stiffness: number
  damping: number
  restitution: number
  tether: boolean
  magnets: boolean
  collisions: boolean
}

export const PHYSICS_PRESETS = {
  balanced: { label: 'Balanced', mass: 1, stiffness: 180, damping: 18, restitution: .55 },
  gentle: { label: 'Gentle', mass: 1.4, stiffness: 80, damping: 22, restitution: .2 },
  elastic: { label: 'Elastic', mass: .8, stiffness: 260, damping: 7, restitution: .85 },
} as const
export const DEFAULT_PHYSICS: PhysicsSettings = { ...PHYSICS_PRESETS.balanced, tether: true, magnets: true, collisions: true }
export const FIXED_STEP = 1 / 120
const MAX_SPEED = 2400
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Mutable runtime bodies never enter the immutable document or its history. */
export interface PhysicsBody extends Bounds {
  id: string
  home: Point
  vx: number
  vy: number
  held: boolean
}
export function createBody(id: string, bounds: Bounds): PhysicsBody {
  return { ...bounds, id, home: { x: bounds.x, y: bounds.y }, vx: 0, vy: 0, held: false }
}

export function magneticTarget(body: PhysicsBody, arena?: Bounds): Point | null {
  const x = Math.round((body.x + body.width / 2) / 120) * 120 - body.width / 2
  const y = Math.round((body.y + body.height / 2) / 120) * 120 - body.height / 2
  // A magnet outside the arena would keep pulling against the wall indefinitely.
  if (arena && (x < arena.x || y < arena.y || x + body.width > arena.x + arena.width || y + body.height > arena.y + arena.height)) return null
  return Math.hypot(x - body.x, y - body.y) <= 42 ? { x, y } : null
}

export function containBody(body: PhysicsBody, arena: Bounds, restitution: number): void {
  const maxX = Math.max(arena.x, arena.x + arena.width - body.width)
  const maxY = Math.max(arena.y, arena.y + arena.height - body.height)
  if (body.x < arena.x) { body.x = arena.x; if (body.vx < 0) body.vx = -body.vx * restitution }
  if (body.x > maxX) { body.x = maxX; if (body.vx > 0) body.vx = -body.vx * restitution }
  if (body.y < arena.y) { body.y = arena.y; if (body.vy < 0) body.vy = -body.vy * restitution }
  if (body.y > maxY) { body.y = maxY; if (body.vy > 0) body.vy = -body.vy * restitution }
}

function collide(a: PhysicsBody, b: PhysicsBody, restitution: number): void {
  const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (ox <= 0 || oy <= 0 || (a.held && b.held)) return
  const axis = ox < oy ? 'x' : 'y', velocity = axis === 'x' ? 'vx' : 'vy', size = axis === 'x' ? 'width' : 'height'
  const normal = a[axis] + a[size] / 2 < b[axis] + b[size] / 2 ? 1 : -1
  const invA = a.held ? 0 : 1, invB = b.held ? 0 : 1
  a[axis] -= normal * (axis === 'x' ? ox : oy) * invA / (invA + invB)
  b[axis] += normal * (axis === 'x' ? ox : oy) * invB / (invA + invB)
  const relative = (b[velocity] - a[velocity]) * normal
  if (relative >= 0) return
  const impulse = -(1 + restitution) * relative / (invA + invB)
  if (!a.held) a[velocity] -= impulse * normal
  if (!b.held) b[velocity] += impulse * normal
}

/** Fixed semi-implicit Euler step with travel substeps for fast, thin bodies. */
export function stepPhysics(bodies: PhysicsBody[], arena: Bounds, settings: PhysicsSettings, dt = FIXED_STEP): boolean {
  if (!Number.isFinite(dt) || dt <= 0) return false
  dt = Math.min(dt, .05)
  const mass = clamp(settings.mass, .2, 5), stiffness = clamp(settings.stiffness, 20, 400)
  // Include acceleration: a stationary thin body can cross a neighbour in its
  // first spring step, before it has a measured velocity to size substeps with.
  const speed = bodies.reduce((v, body) => {
    const target = settings.tether ? body.home : settings.magnets ? magneticTarget(body, arena) : null
    const acceleration = target && !body.held ? Math.max(Math.abs(target.x - body.x), Math.abs(target.y - body.y)) * stiffness / mass : 0
    return Math.max(v, Math.min(MAX_SPEED, Math.max(Math.abs(body.vx), Math.abs(body.vy)) + acceleration * dt))
  }, 0)
  const extent = bodies.reduce((v, body) => Math.min(v, body.width, body.height), 120)
  const steps = Math.min(128, Math.max(1, Math.ceil(speed * dt / Math.max(.25, extent / 2))))
  const h = dt / steps
  const damping = clamp(settings.damping, 1, 40), restitution = clamp(settings.restitution, 0, 1)
  for (let step = 0; step < steps; step++) {
    for (const body of bodies) {
      if (body.held) continue
      const target = settings.tether ? body.home : settings.magnets ? magneticTarget(body, arena) : null
      body.vx = clamp(body.vx + ((target ? (target.x - body.x) * stiffness : 0) - damping * body.vx) / mass * h, -MAX_SPEED, MAX_SPEED)
      body.vy = clamp(body.vy + ((target ? (target.y - body.y) * stiffness : 0) - damping * body.vy) / mass * h, -MAX_SPEED, MAX_SPEED)
      body.x += body.vx * h; body.y += body.vy * h
    }
    if (settings.collisions) for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) collide(bodies[i], bodies[j], restitution)
    for (const body of bodies) if (!body.held) containBody(body, arena, restitution)
  }
  let active = false
  for (const body of bodies) {
    if (body.held) { active = true; continue }
    const target = settings.tether ? body.home : settings.magnets ? magneticTarget(body, arena) : null
    if (Math.hypot(body.vx, body.vy) > .08 || (target && Math.hypot(target.x - body.x, target.y - body.y) > .08)) active = true
    else { body.vx = 0; body.vy = 0; if (target) { body.x = target.x; body.y = target.y } }
  }
  return active
}

/** Bound catch-up work after backgrounding; simulation time is frame-rate independent. */
export class PhysicsClock {
  private accumulator = 0
  reset() { this.accumulator = 0 }
  advance(seconds: number, step: () => void) {
    if (!Number.isFinite(seconds) || seconds <= 0) return
    this.accumulator += Math.min(seconds, .05)
    while (this.accumulator + 1e-10 >= FIXED_STEP) { step(); this.accumulator -= FIXED_STEP }
  }
}
