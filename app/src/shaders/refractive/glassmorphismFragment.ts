import type { GlassmorphismPaint, GlassmorphismParams } from './types.ts'
import { parseHexColor } from '../mesh.ts'

export const glassmorphismFragmentShader = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform float u_rotation;
uniform vec2 u_offset;

// Physical Refraction & Dispersion
uniform float u_refractionIndex;
uniform float u_dispersion;
uniform float u_roughness;
uniform float u_blurRadius;

// Surface Geometry & Roughness Perturbation
uniform float u_surfacePattern; // 0=smooth, 1=frosted, 2=fluted, 3=rippled, 4=faceted
uniform float u_patternScale;
uniform float u_frostIntensity;
uniform float u_bevelWidth;

// Volume Tint & Highlights
uniform vec3 u_tintColor;
uniform float u_tintOpacity;
uniform vec3 u_highlightColor;
uniform float u_specularStrength;
uniform float u_lightAngle;
uniform float u_chromaticShift;

out vec4 fragColor;

// ==================== GLSL MATH & UTILITIES ====================

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

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise2D(p);
    p = p * 2.02 + vec2(1.4, 3.2);
    a *= 0.5;
  }
  return v;
}

// Worley / Cellular noise for faceted crystal caustics
float worley2D(vec2 p) {
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

// Surface height function for normal derivation
float sampleSurfaceHeight(vec2 p, float time) {
  float h = 0.0;
  vec2 scaledP = p * max(0.1, u_patternScale);

  if (u_surfacePattern < 0.5) {
    // 0: Smooth lens curvature
    float d = clamp(length(p), 0.0, 1.0);
    h = sqrt(max(0.0, 1.0 - d * d * 0.9));
  } else if (u_surfacePattern < 1.5) {
    // 1: Frosted etched glass (multi-scale fbm micro-facets)
    h = fbm(scaledP * 4.0 + time * 0.05) * 0.8;
    h += (noise2D(scaledP * 16.0) - 0.5) * 0.2;
  } else if (u_surfacePattern < 2.5) {
    // 2: Architectural Fluted glass (directional sinusoidal ribs)
    float rib = sin(scaledP.x * 6.2831853);
    float subRib = sin(scaledP.x * 12.56637) * 0.2;
    h = rib * 0.8 + subRib;
  } else if (u_surfacePattern < 3.5) {
    // 3: Rippled organic water surface
    float r1 = sin(length(scaledP - vec2(0.2, 0.2)) * 8.0 - time * 1.5);
    float r2 = cos(scaledP.y * 6.0 + scaledP.x * 4.0 + time * 1.2);
    float r3 = sin((scaledP.x - scaledP.y) * 5.0 - time * 0.8) * 0.5;
    h = (r1 + r2 + r3) * 0.35;
  } else {
    // 4: Faceted prismatic crystal ridges
    float w1 = worley2D(scaledP * 2.5);
    float w2 = worley2D(scaledP * 5.0 + vec2(1.2, -0.8));
    h = (1.0 - w1) * 0.7 + (1.0 - w2) * 0.3;
  }

  // Microfacet roughness perturbation
  float microRough = (noise2D(p * 35.0 + time * 0.02) - 0.5) * u_roughness * 0.25;
  return h * (0.4 + u_frostIntensity * 0.6) + microRough;
}

// Procedural Backdrop scene (high-craft Paper design system aesthetic)
vec3 sampleBackdropScene(vec2 uv) {
  // Paper design system palette: #edebe1 (cream), #080808 (black), #81adec (blue), #222222 (charcoal)
  vec3 cream = vec3(0.929, 0.922, 0.882);
  vec3 blue = vec3(0.506, 0.678, 0.925);
  vec3 slate = vec3(0.318, 0.420, 0.580);
  vec3 charcoal = vec3(0.133, 0.133, 0.133);
  vec3 black = vec3(0.031, 0.031, 0.031);

  // Structural backdrop composition: architectural cards, grid lines, and soft ambient spots
  vec2 gridUV = fract(uv * 6.0);
  float gridLines = smoothstep(0.04, 0.0, gridUV.x) + smoothstep(0.04, 0.0, gridUV.y);

  // Soft luminous colored card
  float cardDist = length(uv - vec2(0.35, 0.45));
  float cardGlow = smoothstep(0.5, 0.0, cardDist);

  // Linear diagonal gradient base
  float diag = uv.x * 0.6 + uv.y * 0.4;
  vec3 bg = mix(cream, charcoal, smoothstep(0.1, 0.9, diag));
  bg = mix(bg, blue, cardGlow * 0.65);
  bg = mix(bg, slate, smoothstep(0.7, 0.1, length(uv - vec2(0.75, 0.8))) * 0.5);

  // Contrast shapes resembling underlying canvas scene nodes
  float stripe = step(0.48, fract(uv.x * 3.0 + uv.y * 2.0));
  bg = mix(bg, black, stripe * 0.15);
  bg = mix(bg, blue, gridLines * 0.12);

  return bg;
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y);
  vec2 p = uv - 0.5 - u_offset;

  // Apply layer transform (rotation and scale)
  float c = cos(u_rotation), s = sin(u_rotation);
  p = mat2(c, -s, s, c) * p / max(0.01, u_scale);

  float time = u_time * 0.1;

  // Derive surface normal via finite difference gradient
  float eps = 0.004;
  float hL = sampleSurfaceHeight(p - vec2(eps, 0.0), time);
  float hR = sampleSurfaceHeight(p + vec2(eps, 0.0), time);
  float hD = sampleSurfaceHeight(p - vec2(0.0, eps), time);
  float hU = sampleSurfaceHeight(p + vec2(0.0, eps), time);

  float dhdx = (hR - hL) / (2.0 * eps);
  float dhdy = (hU - hD) / (2.0 * eps);

  // Surface normal with roughness perturbation
  float bumpIntensity = 2.5 * (1.0 + u_frostIntensity * 2.0);
  vec3 N = normalize(vec3(-dhdx * bumpIntensity, -dhdy * bumpIntensity, 1.0));

  // Incident view direction (orthographic camera looking along +Z into scene)
  vec3 V = vec3(0.0, 0.0, 1.0);

  // Index of Refraction and Cauchy Chromatic Dispersion
  // Red (650nm) refracts less, Blue (450nm) refracts more
  float ior = max(1.0, u_refractionIndex);
  float dispOffset = u_dispersion * 0.08;
  float iorR = ior - dispOffset;
  float iorG = ior;
  float iorB = ior + dispOffset;

  vec3 refrR = refract(-V, N, 1.0 / iorR);
  vec3 refrG = refract(-V, N, 1.0 / iorG);
  vec3 refrB = refract(-V, N, 1.0 / iorB);

  // Total internal reflection handling: fall back to reflection if refract returns vec3(0.0)
  vec3 refl = reflect(-V, N);
  if (length(refrR) < 0.01) refrR = refl;
  if (length(refrG) < 0.01) refrG = refl;
  if (length(refrB) < 0.01) refrB = refl;

  // Directional Refractive Offsets
  float refrStrength = (ior - 1.0) * 0.22;
  vec2 radialShift = normalize(p + vec2(0.0001)) * u_chromaticShift * 0.04;

  vec2 uvOffsetR = refrR.xy * refrStrength - radialShift;
  vec2 uvOffsetG = refrG.xy * refrStrength;
  vec2 uvOffsetB = refrB.xy * refrStrength + radialShift;

  // ==================== DYNAMIC BACKDROP BLURRING ====================
  // Multi-tap golden-angle spiral Poisson-disc blurred kernel
  float blurRadius = (u_blurRadius * 0.045 + u_roughness * 0.065);
  vec3 accumulatedBackdrop = vec3(0.0);
  float totalWeight = 0.0;

  const int TAP_COUNT = 16;
  for (int i = 0; i < TAP_COUNT; i++) {
    float fi = float(i);
    float angle = fi * 2.39996323; // Golden angle in radians
    float r = sqrt((fi + 1.0) / float(TAP_COUNT)) * blurRadius;
    vec2 tapOffset = vec2(cos(angle), sin(angle)) * r;

    // Weight tap by Gaussian falloff
    float weight = exp(-2.2 * (r / max(0.001, blurRadius)) * (r / max(0.001, blurRadius)));

    // Sample chromatic spectral components
    float sampleR = sampleBackdropScene(uv + uvOffsetR + tapOffset).r;
    float sampleG = sampleBackdropScene(uv + uvOffsetG + tapOffset).g;
    float sampleB = sampleBackdropScene(uv + uvOffsetB + tapOffset).b;

    accumulatedBackdrop += vec3(sampleR, sampleG, sampleB) * weight;
    totalWeight += weight;
  }

  vec3 refractedColor = accumulatedBackdrop / max(0.0001, totalWeight);

  // ==================== BEER-LAMBERT DEPTH ABSORPTION ====================
  // Tint absorption increases with transmission optical path length
  float pathLength = 1.0 + length(refrG.xy) * 2.5;
  vec3 absorption = exp(-((vec3(1.0) - u_tintColor) * u_tintOpacity * pathLength * 1.5));
  vec3 transmittedColor = mix(refractedColor * absorption, u_tintColor, u_tintOpacity * 0.45);

  // ==================== FRESNEL & SPECULAR HIGHLIGHTS ====================
  // Schlick's approximation for dielectric glass
  float f0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
  float cosTheta = clamp(dot(V, N), 0.0, 1.0);
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);

  // Edge bevel highlight glow
  float bevelGlow = pow(1.0 - cosTheta, 3.5) * u_bevelWidth * 1.2;

  // Directional studio key lighting
  float rad = radians(u_lightAngle);
  vec3 L = normalize(vec3(cos(rad), sin(rad), 0.65));
  vec3 H = normalize(L + V);

  float specPower = mix(64.0, 8.0, u_roughness);
  float NdotH = max(0.0, dot(N, H));
  float specular = pow(NdotH, specPower) * u_specularStrength;

  // Environment reflection at grazing angles
  vec3 envRefl = mix(u_highlightColor, vec3(1.0), fresnel);

  // Composite final glassmorphism material
  vec3 litGlass = transmittedColor * (1.0 - fresnel * 0.6) +
                  envRefl * (fresnel * 0.4 + bevelGlow) +
                  u_highlightColor * specular;

  // Micro-grain dither to eliminate 8-bit banding
  float dither = (hash12(gl_FragCoord.xy) - 0.5) * (0.015 + u_roughness * 0.02);
  litGlass = clamp(litGlass + vec3(dither), 0.0, 1.0);

  fragColor = vec4(litGlass, 1.0);
}
`

export function glassmorphismUniforms(paint: GlassmorphismPaint) {
  const p: GlassmorphismParams = paint.params
  const patternMap = { smooth: 0, frosted: 1, fluted: 2, rippled: 3, faceted: 4 }
  const cTint = parseHexColor(p.tintColor)
  const cHigh = parseHexColor(p.highlightColor)

  return {
    u_scale: paint.scale,
    u_rotation: (paint.rotation * Math.PI) / 180,
    u_offset: [paint.offsetX, paint.offsetY],
    u_refractionIndex: p.refractionIndex,
    u_dispersion: p.dispersion,
    u_roughness: p.roughness,
    u_blurRadius: p.blurRadius,
    u_surfacePattern: patternMap[p.surfacePattern] ?? 0,
    u_patternScale: p.patternScale,
    u_frostIntensity: p.frostIntensity,
    u_bevelWidth: p.bevelWidth,
    u_tintColor: [cTint.r, cTint.g, cTint.b],
    u_tintOpacity: p.tintOpacity,
    u_highlightColor: [cHigh.r, cHigh.g, cHigh.b],
    u_specularStrength: p.specularStrength,
    u_lightAngle: p.lightAngle,
    u_chromaticShift: p.chromaticShift,
  }
}
