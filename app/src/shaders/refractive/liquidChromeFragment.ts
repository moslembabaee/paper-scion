import type { LiquidChromePaint, LiquidChromeParams } from './types.ts'
import { parseHexColor } from '../mesh.ts'

export const liquidChromeFragmentShader = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform float u_rotation;
uniform vec2 u_offset;

// Metallic & Iridescent Optics
uniform float u_metallicSheen;
uniform float u_iridescence;
uniform float u_filmThickness; // in nanometers (100 to 1000 nm)
uniform float u_roughness;
uniform float u_dispersion;

// Fluid Dynamic Flow
uniform float u_fluidViscosity;
uniform float u_flowSpeed;
uniform float u_rippleFrequency;
uniform float u_normalPerturbation;

// Palette & Studio Lighting
uniform vec3 u_baseColor;
uniform vec3 u_sheenColor;
uniform float u_lightAngle;
uniform float u_environmentStyle; // 0=studio, 1=horizon, 2=aurora, 3=cyber, 4=monochrome
uniform float u_grainMixer;

out vec4 fragColor;

// ==================== GLSL MATH & FLUID HELPERS ====================

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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

// Navier-Stokes-inspired curl domain flow field
vec2 liquidCurlFlow(vec2 p, float time) {
  float freq = u_rippleFrequency;
  float speed = u_flowSpeed * 0.8;
  float viscosityFactor = 1.0 - clamp(u_fluidViscosity, 0.0, 0.9) * 0.6;

  vec2 flow = vec2(0.0);
  float amp = 1.0;

  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 wave = vec2(
      sin(p.y * freq + time * speed * (1.0 + fi * 0.25) + fi * 1.6),
      cos(p.x * freq - time * speed * (0.85 + fi * 0.2) + fi * 0.9)
    );
    flow += wave * amp * viscosityFactor;
    freq *= 1.85;
    amp *= 0.52;
    // Domain rotation
    p = mat2(0.8, -0.6, 0.6, 0.8) * p + vec2(0.3, -0.2);
  }

  return flow * 0.18;
}

// Fluid height field for dynamic normal derivation
float sampleLiquidHeight(vec2 p, float time) {
  vec2 flow = liquidCurlFlow(p, time);
  vec2 warpedP = p + flow;

  float freq = u_rippleFrequency * 2.2;
  float h1 = sin(warpedP.x * freq + time * u_flowSpeed) * cos(warpedP.y * freq - time * u_flowSpeed * 0.8);
  float h2 = sin((warpedP.x + warpedP.y) * freq * 0.7 - time * u_flowSpeed * 1.2) * 0.6;
  float h3 = noise2D(warpedP * freq * 1.5 + time * u_flowSpeed * 0.5) * 0.4;

  // Micro-roughness perturbation
  float micro = (noise2D(p * 40.0) - 0.5) * u_roughness * 0.35;

  return (h1 + h2 + h3) * 0.45 + micro;
}

// ==================== THIN-FILM OPTICAL INTERFERENCE ====================
// Physically calculates constructive and destructive phase interference
// across visible wavelengths: Red (650nm), Green (535nm), Blue (450nm)
vec3 calculateThinFilmInterference(float cosTheta, float thicknessNm) {
  // Refractive index of thin film layer (e.g. oil or metallic oxide n ~ 1.45)
  float nFilm = 1.45;
  float sinTheta2 = (1.0 - cosTheta * cosTheta) / (nFilm * nFilm);
  float cosThetaT = sqrt(max(0.001, 1.0 - sinTheta2));

  // Optical path difference: 2 * n * d * cos(theta_t)
  float opd = 2.0 * nFilm * thicknessNm * cosThetaT;

  // Phase shift on reflection at metallic boundary (~ pi)
  float phaseShift = 3.14159265;

  // Wavelengths in nm
  vec3 wavelengths = vec3(650.0, 535.0, 450.0);

  // Phase difference delta = 2 * pi * opd / lambda + phaseShift
  vec3 delta = (6.2831853 * opd) / wavelengths + vec3(phaseShift);

  // Interference intensity: I = cos^2(delta / 2)
  vec3 interference = cos(delta * 0.5) * cos(delta * 0.5);

  // Tone map interference into radiant iridescent luster
  return clamp(interference * 1.25, 0.0, 1.0);
}

// ==================== PROCEDURAL HDR STUDIO ENVIRONMENT ====================
vec3 sampleStudioEnvironment(vec3 ray) {
  // Normalize reflection vector
  vec3 R = normalize(ray);

  // Paper design system color tokens
  vec3 cream = vec3(0.929, 0.922, 0.882); // #edebe1
  vec3 dark = vec3(0.031, 0.031, 0.031);  // #080808
  vec3 blue = vec3(0.506, 0.678, 0.925);  // #81adec
  vec3 slate = vec3(0.318, 0.420, 0.580); // #516b94

  if (u_environmentStyle < 0.5) {
    // 0: High-craft Photo Studio
    // Overhead softbox
    float softbox = smoothstep(0.4, 0.98, R.y) * 2.2;
    // Lateral rim lights
    float rimLight = pow(clamp(1.0 - abs(R.x), 0.0, 1.0), 4.0) * 0.8;
    // Dark floor reflection
    float floorShade = smoothstep(-0.8, -0.1, R.y);
    vec3 env = mix(dark, cream * 0.7, floorShade);
    env += cream * softbox + blue * rimLight;
    return env;
  } else if (u_environmentStyle < 1.5) {
    // 1: Horizon Mirror
    float horizon = smoothstep(-0.04, 0.04, R.y);
    vec3 sky = mix(slate, cream * 1.2, pow(clamp(R.y, 0.0, 1.0), 0.6));
    vec3 ground = mix(dark, slate * 0.4, pow(clamp(-R.y, 0.0, 1.0), 0.5));
    float sunGlint = pow(max(0.0, dot(R, normalize(vec3(0.5, 0.2, 0.8)))), 24.0) * 2.0;
    return mix(ground, sky, horizon) + vec3(sunGlint);
  } else if (u_environmentStyle < 2.5) {
    // 2: Aurora Borealis
    float wave1 = sin(R.x * 3.0 + R.y * 2.0) * 0.5 + 0.5;
    float wave2 = cos(R.z * 4.0 - R.y * 3.0) * 0.5 + 0.5;
    vec3 colorA = mix(blue, cream, wave1);
    vec3 colorB = mix(slate, blue * 1.3, wave2);
    return mix(dark, mix(colorA, colorB, R.y * 0.5 + 0.5), smoothstep(-0.3, 0.7, R.y));
  } else if (u_environmentStyle < 3.5) {
    // 3: Cyber Chrome
    float neonStripe1 = pow(abs(sin(R.y * 8.0 + R.x * 4.0)), 16.0) * 2.5;
    float neonStripe2 = pow(abs(cos(R.z * 6.0)), 12.0) * 1.8;
    return dark + blue * neonStripe1 + cream * neonStripe2 * 0.8;
  } else {
    // 4: Pure Monochrome Liquid Mercury
    float bands = sin(R.y * 12.0) * sin(R.x * 8.0) * 0.5 + 0.5;
    float spec = pow(max(0.0, R.y), 3.0) * 1.8;
    return mix(dark, cream, bands * 0.75 + spec * 0.5);
  }
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y);
  vec2 p = uv - 0.5 - u_offset;

  // Apply layer transform (scale & rotation)
  float c = cos(u_rotation), s = sin(u_rotation);
  p = mat2(c, -s, s, c) * p / max(0.01, u_scale);

  float time = u_time * 0.15;

  // Derive dynamic liquid normal via finite differences
  float eps = 0.0035;
  float hL = sampleLiquidHeight(p - vec2(eps, 0.0), time);
  float hR = sampleLiquidHeight(p + vec2(eps, 0.0), time);
  float hD = sampleLiquidHeight(p - vec2(0.0, eps), time);
  float hU = sampleLiquidHeight(p + vec2(0.0, eps), time);

  float dhdx = (hR - hL) / (2.0 * eps);
  float dhdy = (hU - hD) / (2.0 * eps);

  // Surface normal perturbation from fluid dynamics
  float bump = u_normalPerturbation * 6.0;
  vec3 N = normalize(vec3(-dhdx * bump, -dhdy * bump, 1.0));

  // Incident camera view direction
  vec3 V = vec3(0.0, 0.0, 1.0);
  float cosTheta = clamp(dot(V, N), 0.0, 1.0);

  // Reflect ray for environment mapping
  vec3 R = reflect(-V, N);

  // Specular chromatic dispersion on reflection vectors
  // Splitting R, G, B reflection vectors by dispersion amount
  vec3 dispAxis = normalize(vec3(dhdy, -dhdx, 0.2));
  float dispAmount = u_dispersion * 0.09;

  vec3 rayR = normalize(R - dispAxis * dispAmount);
  vec3 rayG = R;
  vec3 rayB = normalize(R + dispAxis * dispAmount);

  // Sample environment reflections with chromatic dispersion
  float envR = sampleStudioEnvironment(rayR).r;
  float envG = sampleStudioEnvironment(rayG).g;
  float envB = sampleStudioEnvironment(rayB).b;
  vec3 envRefl = vec3(envR, envG, envB);

  // Micro-roughness scattering: blur environment towards diffuse
  vec3 diffuseEnv = sampleStudioEnvironment(vec3(0.0, 1.0, 0.2)) * 0.4;
  envRefl = mix(envRefl, diffuseEnv, u_roughness * 0.65);

  // ==================== THIN-FILM IRIDESCENT SHEEN ====================
  vec3 iridescenceColor = calculateThinFilmInterference(cosTheta, u_filmThickness);

  // Conductor metallic Fresnel (Schlick approximation with high base reflectivity)
  vec3 f0 = mix(u_baseColor, u_sheenColor, u_metallicSheen);
  vec3 fresnelMetal = f0 + (vec3(1.0) - f0) * pow(1.0 - cosTheta, 5.0);

  // Directional Studio Key Lighting
  float rad = radians(u_lightAngle);
  vec3 L = normalize(vec3(cos(rad), sin(rad), 0.7));
  vec3 H = normalize(L + V);

  float specPower = mix(128.0, 12.0, u_roughness);
  float NdotH = max(0.0, dot(N, H));
  float specularGlint = pow(NdotH, specPower) * (1.2 + u_metallicSheen * 0.8);

  // Combine metallic reflections with thin-film rainbow iridescence
  vec3 baseMetal = fresnelMetal * envRefl;
  vec3 iridescentSheen = iridescenceColor * envRefl * 1.35;

  vec3 finalColor = mix(baseMetal, iridescentSheen, u_iridescence);

  // Add specular highlight glint tinted by sheenColor
  finalColor += u_sheenColor * specularGlint;

  // Add subtle liquid edge rim glow
  float rim = pow(1.0 - cosTheta, 3.0) * 0.45;
  finalColor += mix(u_sheenColor, iridescenceColor, 0.5) * rim;

  // Micro-grain dither to eliminate color banding
  float dither = (hash12(gl_FragCoord.xy) - 0.5) * (u_grainMixer * 0.35);
  finalColor = clamp(finalColor + vec3(dither), 0.0, 1.0);

  fragColor = vec4(finalColor, 1.0);
}
`

export function liquidChromeUniforms(paint: LiquidChromePaint) {
  const p: LiquidChromeParams = paint.params
  const envMap = { studio: 0, horizon: 1, aurora: 2, cyber: 3, monochrome: 4 }
  const cBase = parseHexColor(p.baseColor)
  const cSheen = parseHexColor(p.sheenColor)

  return {
    u_scale: paint.scale,
    u_rotation: (paint.rotation * Math.PI) / 180,
    u_offset: [paint.offsetX, paint.offsetY],
    u_metallicSheen: p.metallicSheen,
    u_iridescence: p.iridescence,
    u_filmThickness: p.filmThickness,
    u_roughness: p.roughness,
    u_dispersion: p.dispersion,
    u_fluidViscosity: p.fluidViscosity,
    u_flowSpeed: p.flowSpeed,
    u_rippleFrequency: p.rippleFrequency,
    u_normalPerturbation: p.normalPerturbation,
    u_baseColor: [cBase.r, cBase.g, cBase.b],
    u_sheenColor: [cSheen.r, cSheen.g, cSheen.b],
    u_lightAngle: p.lightAngle,
    u_environmentStyle: envMap[p.environmentStyle] ?? 0,
    u_grainMixer: p.grainMixer,
  }
}
