import type { FluidPreset, FluidPresetId, FluidSimulationParams } from './types.ts'

export const FLUID_PRESETS: readonly FluidPreset[] = [
  {
    id: 'ink-in-water',
    name: 'Ink in Water',
    description: 'Dynamic inky plume blooms and curls through pristine water.',
    params: {
      densityDissipation: 0.985,
      velocityDissipation: 0.98,
      pressureIterations: 24,
      viscosity: 0.25,
      curlStrength: 18.0,
      splatRadius: 0.025,
      splatForce: 3500,
      dyeColors: ['#080808', '#222222', '#516b94', '#81adec'],
      colorMode: 'palette',
      ambientFlow: 0.25,
      refractionIndex: 1.33,
      dispersion: 0.2,
      surfaceTension: 0.35,
      normalPerturbation: 0.55,
      specularStrength: 0.8,
      lightAngle: 45,
      viewMode: 'fluid-composite',
      gridResolution: 128,
    },
  },
  {
    id: 'liquid-mercury',
    name: 'Liquid Mercury',
    description: 'Dense molten metallic fluid with high surface tension and mirror specular reflections.',
    params: {
      densityDissipation: 0.995,
      velocityDissipation: 0.96,
      pressureIterations: 32,
      viscosity: 0.65,
      curlStrength: 10.0,
      splatRadius: 0.035,
      splatForce: 4500,
      dyeColors: ['#edebe1', '#c2c0b6', '#81adec', '#222222'],
      colorMode: 'monochrome',
      ambientFlow: 0.15,
      refractionIndex: 1.85,
      dispersion: 0.45,
      surfaceTension: 0.75,
      normalPerturbation: 0.85,
      specularStrength: 1.6,
      lightAngle: 60,
      viewMode: 'fluid-composite',
      gridResolution: 128,
    },
  },
  {
    id: 'neon-vapor',
    name: 'Neon Vapor',
    description: 'Luminescent electric plasma currents with low dissipation and turbulent eddies.',
    params: {
      densityDissipation: 0.99,
      velocityDissipation: 0.985,
      pressureIterations: 24,
      viscosity: 0.1,
      curlStrength: 28.0,
      splatRadius: 0.02,
      splatForce: 4000,
      dyeColors: ['#81adec', '#db7d98', '#e8c873', '#edebe1'],
      colorMode: 'rainbow',
      ambientFlow: 0.4,
      refractionIndex: 1.45,
      dispersion: 0.6,
      surfaceTension: 0.2,
      normalPerturbation: 0.45,
      specularStrength: 0.9,
      lightAngle: 120,
      viewMode: 'fluid-composite',
      gridResolution: 128,
    },
  },
  {
    id: 'paper-ripples',
    name: 'Paper Surface Ripples',
    description: 'Delicate tactile fluid ripples refracting the underlying paper canvas and 120px grid.',
    params: {
      densityDissipation: 0.97,
      velocityDissipation: 0.975,
      pressureIterations: 20,
      viscosity: 0.3,
      curlStrength: 12.0,
      splatRadius: 0.03,
      splatForce: 2800,
      dyeColors: ['#edebe1', '#81adec', '#516b94', '#080808'],
      colorMode: 'palette',
      ambientFlow: 0.2,
      refractionIndex: 1.52,
      dispersion: 0.3,
      surfaceTension: 0.5,
      normalPerturbation: 0.65,
      specularStrength: 1.1,
      lightAngle: 45,
      viewMode: 'fluid-composite',
      gridResolution: 128,
    },
  },
  {
    id: 'deep-ocean',
    name: 'Deep Ocean',
    description: 'Abyssal fluid currents with viscous indigo swirls and luminous cyan crests.',
    params: {
      densityDissipation: 0.98,
      velocityDissipation: 0.97,
      pressureIterations: 28,
      viscosity: 0.45,
      curlStrength: 22.0,
      splatRadius: 0.028,
      splatForce: 3800,
      dyeColors: ['#040a14', '#152b48', '#81adec', '#489fd9'],
      colorMode: 'palette',
      ambientFlow: 0.35,
      refractionIndex: 1.38,
      dispersion: 0.35,
      surfaceTension: 0.4,
      normalPerturbation: 0.7,
      specularStrength: 1.0,
      lightAngle: 30,
      viewMode: 'fluid-composite',
      gridResolution: 128,
    },
  },
] as const

export const FLUID_PRESET_MAP: Readonly<Record<FluidPresetId, FluidPreset>> = Object.freeze(
  FLUID_PRESETS.reduce((acc, preset) => {
    acc[preset.id] = preset
    return acc
  }, {} as Record<FluidPresetId, FluidPreset>)
)

export function getFluidPreset(id: FluidPresetId): FluidPreset {
  return FLUID_PRESET_MAP[id] ?? FLUID_PRESETS[0]
}

export function createDefaultFluidParams(presetId: FluidPresetId = 'ink-in-water'): FluidSimulationParams {
  const preset = getFluidPreset(presetId)
  return {
    ...preset.params,
    dyeColors: [...preset.params.dyeColors],
  }
}
