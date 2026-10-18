import type { ShaderNodeDefinition } from './types'

export const NODE_DEFINITIONS: Record<string, ShaderNodeDefinition> = {
  // ==========================================
  // UV TRANSFORMATIONS
  // ==========================================
  uv: {
    type: 'uv',
    label: 'UV Coordinates',
    category: 'uv',
    description: 'Generates normalized screen-space UV coordinates (0.0 to 1.0) with scale and offset.',
    inputs: [
      { id: 'scale', label: 'Scale', type: 'float', defaultValue: 1.0 },
      { id: 'offsetX', label: 'Offset X', type: 'float', defaultValue: 0.0 },
      { id: 'offsetY', label: 'Offset Y', type: 'float', defaultValue: 0.0 },
    ],
    outputs: [
      { id: 'uv', label: 'UV', type: 'vec2' },
      { id: 'u', label: 'U', type: 'float' },
      { id: 'v', label: 'V', type: 'float' },
    ],
    defaultParams: { scale: 1.0, offsetX: 0.0, offsetY: 0.0 },
  },

  'rotate-uv': {
    type: 'rotate-uv',
    label: 'Rotate UV',
    category: 'uv',
    description: 'Rotates 2D UV coordinates around an anchor point.',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'angle', label: 'Angle (deg)', type: 'float', defaultValue: 45.0 },
      { id: 'centerX', label: 'Center X', type: 'float', defaultValue: 0.5 },
      { id: 'centerY', label: 'Center Y', type: 'float', defaultValue: 0.5 },
    ],
    outputs: [
      { id: 'uv', label: 'UV Out', type: 'vec2' },
    ],
    defaultParams: { angle: 45.0, centerX: 0.5, centerY: 0.5 },
  },

  'polar-uv': {
    type: 'polar-uv',
    label: 'Polar Coordinates',
    category: 'uv',
    description: 'Converts Cartesian UV coordinates to polar coordinates (radius & angle).',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'radialScale', label: 'Radial Scale', type: 'float', defaultValue: 1.0 },
      { id: 'angleScale', label: 'Angle Scale', type: 'float', defaultValue: 1.0 },
    ],
    outputs: [
      { id: 'uv', label: 'Polar UV', type: 'vec2' },
      { id: 'radius', label: 'Radius', type: 'float' },
      { id: 'angle', label: 'Angle', type: 'float' },
    ],
    defaultParams: { radialScale: 1.0, angleScale: 1.0 },
  },

  panner: {
    type: 'panner',
    label: 'Panner / Scroll',
    category: 'uv',
    description: 'Animates UV coordinates over time along X and Y axes.',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'speedX', label: 'Speed X', type: 'float', defaultValue: 0.1 },
      { id: 'speedY', label: 'Speed Y', type: 'float', defaultValue: 0.05 },
    ],
    outputs: [
      { id: 'uv', label: 'UV Out', type: 'vec2' },
    ],
    defaultParams: { speedX: 0.1, speedY: 0.05 },
  },

  twirl: {
    type: 'twirl',
    label: 'Twirl Distortion',
    category: 'uv',
    description: 'Creates a vortex-like spiral distortion around a center point.',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'strength', label: 'Strength', type: 'float', defaultValue: 2.5 },
      { id: 'radius', label: 'Radius', type: 'float', defaultValue: 0.5 },
      { id: 'centerX', label: 'Center X', type: 'float', defaultValue: 0.5 },
      { id: 'centerY', label: 'Center Y', type: 'float', defaultValue: 0.5 },
    ],
    outputs: [
      { id: 'uv', label: 'UV Out', type: 'vec2' },
    ],
    defaultParams: { strength: 2.5, radius: 0.5, centerX: 0.5, centerY: 0.5 },
  },

  'tile-offset': {
    type: 'tile-offset',
    label: 'Tile & Offset',
    category: 'uv',
    description: 'Tiles and repeats UV coordinates with fractional wrapping.',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'tileX', label: 'Tile X', type: 'float', defaultValue: 2.0 },
      { id: 'tileY', label: 'Tile Y', type: 'float', defaultValue: 2.0 },
    ],
    outputs: [
      { id: 'uv', label: 'UV Out', type: 'vec2' },
    ],
    defaultParams: { tileX: 2.0, tileY: 2.0 },
  },

  // ==========================================
  // PROCEDURAL NOISE & GENERATORS
  // ==========================================
  'simplex-noise': {
    type: 'simplex-noise',
    label: 'Simplex Noise',
    category: 'noise',
    description: 'Continuous smooth 2D simplex noise gradient.',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'scale', label: 'Scale', type: 'float', defaultValue: 4.0 },
      { id: 'speed', label: 'Speed', type: 'float', defaultValue: 0.3 },
    ],
    outputs: [
      { id: 'out', label: 'Scalar', type: 'float' },
      { id: 'color', label: 'Grayscale', type: 'vec4' },
    ],
    defaultParams: { scale: 4.0, speed: 0.3 },
  },

  'perlin-noise': {
    type: 'perlin-noise',
    label: 'Perlin Noise',
    category: 'noise',
    description: 'Classic Perlin lattice noise with multi-octave roughness.',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'frequency', label: 'Frequency', type: 'float', defaultValue: 5.0 },
      { id: 'octaves', label: 'Octaves', type: 'float', defaultValue: 3.0 },
      { id: 'persistence', label: 'Persistence', type: 'float', defaultValue: 0.5 },
    ],
    outputs: [
      { id: 'out', label: 'Scalar', type: 'float' },
      { id: 'color', label: 'Grayscale', type: 'vec4' },
    ],
    defaultParams: { frequency: 5.0, octaves: 3.0, persistence: 0.5 },
  },

  'voronoi-noise': {
    type: 'voronoi-noise',
    label: 'Voronoi Cellular',
    category: 'noise',
    description: 'Cellular Voronoi / Worley noise computing distances to nearest feature points.',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'scale', label: 'Scale', type: 'float', defaultValue: 5.0 },
      { id: 'randomness', label: 'Randomness', type: 'float', defaultValue: 1.0 },
    ],
    outputs: [
      { id: 'f1', label: 'F1 Distance', type: 'float' },
      { id: 'f2', label: 'F2 Distance', type: 'float' },
      { id: 'cells', label: 'Cell ID', type: 'float' },
      { id: 'color', label: 'Color', type: 'vec4' },
    ],
    defaultParams: { scale: 5.0, randomness: 1.0 },
  },

  'fbm-noise': {
    type: 'fbm-noise',
    label: 'Fractal Brownian (FBM)',
    category: 'noise',
    description: 'Multi-octave fractal noise accumulator with turbulence and lacunarity.',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'octaves', label: 'Octaves', type: 'float', defaultValue: 4.0 },
      { id: 'lacunarity', label: 'Lacunarity', type: 'float', defaultValue: 2.0 },
      { id: 'persistence', label: 'Persistence', type: 'float', defaultValue: 0.5 },
      { id: 'turbulence', label: 'Turbulence', type: 'float', defaultValue: 0.0 },
    ],
    outputs: [
      { id: 'out', label: 'Scalar', type: 'float' },
      { id: 'color', label: 'Grayscale', type: 'vec4' },
    ],
    defaultParams: { octaves: 4.0, lacunarity: 2.0, persistence: 0.5, turbulence: 0.0 },
  },

  checkerboard: {
    type: 'checkerboard',
    label: 'Checkerboard',
    category: 'noise',
    description: 'Procedural alternating square grid pattern.',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'frequency', label: 'Frequency', type: 'float', defaultValue: 8.0 },
    ],
    outputs: [
      { id: 'out', label: 'Scalar', type: 'float' },
      { id: 'color', label: 'Color', type: 'vec4' },
    ],
    defaultParams: { frequency: 8.0 },
  },

  'sine-wave': {
    type: 'sine-wave',
    label: 'Sine Wave Bands',
    category: 'noise',
    description: 'Directional harmonic wave stripes with frequency and phase controls.',
    inputs: [
      { id: 'uv', label: 'UV In', type: 'vec2' },
      { id: 'frequency', label: 'Frequency', type: 'float', defaultValue: 12.0 },
      { id: 'angle', label: 'Angle (deg)', type: 'float', defaultValue: 0.0 },
      { id: 'phase', label: 'Phase', type: 'float', defaultValue: 0.0 },
    ],
    outputs: [
      { id: 'out', label: 'Scalar', type: 'float' },
    ],
    defaultParams: { frequency: 12.0, angle: 0.0, phase: 0.0 },
  },

  // ==========================================
  // COLOR & BLENDING
  // ==========================================
  'color-constant': {
    type: 'color-constant',
    label: 'Color Constant',
    category: 'color',
    description: 'A solid RGBA color swatch with hex picker.',
    inputs: [],
    outputs: [
      { id: 'color', label: 'RGBA', type: 'vec4' },
      { id: 'rgb', label: 'RGB', type: 'vec3' },
      { id: 'alpha', label: 'Alpha', type: 'float' },
    ],
    defaultParams: { hex: '#81adec', alpha: 1.0 },
  },

  'color-ramp': {
    type: 'color-ramp',
    label: 'Color Ramp / Gradient',
    category: 'color',
    description: 'Evaluates a smooth 4-stop gradient palette from scalar t (0.0 to 1.0).',
    inputs: [
      { id: 't', label: 'Factor (t)', type: 'float', defaultValue: 0.5 },
    ],
    outputs: [
      { id: 'color', label: 'RGBA', type: 'vec4' },
      { id: 'rgb', label: 'RGB', type: 'vec3' },
    ],
    defaultParams: {
      color0: '#080808',
      color1: '#516b94',
      color2: '#81adec',
      color3: '#edebe1',
    },
  },

  blend: {
    type: 'blend',
    label: 'Color Blend',
    category: 'color',
    description: 'Combines two color inputs using standard Photoshop-style blend modes.',
    inputs: [
      { id: 'base', label: 'Base', type: 'vec4' },
      { id: 'blend', label: 'Blend', type: 'vec4' },
      { id: 'opacity', label: 'Opacity', type: 'float', defaultValue: 1.0 },
    ],
    outputs: [
      { id: 'out', label: 'Color Out', type: 'vec4' },
    ],
    defaultParams: { mode: 'normal', opacity: 1.0 },
  },

  grayscale: {
    type: 'grayscale',
    label: 'Grayscale / Luminance',
    category: 'color',
    description: 'Calculates perceived luminance (Rec.709 coefficients: 0.2126 R + 0.7152 G + 0.0722 B).',
    inputs: [
      { id: 'color', label: 'Color In', type: 'vec4' },
    ],
    outputs: [
      { id: 'luminance', label: 'Luminance', type: 'float' },
      { id: 'color', label: 'Grayscale', type: 'vec4' },
    ],
    defaultParams: {},
  },

  invert: {
    type: 'invert',
    label: 'Invert',
    category: 'color',
    description: 'Inverts color or scalar value (1.0 - input).',
    inputs: [
      { id: 'in', label: 'Input', type: 'vec4' },
    ],
    outputs: [
      { id: 'out', label: 'Inverted', type: 'vec4' },
    ],
    defaultParams: {},
  },

  posterize: {
    type: 'posterize',
    label: 'Posterize',
    category: 'color',
    description: 'Quantizes color or values into discrete stepped color bands.',
    inputs: [
      { id: 'in', label: 'Input', type: 'vec4' },
      { id: 'steps', label: 'Steps', type: 'float', defaultValue: 4.0 },
    ],
    outputs: [
      { id: 'out', label: 'Posterized', type: 'vec4' },
    ],
    defaultParams: { steps: 4.0 },
  },

  // ==========================================
  // MATH OPERATORS & SHAPING
  // ==========================================
  add: {
    type: 'add',
    label: 'Add (A + B)',
    category: 'math',
    description: 'Adds two values or vectors component-wise.',
    inputs: [
      { id: 'a', label: 'A', type: 'float', defaultValue: 0.0 },
      { id: 'b', label: 'B', type: 'float', defaultValue: 0.0 },
    ],
    outputs: [
      { id: 'out', label: 'A + B', type: 'float' },
    ],
    defaultParams: { a: 0.0, b: 0.0 },
  },

  subtract: {
    type: 'subtract',
    label: 'Subtract (A - B)',
    category: 'math',
    description: 'Subtracts input B from input A.',
    inputs: [
      { id: 'a', label: 'A', type: 'float', defaultValue: 1.0 },
      { id: 'b', label: 'B', type: 'float', defaultValue: 0.5 },
    ],
    outputs: [
      { id: 'out', label: 'A - B', type: 'float' },
    ],
    defaultParams: { a: 1.0, b: 0.5 },
  },

  multiply: {
    type: 'multiply',
    label: 'Multiply (A × B)',
    category: 'math',
    description: 'Multiplies two inputs together.',
    inputs: [
      { id: 'a', label: 'A', type: 'float', defaultValue: 1.0 },
      { id: 'b', label: 'B', type: 'float', defaultValue: 1.0 },
    ],
    outputs: [
      { id: 'out', label: 'A × B', type: 'float' },
    ],
    defaultParams: { a: 1.0, b: 1.0 },
  },

  divide: {
    type: 'divide',
    label: 'Divide (A ÷ B)',
    category: 'math',
    description: 'Divides input A by input B with zero-division safeguard.',
    inputs: [
      { id: 'a', label: 'A', type: 'float', defaultValue: 1.0 },
      { id: 'b', label: 'B', type: 'float', defaultValue: 1.0 },
    ],
    outputs: [
      { id: 'out', label: 'A ÷ B', type: 'float' },
    ],
    defaultParams: { a: 1.0, b: 1.0 },
  },

  power: {
    type: 'power',
    label: 'Power (pow)',
    category: 'math',
    description: 'Raises base A to the exponent power B.',
    inputs: [
      { id: 'base', label: 'Base', type: 'float', defaultValue: 0.5 },
      { id: 'exp', label: 'Exp', type: 'float', defaultValue: 2.0 },
    ],
    outputs: [
      { id: 'out', label: 'Base^Exp', type: 'float' },
    ],
    defaultParams: { base: 0.5, exp: 2.0 },
  },

  smoothstep: {
    type: 'smoothstep',
    label: 'Smoothstep',
    category: 'math',
    description: 'Performs Hermite interpolation between edge0 and edge1.',
    inputs: [
      { id: 'in', label: 'Input', type: 'float', defaultValue: 0.5 },
      { id: 'edge0', label: 'Edge 0', type: 'float', defaultValue: 0.2 },
      { id: 'edge1', label: 'Edge 1', type: 'float', defaultValue: 0.8 },
    ],
    outputs: [
      { id: 'out', label: 'Stepped', type: 'float' },
    ],
    defaultParams: { edge0: 0.2, edge1: 0.8 },
  },

  clamp: {
    type: 'clamp',
    label: 'Clamp',
    category: 'math',
    description: 'Constrains a value to lie between min and max bounds.',
    inputs: [
      { id: 'in', label: 'Input', type: 'float', defaultValue: 0.5 },
      { id: 'min', label: 'Min', type: 'float', defaultValue: 0.0 },
      { id: 'max', label: 'Max', type: 'float', defaultValue: 1.0 },
    ],
    outputs: [
      { id: 'out', label: 'Clamped', type: 'float' },
    ],
    defaultParams: { min: 0.0, max: 1.0 },
  },

  mix: {
    type: 'mix',
    label: 'Mix / Lerp',
    category: 'math',
    description: 'Linear interpolation between A and B based on factor t.',
    inputs: [
      { id: 'a', label: 'A', type: 'vec4' },
      { id: 'b', label: 'B', type: 'vec4' },
      { id: 't', label: 'Factor (t)', type: 'float', defaultValue: 0.5 },
    ],
    outputs: [
      { id: 'out', label: 'Mixed', type: 'vec4' },
    ],
    defaultParams: { t: 0.5 },
  },

  abs: {
    type: 'abs',
    label: 'Absolute Value',
    category: 'math',
    description: 'Returns the positive magnitude of the input.',
    inputs: [
      { id: 'in', label: 'Input', type: 'float', defaultValue: 0.0 },
    ],
    outputs: [
      { id: 'out', label: '|x|', type: 'float' },
    ],
    defaultParams: { in: 0.0 },
  },

  sin: {
    type: 'sin',
    label: 'Sine',
    category: 'math',
    description: 'Computes trigonometric sine of angle in radians.',
    inputs: [
      { id: 'in', label: 'Input', type: 'float', defaultValue: 0.0 },
    ],
    outputs: [
      { id: 'out', label: 'sin(x)', type: 'float' },
    ],
    defaultParams: { in: 0.0 },
  },

  cos: {
    type: 'cos',
    label: 'Cosine',
    category: 'math',
    description: 'Computes trigonometric cosine of angle in radians.',
    inputs: [
      { id: 'in', label: 'Input', type: 'float', defaultValue: 0.0 },
    ],
    outputs: [
      { id: 'out', label: 'cos(x)', type: 'float' },
    ],
    defaultParams: { in: 0.0 },
  },

  fract: {
    type: 'fract',
    label: 'Fractional Part (fract)',
    category: 'math',
    description: 'Returns the fractional part of x (x - floor(x)).',
    inputs: [
      { id: 'in', label: 'Input', type: 'float', defaultValue: 0.0 },
    ],
    outputs: [
      { id: 'out', label: 'fract(x)', type: 'float' },
    ],
    defaultParams: { in: 0.0 },
  },

  length: {
    type: 'length',
    label: 'Vector Length',
    category: 'math',
    description: 'Calculates Euclidean length of a 2D/3D/4D vector.',
    inputs: [
      { id: 'vec', label: 'Vector In', type: 'vec2' },
    ],
    outputs: [
      { id: 'out', label: 'Length', type: 'float' },
    ],
    defaultParams: {},
  },

  'float-constant': {
    type: 'float-constant',
    label: 'Float Constant',
    category: 'math',
    description: 'A scalar floating-point constant value.',
    inputs: [],
    outputs: [
      { id: 'out', label: 'Value', type: 'float' },
    ],
    defaultParams: { value: 1.0 },
  },

  'vector2-constant': {
    type: 'vector2-constant',
    label: 'Vector2 Constant',
    category: 'math',
    description: 'A 2-component vector (X, Y).',
    inputs: [],
    outputs: [
      { id: 'out', label: 'Vec2', type: 'vec2' },
    ],
    defaultParams: { x: 0.5, y: 0.5 },
  },

  // ==========================================
  // MASTER OUTPUT
  // ==========================================
  'master-output': {
    type: 'master-output',
    label: 'Master Fragment Output',
    category: 'output',
    description: 'Terminal destination node for the procedural WebGL shader pipeline.',
    inputs: [
      { id: 'color', label: 'Base Color', type: 'vec4' },
      { id: 'alpha', label: 'Alpha', type: 'float', defaultValue: 1.0 },
      { id: 'emissive', label: 'Emissive', type: 'vec3' },
    ],
    outputs: [],
    defaultParams: {
      defaultColor: '#81adec',
      defaultAlpha: 1.0,
    },
  },
}

export const CATEGORY_LABELS: Record<string, string> = {
  uv: 'UV & Coordinates',
  noise: 'Procedural Noise',
  color: 'Color & Blending',
  math: 'Math & Shaping',
  output: 'Master Output',
}

export const CATEGORY_COLORS: Record<string, string> = {
  uv: '#81adec', // Paper blue
  noise: '#a78bfa', // Purple / violet
  color: '#ec4899', // Pink / magenta
  math: '#34d399', // Emerald / green
  output: '#fbbf24', // Amber / gold
}

export const PORT_COLORS: Record<string, string> = {
  float: '#81adec',
  vec2: '#34d399',
  vec3: '#fbbf24',
  vec4: '#f472b6',
}
