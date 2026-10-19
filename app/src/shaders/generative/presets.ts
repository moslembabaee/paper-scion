import type { GenerativeMaterialParams, GenerativePresetDefinition, GenerativePresetId } from './types.ts'

export const GENERATIVE_PRESETS: readonly GenerativePresetDefinition[] = [
  {
    id: 'aurora-borealis',
    name: 'Aurora Borealis',
    description: 'Ethereal curtains of geomagnetic light, shifting through teal, emerald, and violet.',
    params: {
      preset: 'aurora-borealis',
      colorStops: ['#051c24', '#0d5c4d', '#25a18e', '#84f5cd', '#a155b9'],
      grainIntensity: 0.12,
      fluidDistortion: 0.48,
      chromaticAberration: 0.28,
      turbulenceSpeed: 0.65,
      frequency: 2.2,
      contrast: 1.15,
      octaves: 4,
    },
  },
  {
    id: 'cosmic-nebula',
    name: 'Cosmic Nebula',
    description: 'Deep stellar gas clouds with swirling magenta, cyan ionization, and starlight grain.',
    params: {
      preset: 'cosmic-nebula',
      colorStops: ['#06040a', '#3b1054', '#8c1d76', '#d14b8f', '#5ce1e6', '#f9f871'],
      grainIntensity: 0.22,
      fluidDistortion: 0.62,
      chromaticAberration: 0.45,
      turbulenceSpeed: 0.4,
      frequency: 1.8,
      contrast: 1.25,
      octaves: 4,
    },
  },
  {
    id: 'liquid-marble',
    name: 'Liquid Marble',
    description: 'Viscous organic marbling with silky veins, mineral taupe, and liquid gold flecks.',
    params: {
      preset: 'liquid-marble',
      colorStops: ['#f7f4ea', '#d3c5b4', '#7d7265', '#2b2622', '#d4af37'],
      grainIntensity: 0.08,
      fluidDistortion: 0.75,
      chromaticAberration: 0.15,
      turbulenceSpeed: 0.3,
      frequency: 2.8,
      contrast: 1.1,
      octaves: 5,
    },
  },
  {
    id: 'cyber-hologram',
    name: 'Cyber Hologram',
    description: 'High-energy diffraction holographic foil with sharp spectral aberration and fluid warp.',
    params: {
      preset: 'cyber-hologram',
      colorStops: ['#00f5d4', '#7b2cbf', '#f72585', '#4361ee', '#4cc9f0'],
      grainIntensity: 0.18,
      fluidDistortion: 0.55,
      chromaticAberration: 0.65,
      turbulenceSpeed: 0.85,
      frequency: 3.2,
      contrast: 1.3,
      octaves: 3,
    },
  },
  {
    id: 'solar-flare',
    name: 'Solar Flare',
    description: 'Turbulent convection plasma cells emitting incandescent coronal bursts.',
    params: {
      preset: 'solar-flare',
      colorStops: ['#1a0500', '#7a1200', '#d9381e', '#fa8128', '#ffd166'],
      grainIntensity: 0.14,
      fluidDistortion: 0.7,
      chromaticAberration: 0.35,
      turbulenceSpeed: 1.1,
      frequency: 2.5,
      contrast: 1.2,
      octaves: 4,
    },
  },
  {
    id: 'oceanic-depth',
    name: 'Oceanic Depth',
    description: 'Bioluminescent deep-sea abyss with sweeping refractive caustics and oceanic currents.',
    params: {
      preset: 'oceanic-depth',
      colorStops: ['#03071e', '#0a2472', '#0077b6', '#00b4d8', '#90e0ef'],
      grainIntensity: 0.1,
      fluidDistortion: 0.52,
      chromaticAberration: 0.22,
      turbulenceSpeed: 0.45,
      frequency: 1.9,
      contrast: 1.05,
      octaves: 4,
    },
  },
  {
    id: 'prismatic-opal',
    name: 'Prismatic Opal',
    description: 'Delicate mineral iridescence with pearlescent pastel diffusion and micro-facet dispersion.',
    params: {
      preset: 'prismatic-opal',
      colorStops: ['#e0c3fc', '#8ec5fc', '#fbc2eb', '#a6c1ee', '#fdfbfb'],
      grainIntensity: 0.06,
      fluidDistortion: 0.38,
      chromaticAberration: 0.5,
      turbulenceSpeed: 0.35,
      frequency: 2.0,
      contrast: 0.95,
      octaves: 3,
    },
  },
]

export const generativePresetKeys = GENERATIVE_PRESETS.map(p => p.id) as readonly GenerativePresetId[]

export function getGenerativePreset(id: string): GenerativePresetDefinition | undefined {
  return GENERATIVE_PRESETS.find(p => p.id === id)
}

export function createDefaultGenerativeParams(id: GenerativePresetId = 'aurora-borealis'): GenerativeMaterialParams {
  const preset = getGenerativePreset(id) ?? GENERATIVE_PRESETS[0]
  return {
    ...preset.params,
    colorStops: [...preset.params.colorStops],
  }
}
