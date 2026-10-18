import type {
  PhysicsConfig,
  PhysicsPreset,
  PhysicsPresetDefinition,
  ElementPhysicsConfig,
  PhysicsDocument,
} from './types.ts'

export const ENGINEERING_GRID_SIZE = 120

export const PHYSICS_LIMITS = {
  stiffness: [10, 1500] as const,
  damping: [0.5, 120] as const,
  mass: [0.1, 20] as const,
  restitution: [0, 1] as const,
  friction: [0, 0.5] as const,
  magneticRadius: [20, 600] as const,
  magneticStrength: [0.1, 10] as const,
  maxVelocity: 5000,
} as const

export const PHYSICS_PRESETS: Record<Exclude<PhysicsPreset, 'custom'>, PhysicsPresetDefinition> = {
  gentle: {
    label: 'Gentle',
    description: 'Soft tension with high damping for a calm, floating feel',
    stiffness: 90,
    damping: 20,
    mass: 1.0,
    restitution: 0.35,
    friction: 0.05,
    gravity: { x: 0, y: 0 },
  },
  snappy: {
    label: 'Snappy',
    description: 'High stiffness with critical damping for responsive, crisp lock-in',
    stiffness: 350,
    damping: 35,
    mass: 0.8,
    restitution: 0.20,
    friction: 0.08,
    gravity: { x: 0, y: 0 },
  },
  bouncy: {
    label: 'Bouncy',
    description: 'Energetic spring with minimal damping and high restitution',
    stiffness: 180,
    damping: 8,
    mass: 1.0,
    restitution: 0.88,
    friction: 0.02,
    gravity: { x: 0, y: 0 },
  },
  wobbly: {
    label: 'Wobbly',
    description: 'Playful low-stiffness jelly oscillations with high elasticity',
    stiffness: 50,
    damping: 4,
    mass: 1.2,
    restitution: 0.92,
    friction: 0.01,
    gravity: { x: 0, y: 0 },
  },
  magnetic: {
    label: 'Magnetic',
    description: 'Strong attractive snapping toward engineering grid intersections',
    stiffness: 220,
    damping: 24,
    mass: 0.8,
    restitution: 0.15,
    friction: 0.05,
    magneticRadius: 140,
    magneticStrength: 3.5,
    gravity: { x: 0, y: 0 },
  },
  'zero-g': {
    label: 'Zero-G',
    description: 'Frictionless deep space drifting with pure momentum coasting',
    stiffness: 15,
    damping: 1.2,
    mass: 1.0,
    restitution: 0.98,
    friction: 0.005,
    gravity: { x: 0, y: 0 },
  },
  heavy: {
    label: 'Heavy',
    description: 'Substantial mass with strong resistance and subdued recoil',
    stiffness: 420,
    damping: 52,
    mass: 4.5,
    restitution: 0.12,
    friction: 0.12,
    gravity: { x: 0, y: 0 },
  },
} as const

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = Object.freeze({
  preset: 'bouncy',
  stiffness: 180,
  damping: 8,
  mass: 1.0,
  restitution: 0.88,
  friction: 0.02,
  gravity: Object.freeze({ x: 0, y: 0 }),
  gravityMode: 'none',
  magneticGrid: true,
  magneticRadius: 120,
  magneticStrength: 2.5,
  boundaryMode: 'bounce',
  interNodeCollisions: true,
  subSteps: 4,
})

const isFiniteNumber = (val: unknown): val is number => typeof val === 'number' && Number.isFinite(val)

export function clampValue(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

export function validatePhysicsConfig(input: unknown): PhysicsConfig {
  if (!input || typeof input !== 'object') return DEFAULT_PHYSICS_CONFIG
  const rec = input as Record<string, unknown>

  const preset = typeof rec.preset === 'string' && (rec.preset in PHYSICS_PRESETS || rec.preset === 'custom')
    ? (rec.preset as PhysicsPreset)
    : DEFAULT_PHYSICS_CONFIG.preset

  const stiffness = isFiniteNumber(rec.stiffness)
    ? clampValue(rec.stiffness, PHYSICS_LIMITS.stiffness[0], PHYSICS_LIMITS.stiffness[1])
    : DEFAULT_PHYSICS_CONFIG.stiffness

  const damping = isFiniteNumber(rec.damping)
    ? clampValue(rec.damping, PHYSICS_LIMITS.damping[0], PHYSICS_LIMITS.damping[1])
    : DEFAULT_PHYSICS_CONFIG.damping

  const mass = isFiniteNumber(rec.mass)
    ? clampValue(rec.mass, PHYSICS_LIMITS.mass[0], PHYSICS_LIMITS.mass[1])
    : DEFAULT_PHYSICS_CONFIG.mass

  const restitution = isFiniteNumber(rec.restitution)
    ? clampValue(rec.restitution, PHYSICS_LIMITS.restitution[0], PHYSICS_LIMITS.restitution[1])
    : DEFAULT_PHYSICS_CONFIG.restitution

  const friction = isFiniteNumber(rec.friction)
    ? clampValue(rec.friction, PHYSICS_LIMITS.friction[0], PHYSICS_LIMITS.friction[1])
    : DEFAULT_PHYSICS_CONFIG.friction

  const gravity = rec.gravity && typeof rec.gravity === 'object' && isFiniteNumber((rec.gravity as Record<string, unknown>).x) && isFiniteNumber((rec.gravity as Record<string, unknown>).y)
    ? Object.freeze({ x: (rec.gravity as { x: number }).x, y: (rec.gravity as { y: number }).y })
    : DEFAULT_PHYSICS_CONFIG.gravity

  const gravityMode = ['none', 'down', 'up', 'center', 'pointer'].includes(String(rec.gravityMode))
    ? (rec.gravityMode as PhysicsConfig['gravityMode'])
    : DEFAULT_PHYSICS_CONFIG.gravityMode

  const boundaryMode = ['bounce', 'clamp', 'wrap', 'none'].includes(String(rec.boundaryMode))
    ? (rec.boundaryMode as PhysicsConfig['boundaryMode'])
    : DEFAULT_PHYSICS_CONFIG.boundaryMode

  const magneticRadius = isFiniteNumber(rec.magneticRadius)
    ? clampValue(rec.magneticRadius, PHYSICS_LIMITS.magneticRadius[0], PHYSICS_LIMITS.magneticRadius[1])
    : DEFAULT_PHYSICS_CONFIG.magneticRadius

  const magneticStrength = isFiniteNumber(rec.magneticStrength)
    ? clampValue(rec.magneticStrength, PHYSICS_LIMITS.magneticStrength[0], PHYSICS_LIMITS.magneticStrength[1])
    : DEFAULT_PHYSICS_CONFIG.magneticStrength

  const subSteps = isFiniteNumber(rec.subSteps)
    ? Math.round(clampValue(rec.subSteps, 1, 8))
    : DEFAULT_PHYSICS_CONFIG.subSteps

  return Object.freeze({
    preset,
    stiffness,
    damping,
    mass,
    restitution,
    friction,
    gravity,
    gravityMode,
    magneticGrid: typeof rec.magneticGrid === 'boolean' ? rec.magneticGrid : DEFAULT_PHYSICS_CONFIG.magneticGrid,
    magneticRadius,
    magneticStrength,
    boundaryMode,
    interNodeCollisions: typeof rec.interNodeCollisions === 'boolean' ? rec.interNodeCollisions : DEFAULT_PHYSICS_CONFIG.interNodeCollisions,
    subSteps,
  })
}

export function validateElementPhysics(input: unknown): ElementPhysicsConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid element physics')
  const rec = input as Record<string, unknown>

  if (rec.mass !== undefined && (!isFiniteNumber(rec.mass) || rec.mass <= 0)) throw new Error('Invalid physics mass')
  if (rec.stiffness !== undefined && (!isFiniteNumber(rec.stiffness) || rec.stiffness <= 0)) throw new Error('Invalid physics stiffness')
  if (rec.damping !== undefined && (!isFiniteNumber(rec.damping) || rec.damping < 0)) throw new Error('Invalid physics damping')
  if (rec.restitution !== undefined && (!isFiniteNumber(rec.restitution) || rec.restitution < 0 || rec.restitution > 1)) throw new Error('Invalid physics restitution')
  if (rec.pinned !== undefined && typeof rec.pinned !== 'boolean') throw new Error('Invalid physics pinned')
  if (rec.magnetic !== undefined && typeof rec.magnetic !== 'boolean') throw new Error('Invalid physics magnetic')

  return Object.freeze({
    enabled: typeof rec.enabled === 'boolean' ? rec.enabled : undefined,
    mass: isFiniteNumber(rec.mass) ? rec.mass : undefined,
    preset: typeof rec.preset === 'string' && (rec.preset in PHYSICS_PRESETS || rec.preset === 'custom') ? (rec.preset as PhysicsPreset) : undefined,
    stiffness: isFiniteNumber(rec.stiffness) ? rec.stiffness : undefined,
    damping: isFiniteNumber(rec.damping) ? rec.damping : undefined,
    restitution: isFiniteNumber(rec.restitution) ? rec.restitution : undefined,
    pinned: typeof rec.pinned === 'boolean' ? rec.pinned : undefined,
    magnetic: typeof rec.magnetic === 'boolean' ? rec.magnetic : undefined,
  })
}

export function validatePhysicsDocument(input: unknown): PhysicsDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid physics document')
  const rec = input as Record<string, unknown>

  return Object.freeze({
    enabled: typeof rec.enabled === 'boolean' ? rec.enabled : undefined,
    preset: typeof rec.preset === 'string' && (rec.preset in PHYSICS_PRESETS || rec.preset === 'custom') ? (rec.preset as PhysicsPreset) : undefined,
    config: rec.config ? validatePhysicsConfig(rec.config) : undefined,
    magneticGrid: typeof rec.magneticGrid === 'boolean' ? rec.magneticGrid : undefined,
    boundaryMode: ['bounce', 'clamp', 'wrap', 'none'].includes(String(rec.boundaryMode)) ? (rec.boundaryMode as PhysicsDocument['boundaryMode']) : undefined,
    interNodeCollisions: typeof rec.interNodeCollisions === 'boolean' ? rec.interNodeCollisions : undefined,
  })
}
