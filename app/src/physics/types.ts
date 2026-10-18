import type { Point } from '../canvas/types.ts'

export type PhysicsPreset = 'gentle' | 'snappy' | 'bouncy' | 'wobbly' | 'magnetic' | 'zero-g' | 'heavy' | 'custom'

export type BoundaryMode = 'bounce' | 'clamp' | 'wrap' | 'none'

export type GravityMode = 'none' | 'down' | 'up' | 'center' | 'pointer'

export interface PhysicsParameters {
  readonly stiffness: number
  readonly damping: number
  readonly mass: number
  readonly restitution: number
  readonly friction: number
}

export interface PhysicsPresetDefinition extends PhysicsParameters {
  readonly label: string
  readonly description: string
  readonly gravity?: { x: number; y: number }
  readonly magneticRadius?: number
  readonly magneticStrength?: number
}

export interface PhysicsConfig {
  readonly preset: PhysicsPreset
  readonly stiffness: number
  readonly damping: number
  readonly mass: number
  readonly restitution: number
  readonly friction: number
  readonly gravity: { x: number; y: number }
  readonly gravityMode: GravityMode
  readonly magneticGrid: boolean
  readonly magneticRadius: number
  readonly magneticStrength: number
  readonly boundaryMode: BoundaryMode
  readonly interNodeCollisions: boolean
  readonly subSteps: number
}

export interface PhysicsBody {
  readonly id: string
  name: string
  type: string
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
  mass: number
  width: number
  height: number
  radius: number
  restX: number
  restY: number
  pinned: boolean
  isDragging: boolean
  magnetic: boolean
  preset: PhysicsPreset
  lastCollisionVelocity: number
  lastCollisionTime: number
  settled: boolean
}

export interface PhysicsBodyInput {
  id: string
  name?: string
  type?: string
  x: number
  y: number
  width: number
  height: number
  mass?: number
  pinned?: boolean
  magnetic?: boolean
  preset?: PhysicsPreset
  restX?: number
  restY?: number
}

export interface MagneticTarget {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly strength: number
  readonly label?: string
  active?: boolean
}

export interface CollisionArena {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export interface PhysicsImpulse {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly strength: number
  readonly timestamp: number
}

export interface PhysicsStats {
  readonly fps: number
  readonly stepDuration: number
  readonly activeBodies: number
  readonly settledBodies: number
  readonly totalKineticEnergy: number
  readonly maxVelocity: number
}

export interface ElementPhysicsConfig {
  readonly enabled?: boolean
  readonly mass?: number
  readonly preset?: PhysicsPreset
  readonly stiffness?: number
  readonly damping?: number
  readonly restitution?: number
  readonly pinned?: boolean
  readonly magnetic?: boolean
}

export interface PhysicsDocument {
  readonly enabled?: boolean
  readonly preset?: PhysicsPreset
  readonly config?: Partial<PhysicsConfig>
  readonly magneticGrid?: boolean
  readonly boundaryMode?: BoundaryMode
  readonly interNodeCollisions?: boolean
}

export interface DragState {
  readonly bodyId: string
  readonly startPointer: Point
  readonly startBodyPos: Point
  readonly dragOffset: Point
  pointerHistory: Array<{ pos: Point; time: number }>
}
