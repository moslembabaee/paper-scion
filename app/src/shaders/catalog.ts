import type { ShaderControl, ShaderDefinition, ShaderKind, ShaderMotion, ShaderPaint, ShaderValue } from './types.ts'
import { shaderBlendModes } from './types.ts'
import { createMeshMaterial, defaultMeshAnchor, validateMeshMaterial } from './mesh.ts'
import { createDefaultGradient, freezeGradient, validateGradient } from './gradient.ts'
import { PIPELINE_PRESETS, createDefaultPipeline, presetKeys } from './pipeline/presets.ts'
import { validatePipeline } from './pipeline/pipelineOps.ts'
import { freezePostProcessing, validatePostProcessing } from '../canvas/postprocessing/model.ts'
import { GLASSMORPHISM_PRESETS, LIQUID_CHROME_PRESETS } from './refractive/presets.ts'
import { glassSurfacePatterns, chromeEnvironmentStyles } from './refractive/types.ts'
import { MATERIAL_PRESETS, createDefaultMaterialParams, getMaterialPreset } from './materials/presets.ts'
import { createDefaultFluidParams } from './fluid/presets.ts'
import { createDefaultParticleParams } from './particle/presets.ts'
import { createDefaultExtrusionParams } from './extrusion/presets.ts'
import { extrusionBevelProfiles, extrusionViewModes } from './extrusion/types.ts'

const number = (key: string, label: string, min = 0, max = 1, step = .01, integer = false): Extract<ShaderControl, { type: 'number' }> => ({ key, label, type: 'number', min, max, step, integer })
const color = (key: string, label: string): ShaderControl => ({ key, label, type: 'color' })
const palette = (max: number, key = 'colors'): ShaderControl => ({ key, label: 'Palette', type: 'palette', max })
const select = (key: string, label: string, options: readonly string[]): ShaderControl => ({ key, label, type: 'select', options })
const colors = ['#edebe1', '#81adec', '#516b94', '#222222']

export const shaderCatalog = {
  'mesh-gradient': {
    label: 'Mesh Gradient', description: 'Soft color, in constant conversation.',
    defaults: { colors, distortion: .65, swirl: .25, grainMixer: .08, grainOverlay: .04 },
    controls: [palette(10), number('distortion', 'Distortion'), number('swirl', 'Swirl'), number('grainMixer', 'Grain mixer'), number('grainOverlay', 'Grain overlay')],
  },
  'dot-orbit': {
    label: 'Dot Orbit', description: 'Little worlds, moving in their own way.',
    defaults: { colors: ['#81adec', '#222222', '#a5b4c8'], colorBack: '#edebe1', size: .3, sizeRange: .4, spreading: .6, stepsPerColor: 1 },
    controls: [palette(10), color('colorBack', 'Background'), number('size', 'Dot size'), number('sizeRange', 'Size variation'), number('spreading', 'Orbit spread'), number('stepsPerColor', 'Color steps', 1, 4, 1, true)],
  },
  'grain-gradient': {
    label: 'Grain Gradient', description: 'A little texture. A softer edge.',
    defaults: { colors, colorBack: '#222222', softness: .55, intensity: .45, noise: .2, shape: 'corners' },
    controls: [palette(7), color('colorBack', 'Background'), number('softness', 'Softness'), number('intensity', 'Intensity'), number('noise', 'Grain'), select('shape', 'Pattern', ['wave', 'dots', 'truchet', 'corners', 'ripple', 'blob', 'sphere'])],
  },
  'halftone-cmyk': {
    label: 'Halftone CMYK', description: 'Four inks. Endless possibilities.',
    defaults: { image: '/shader-source.svg', colorBack: '#edebe1', colorC: '#81adec', colorM: '#db7d98', colorY: '#e8c873', colorK: '#222222', size: .2, gridNoise: .15, type: 'ink', softness: .5, contrast: 1, floodC: .1, floodM: 0, floodY: 0, floodK: 0, gainC: .2, gainM: 0, gainY: .1, gainK: 0, grainMixer: .05, grainOverlay: .03, grainSize: .5 },
    controls: [{ key: 'image', label: 'Source image', type: 'image' }, color('colorBack', 'Paper'), color('colorC', 'Cyan'), color('colorM', 'Magenta'), color('colorY', 'Yellow'), color('colorK', 'Black'), number('size', 'Dot size'), select('type', 'Dot style', ['dots', 'ink', 'sharp']), number('gridNoise', 'Grid noise'), number('softness', 'Softness'), number('contrast', 'Contrast', 0, 2), ...['C', 'M', 'Y', 'K'].flatMap(ink => [number(`flood${ink}`, `${ink} flood`), number(`gain${ink}`, `${ink} gain`, -1, 1)]), number('grainMixer', 'Grain mixer'), number('grainOverlay', 'Grain overlay'), number('grainSize', 'Grain size')],
  },
  'neuro-noise': {
    label: 'Neuro Noise', description: 'An organic network of light and motion.',
    defaults: { colorFront: '#edebe1', colorMid: '#81adec', colorBack: '#080808', brightness: .1, contrast: .35 },
    controls: [color('colorFront', 'Highlight'), color('colorMid', 'Midtone'), color('colorBack', 'Background'), number('brightness', 'Brightness'), number('contrast', 'Contrast')],
  },
  gooey: {
    label: 'Gooey / Metaballs', description: 'Fluid forms that find each other.',
    defaults: { colors: ['#81adec', '#edebe1', '#516b94'], colorBack: '#222222', count: 6, size: .5 },
    controls: [palette(8), color('colorBack', 'Background'), number('count', 'Ball count', 1, 20, 1, true), number('size', 'Ball size')],
  },
  dithering: {
    label: 'Dithering', description: 'A study in pixels, pattern and ink.',
    defaults: { colorBack: '#edebe1', colorFront: '#222222', shape: 'simplex', type: '4x4', size: 2 },
    controls: [color('colorFront', 'Ink'), color('colorBack', 'Paper'), select('shape', 'Pattern', ['simplex', 'warp', 'dots', 'wave', 'ripple', 'swirl', 'sphere']), select('type', 'Dither', ['random', '2x2', '4x4', '8x8']), number('size', 'Pixel size', .5, 20, .5)],
  },
  'perlin-noise': {
    label: 'Perlin Noise', description: 'Layered noise, from soft clouds to fine detail.',
    defaults: { colorFront: '#81adec', colorBack: '#222222', proportion: .5, softness: .65, octaveCount: 3, persistence: .55, lacunarity: 2 },
    controls: [color('colorFront', 'Foreground'), color('colorBack', 'Background'), number('proportion', 'Distribution'), number('softness', 'Softness'), number('octaveCount', 'Octaves', 1, 8, 1, true), number('persistence', 'Roughness', .3, 1), number('lacunarity', 'Frequency step', 1.5, 10, .1)],
  },
  'liquid-distortion': {
    label: 'Liquid Distortion', description: 'Noise and layered swirls turn color into flowing ink.',
    defaults: { colors, proportion: .5, softness: .7, shape: 'stripes', shapeScale: .35, distortion: .45, swirl: .65, swirlIterations: 6 },
    controls: [palette(10), select('shape', 'Pattern', ['checks', 'stripes', 'edge']), number('shapeScale', 'Pattern scale'), number('distortion', 'Distortion'), number('swirl', 'Swirl'), number('swirlIterations', 'Swirl passes', 2, 20, 1, true), number('proportion', 'Distribution'), number('softness', 'Softness')],
  },
  'glass-refraction': {
    label: 'Glass Refraction', description: 'Refract a source image through sculpted glass.',
    defaults: { image: '/shader-source.svg', colorBack: '#edebe1', colorShadow: '#222222', colorHighlight: '#edebe1', shadows: .25, highlights: .25, size: .5, angle: 0, distortion: .55, distortionShape: 'lens', shape: 'lines', shift: 0, stretch: .1, blur: .08, edges: .25, marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0, grainMixer: .02, grainOverlay: .02 },
    controls: [{ key: 'image', label: 'Source image', type: 'image' }, color('colorBack', 'Background'), color('colorShadow', 'Shadow tint'), color('colorHighlight', 'Highlight tint'), select('distortionShape', 'Refraction', ['prism', 'lens', 'contour', 'cascade', 'flat']), select('shape', 'Glass pattern', ['lines', 'linesIrregular', 'wave', 'zigzag', 'pattern']), number('size', 'Rib size'), number('angle', 'Rib angle', 0, 180, 1), number('distortion', 'Refraction strength'), number('shift', 'Image shift', -1, 1), number('stretch', 'Stretch'), number('blur', 'Frosting'), number('edges', 'Edge softness'), number('shadows', 'Shadows'), number('highlights', 'Highlights'), ...['Left', 'Right', 'Top', 'Bottom'].map(side => number(`margin${side}`, `${side} margin`)), number('grainMixer', 'Grain mixer'), number('grainOverlay', 'Grain overlay')],
  },
  'multi-pass': {
    label: 'Multi-Pass Pipeline',
    description: 'Layered post-processing pipeline with liquid, glass, chromatic split, and grain.',
    defaults: {
      preset: 'prismatic-glass',
      colors,
      meshTurbulence: 0.45,
      liquidDistortion: 0.55,
      liquidFrequency: 2.2,
      glassRefraction: 0.65,
      glassFrost: 0.28,
      chromaticAberration: 0.48,
      grainIntensity: 0.12,
      grainBlend: 'overlay',
      modulatorSpeed: 0.4,
      modulatorDepth: 0.25,
    },
    controls: [
      select('preset', 'Preset', presetKeys),
      palette(10),
      number('meshTurbulence', 'Mesh turbulence'),
      number('liquidDistortion', 'Liquid distortion'),
      number('liquidFrequency', 'Liquid frequency', 0.5, 10, 0.1),
      number('glassRefraction', 'Glass refraction'),
      number('glassFrost', 'Glass frost blur'),
      number('chromaticAberration', 'Chromatic aberration'),
      number('grainIntensity', 'Film grain'),
      select('grainBlend', 'Grain blend', ['overlay', 'soft-light', 'multiply', 'screen']),
      number('modulatorSpeed', 'Modulator speed', 0, 3, 0.05),
      number('modulatorDepth', 'Modulator depth'),
    ],
  },
  'procedural-noise': {
    label: 'Procedural Noise',
    description: 'Multi-octave Simplex, Perlin, and Worley noise with grain displacement and normal-map surface perturbation.',
    defaults: {
      noiseType: 'simplex',
      frequency: 3.5,
      octaves: 3,
      lacunarity: 2.0,
      persistence: 0.5,
      turbulence: 0.2,
      displacement: 0.35,
      normalPerturbation: 0.4,
      grainMixer: 0.12,
      grainOverlay: 0.08,
      colorFront: '#edebe1',
      colorMid: '#81adec',
      colorBack: '#080808',
      lightAngle: 45,
      specularStrength: 0.35,
      viewMode: 'shaded',
    },
    controls: [
      select('noiseType', 'Generator', ['simplex', 'perlin', 'worley']),
      number('frequency', 'Frequency', 0.5, 20, 0.1),
      number('octaves', 'Octaves', 1, 8, 1, true),
      number('lacunarity', 'Lacunarity', 1.0, 5.0, 0.1),
      number('persistence', 'Roughness', 0.1, 1.0, 0.05),
      number('turbulence', 'Turbulence'),
      number('displacement', 'Displacement'),
      number('normalPerturbation', 'Normal bump'),
      number('grainMixer', 'Grain mixer'),
      number('grainOverlay', 'Grain overlay'),
      color('colorFront', 'Highlight'),
      color('colorMid', 'Midtone'),
      color('colorBack', 'Base'),
      number('lightAngle', 'Light angle', 0, 360, 1),
      number('specularStrength', 'Specular'),
      select('viewMode', 'View mode', ['shaded', 'normal-map', 'heightmap']),
    ],
  },
  'multi-stop-gradient': {
    label: 'Multi-Stop Gradient',
    description: 'Linear, radial, and angular multi-stop color transitions with on-canvas control handles.',
    defaults: {
      gradientType: 'linear',
      colors,
      angle: 90,
      originX: 0.5,
      originY: 0.5,
      focalLength: 0.0,
      spread: 1.0,
      dither: 0.25,
      smoothness: 0.5,
    },
    controls: [
      select('gradientType', 'Type', ['linear', 'radial', 'angular']),
      palette(16),
      number('angle', 'Angle', 0, 360, 1),
      number('originX', 'Center X', 0, 1, 0.01),
      number('originY', 'Center Y', 0, 1, 0.01),
      number('focalLength', 'Focal length', 0, 2, 0.01),
      number('spread', 'Spread', 0.1, 3, 0.01),
      number('dither', 'Dither noise', 0, 1, 0.01),
      number('smoothness', 'Interpolation', 0, 1, 0.01),
    ],
  },
  glassmorphism: {
    label: 'Glassmorphism FX',
    description: 'Physical glass optics with chromatic dispersion, microfacet roughness, and real-time backdrop blur.',
    defaults: { ...GLASSMORPHISM_PRESETS[0].params },
    controls: [
      number('refractionIndex', 'Refractive index', 1.0, 2.5, 0.01),
      number('dispersion', 'Chromatic dispersion', 0, 1, 0.01),
      number('roughness', 'Roughness', 0, 1, 0.01),
      number('blurRadius', 'Backdrop blur', 0, 1, 0.01),
      select('surfacePattern', 'Surface pattern', glassSurfacePatterns),
      number('patternScale', 'Pattern scale', 0.5, 10.0, 0.1),
      number('frostIntensity', 'Frost etching', 0, 1, 0.01),
      color('tintColor', 'Tint color'),
      number('tintOpacity', 'Tint opacity', 0, 1, 0.01),
      color('highlightColor', 'Specular highlight'),
      number('specularStrength', 'Specular glint', 0, 1, 0.01),
      number('lightAngle', 'Light angle', 0, 360, 1, true),
      number('bevelWidth', 'Bevel width', 0, 1, 0.01),
      number('chromaticShift', 'Color aberration', 0, 1, 0.01),
    ],
  },
  'liquid-chrome': {
    label: 'Liquid Chrome FX',
    description: 'Fluid warp distortion, molten metallic iridescence, and procedural studio reflections.',
    defaults: { ...LIQUID_CHROME_PRESETS[0].params },
    controls: [
      number('metallicSheen', 'Metallic sheen', 0, 1, 0.01),
      number('iridescence', 'Rainbow iridescence', 0, 1, 0.01),
      number('filmThickness', 'Film thickness', 100, 1000, 10),
      number('roughness', 'Roughness', 0, 1, 0.01),
      number('fluidViscosity', 'Fluid viscosity', 0, 1, 0.01),
      number('flowSpeed', 'Flow speed', 0, 3, 0.05),
      number('rippleFrequency', 'Ripple frequency', 0.5, 10, 0.1),
      number('dispersion', 'Color aberration', 0, 1, 0.01),
      color('baseColor', 'Base metal'),
      color('sheenColor', 'Sheen highlight'),
      number('lightAngle', 'Light angle', 0, 360, 1, true),
      select('environmentStyle', 'Environment map', chromeEnvironmentStyles),
      number('normalPerturbation', 'Normal bump', 0, 1, 0.01),
      number('grainMixer', 'Micro-grain noise', 0, 1, 0.01),
    ],
  },
  'shader-material': {
    label: 'Material Presets',
    description: 'Expandable physical shader materials with live WebGL controls, refraction, dispersion, and cursor reactivity.',
    defaults: createDefaultMaterialParams('iridescent-film'),
    controls: [
      select('presetId', 'Preset', MATERIAL_PRESETS.map(p => p.id)),
      number('refractionIndex', 'Refraction index', 1.0, 2.8, 0.01),
      number('dispersionSpread', 'Dispersion spread', 0.0, 1.0, 0.01),
      number('frequency', 'Frequency', 0.1, 20.0, 0.1),
      number('mouseReactivity', 'Mouse reactivity', 0.0, 1.0, 0.01),
      number('roughness', 'Roughness', 0.0, 1.0, 0.01),
      number('filmThickness', 'Film thickness', 100, 1200, 10),
      number('iridescence', 'Rainbow iridescence', 0.0, 1.0, 0.01),
      number('fluidViscosity', 'Fluid viscosity', 0.0, 1.0, 0.01),
      number('grainScale', 'Grain scale', 0.5, 10.0, 0.1),
      number('grainIntensity', 'Grain intensity', 0.0, 1.0, 0.01),
      palette(8),
      color('tintColor', 'Volume tint'),
      color('highlightColor', 'Specular glint'),
      number('lightAngle', 'Light angle', 0, 360, 1),
      number('specularStrength', 'Specular strength', 0.0, 1.0, 0.01),
      number('blendRatio', 'Internal blend', 0.0, 1.0, 0.01),
    ],
  },
  'fluid-simulation': {
    label: 'Fluid Simulation',
    description: 'Real-time Navier-Stokes 2D grid fluid dynamics simulation with velocity advection, dye dispersion, and surface refraction.',
    defaults: createDefaultFluidParams('ink-in-water'),
    controls: [
      number('densityDissipation', 'Density dissipation', 0.9, 1.0, 0.001),
      number('velocityDissipation', 'Velocity dissipation', 0.9, 1.0, 0.001),
      number('pressureIterations', 'Pressure iterations', 4, 64, 1, true),
      number('viscosity', 'Viscosity', 0.0, 1.0, 0.01),
      number('curlStrength', 'Curl strength', 0, 50, 0.5),
      number('splatRadius', 'Splat radius', 0.005, 0.1, 0.001),
      number('splatForce', 'Splat force', 100, 10000, 50),
      palette(8, 'dyeColors'),
      select('colorMode', 'Color mode', ['palette', 'rainbow', 'monochrome', 'fire', 'velocity']),
      number('ambientFlow', 'Ambient flow', 0.0, 2.0, 0.05),
      number('refractionIndex', 'Refraction index', 1.0, 2.5, 0.01),
      number('dispersion', 'Dispersion', 0.0, 1.0, 0.01),
      number('surfaceTension', 'Surface tension', 0.0, 1.0, 0.01),
      number('normalPerturbation', 'Normal perturbation', 0.0, 1.0, 0.01),
      number('specularStrength', 'Specular strength', 0.0, 2.0, 0.05),
      number('lightAngle', 'Light angle', 0, 360, 1),
      select('viewMode', 'View mode', ['fluid-composite', 'dye-only', 'velocity', 'pressure', 'normal-map', 'refraction-only']),
      number('gridResolution', 'Grid resolution', 64, 512, 32, true),
    ],
  },
  'particle-simulation': {
    label: 'Particle Simulation',
    description: 'Generative GPU particle field with incompressible curl noise, velocity advection, and cursor-driven magnetic flow.',
    defaults: createDefaultParticleParams('magnetic-vortex'),
    controls: [
      number('particleCount', 'Particle count', 1024, 65536, 1024, true),
      number('particleSize', 'Particle size', 0.5, 12.0, 0.1),
      number('advectionSpeed', 'Advection speed', 0.1, 5.0, 0.05),
      number('curlStrength', 'Curl strength', 0.0, 10.0, 0.1),
      number('curlScale', 'Curl scale', 0.2, 10.0, 0.1),
      number('curlOctaves', 'Curl octaves', 1, 5, 1, true),
      number('velocityDamping', 'Velocity damping', 0.80, 0.999, 0.001),
      select('magneticMode', 'Magnetic mode', ['attract', 'repel', 'vortex', 'dipole', 'cross-flow', 'orbit']),
      number('magneticForce', 'Magnetic force', 0.0, 10.0, 0.1),
      number('magneticRadius', 'Magnetic radius', 0.05, 1.0, 0.01),
      number('magneticPolesCount', 'Grid magnetic poles', 0, 8, 1, true),
      number('trailDecay', 'Trail decay', 0.70, 0.99, 0.01),
      palette(8, 'particleColors'),
      select('colorMode', 'Color mode', ['palette', 'monochrome', 'velocity', 'magnetic-flow', 'aurora', 'paper-blueprint']),
      select('viewMode', 'View mode', ['field-composite', 'particles-only', 'flow-vectors', 'magnetic-potential', 'velocity-stream', 'trails-only']),
      number('gridAlignment', 'Grid alignment', 0.0, 1.0, 0.01),
      number('glowIntensity', 'Glow intensity', 0.0, 2.0, 0.05),
      number('jitter', 'Jitter', 0.0, 1.0, 0.01),
    ],
  },
  'vector-extrusion': {
    label: 'Vector Extrusion 3D',
    description: '3D extrusion for vector paths and shapes with configurable bevel depth, analytical normal maps, directional lighting handles, and ambient occlusion.',
    defaults: createDefaultExtrusionParams('chiseled-aluminum'),
    controls: [
      number('extrusionDepth', 'Extrusion depth', 0, 100, 1),
      number('bevelDepth', 'Bevel depth', 0, 50, 0.5),
      number('bevelWidth', 'Bevel width', 1, 50, 0.5),
      select('bevelProfile', 'Bevel profile', extrusionBevelProfiles),
      number('bevelSegments', 'Bevel segments', 2, 16, 1, true),
      number('lightAzimuth', 'Light azimuth', 0, 360, 1),
      number('lightElevation', 'Light elevation', 5, 90, 1),
      number('lightDistance', 'Light distance', 0.2, 2.0, 0.05),
      number('lightIntensity', 'Light intensity', 0.0, 3.0, 0.05),
      color('lightColor', 'Light color'),
      number('ambientOcclusion', 'Ambient occlusion', 0.0, 1.0, 0.01),
      number('aoRadius', 'AO radius', 1, 30, 1),
      number('shadowSoftness', 'Shadow softness', 0.05, 1.0, 0.01),
      number('shadowLength', 'Shadow length', 0.0, 2.0, 0.05),
      number('shadowOpacity', 'Shadow opacity', 0.0, 1.0, 0.01),
      number('roughness', 'Roughness', 0.0, 1.0, 0.01),
      number('metallic', 'Metallic', 0.0, 1.0, 0.01),
      color('baseColor', 'Base color'),
      color('sideColor', 'Side wall color'),
      number('specularIntensity', 'Specular intensity', 0.0, 2.0, 0.05),
      number('normalMapStrength', 'Normal strength', 0.0, 3.0, 0.05),
      select('viewMode', 'View mode', extrusionViewModes),
    ],
  },
} satisfies { [K in ShaderKind]: ShaderDefinition<K> }

export const shaderKinds = Object.keys(shaderCatalog) as ShaderKind[]
export const motionControls = [number('speed', 'Speed', 0, 3), number('frame', 'Frame · ms', 0, 120000, 100), number('scale', 'Scale', .01, 4), number('rotation', 'Rotation', 0, 360, 1), number('offsetX', 'Offset X', -1, 1), number('offsetY', 'Offset Y', -1, 1)] as const

export function createShader(kind: ShaderKind, image?: string): ShaderPaint {
  const params = { ...shaderCatalog[kind].defaults }
  const paint = { kind, params, animated: kind !== 'halftone-cmyk' && kind !== 'glass-refraction', speed: .35, frame: 12000, scale: 1, rotation: 0, offsetX: 0, offsetY: 0, composite: { blendMode: 'normal', opacity: 1 } } as ShaderPaint
  return freezeShader(
    kind === 'mesh-gradient'
      ? { ...paint, mesh: createMeshMaterial(colors.length) }
      : kind === 'multi-stop-gradient'
        ? { ...paint, gradient: createDefaultGradient() }
        : kind === 'multi-pass'
          ? { ...paint, pipeline: createDefaultPipeline('prismatic-glass') }
          : (kind === 'halftone-cmyk' || kind === 'glass-refraction') && image
            ? ({ ...paint, params: { ...params, image } } as ShaderPaint)
            : paint
  )
}

/** Serializable, owned values: neither callers nor inspectors can mutate store state. */
export function freezeShader(paint: ShaderPaint): ShaderPaint {
  if (
    Object.isFrozen(paint) &&
    (!paint.postProcessing || (Object.isFrozen(paint.postProcessing) && Object.isFrozen(paint.postProcessing.passes) && paint.postProcessing.passes.every(pass => Object.isFrozen(pass) && Object.isFrozen(pass.params)))) &&
    (!paint.mesh || (Object.isFrozen(paint.mesh) && Object.isFrozen(paint.mesh.anchors) && paint.mesh.anchors.every(Object.isFrozen) && (!paint.mesh.grid || (Object.isFrozen(paint.mesh.grid) && Object.isFrozen(paint.mesh.grid.vertices) && paint.mesh.grid.vertices.every(Object.isFrozen))))) &&
    (!paint.gradient || Object.isFrozen(paint.gradient)) &&
    (!paint.pipeline ||
      (Object.isFrozen(paint.pipeline) &&
        Object.isFrozen(paint.pipeline.passes) &&
        paint.pipeline.passes.every(pass => Object.isFrozen(pass) && Object.isFrozen(pass.params)) &&
        Object.isFrozen(paint.pipeline.modulators) &&
        paint.pipeline.modulators.every(Object.isFrozen))) &&
    (!paint.composite || Object.isFrozen(paint.composite)) &&
    Object.isFrozen(paint.params) &&
    Object.values(paint.params).every(value => !Array.isArray(value) || Object.isFrozen(value))
  )
    return paint

  const params = Object.fromEntries(Object.entries(paint.params).map(([key, value]) => [key, Array.isArray(value) ? Object.freeze([...value]) : value]))
  const pipeline = paint.pipeline
    ? Object.freeze({
        ...paint.pipeline,
        passes: Object.freeze(
          paint.pipeline.passes.map(pass =>
            Object.freeze({
              ...pass,
              params: Object.freeze({
                ...pass.params,
                ...(Array.isArray((pass.params as unknown as Record<string, unknown>).colors)
                  ? { colors: Object.freeze([...((pass.params as unknown as Record<string, unknown>).colors as string[])]) }
                  : {}),
                ...(Array.isArray((pass.params as unknown as Record<string, unknown>).anchors)
                  ? { anchors: Object.freeze(((pass.params as unknown as Record<string, unknown>).anchors as unknown[]).map(a => Object.freeze({ ...(a as object) }))) }
                  : {}),
              }),
            })
          )
        ),
        modulators: Object.freeze(paint.pipeline.modulators.map(mod => Object.freeze({ ...mod }))),
      })
    : undefined

  return Object.freeze({
    ...paint,
    ...(paint.postProcessing ? { postProcessing: freezePostProcessing(paint.postProcessing) } : {}),
    ...(paint.mesh ? { mesh: Object.freeze({
      ...paint.mesh,
      anchors: Object.freeze(paint.mesh.anchors.map(anchor => Object.freeze({ ...anchor }))),
      ...(paint.mesh.grid ? { grid: Object.freeze({
        ...paint.mesh.grid,
        vertices: Object.freeze(paint.mesh.grid.vertices.map(v => Object.freeze({ ...v }))),
      }) } : {}),
    }) } : {}),
    ...(paint.gradient ? { gradient: freezeGradient(paint.gradient) } : {}),
    ...(pipeline ? { pipeline } : {}),
    ...(paint.composite ? { composite: Object.freeze({ ...paint.composite }) } : {}),
    params: Object.freeze(params),
  }) as ShaderPaint
}

export function updateShaderParameter(paint: ShaderPaint, key: string, value: ShaderValue): ShaderPaint {
  if (paint.kind === 'shader-material' && key === 'presetId' && typeof value === 'string') {
    const preset = getMaterialPreset(value)
    if (preset) {
      const next = { ...paint, params: { ...preset.params, colors: [...preset.params.colors] } } as ShaderPaint
      validateShader(next)
      return freezeShader(next)
    }
  }
  const mesh = paint.mesh && key === 'colors' && Array.isArray(value) ? { ...paint.mesh, anchors: value.map((_, index) => paint.mesh!.anchors[index] ?? defaultMeshAnchor(index)) } : paint.mesh
  let pipeline = paint.pipeline
  if (paint.kind === 'multi-pass') {
    if (key === 'preset' && typeof value === 'string') {
      const preset = PIPELINE_PRESETS[value]
      if (preset) {
        pipeline = preset.createPipeline()
      }
    } else if (pipeline) {
      const passMap = new Map(pipeline.passes.map(p => [p.type, p]))
      if (key === 'colors' && Array.isArray(value)) {
        const p = passMap.get('mesh-gradient')
        if (p) pipeline = { ...pipeline, preset: 'custom', passes: pipeline.passes.map(pass => pass.id === p.id ? { ...pass, params: { ...pass.params, colors: value as string[] } } : pass) }
      } else if (key === 'meshTurbulence' && typeof value === 'number') {
        const p = passMap.get('mesh-gradient')
        if (p) pipeline = { ...pipeline, preset: 'custom', passes: pipeline.passes.map(pass => pass.id === p.id ? { ...pass, params: { ...pass.params, turbulence: value } } : pass) }
      } else if (key === 'liquidDistortion' && typeof value === 'number') {
        const p = passMap.get('liquid-distortion')
        if (p) pipeline = { ...pipeline, preset: 'custom', passes: pipeline.passes.map(pass => pass.id === p.id ? { ...pass, params: { ...pass.params, distortion: value } } : pass) }
      } else if (key === 'liquidFrequency' && typeof value === 'number') {
        const p = passMap.get('liquid-distortion')
        if (p) pipeline = { ...pipeline, preset: 'custom', passes: pipeline.passes.map(pass => pass.id === p.id ? { ...pass, params: { ...pass.params, frequency: value } } : pass) }
      } else if (key === 'glassRefraction' && typeof value === 'number') {
        const p = passMap.get('glassmorphism')
        if (p) pipeline = { ...pipeline, preset: 'custom', passes: pipeline.passes.map(pass => pass.id === p.id ? { ...pass, params: { ...pass.params, refraction: value } } : pass) }
      } else if (key === 'glassFrost' && typeof value === 'number') {
        const p = passMap.get('glassmorphism')
        if (p) pipeline = { ...pipeline, preset: 'custom', passes: pipeline.passes.map(pass => pass.id === p.id ? { ...pass, params: { ...pass.params, frost: value } } : pass) }
      } else if (key === 'chromaticAberration' && typeof value === 'number') {
        const p = passMap.get('chromatic-aberration')
        if (p) pipeline = { ...pipeline, preset: 'custom', passes: pipeline.passes.map(pass => pass.id === p.id ? { ...pass, params: { ...pass.params, intensity: value } } : pass) }
      } else if (key === 'grainIntensity' && typeof value === 'number') {
        const p = passMap.get('grain')
        if (p) pipeline = { ...pipeline, preset: 'custom', passes: pipeline.passes.map(pass => pass.id === p.id ? { ...pass, params: { ...pass.params, intensity: value } } : pass) }
      } else if (key === 'grainBlend' && typeof value === 'string') {
        const p = passMap.get('grain')
        if (p) pipeline = { ...pipeline, preset: 'custom', passes: pipeline.passes.map(pass => pass.id === p.id ? { ...pass, params: { ...pass.params, blendMode: value as 'overlay' | 'soft-light' | 'multiply' | 'screen' } } : pass) }
      }
    }
  }
  const next = { ...paint, params: { ...paint.params, [key]: value }, ...(mesh ? { mesh } : {}), ...(pipeline ? { pipeline } : {}) } as ShaderPaint
  validateShader(next)
  return freezeShader(next)
}

const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value)
export function validateShader(value: unknown): asserts value is ShaderPaint {
  if (!value || typeof value !== 'object') throw new Error('Invalid shader paint')
  const paint = value as ShaderPaint
  if (paint.postProcessing !== undefined) validatePostProcessing(paint.postProcessing)
  if (!Object.hasOwn(shaderCatalog, paint.kind) || !paint.params || typeof paint.params !== 'object' || typeof paint.animated !== 'boolean') throw new Error('Invalid shader kind or parameters')
  if (paint.composite !== undefined) {
    const composite = paint.composite
    if (!composite || typeof composite !== 'object' || Object.keys(composite).length !== 2 || !shaderBlendModes.includes(composite.blendMode) || typeof composite.opacity !== 'number' || !Number.isFinite(composite.opacity) || composite.opacity < 0 || composite.opacity > 1) throw new Error('Invalid shader composite')
  }
  for (const control of motionControls) {
    const n = paint[control.key as keyof ShaderMotion]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < control.min || n > control.max) throw new Error(`Invalid shader ${control.key}`)
  }
  const definition: ShaderDefinition = shaderCatalog[paint.kind]
  const params = paint.params as unknown as Record<string, unknown>
  if (Object.keys(params).length !== definition.controls.length) throw new Error('Invalid shader parameter count')
  for (const control of definition.controls) {
    const param = params[control.key]
    const valid = control.type === 'number' ? typeof param === 'number' && Number.isFinite(param) && param >= control.min && param <= control.max && (!control.integer || Number.isInteger(param))
      : control.type === 'color' ? isColor(param)
      : control.type === 'palette' ? Array.isArray(param) && param.length >= 2 && param.length <= control.max && param.every(isColor)
      : control.type === 'select' ? typeof param === 'string' && control.options.includes(param)
      : typeof param === 'string' && !!param.trim() && /^(\/|\.\/|\.\.\/|https?:\/\/|data:image\/|blob:)/i.test(param)
    if (!valid) throw new Error(`Invalid shader ${control.key}`)
  }
  if (paint.mesh !== undefined) validateMeshMaterial(paint.mesh, paint)
  if (paint.gradient !== undefined) validateGradient(paint.gradient)
  if (paint.pipeline !== undefined) {
    if (paint.kind !== 'multi-pass') throw new Error('Invalid shader pipeline')
    validatePipeline(paint.pipeline, paint)
  }
}
