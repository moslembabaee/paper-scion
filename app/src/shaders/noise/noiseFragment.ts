import type { ProceduralNoiseParams, ShaderPaint } from '../types.ts'
import { parseHexColor } from '../mesh.ts'

export const proceduralNoiseFragmentShader = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform float u_rotation;
uniform vec2 u_offset;

// Procedural generator parameters
uniform float u_noiseType; // 0.0 = simplex, 1.0 = perlin, 2.0 = worley
uniform float u_frequency;
uniform float u_octaves;
uniform float u_lacunarity;
uniform float u_persistence;
uniform float u_turbulence;
uniform float u_displacement;
uniform float u_normalPerturbation;
uniform float u_grainMixer;
uniform float u_grainOverlay;

// Surface color & lighting parameters
uniform vec3 u_colorFront;
uniform vec3 u_colorMid;
uniform vec3 u_colorBack;
uniform float u_lightAngle;
uniform float u_specularStrength;
uniform float u_viewMode; // 0.0 = shaded, 1.0 = normal-map, 2.0 = heightmap

out vec4 fragColor;

// ==================== GLSL MATH & NOISE HELPERS ====================

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }

// High-frequency hash for grain dithering
float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}

// 2D Simplex Noise
float simplexNoise2D(vec2 v) {
  const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                     -0.577350269189626,  // -1.0 + 2.0 * C.x
                      0.024390243902439); // 1.0 / 41.0
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// 2D Classic Perlin Gradient Noise
float perlinNoise2D(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = 2.0 * fract(i * 0.0243902439) - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = 1.79284291400159 - 0.85373472095314 * vec4(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11));
  g00 *= norm.x;
  g01 *= norm.y;
  g10 *= norm.z;
  g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = Pf.xy * Pf.xy * Pf.xy * (Pf.xy * (Pf.xy * 6.0 - 15.0) + 10.0);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.2 * mix(n_x.x, n_x.y, fade_xy.y);
}

// 2D Worley (Cellular / Voronoi) Noise
float worleyNoise2D(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 delta = g + o - f;
      float d = dot(delta, delta);
      f1 = min(f1, d);
    }
  }
  return clamp(sqrt(f1), 0.0, 1.0);
}

// Multi-octave noise generator
float sampleGenerator(vec2 p, float t) {
  float total = 0.0;
  float maxAmp = 0.0;
  float amp = 1.0;
  float freq = u_frequency;
  int octaves = int(clamp(u_octaves, 1.0, 8.0));

  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    vec2 coord = p * freq + vec2(t * 0.06, t * 0.04);
    float n = 0.0;
    if (u_noiseType < 0.5) {
      n = simplexNoise2D(coord);
    } else if (u_noiseType < 1.5) {
      n = perlinNoise2D(coord);
    } else {
      // Worley cellular noise mapped to [-1, 1]
      n = worleyNoise2D(coord) * 2.0 - 1.0;
    }

    if (u_turbulence > 0.0) {
      float turb = abs(n) * 2.0 - 1.0;
      n = mix(n, turb, u_turbulence);
    }

    total += n * amp;
    maxAmp += amp;
    amp *= u_persistence;
    freq *= u_lacunarity;
  }

  return maxAmp > 0.0 ? total / maxAmp : 0.0;
}

// Evaluates height displacement with micro-grain perturbation
float sampleDisplacementHeight(vec2 p, float t) {
  float base = sampleGenerator(p, t);
  float grain = (hash12(gl_FragCoord.xy) - 0.5) * u_grainOverlay;
  return base * u_displacement + grain;
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y);
  vec2 p = uv - 0.5 - u_offset;
  float c = cos(u_rotation), s = sin(u_rotation);
  p = mat2(c, -s, s, c) * p / max(0.01, u_scale);

  float t = u_time * 0.15;
  float height = sampleDisplacementHeight(p, t);

  // Normal-map surface perturbation via finite difference gradient
  float eps = 0.003;
  float hL = sampleDisplacementHeight(p - vec2(eps, 0.0), t);
  float hR = sampleDisplacementHeight(p + vec2(eps, 0.0), t);
  float hD = sampleDisplacementHeight(p - vec2(0.0, eps), t);
  float hU = sampleDisplacementHeight(p + vec2(0.0, eps), t);

  float dhdx = (hR - hL) / (2.0 * eps);
  float dhdy = (hU - hD) / (2.0 * eps);

  vec3 normal = normalize(vec3(-dhdx * u_normalPerturbation * 5.0,
                               -dhdy * u_normalPerturbation * 5.0,
                               1.0));

  // Mode 1: Raw Tangent Space Normal Map [0, 1]
  if (u_viewMode > 0.5 && u_viewMode < 1.5) {
    fragColor = vec4(normal * 0.5 + 0.5, 1.0);
    return;
  }

  // Mode 2: Scalar Height Displacement Map
  if (u_viewMode > 1.5) {
    float hNorm = clamp(height * 0.5 + 0.5, 0.0, 1.0);
    fragColor = vec4(vec3(hNorm), 1.0);
    return;
  }

  // Mode 0: Shaded Surface Material with Directional Lighting & Specular Relief
  float rad = u_lightAngle * 0.0174532925;
  vec3 lightDir = normalize(vec3(cos(rad), sin(rad), 0.7));
  vec3 halfDir = normalize(lightDir + vec3(0.0, 0.0, 1.0));

  float diff = max(dot(normal, lightDir), 0.0) * 0.8 + 0.2;
  float spec = pow(max(dot(normal, halfDir), 0.0), 24.0) * u_specularStrength;

  // Color gradient ramp from Back -> Mid -> Front according to normalized height
  float tNorm = clamp(height * 0.5 + 0.5, 0.0, 1.0);
  vec3 rampColor;
  if (tNorm < 0.5) {
    rampColor = mix(u_colorBack, u_colorMid, tNorm * 2.0);
  } else {
    rampColor = mix(u_colorMid, u_colorFront, (tNorm - 0.5) * 2.0);
  }

  // Apply diffuse lighting and specular highlight
  vec3 litColor = rampColor * diff + vec3(spec);

  // Micro-grain dither blend
  float grainDither = (hash12(gl_FragCoord.xy) - 0.5) * u_grainMixer;
  litColor = clamp(litColor + vec3(grainDither), 0.0, 1.0);

  fragColor = vec4(litColor, 1.0);
}
`

export function proceduralNoiseUniforms(paint: Extract<ShaderPaint, { kind: 'procedural-noise' }>) {
  const params: ProceduralNoiseParams = paint.params
  const noiseTypeValue = params.noiseType === 'simplex' ? 0.0 : params.noiseType === 'perlin' ? 1.0 : 2.0
  const viewModeValue = params.viewMode === 'normal-map' ? 1.0 : params.viewMode === 'heightmap' ? 2.0 : 0.0

  const cFront = parseHexColor(params.colorFront)
  const cMid = parseHexColor(params.colorMid)
  const cBack = parseHexColor(params.colorBack)

  return {
    u_scale: paint.scale,
    u_rotation: (paint.rotation * Math.PI) / 180,
    u_offset: [paint.offsetX, paint.offsetY],
    u_noiseType: noiseTypeValue,
    u_frequency: params.frequency,
    u_octaves: params.octaves,
    u_lacunarity: params.lacunarity,
    u_persistence: params.persistence,
    u_turbulence: params.turbulence,
    u_displacement: params.displacement,
    u_normalPerturbation: params.normalPerturbation,
    u_grainMixer: params.grainMixer,
    u_grainOverlay: params.grainOverlay,
    u_colorFront: [cFront.r, cFront.g, cFront.b],
    u_colorMid: [cMid.r, cMid.g, cMid.b],
    u_colorBack: [cBack.r, cBack.g, cBack.b],
    u_lightAngle: params.lightAngle,
    u_specularStrength: params.specularStrength,
    u_viewMode: viewModeValue,
  }
}
