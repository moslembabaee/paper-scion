import type { SpringParameters } from './types.ts'

export const DEFAULT_SPRING: SpringParameters = Object.freeze({ stiffness: 170, damping: 20, mass: 1 })
export const SPRING_PRESETS = {
  gentle: { label: 'Gentle', spring: Object.freeze({ stiffness: 100, damping: 20, mass: 1 }) },
  snappy: { label: 'Snappy', spring: Object.freeze({ stiffness: 300, damping: 30, mass: 1 }) },
  bouncy: { label: 'Bouncy', spring: Object.freeze({ stiffness: 180, damping: 12, mass: 1 }) },
  smooth: { label: 'Smooth', spring: Object.freeze({ stiffness: 200, damping: 25, mass: 1 }) },
  stiff: { label: 'Stiff', spring: Object.freeze({ stiffness: 400, damping: 35, mass: 0.8 }) },
  wobbly: { label: 'Wobbly', spring: Object.freeze({ stiffness: 120, damping: 8, mass: 1.2 }) },
  slow: { label: 'Slow', spring: Object.freeze({ stiffness: 80, damping: 18, mass: 1.5 }) },
} as const
export const SPRING_LIMITS = { stiffness: [20, 1000], damping: [1, 100], mass: [.1, 10] } as const
const MAX_DURATION = 10000
const SAMPLE_MS = 1000 / 120

export function validateSpring(spring: SpringParameters): SpringParameters {
  if (!spring || Object.entries(SPRING_LIMITS).some(([key, [min, max]]) => {
    const value = spring[key as keyof SpringParameters]
    return !Number.isFinite(value) || value < min || value > max
  })) throw new Error('Invalid prototype spring')
  return Object.freeze({ stiffness: spring.stiffness, damping: spring.damping, mass: spring.mass })
}

/** Exact unit-step response of m·x″ + c·x′ + k·(x − 1) = 0, at rest at x = 0.
 * An analytic solution avoids frame-rate-dependent integration and large-delta instability. */
export function springState(milliseconds: number, spring: SpringParameters = DEFAULT_SPRING): { position: number; velocity: number } {
  if (milliseconds <= 0) return { position: 0, velocity: 0 }
  const time = milliseconds / 1000
  const omega = Math.sqrt(spring.stiffness / spring.mass), decay = spring.damping / (2 * spring.mass)
  if (Math.abs(decay - omega) < omega * 1e-6) {
    const envelope = Math.exp(-omega * time)
    return { position: 1 - envelope * (1 + omega * time), velocity: envelope * omega * omega * time }
  }
  if (decay < omega) {
    const frequency = Math.sqrt(omega * omega - decay * decay), envelope = Math.exp(-decay * time)
    return {
      position: 1 - envelope * (Math.cos(frequency * time) + decay / frequency * Math.sin(frequency * time)),
      velocity: envelope * omega * omega / frequency * Math.sin(frequency * time),
    }
  }
  const frequency = Math.sqrt(decay * decay - omega * omega)
  // Rationalizing the slow root avoids cancellation for strongly overdamped springs.
  const slow = -omega * omega / (decay + frequency), fast = -decay - frequency
  const a = fast / (slow - fast), b = -slow / (slow - fast)
  return { position: 1 + a * Math.exp(slow * time) + b * Math.exp(fast * time), velocity: a * slow * Math.exp(slow * time) + b * fast * Math.exp(fast * time) }
}

/** Require a quiet tail, so a turning point cannot be mistaken for a settled spring.
 * Extreme user settings are bounded to ten seconds; playback then finishes at exactly 1. */
export function springDuration(spring: SpringParameters = DEFAULT_SPRING): number {
  let quietSince = 0
  for (let time = SAMPLE_MS; time <= MAX_DURATION; time += SAMPLE_MS) {
    const { position, velocity } = springState(time, spring)
    if (Math.abs(1 - position) > .001 || Math.abs(velocity) > .01) quietSince = time
    else if (time - quietSince >= 200) return Math.ceil(time)
  }
  return MAX_DURATION
}

export function springProgress(progress: number, spring: SpringParameters = DEFAULT_SPRING, duration = springDuration(spring)): number {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  return springState(progress * duration, spring).position
}

/** Native sampled easing lets the browser animate transforms without a React render loop. */
export function springCSS(spring: SpringParameters = DEFAULT_SPRING, duration = springDuration(spring)): string {
  if (duration <= 0) return 'linear(0,1)'
  const count = Math.ceil(duration / SAMPLE_MS)
  return `linear(${Array.from({ length: count + 1 }, (_, index) => springProgress(index / count, spring, duration).toFixed(6)).join(',')})`
}
