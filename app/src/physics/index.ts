export { PhysicsEngine } from './engine.ts'
export {
  DEFAULT_PHYSICS_CONFIG,
  ENGINEERING_GRID_SIZE,
  PHYSICS_LIMITS,
  PHYSICS_PRESETS,
  validatePhysicsConfig,
  validateElementPhysics,
  validatePhysicsDocument,
} from './constants.ts'
export type {
  PhysicsBody,
  PhysicsBodyInput,
  PhysicsConfig,
  PhysicsDocument,
  PhysicsImpulse,
  PhysicsPreset,
  PhysicsPresetDefinition,
  PhysicsStats,
  CollisionArena,
  MagneticTarget,
  ElementPhysicsConfig,
  DragState,
} from './types.ts'