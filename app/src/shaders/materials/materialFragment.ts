import type { MaterialPresetParams } from './types.ts'
import type { ShaderPaint } from '../types.ts'
import { parseHexColor } from '../mesh.ts'

export const materialFragmentShader = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform float u_rotation;
uniform vec2 u_offset;

// Material Uniforms
uniform float u_refractionIndex;
uniform float u_dispersionSpread;
uniform float u_frequency;
uniform float u_mouseReactivity;
uniform vec2 u_mouse;
uniform float u_mouseActive;

uniform float u_roughness;
uniform float u_filmThickness;
uniform float u_iridescence;
uniform float u_fluidViscosity;
uniform float u_grainScale;
uniform float u_grainIntensity;
uniform float u_lightAngle;
uniform float u_specularStrength;
uniform float u_blendRatio;

uniform float u_presetMode;
uniform float u_colorCount;
uniform vec4 u_colors[8];
uniform vec3 u_tintColor;
uniform vec3 u_highlightColor;

out vec4 fragColor;

// ==================== MATHEMATICAL UTILITIES & PROCEDURAL NOISE ====================

const float PI = 3.14159265358979323846;
const float TWO_PI = 6.28318530717958647692;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p, int octaves, float persistence, float lacunarity) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    value += amplitude * noise2D(p * frequency);
    frequency *= lacunarity;
    amplitude *= persistence;
  }
  return value;
}

vec2 curlNoise(vec2 p) {
  float eps = 0.01;
  float n1 = noise2D(p + vec2(0.0, eps));
  float n2 = noise2D(p - vec2(0.0, eps));
  float n3 = noise2D(p + vec2(eps, 0.0));
  float n4 = noise2D(p - vec2(eps, 0.0));
  return vec2((n1 - n2) / (2.0 * eps), -(n3 - n4) / (2.0 * eps));
}

// Multi-color palette sampler
vec3 samplePalette(float t) {
  int count = int(clamp(u_colorCount, 2.0, 8.0));
  float clampedT = clamp(t, 0.0, 0.9999) * float(count - 1);
  int idx = int(floor(clampedT));
  float f = fract(clampedT);

  vec3 cA = u_colors[0].rgb;
  vec3 cB = u_colors[1].rgb;

  for (int i = 0; i < 7; i++) {
    if (i == idx) {
      cA = u_colors[i].rgb;
      cB = u_colors[i + 1].rgb;
      break;
    }
  }
  return mix(cA, cB, smoothstep(0.0, 1.0, f));
}

// Thin-film interference simulation (Airy formula approximation)
vec3 calculateThinFilmInterference(float cosTheta, float thicknessNm, float ior) {
  // Optical path difference
  float sin2Theta = max(0.0, 1.0 - cosTheta * cosTheta);
  float cosThetaT = sqrt(max(0.0, 1.0 - sin2Theta / (ior * ior)));
  float opd = 2.0 * ior * thicknessNm * cosThetaT;

  // Wavelengths in nm: Red (650), Green (532), Blue (450)
  vec3 wavelengths = vec3(650.0, 532.0, 450.0);
  vec3 phi = TWO_PI * opd / wavelengths;

  // Phase shift at reflection boundaries
  vec3 interference = 0.5 + 0.5 * cos(phi);
  return clamp(interference, 0.0, 1.0);
}

// Studio environment map reflection
vec3 sampleStudioReflection(vec3 R) {
  float horizon = smoothstep(-0.2, 0.4, R.y);
  vec3 sky = mix(vec3(0.04, 0.05, 0.08), vec3(0.92, 0.94, 0.98), horizon);
  float keyLight = pow(max(0.0, dot(R, normalize(vec3(0.5, 0.8, 0.3)))), 32.0);
  sky += vec3(keyLight * 1.5);
  return sky;
}

// Procedural Backdrop scene (high-craft Paper design system aesthetic)
vec3 sampleBackdropScene(vec2 uv) {
  vec3 cream = vec3(0.929, 0.922, 0.882);
  vec3 blue = vec3(0.506, 0.678, 0.925);
  vec3 slate = vec3(0.318, 0.420, 0.580);
  vec3 charcoal = vec3(0.133, 0.133, 0.133);
  vec3 black = vec3(0.031, 0.031, 0.031);

  vec2 gridUV = fract(uv * 6.0);
  float gridLines = smoothstep(0.04, 0.0, gridUV.x) + smoothstep(0.04, 0.0, gridUV.y);

  float cardDist = length(uv - vec2(0.35, 0.45));
  float cardGlow = smoothstep(0.5, 0.0, cardDist);

  float diag = uv.x * 0.6 + uv.y * 0.4;
  vec3 bg = mix(cream, charcoal, smoothstep(0.1, 0.9, diag));
  bg = mix(bg, blue, cardGlow * 0.65);
  bg = mix(bg, slate, smoothstep(0.7, 0.1, length(uv - vec2(0.75, 0.8))) * 0.5);

  float stripe = step(0.48, fract(uv.x * 3.0 + uv.y * 2.0));
  bg = mix(bg, black, stripe * 0.15);
  bg = mix(bg, blue, gridLines * 0.12);

  return bg;
}

// Surface elevation calculation depending on preset mode and mouse
float sampleSurfaceElevation(vec2 p, float time, vec2 mouseDeflect) {
  vec2 pos = p + mouseDeflect;
  int mode = int(u_presetMode + 0.5);
  float freq = u_frequency;

  if (mode == 0) {
    // Iridescent Film: Soft fluid swelling with laminar waves
    vec2 curl = curlNoise(pos * freq * 0.7 + time * 0.15);
    float wave1 = sin(pos.x * freq * 1.8 + curl.y * 3.0 + time * 0.6);
    float wave2 = cos(pos.y * freq * 1.8 + curl.x * 3.0 - time * 0.4);
    return (wave1 + wave2) * 0.5 * 0.35;
  } else if (mode == 1) {
    // Chromatic Dispersion: Cauchy faceted prism ridges
    float r = length(pos);
    float angle = atan(pos.y, pos.x);
    float facets = sin(angle * 6.0 + r * freq * 4.0 - time * 0.5);
    float ripple = cos(r * freq * 3.5 - time * 0.8);
    return (facets * 0.6 + ripple * 0.4) * 0.45;
  } else if (mode == 2) {
    // Frosted Liquid Acrylic: Viscous organic polymer fluid
    vec2 flow = curlNoise(pos * freq * 0.5 + time * 0.1) * (1.0 - clamp(u_fluidViscosity, 0.0, 0.9) * 0.6);
    float fluid = fbm(pos * freq + flow * 2.5, 4, 0.55, 2.0);
    return (fluid - 0.5) * 0.55;
  } else if (mode == 3) {
    // Reactive Grain: High-frequency stipple vibration
    float grainFbm = fbm(pos * freq * 2.0, 3, 0.6, 2.1);
    float ripple = sin(length(pos) * freq * 5.0 - time * 2.0) * 0.2;
    return (grainFbm + ripple) * 0.3;
  } else if (mode == 4) {
    // Liquid Caustics: Submerged refractive caustic network
    vec2 c1 = pos * freq * 2.0 + vec2(time * 0.3, time * 0.2);
    vec2 c2 = pos * freq * 2.0 + vec2(-time * 0.25, time * 0.35);
    float w1 = abs(sin(c1.x + sin(c1.y * 1.5))) * abs(cos(c1.y + cos(c1.x * 1.5)));
    float w2 = abs(sin(c2.x + sin(c2.y * 1.5))) * abs(cos(c2.y + cos(c2.x * 1.5)));
    return pow(w1 * 0.5 + w2 * 0.5, 1.8) * 0.6;
  } else if (mode == 5) {
    // Holographic Foil: Micro-grooved diffraction grating
    float grating = sin(pos.x * freq * 25.0 + sin(pos.y * freq * 6.0) * 2.0 + time * 0.5);
    float macro = sin(pos.y * freq * 2.5 + time * 0.3);
    return (grating * 0.4 + macro * 0.6) * 0.35;
  } else if (mode == 6) {
    // Velvet Aurora: Flowing vertical atmospheric ribbons
    float ribbon = sin(pos.x * freq * 2.0 + sin(pos.y * freq * 3.0 + time * 0.7) * 2.5);
    float flutter = fbm(pos * freq * 1.2 + vec2(0.0, time * 0.4), 3, 0.5, 2.0);
    return (ribbon * 0.6 + flutter * 0.4) * 0.5;
  } else if (mode == 7) {
    // Frosted Obsidian: Smoked geometric facets
    float grid = abs(fract(pos.x * freq * 1.5) - 0.5) + abs(fract(pos.y * freq * 1.5) - 0.5);
    float smoothN = fbm(pos * freq * 0.8, 3, 0.5, 2.0);
    return mix(grid, smoothN, 0.4) * 0.45;
  } else if (mode == 8) {
    // Prismatic Flare: Radial optical streaks
    float r = length(pos);
    float a = atan(pos.y, pos.x);
    float streak = sin(a * 12.0 + time * 0.5) * sin(a * 24.0);
    float ring = sin(r * freq * 6.0 - time * 1.2);
    return (streak * 0.5 + ring * 0.5) * exp(-r * 0.8) * 0.5;
  } else {
    // Analog Risograph: Stipple grain threshold
    return (fbm(pos * freq * 2.5, 4, 0.55, 2.2) - 0.5) * 0.4;
  }
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y);
  float aspect = u_resolution.x / u_resolution.y;

  // Layer transformation (scale, rotation, offset)
  vec2 p = uv - 0.5 - u_offset;
  float c = cos(u_rotation), s = sin(u_rotation);
  p = mat2(c, -s, s, c) * p / max(0.01, u_scale);

  // Time modulated by fluid viscosity
  float viscFactor = 1.0 - clamp(u_fluidViscosity, 0.0, 0.9) * 0.6;
  float time = u_time * 0.1 * viscFactor;

  // ==================== INTERACTIVE MOUSE REACTIVITY ====================
  vec2 mouseTarget = u_mouseActive > 0.5
    ? u_mouse
    : vec2(0.5 + sin(time * 3.5) * 0.22, 0.5 + cos(time * 2.8) * 0.22);

  vec2 mDiff = uv - mouseTarget;
  mDiff.x *= aspect;
  float mDist = length(mDiff);

  // Responsive Gaussian ripple & deflection envelope
  float mInfluence = exp(-mDist * mDist * 14.0);
  float mWave = sin(mDist * u_frequency * 8.0 - time * 25.0) * mInfluence;
  vec2 mAngleVec = mDist > 0.0001 ? (mDiff / mDist) : vec2(0.0);
  vec2 mouseDeflect = mAngleVec * mWave * (u_mouseReactivity * 0.35);

  // ==================== SURFACE NORMAL & GRADIENT ====================
  float eps = 0.005;
  float hL = sampleSurfaceElevation(p - vec2(eps, 0.0), time, mouseDeflect);
  float hR = sampleSurfaceElevation(p + vec2(eps, 0.0), time, mouseDeflect);
  float hD = sampleSurfaceElevation(p - vec2(0.0, eps), time, mouseDeflect);
  float hU = sampleSurfaceElevation(p + vec2(0.0, eps), time, mouseDeflect);
  float centerH = sampleSurfaceElevation(p, time, mouseDeflect);

  float dhdx = (hR - hL) / (2.0 * eps);
  float dhdy = (hU - hD) / (2.0 * eps);

  // Normal vector with roughness microfacet jitter
  vec2 microJitter = (hash22(gl_FragCoord.xy) - 0.5) * u_roughness * 0.35;
  float bumpStrength = 2.4 * (1.0 + (1.0 - u_roughness) * 0.8);
  vec3 N = normalize(vec3((-dhdx + microJitter.x) * bumpStrength, (-dhdy + microJitter.y) * bumpStrength, 1.0));

  // Incident viewing direction (orthographic camera looking into screen)
  vec3 V = vec3(0.0, 0.0, 1.0);
  float cosTheta = max(0.0, dot(N, V));

  // ==================== PHYSICAL CAUCHY CHROMATIC DISPERSION ====================
  float ior = max(1.0, u_refractionIndex);
  float dispOffset = u_dispersionSpread * 0.14;
  float iorR = max(1.0, ior - dispOffset);
  float iorG = ior;
  float iorB = ior + dispOffset;

  vec3 refrR = refract(-V, N, 1.0 / iorR);
  vec3 refrG = refract(-V, N, 1.0 / iorG);
  vec3 refrB = refract(-V, N, 1.0 / iorB);

  // Sample multi-spectral coordinate field
  float coordBase = centerH * 0.8 + 0.5 + dot(p, vec2(0.2, 0.4));
  float coordR = coordBase + refrR.x * dispOffset * 2.0;
  float coordG = coordBase + refrG.x * dispOffset * 2.0;
  float coordB = coordBase + refrB.x * dispOffset * 2.0;

  vec3 dispColor = vec3(
    samplePalette(coordR).r,
    samplePalette(coordG).g,
    samplePalette(coordB).b
  );

  // ==================== REAL-TIME BACKDROP BLUR & CAUCHY DISPERSION ====================
  float backdropBlurRadius = u_roughness * 0.05 + 0.005;
  vec3 accumulatedBackdrop = vec3(0.0);
  float totalBackdropWeight = 0.0;
  const int BLUR_TAPS = 12;
  for (int i = 0; i < BLUR_TAPS; i++) {
    float fi = float(i);
    float angle = fi * 2.39996323; // Golden angle
    float r = sqrt((fi + 1.0) / float(BLUR_TAPS)) * backdropBlurRadius;
    vec2 tap = vec2(cos(angle), sin(angle)) * r;
    float w = exp(-2.2 * (r / max(0.001, backdropBlurRadius)) * (r / max(0.001, backdropBlurRadius)));

    vec2 offsetR = refrR.xy * dispOffset * 2.0;
    vec2 offsetG = refrG.xy * dispOffset * 2.0;
    vec2 offsetB = refrB.xy * dispOffset * 2.0;

    float sR = sampleBackdropScene(uv + offsetR + tap).r;
    float sG = sampleBackdropScene(uv + offsetG + tap).g;
    float sB = sampleBackdropScene(uv + offsetB + tap).b;

    accumulatedBackdrop += vec3(sR, sG, sB) * w;
    totalBackdropWeight += w;
  }
  vec3 backdropColor = accumulatedBackdrop / max(0.0001, totalBackdropWeight);

  // ==================== THIN-FILM IRIDESCENT OPTICS ====================
  vec3 iridColor = calculateThinFilmInterference(cosTheta, u_filmThickness, ior);

  // Angle-dependent Fresnel term
  float f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 4.0);

  // Studio specular reflection
  vec3 R = reflect(-V, N);
  vec3 envRefl = sampleStudioReflection(R);

  // Directional lighting
  float rad = radians(u_lightAngle);
  vec3 L = normalize(vec3(cos(rad), sin(rad), 0.7));
  vec3 H = normalize(L + V);
  float specPower = mix(128.0, 8.0, u_roughness);
  float NdotH = max(0.0, dot(N, H));
  float specGlint = pow(NdotH, specPower) * u_specularStrength * 1.5;

  // ==================== LAYER COMPOSITING & TINT ABSORPTION ====================
  vec3 mixedMaterial = mix(dispColor, backdropColor, 0.45 * (1.0 - u_blendRatio * 0.4));
  vec3 baseColor = mix(mixedMaterial, u_tintColor, 0.35);
  vec3 surfaceColor = mix(baseColor, iridColor * envRefl * 1.25, u_iridescence);

  // Blend with Fresnel reflection
  surfaceColor = mix(surfaceColor, envRefl, fresnel * 0.6);

  // Add specular highlight glint
  surfaceColor += u_highlightColor * specGlint;

  // Add cursor-guided proximity illumination
  float mouseGlint = exp(-mDist * mDist * 18.0) * u_mouseReactivity * 0.4;
  surfaceColor += u_highlightColor * mouseGlint;

  // ==================== TACTILE REACTIVE GRAIN & DITHER ====================
  // High-frequency analog film grain stippling
  vec2 grainCoord = gl_FragCoord.xy * (u_grainScale * 0.45);
  float grainNoise = hash12(grainCoord + vec2(sin(time * 10.0), cos(time * 10.0)));

  // Magnetic grain response to cursor
  if (u_mouseReactivity > 0.05) {
    float grainDeflect = sin(dot(grainCoord, mAngleVec * 4.0)) * mInfluence * u_mouseReactivity;
    grainNoise = mix(grainNoise, fract(grainNoise + grainDeflect), 0.5);
  }

  float grainMod = (grainNoise - 0.5) * (u_grainIntensity * 0.35);
  vec3 finalColor = clamp(surfaceColor + vec3(grainMod), 0.0, 1.0);

  // Layer alpha and blending ratio
  fragColor = vec4(finalColor, u_blendRatio);
}
`

export function materialUniforms(paint: Extract<ShaderPaint, { kind: 'shader-material' }>) {
  const p: MaterialPresetParams = paint.params
  const cTint = parseHexColor(p.tintColor)
  const cHigh = parseHexColor(p.highlightColor)

  const modeMap: Record<string, number> = {
    'iridescent-film': 0,
    'chromatic-dispersion': 1,
    'frosted-liquid-acrylic': 2,
    'reactive-grain': 3,
    'liquid-caustics': 4,
    'holographic-foil': 5,
    'velvet-aurora': 6,
    'frosted-obsidian': 7,
    'prismatic-flare': 8,
    'analog-risograph': 9,
  }

  const presetMode = modeMap[p.presetId] ?? 0
  const colorCount = Math.min(8, Math.max(2, p.colors.length))
  const colorsArray = Array.from({ length: 8 }, (_, i) => {
    if (i < p.colors.length) {
      const c = parseHexColor(p.colors[i])
      return [c.r, c.g, c.b, c.a]
    }
    return [0, 0, 0, 1]
  })

  return {
    u_scale: paint.scale,
    u_rotation: (paint.rotation * Math.PI) / 180,
    u_offset: [paint.offsetX, paint.offsetY],
    u_refractionIndex: p.refractionIndex,
    u_dispersionSpread: p.dispersionSpread,
    u_frequency: p.frequency,
    u_mouseReactivity: p.mouseReactivity,
    u_mouse: [0.5, 0.5],
    u_mouseActive: 0.0,
    u_roughness: p.roughness,
    u_filmThickness: p.filmThickness,
    u_iridescence: p.iridescence,
    u_fluidViscosity: p.fluidViscosity,
    u_grainScale: p.grainScale,
    u_grainIntensity: p.grainIntensity,
    u_lightAngle: p.lightAngle,
    u_specularStrength: p.specularStrength,
    u_blendRatio: p.blendRatio,
    u_presetMode: presetMode,
    u_colorCount: colorCount,
    u_colors: colorsArray,
    u_tintColor: [cTint.r, cTint.g, cTint.b],
    u_highlightColor: [cHigh.r, cHigh.g, cHigh.b],
  }
}
