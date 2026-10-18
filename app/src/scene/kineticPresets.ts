import type { KineticTypography } from './types'

export interface KineticAnimationPreset {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon: string
  readonly category: 'Wave' | 'Bounce' | 'Pulse' | 'Continuous' | 'Expressive' | 'Organic' | 'Mechanical'
  readonly config: Readonly<Partial<KineticTypography>>
}

export const KINETIC_PRESETS: readonly KineticAnimationPreset[] = [
  {
    id: 'wave-ripple',
    name: 'Wave Ripple',
    description: 'Harmonic sinusoidal wave with gentle slant tilt and optical weight pulse',
    icon: '〰',
    category: 'Wave',
    config: {
      enabled: true,
      playing: true,
      amplitude: 22,
      rotation: 6,
      duration: 2.2,
      stagger: 65,
      staggerMode: 'wave',
      waveShape: 'sine',
      weightModulation: 180,
      slantModulation: 5,
      widthModulation: 15,
      scaleModulation: 0.08,
      horizontalAmplitude: 4,
      opticalSizeModulation: 12,
    },
  },
  {
    id: 'elastic-bounce',
    name: 'Elastic Bounce',
    description: 'Energetic spring rebound with vertical overshoot, scale pulse, and width stretch',
    icon: '∿',
    category: 'Bounce',
    config: {
      enabled: true,
      playing: true,
      amplitude: 32,
      rotation: 10,
      duration: 1.8,
      stagger: 80,
      staggerMode: 'elastic',
      waveShape: 'bounce',
      weightModulation: 250,
      slantModulation: -8,
      widthModulation: 30,
      scaleModulation: 0.22,
      horizontalAmplitude: 8,
      opticalSizeModulation: 16,
    },
  },
  {
    id: 'cascade-waterfall',
    name: 'Waterfall Cascade',
    description: 'Sequential waterfall delay with graceful downward float and oblique slant drift',
    icon: '↓',
    category: 'Continuous',
    config: {
      enabled: true,
      playing: true,
      amplitude: 28,
      rotation: 8,
      duration: 2.5,
      stagger: 85,
      staggerMode: 'cascade',
      waveShape: 'triangle',
      weightModulation: 120,
      slantModulation: -7,
      widthModulation: 0,
      scaleModulation: 0.1,
      horizontalAmplitude: 0,
      opticalSizeModulation: 8,
    },
  },
  {
    id: 'kinetic-pulse',
    name: 'Kinetic Pulse',
    description: 'Rhythmic center-out heartbeat swell with commanding optical weight expansion',
    icon: '♥',
    category: 'Pulse',
    config: {
      enabled: true,
      playing: true,
      amplitude: 14,
      rotation: 0,
      duration: 1.6,
      stagger: 110,
      staggerMode: 'center-out',
      waveShape: 'spring',
      weightModulation: 320,
      slantModulation: 0,
      widthModulation: 35,
      scaleModulation: 0.26,
      horizontalAmplitude: 0,
      opticalSizeModulation: 24,
    },
  },
  {
    id: 'breathe-expand',
    name: 'Breathe & Expand',
    description: 'Meditative slow breathing expanding glyph counter width and weight without rotation',
    icon: '○',
    category: 'Organic',
    config: {
      enabled: true,
      playing: true,
      amplitude: 6,
      rotation: 0,
      duration: 3.8,
      stagger: 45,
      staggerMode: 'center-out',
      waveShape: 'sine',
      weightModulation: 220,
      slantModulation: 0,
      widthModulation: 50,
      scaleModulation: 0.16,
      horizontalAmplitude: 2,
      opticalSizeModulation: 20,
    },
  },
  {
    id: 'typewriter-staccato',
    name: 'Typewriter Staccato',
    description: 'Crisp mechanical typewriter rhythm with stepping optical size and scale snap',
    icon: '⌨',
    category: 'Mechanical',
    config: {
      enabled: true,
      playing: true,
      amplitude: 16,
      rotation: 3,
      duration: 1.4,
      stagger: 120,
      staggerMode: 'left-to-right',
      waveShape: 'triangle',
      weightModulation: 0,
      slantModulation: 0,
      widthModulation: 0,
      scaleModulation: 0.14,
      horizontalAmplitude: 0,
      opticalSizeModulation: 18,
    },
  },
  {
    id: 'neon-jitter',
    name: 'Neon Jitter',
    description: 'High-frequency energetic micro-vibrations with random rotations and weight flicker',
    icon: '⚡',
    category: 'Expressive',
    config: {
      enabled: true,
      playing: true,
      amplitude: 8,
      rotation: 14,
      duration: 0.8,
      stagger: 35,
      staggerMode: 'random',
      waveShape: 'triangle',
      weightModulation: 160,
      slantModulation: 12,
      widthModulation: 20,
      scaleModulation: 0.12,
      horizontalAmplitude: 6,
      opticalSizeModulation: 14,
    },
  },
  {
    id: 'oblique-wind',
    name: 'Oblique Wind',
    description: 'Directional aerodynamic sweep with strong slant shear and lateral surge',
    icon: '彡',
    category: 'Expressive',
    config: {
      enabled: true,
      playing: true,
      amplitude: 16,
      rotation: -8,
      duration: 2.0,
      stagger: 75,
      staggerMode: 'left-to-right',
      waveShape: 'sine',
      weightModulation: 140,
      slantModulation: -18,
      widthModulation: 20,
      scaleModulation: 0.06,
      horizontalAmplitude: 26,
      opticalSizeModulation: 10,
    },
  },
  {
    id: 'rollercoaster-orbit',
    name: 'Rollercoaster Orbit',
    description: 'Dramatic curvature-following baseline ride with tangent drift and rotation swing',
    icon: '🎢',
    category: 'Wave',
    config: {
      enabled: true,
      playing: true,
      amplitude: 36,
      rotation: 24,
      duration: 2.8,
      stagger: 85,
      staggerMode: 'wave',
      waveShape: 'spring',
      weightModulation: 200,
      slantModulation: 14,
      widthModulation: -18,
      scaleModulation: 0.24,
      horizontalAmplitude: 18,
      opticalSizeModulation: 16,
    },
  },
  {
    id: 'weight-spectrum',
    name: 'Weight Spectrum',
    description: 'Continuous optical weight ribbon traversing from hairline thin to ultra-black',
    icon: '▮',
    category: 'Continuous',
    config: {
      enabled: true,
      playing: true,
      amplitude: 0,
      rotation: 0,
      duration: 2.4,
      stagger: 90,
      staggerMode: 'cascade',
      waveShape: 'sine',
      weightModulation: 420,
      slantModulation: 0,
      widthModulation: 30,
      scaleModulation: 0,
      horizontalAmplitude: 0,
      opticalSizeModulation: 30,
    },
  },
] as const

export function getKineticPreset(id: string): KineticAnimationPreset | undefined {
  return KINETIC_PRESETS.find(p => p.id === id)
}

export function applyKineticPreset(
  current: KineticTypography | undefined,
  presetId: string
): KineticTypography {
  const preset = getKineticPreset(presetId)
  if (!preset) {
    return {
      enabled: true,
      playing: true,
      amplitude: 18,
      rotation: 8,
      duration: 2.4,
      stagger: 70,
      phase: current?.phase ?? 0,
      staggerMode: 'cascade',
      waveShape: 'triangle',
      weightModulation: 0,
      slantModulation: 0,
      scaleModulation: 0,
      widthModulation: 0,
      horizontalAmplitude: 0,
      opticalSizeModulation: 0,
    }
  }

  return {
    enabled: true,
    playing: true,
    amplitude: preset.config.amplitude ?? 18,
    rotation: preset.config.rotation ?? 8,
    duration: preset.config.duration ?? 2.4,
    stagger: preset.config.stagger ?? 70,
    phase: current?.phase ?? 0,
    staggerMode: preset.config.staggerMode ?? 'cascade',
    waveShape: preset.config.waveShape ?? 'triangle',
    weightModulation: preset.config.weightModulation ?? 0,
    slantModulation: preset.config.slantModulation ?? 0,
    scaleModulation: preset.config.scaleModulation ?? 0,
    widthModulation: preset.config.widthModulation ?? 0,
    horizontalAmplitude: preset.config.horizontalAmplitude ?? 0,
    opticalSizeModulation: preset.config.opticalSizeModulation ?? 0,
  }
}

export function matchCurrentKineticPreset(current: KineticTypography | undefined): string | null {
  if (!current || !current.enabled) return null
  for (const preset of KINETIC_PRESETS) {
    const c = preset.config
    if (
      current.staggerMode === c.staggerMode &&
      current.waveShape === c.waveShape &&
      Math.abs(current.amplitude - (c.amplitude ?? 0)) <= 3 &&
      Math.abs(current.rotation - (c.rotation ?? 0)) <= 2 &&
      Math.abs((current.weightModulation ?? 0) - (c.weightModulation ?? 0)) <= 15
    ) {
      return preset.id
    }
  }
  return null
}
