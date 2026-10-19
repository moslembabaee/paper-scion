import type { GenerativeMaterialParams, GenerativeUniforms } from './types.ts'
import type { ShaderPaint } from '../types.ts'
import { parseHexColor } from '../mesh.ts'

export const generativeFragmentShader = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform float u_rotation;
uniform vec2 u_offset;

// Generative Material Parameters
uniform float u_grainIntensity;
uniform float u_fluidDistortion;
uniform float u_chromaticAberration;
uniform float u_turbulenceSpeed;
uniform float u_frequency;
uniform float u_contrast;
uniform int u_octaves;

// Color Stops
uniform int u_colorCount;
uniform vec4 u_colors[8];

// Interactive Cursor Inputs
uniform vec2 u_mouse;
uniform float u_mouseActive;

out vec4 fragColor;

const float PI = 3.14159265358979323846;

// High-entropy 2D hash
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Continuous 2D gradient noise
float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i + vec2(0.0, 0.0));
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Multi-octave fractal Brownian motion
float fbm(vec2 p, int octs) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octs) break;
    value += amplitude * noise2D(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// Incompressible fluid curl & domain warp field
float sampleGenerativeField(vec2 p, float t, int octs, float distortion, float mouseInf) {
  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + t * 0.18, octs),
    fbm(p + vec2(5.2, 1.3) - t * 0.14, octs)
  );

  vec2 r = vec2(
    fbm(p + 3.2 * q + vec2(1.7, 9.2) + t * 0.22, octs),
    fbm(p + 3.2 * q + vec2(8.3, 2.8) - t * 0.19, octs)
  );

  vec2 warped = p + distortion * 2.4 * r + mouseInf * q;
  float f = fbm(warped + q * 1.6, octs);

  return clamp(f * 1.25 - 0.12, 0.0, 1.0);
}

// Multi-stop color palette interpolation with smooth Hermite blending
vec4 samplePalette(float tVal) {
  tVal = clamp(tVal, 0.0, 1.0);
  if (u_colorCount <= 1) return u_colors[0];
  float scaled = tVal * float(u_colorCount - 1);
  int idx = int(floor(scaled));
  float frac = fract(scaled);
  frac = smoothstep(0.0, 1.0, frac);

  for (int i = 0; i < 7; i++) {
    if (i >= u_colorCount - 1) break;
    if (i == idx) {
      return mix(u_colors[i], u_colors[i + 1], frac);
    }
  }
  return u_colors[u_colorCount - 1];
}

void main() {
  vec2 uv = gl_FragCoord.xy / max(u_resolution.xy, vec2(1.0));
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  // Apply rotation
  float rad = u_rotation * PI / 180.0;
  float c = cos(rad);
  float s = sin(rad);
  p = mat2(c, -s, s, c) * p;

  // Scale and offset
  p = (p / max(u_scale, 0.001)) + u_offset;
  p *= u_frequency;

  // Real-time turbulence time step
  float t = u_time * 0.001 * u_turbulenceSpeed;

  // Interactive mouse displacement
  float mouseInf = 0.0;
  if (u_mouseActive > 0.5) {
    vec2 mPos = (u_mouse - 0.5) * vec2(aspect, 1.0);
    mPos = mat2(c, -s, s, c) * mPos;
    mPos = (mPos / max(u_scale, 0.001)) + u_offset;
    mPos *= u_frequency;
    float mDist = length(p - mPos);
    mouseInf = exp(-mDist * 2.5) * 0.4;
  }

  // Chromatic dispersion vector along radial/tangential gradient
  vec2 dispDir = normalize(p + vec2(0.0001));
  float disp = u_chromaticAberration * 0.05;

  // Sample separated spectral channels (Cauchy wavelength splitting)
  float fieldR = sampleGenerativeField(p + dispDir * disp, t, u_octaves, u_fluidDistortion, mouseInf);
  float fieldG = sampleGenerativeField(p, t, u_octaves, u_fluidDistortion, mouseInf);
  float fieldB = sampleGenerativeField(p - dispDir * disp, t, u_octaves, u_fluidDistortion, mouseInf);

  vec4 colR = samplePalette(fieldR);
  vec4 colG = samplePalette(fieldG);
  vec4 colB = samplePalette(fieldB);

  vec4 color = vec4(colR.r, colG.g, colB.b, (colR.a + colG.a + colB.a) / 3.0);

  // Dynamic tonal contrast
  color.rgb = clamp(((color.rgb - 0.5) * u_contrast) + 0.5, 0.0, 1.0);

  // Procedural analog film grain
  if (u_grainIntensity > 0.001) {
    vec2 grainCoord = gl_FragCoord.xy + vec2(fract(sin(u_time * 0.001) * 43758.5453), fract(cos(u_time * 0.001) * 22578.1459));
    float grain = (hash12(grainCoord) - 0.5) * 2.0;
    float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float grainMask = 1.0 - 1.5 * abs(lum - 0.5);
    color.rgb = clamp(color.rgb + grain * u_grainIntensity * 0.35 * max(0.2, grainMask), 0.0, 1.0);
  }

  fragColor = color;
}
`

export function generativeUniforms(
  paint: Extract<ShaderPaint, { kind: 'generative-material' }>,
  mouse?: { x: number; y: number; active: boolean }
): GenerativeUniforms {
  const params = paint.params as GenerativeMaterialParams
  const rawColors: [number, number, number, number][] = (params.colorStops ?? []).slice(0, 8).map(hex => {
    const c = parseHexColor(hex)
    return [c.r, c.g, c.b, c.a]
  })

  const count = Math.max(1, Math.min(8, rawColors.length))
  while (rawColors.length < 8) {
    rawColors.push(rawColors[rawColors.length - 1] ?? [0, 0, 0, 1])
  }

  return {
    u_grainIntensity: params.grainIntensity ?? 0.12,
    u_fluidDistortion: params.fluidDistortion ?? 0.48,
    u_chromaticAberration: params.chromaticAberration ?? 0.28,
    u_turbulenceSpeed: params.turbulenceSpeed ?? 0.65,
    u_frequency: params.frequency ?? 2.2,
    u_contrast: params.contrast ?? 1.15,
    u_octaves: Math.max(1, Math.min(6, Math.round(params.octaves ?? 4))),
    u_colorCount: count,
    u_colors: rawColors,
    u_mouse: mouse ? [mouse.x, mouse.y] : [0.5, 0.5],
    u_mouseActive: mouse?.active ? 1.0 : 0.0,
  }
}
