import type { ShaderPaint } from '../types.ts'
import type {
  ChromaticAberrationPassParams,
  CustomGLSLPassParams,
  GlassmorphismPassParams,
  LiquidDistortionPassParams,
  MeshGradientPassParams,
  ModulatorWaveform,
  PipelinePass,
  ShaderPipeline,
  UniformModulator,
} from './types.ts'
import { createDefaultPipeline } from './presets.ts'
import { SILENT_AUDIO } from '../audio/types.ts'
import type { AudioFrame } from '../audio/types.ts'

export const multiPassFragmentShader = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;

// Normalized live Web Audio signals. Zero for static exports / disconnected input.
uniform float u_audio_bass, u_audio_mid, u_audio_treble;
uniform float u_audio_volume, u_audio_peak, u_audio_transient;

// Global transformations
uniform float u_scale, u_rotation;
uniform vec2 u_offset;

// Pass toggles and opacities
uniform float u_pass_mesh_enabled;
uniform float u_pass_mesh_opacity;
uniform float u_pass_liquid_enabled;
uniform float u_pass_liquid_opacity;
uniform float u_pass_glass_enabled;
uniform float u_pass_glass_opacity;
uniform float u_pass_chromatic_enabled;
uniform float u_pass_chromatic_opacity;
uniform float u_pass_grain_enabled;
uniform float u_pass_grain_opacity;
uniform float u_pass_custom_enabled;
uniform float u_pass_custom_opacity;

// Pass blend modes (0: normal, 1: multiply, 2: screen, 3: overlay, 4: soft-light, 5: hard-light, 6: color-dodge, 7: difference, 8: add)
uniform float u_pass_liquid_blend;
uniform float u_pass_glass_blend;
uniform float u_pass_grain_blend;
uniform float u_pass_custom_blend;

// Pass 1: Mesh Gradient
uniform float u_mesh_count;
uniform vec4 u_mesh_colors[10];
uniform vec3 u_mesh_anchors[10];
uniform float u_mesh_turbulence;
uniform float u_mesh_frequency;
uniform float u_mesh_swirl;
uniform float u_mesh_distortion;

// Pass 2: Liquid Distortion
uniform float u_liquid_distortion;
uniform float u_liquid_frequency;
uniform float u_liquid_speed;
uniform float u_liquid_swirl;
uniform float u_liquid_iterations;
uniform float u_liquid_viscosity;

// Pass 3: Glassmorphism
uniform float u_glass_refraction;
uniform float u_glass_frost;
uniform float u_glass_pattern; // 0=smooth, 1=fluted, 2=prism, 3=wave
uniform float u_glass_angle;
uniform float u_glass_specular;
uniform float u_glass_bevel;
uniform vec4 u_glass_tint;

// Pass 4: Chromatic Aberration
uniform float u_chromatic_intensity;
uniform float u_chromatic_spread;
uniform float u_chromatic_radial; // 1.0 = radial, 0.0 = directional
uniform float u_chromatic_angle;

// Pass 5: Film Grain
uniform float u_grain_intensity;
uniform float u_grain_size;
uniform float u_grain_temporal;
uniform float u_grain_monochrome;

// Pass 6: Post-process adjustments
uniform float u_post_contrast;
uniform float u_post_brightness;
uniform float u_post_saturation;
uniform float u_post_vignette;
uniform vec3 u_post_tint;

out vec4 fragColor;

// --- Procedural Noise & Utilities ---
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}

vec3 blendColors(int mode, vec3 base, vec3 blend) {
  if (mode == 1) return base * blend; // multiply
  if (mode == 2) return 1.0 - (1.0 - base) * (1.0 - blend); // screen
  if (mode == 3) return mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(vec3(0.5), base)); // overlay
  if (mode == 4) return (1.0 - 2.0 * blend) * base * base + 2.0 * blend * base; // soft-light
  if (mode == 5) return mix(2.0 * base * blend, 1.0 - 2.0 * (1.0 - base) * (1.0 - blend), step(vec3(0.5), blend)); // hard-light
  if (mode == 6) return min(vec3(1.0), base / max(vec3(0.001), 1.0 - blend)); // color-dodge
  if (mode == 7) return abs(base - blend); // difference
  if (mode == 8) return min(vec3(1.0), base + blend); // add
  return blend; // normal
}

// --- Sample Mesh Gradient Color Field (Smooth Bicubic Spline) ---
vec4 sampleMeshField(vec2 p) {
  vec4 color = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 10; i++) {
    if (float(i) >= u_mesh_count) break;
    vec2 delta = p - u_mesh_anchors[i].xy;
    float r = max(0.05, u_mesh_anchors[i].z);
    vec2 t = clamp(abs(delta) / r, 0.0, 1.0);
    vec2 h = (vec2(1.0) - t) * (vec2(1.0) - t) * (vec2(1.0) + vec2(2.0) * t);
    float rad = clamp(length(delta) / r, 0.0, 1.0);
    float hRad = (1.0 - rad) * (1.0 - rad) * (1.0 + 2.0 * rad);
    float weight = (h.x * h.y * 0.7 + hRad * 0.3) + 0.00001;
    color += vec4(u_mesh_colors[i].rgb * u_mesh_colors[i].a, u_mesh_colors[i].a) * weight;
    total += weight;
  }
  if (total <= 0.0) return vec4(0.5, 0.68, 0.93, 1.0);
  return color / total;
}

// --- Liquid Flow Vector Calculation ---
vec2 calculateLiquidFlow(vec2 p, float time) {
  vec2 flow = vec2(0.0);
  float freq = u_liquid_frequency;
  float amp = 1.0;
  int iters = int(clamp(u_liquid_iterations, 1.0, 8.0));
  for (int i = 0; i < 8; i++) {
    if (i >= iters) break;
    vec2 shift = vec2(
      sin(p.y * freq + time * (1.0 + float(i) * 0.2)),
      cos(p.x * freq - time * (0.8 + float(i) * 0.15))
    );
    flow += shift * amp;
    freq *= 1.8;
    amp *= 0.5 * (1.0 - u_liquid_viscosity * 0.4);
    p = mat2(0.8, -0.6, 0.6, 0.8) * p;
  }
  return flow * 0.15;
}

// --- Glassmorphism Refraction & Pattern ---
vec2 calculateGlassRefraction(vec2 p, out float specularHighlight, out float bevelEdge) {
  vec2 refr = vec2(0.0);
  specularHighlight = 0.0;
  bevelEdge = 0.0;

  float rad = radians(u_glass_angle);
  vec2 rotP = mat2(cos(rad), -sin(rad), sin(rad), cos(rad)) * p;

  if (u_glass_pattern < 0.5) {
    // Smooth lens curvature
    float d = length(p - 0.5);
    refr = normalize(p - 0.5 + vec2(0.0001)) * pow(d, 1.5) * u_glass_refraction * 0.2;
    specularHighlight = pow(max(0.0, 1.0 - d * 1.5), 6.0) * u_glass_specular;
  } else if (u_glass_pattern < 1.5) {
    // Fluted ribbed glass
    float rib = sin(rotP.x * 32.0);
    refr = vec2(cos(rad), sin(rad)) * rib * u_glass_refraction * 0.12;
    specularHighlight = pow(abs(rib), 12.0) * u_glass_specular;
    bevelEdge = abs(cos(rotP.x * 32.0)) * u_glass_bevel * 0.3;
  } else if (u_glass_pattern < 2.5) {
    // Prism facets
    vec2 grid = fract(rotP * 12.0) - 0.5;
    refr = sign(grid) * pow(abs(grid), vec2(0.8)) * u_glass_refraction * 0.15;
    specularHighlight = step(0.45, max(abs(grid.x), abs(grid.y))) * u_glass_specular * 0.8;
    bevelEdge = (1.0 - length(grid)) * u_glass_bevel * 0.4;
  } else {
    // Wave water glass
    float w1 = sin(rotP.x * 16.0 + u_time * 0.5);
    float w2 = cos(rotP.y * 14.0 - u_time * 0.4);
    refr = vec2(w1, w2) * u_glass_refraction * 0.1;
    specularHighlight = pow(max(0.0, (w1 + w2) * 0.5), 5.0) * u_glass_specular;
  }

  // Frosted micro-roughness / jitter
  if (u_glass_frost > 0.0) {
    vec2 frostJitter = vec2(hash(p * 256.0 + 1.2), hash(p * 256.0 + 7.8)) - 0.5;
    refr += frostJitter * u_glass_frost * 0.04;
  }

  return refr;
}

void main() {
  // Keep the complete live audio interface available to GLSL consumers. Reject
  // invalid negative envelopes; disconnected inputs are all zero and render normally.
  if (any(lessThan(vec3(u_audio_bass, u_audio_mid, u_audio_treble), vec3(0.0))) ||
      any(lessThan(vec3(u_audio_volume, u_audio_peak, u_audio_transient), vec3(0.0)))) {
    fragColor = vec4(0.0);
    return;
  }
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y);
  vec2 p = uv - 0.5 - u_offset;

  // Global scale & rotation
  float c = cos(u_rotation), s = sin(u_rotation);
  p = mat2(c, -s, s, c) * p / max(0.001, u_scale);

  // Center coordinate space (0..1)
  vec2 sampleP = p + 0.5;

  // PASS 1: Mesh Gradient Base Turbulence & Swirl
  if (u_pass_mesh_enabled > 0.5) {
    float angle = u_mesh_swirl * 3.0 * exp(-dot(p, p) * 3.0);
    p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
    float t = u_time * 0.18;
    float turb = u_mesh_turbulence + u_mesh_distortion * 0.3;
    if (turb > 0.0) {
      vec2 flow = vec2(fbm(p * u_mesh_frequency + vec2(t, 0.0)), fbm(p * u_mesh_frequency + vec2(7.0, t)));
      p += (flow - 0.4375) * turb;
    }
    sampleP = p + 0.5;
  }

  // PASS 2: Liquid Distortion (Fluid Domain Warping)
  if (u_pass_liquid_enabled > 0.5) {
    vec2 liquidFlow = calculateLiquidFlow(sampleP, u_time * u_liquid_speed);
    sampleP += liquidFlow * (u_liquid_distortion * u_pass_liquid_opacity);
    if (u_liquid_swirl > 0.0) {
      vec2 centerDelta = sampleP - 0.5;
      float swirlAngle = u_liquid_swirl * 4.0 * exp(-dot(centerDelta, centerDelta) * 4.0);
      sampleP = 0.5 + mat2(cos(swirlAngle), -sin(swirlAngle), sin(swirlAngle), cos(swirlAngle)) * centerDelta;
    }
  }

  // PASS 3: Glassmorphism Refraction
  float specular = 0.0;
  float bevel = 0.0;
  if (u_pass_glass_enabled > 0.5) {
    vec2 glassRefr = calculateGlassRefraction(sampleP, specular, bevel);
    sampleP += glassRefr * u_pass_glass_opacity;
  }

  // PASS 4: Chromatic Aberration & Spectral Sampling
  vec4 baseSample;
  vec3 rgbColor;
  float alpha;

  if (u_pass_chromatic_enabled > 0.5 && u_chromatic_intensity > 0.001) {
    vec2 dispersionDir;
    if (u_chromatic_radial > 0.5) {
      dispersionDir = normalize(sampleP - 0.5 + vec2(0.0001)) * length(sampleP - 0.5);
    } else {
      float aRad = radians(u_chromatic_angle);
      dispersionDir = vec2(cos(aRad), sin(aRad));
    }
    vec2 shift = dispersionDir * (u_chromatic_intensity * u_chromatic_spread * 0.06 * u_pass_chromatic_opacity);

    vec4 sampleR = sampleMeshField(sampleP + shift);
    vec4 sampleG = sampleMeshField(sampleP);
    vec4 sampleB = sampleMeshField(sampleP - shift);

    rgbColor = vec3(
      sampleR.r / max(sampleR.a, 0.0001),
      sampleG.g / max(sampleG.a, 0.0001),
      sampleB.b / max(sampleB.a, 0.0001)
    );
    alpha = (sampleR.a + sampleG.a + sampleB.a) / 3.0;
    baseSample = vec4(rgbColor * alpha, alpha);
  } else {
    baseSample = sampleMeshField(sampleP);
    alpha = baseSample.a;
    rgbColor = baseSample.rgb / max(alpha, 0.0001);
  }

  // Apply Glass Tint and Highlights
  if (u_pass_glass_enabled > 0.5) {
    if (u_glass_tint.a > 0.0) {
      rgbColor = mix(rgbColor, u_glass_tint.rgb, u_glass_tint.a * 0.3 * u_pass_glass_opacity);
    }
    // Specular and Bevel Highlights
    rgbColor += vec3(specular + bevel) * u_pass_glass_opacity;
  }

  // PASS 5: Film Grain & Textural Noise
  if (u_pass_grain_enabled > 0.5 && u_grain_intensity > 0.001) {
    vec2 grainCoord = gl_FragCoord.xy / max(0.5, u_grain_size);
    if (u_grain_temporal > 0.5) {
      grainCoord += vec2(fract(sin(u_time * 43.123) * 1000.0), fract(cos(u_time * 71.456) * 1000.0)) * 50.0;
    }
    float grainVal = hash(grainCoord);
    vec3 grainColor = u_grain_monochrome > 0.5
      ? vec3(grainVal)
      : vec3(grainVal, hash(grainCoord + vec2(13.1, 47.3)), hash(grainCoord + vec2(91.7, 19.3)));

    int gBlend = int(u_pass_grain_blend);
    vec3 blendedGrain = blendColors(gBlend, rgbColor, grainColor);
    rgbColor = mix(rgbColor, blendedGrain, u_grain_intensity * u_pass_grain_opacity);
  }

  // PASS 6: Custom GLSL / Post-processing (Exposure, Contrast, Saturation, Vignette)
  if (u_pass_custom_enabled > 0.5) {
    // Contrast
    rgbColor = (rgbColor - 0.5) * (1.0 + u_post_contrast) + 0.5;
    // Brightness
    rgbColor += u_post_brightness * 0.5;
    // Saturation
    float gray = dot(rgbColor, vec3(0.299, 0.587, 0.114));
    rgbColor = mix(vec3(gray), rgbColor, 1.0 + u_post_saturation);
    // Vignette
    if (u_post_vignette > 0.0) {
      float d = length(uv - 0.5);
      float vig = smoothstep(0.75, 0.2, d * (1.0 + u_post_vignette));
      rgbColor *= vig;
    }
    // Color Tint
    if (length(u_post_tint) > 0.01) {
      rgbColor = mix(rgbColor, rgbColor * u_post_tint, 0.3 * u_pass_custom_opacity);
    }
  }

  fragColor = vec4(clamp(rgbColor, 0.0, 1.0) * alpha, alpha);
}
`

export function evaluateWaveform(waveform: ModulatorWaveform, phase: number): number {
  const normPhase = ((phase % 1) + 1) % 1
  switch (waveform) {
    case 'sine':
      return Math.sin(normPhase * Math.PI * 2)
    case 'triangle':
      return 2 * Math.abs(2 * (normPhase - Math.floor(normPhase + 0.5))) - 1
    case 'sawtooth':
      return 2 * (normPhase - Math.floor(normPhase)) - 1
    case 'pulse':
      return normPhase < 0.5 ? 1 : -1
    case 'noise': {
      const s = Math.sin(normPhase * 1234.567)
      return (s - Math.floor(s)) * 2 - 1
    }
  }
}

export function computeModulatedValue(
  baseValue: number,
  modulators: readonly UniformModulator[],
  passId: string,
  paramKey: string,
  timeSec: number,
  speedMultiplier = 1,
  depthMultiplier = 1,
  audio: Readonly<AudioFrame> = SILENT_AUDIO
): number {
  let val = baseValue
  for (const mod of modulators) {
    if (!mod.enabled || mod.targetPassId !== passId || mod.targetParam !== paramKey) continue
    const source = mod.source ?? 'lfo'
    const phase = timeSec * mod.frequency * speedMultiplier + mod.offset
    const wave = source === 'lfo' ? evaluateWaveform(mod.waveform, phase) : audio[source]
    val += wave * mod.amplitude * depthMultiplier
  }
  return val
}

const blendModeToEnum: Record<string, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  'soft-light': 4,
  'hard-light': 5,
  'color-dodge': 6,
  difference: 7,
  exclusion: 7,
  add: 8,
}

function parseHex(hex: string): [number, number, number, number] {
  if (!hex || hex[0] !== '#') return [0.5, 0.68, 0.93, 1]
  const clean = hex.slice(1)
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1
  return [r, g, b, a]
}

export type PipelineUniformValue = number | boolean | number[] | number[][]

export function multiPassUniforms(paint: ShaderPaint, elapsedMs = 0, audio: Readonly<AudioFrame> = SILENT_AUDIO): Record<string, PipelineUniformValue> {
  const pipeline: ShaderPipeline =
    paint.pipeline ?? createDefaultPipeline(paint.params && 'preset' in paint.params ? (paint.params.preset as string) : 'prismatic-glass')
  const timeSec = (paint.frame + elapsedMs) / 1000
  const modSpeed = paint.params && 'modulatorSpeed' in paint.params ? Number(paint.params.modulatorSpeed) : 0.4
  const modDepth = paint.params && 'modulatorDepth' in paint.params ? Number(paint.params.modulatorDepth) : 0.25

  const passMap = new Map<string, PipelinePass>()
  for (const pass of pipeline.passes) passMap.set(pass.type, pass)

  const meshPass = passMap.get('mesh-gradient')
  const liquidPass = passMap.get('liquid-distortion')
  const glassPass = passMap.get('glassmorphism')
  const chromaticPass = passMap.get('chromatic-aberration')
  const grainPass = passMap.get('grain')
  const customPass = passMap.get('custom-glsl')

  const chromaticParams = (chromaticPass?.params ?? {}) as Partial<ChromaticAberrationPassParams>
  const customParams = (customPass?.params ?? {}) as Partial<CustomGLSLPassParams>

  const mod = (passId: string, param: string, base: number) =>
    computeModulatedValue(base, pipeline.modulators, passId, param, timeSec, modSpeed, modDepth, audio)

  // Mesh Gradient Setup
  const meshParams = (meshPass?.params ?? {}) as Partial<MeshGradientPassParams>
  const colors = (meshParams.colors ?? ['#edebe1', '#81adec', '#516b94', '#222222']).slice(0, 10).map(parseHex)
  const defaultAnchors = [
    { x: 0.2, y: 0.25, radius: 0.65 },
    { x: 0.78, y: 0.32, radius: 0.75 },
    { x: 0.35, y: 0.8, radius: 0.7 },
    { x: 0.82, y: 0.78, radius: 0.6 },
  ]
  const anchors = (meshParams.anchors ?? defaultAnchors).slice(0, 10)

  // Liquid Setup
  const liquidParams = (liquidPass?.params ?? {}) as Partial<LiquidDistortionPassParams>

  // Glass Setup
  const glassParams = (glassPass?.params ?? {}) as Partial<GlassmorphismPassParams>
  const glassPatternIdx =
    glassParams.pattern === 'fluted' ? 1 : glassParams.pattern === 'prism' ? 2 : glassParams.pattern === 'wave' ? 3 : 0
  const glassTint = parseHex(glassParams.tint ?? '#edebe1')

  // Grain Setup
  const grainParams = (grainPass?.params ?? {}) as Partial<{ intensity: number; size: number; temporal: boolean; monochrome: boolean; blendMode: string }>
  const grainBlendIdx = blendModeToEnum[grainParams.blendMode ?? 'overlay'] ?? 3

  return {
    u_audio_bass: audio.bass,
    u_audio_mid: audio.mid,
    u_audio_treble: audio.treble,
    u_audio_volume: audio.volume,
    u_audio_peak: audio.peak,
    u_audio_transient: audio.transient,
    u_scale: paint.scale,
    u_rotation: (paint.rotation * Math.PI) / 180,
    u_offset: [paint.offsetX, paint.offsetY],

    // Pass toggles & opacity
    u_pass_mesh_enabled: meshPass?.enabled ?? true ? 1 : 0,
    u_pass_mesh_opacity: meshPass?.opacity ?? 1,
    u_pass_liquid_enabled: liquidPass?.enabled ?? true ? 1 : 0,
    u_pass_liquid_opacity: liquidPass?.opacity ?? 1,
    u_pass_glass_enabled: glassPass?.enabled ?? true ? 1 : 0,
    u_pass_glass_opacity: glassPass?.opacity ?? 1,
    u_pass_chromatic_enabled: chromaticPass?.enabled ?? true ? 1 : 0,
    u_pass_chromatic_opacity: chromaticPass?.opacity ?? 1,
    u_pass_grain_enabled: grainPass?.enabled ?? true ? 1 : 0,
    u_pass_grain_opacity: grainPass?.opacity ?? 1,
    u_pass_custom_enabled: customPass?.enabled ?? false ? 1 : 0,
    u_pass_custom_opacity: customPass?.opacity ?? 1,

    // Blend modes
    u_pass_liquid_blend: blendModeToEnum[liquidPass?.blendMode ?? 'normal'] ?? 0,
    u_pass_glass_blend: blendModeToEnum[glassPass?.blendMode ?? 'soft-light'] ?? 4,
    u_pass_grain_blend: grainBlendIdx,
    u_pass_custom_blend: blendModeToEnum[customPass?.blendMode ?? 'normal'] ?? 0,

    // Mesh uniforms
    u_mesh_count: colors.length,
    u_mesh_colors: Array.from({ length: 10 }, (_, i) => colors[i] ?? [0, 0, 0, 1]),
    u_mesh_anchors: Array.from({ length: 10 }, (_, i) => {
      const a = anchors[i] ?? defaultAnchors[i % defaultAnchors.length]
      return [a.x, a.y, a.radius]
    }),
    u_mesh_turbulence: Math.max(0, Math.min(1, mod(meshPass?.id ?? 'pass-mesh', 'turbulence', meshParams.turbulence ?? 0.45))),
    u_mesh_frequency: Math.max(0.5, Math.min(12, mod(meshPass?.id ?? 'pass-mesh', 'frequency', meshParams.frequency ?? 2.5))),
    u_mesh_swirl: Math.max(0, Math.min(2, mod(meshPass?.id ?? 'pass-mesh', 'swirl', meshParams.swirl ?? 0.35))),
    u_mesh_distortion: Math.max(0, Math.min(1, mod(meshPass?.id ?? 'pass-mesh', 'distortion', meshParams.distortion ?? 0.5))),

    // Liquid uniforms
    u_liquid_distortion: Math.max(0, Math.min(1, mod(liquidPass?.id ?? 'pass-liquid', 'distortion', liquidParams.distortion ?? 0.55))),
    u_liquid_frequency: Math.max(0.5, Math.min(10, mod(liquidPass?.id ?? 'pass-liquid', 'frequency', liquidParams.frequency ?? 2.2))),
    u_liquid_speed: Math.max(0, Math.min(3, mod(liquidPass?.id ?? 'pass-liquid', 'speed', liquidParams.speed ?? 0.6))),
    u_liquid_swirl: Math.max(0, Math.min(2, mod(liquidPass?.id ?? 'pass-liquid', 'swirl', liquidParams.swirl ?? 0.45))),
    u_liquid_iterations: liquidParams.swirlIterations ?? 4,
    u_liquid_viscosity: Math.max(0, Math.min(1, mod(liquidPass?.id ?? 'pass-liquid', 'viscosity', liquidParams.viscosity ?? 0.35))),

    // Glass uniforms
    u_glass_refraction: Math.max(0, Math.min(1, mod(glassPass?.id ?? 'pass-glass', 'refraction', glassParams.refraction ?? 0.65))),
    u_glass_frost: Math.max(0, Math.min(1, mod(glassPass?.id ?? 'pass-glass', 'frost', glassParams.frost ?? 0.28))),
    u_glass_pattern: glassPatternIdx,
    u_glass_angle: glassParams.angle ?? 45,
    u_glass_specular: Math.max(0, Math.min(1, mod(glassPass?.id ?? 'pass-glass', 'specular', glassParams.specular ?? 0.4))),
    u_glass_bevel: Math.max(0, Math.min(1, mod(glassPass?.id ?? 'pass-glass', 'bevel', glassParams.bevel ?? 0.3))),
    u_glass_tint: glassTint,

    // Chromatic uniforms
    u_chromatic_intensity: Math.max(0, Math.min(1, mod(chromaticPass?.id ?? 'pass-chromatic', 'intensity', chromaticParams.intensity ?? 0.48))),
    u_chromatic_spread: Math.max(0, Math.min(1, mod(chromaticPass?.id ?? 'pass-chromatic', 'spread', chromaticParams.spread ?? 0.4))),
    u_chromatic_radial: chromaticParams.radial ?? true ? 1 : 0,
    u_chromatic_angle: mod(chromaticPass?.id ?? 'pass-chromatic', 'angle', chromaticParams.angle ?? 0),

    // Grain uniforms
    u_grain_intensity: Math.max(0, Math.min(1, mod(grainPass?.id ?? 'pass-grain', 'intensity', grainParams.intensity ?? 0.12))),
    u_grain_size: Math.max(0.5, Math.min(5, mod(grainPass?.id ?? 'pass-grain', 'size', grainParams.size ?? 1.2))),
    u_grain_temporal: grainParams.temporal ?? true ? 1 : 0,
    u_grain_monochrome: grainParams.monochrome ?? true ? 1 : 0,

    // Post-process uniforms
    u_post_contrast: Math.max(-1, Math.min(1, mod(customPass?.id ?? 'pass-custom', 'contrast', customParams.contrast ?? 0))),
    u_post_brightness: Math.max(-1, Math.min(1, mod(customPass?.id ?? 'pass-custom', 'brightness', customParams.brightness ?? 0))),
    u_post_saturation: Math.max(-1, Math.min(1, mod(customPass?.id ?? 'pass-custom', 'saturation', customParams.saturation ?? 0))),
    u_post_vignette: Math.max(0, Math.min(1, mod(customPass?.id ?? 'pass-custom', 'vignette', customParams.vignette ?? 0))),
    u_post_tint: parseHex(customParams.tint ?? '#000000').slice(0, 3),
  }
}

export const pipelineModulationUniforms: Readonly<Record<string, Readonly<Record<string, readonly [string, number, number]>>>> = {
  'mesh-gradient': { turbulence: ['u_mesh_turbulence', 0, 1], frequency: ['u_mesh_frequency', 0.5, 12], swirl: ['u_mesh_swirl', 0, 2], distortion: ['u_mesh_distortion', 0, 1] },
  'liquid-distortion': { distortion: ['u_liquid_distortion', 0, 1], frequency: ['u_liquid_frequency', 0.5, 10], speed: ['u_liquid_speed', 0, 3], swirl: ['u_liquid_swirl', 0, 2], viscosity: ['u_liquid_viscosity', 0, 1] },
  glassmorphism: { refraction: ['u_glass_refraction', 0, 1], frost: ['u_glass_frost', 0, 1], specular: ['u_glass_specular', 0, 1], bevel: ['u_glass_bevel', 0, 1] },
  'chromatic-aberration': { intensity: ['u_chromatic_intensity', 0, 1], spread: ['u_chromatic_spread', 0, 1], angle: ['u_chromatic_angle', -360, 360] },
  grain: { intensity: ['u_grain_intensity', 0, 1], size: ['u_grain_size', 0.5, 5] },
  'custom-glsl': { contrast: ['u_post_contrast', -1, 1], brightness: ['u_post_brightness', -1, 1], saturation: ['u_post_saturation', -1, 1], vignette: ['u_post_vignette', 0, 1] },
}

/** Compile routing once. Only changed scalar uniforms are uploaded during playback. */
export function createMultiPassUniformUpdater(paint: Extract<ShaderPaint, { kind: 'multi-pass' }>) {
  const pipeline = paint.pipeline ?? createDefaultPipeline(paint.params.preset)
  const base = multiPassUniforms({ ...paint, pipeline: { ...pipeline, modulators: [] } })
  const bindings: { uniform: string; base: number; passId: string; param: string; min: number; max: number }[] = []
  const passes = new Map(pipeline.passes.map(pass => [pass.type, pass]))
  for (const pass of passes.values()) {
    for (const [param, [uniform, min, max]] of Object.entries(pipelineModulationUniforms[pass.type] ?? {})) {
      if (pipeline.modulators.some(mod => mod.enabled && mod.targetPassId === pass.id && mod.targetParam === param)) {
        bindings.push({ uniform, base: Number(base[uniform]), passId: pass.id, param, min, max })
      }
    }
  }
  const uniforms: Record<string, number> = {}
  return (elapsedMs: number, audio: Readonly<AudioFrame> = SILENT_AUDIO): Record<string, number> => {
    uniforms.u_audio_bass = audio.bass
    uniforms.u_audio_mid = audio.mid
    uniforms.u_audio_treble = audio.treble
    uniforms.u_audio_volume = audio.volume
    uniforms.u_audio_peak = audio.peak
    uniforms.u_audio_transient = audio.transient
    const time = (paint.frame + elapsedMs) / 1000
    for (const binding of bindings) {
      const value = computeModulatedValue(binding.base, pipeline.modulators, binding.passId, binding.param, time, paint.params.modulatorSpeed, paint.params.modulatorDepth, audio)
      uniforms[binding.uniform] = Math.max(binding.min, Math.min(binding.max, value))
    }
    return uniforms
  }
}
