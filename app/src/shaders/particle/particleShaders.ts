import type { ParticleSimulationParams } from './types.ts'
import { parseColorToRgb } from './particleSimulation.ts'

export const baseVertexShader = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

/**
 * GPGPU Simulation Fragment Shader:
 * Evaluates multi-octave curl noise potential, cursor magnetic attraction/repulsion/vortex fields,
 * secondary grid magnetic poles, Brownian jitter, and advection physics.
 */
export const particleSimFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec4 outVelocity;

uniform sampler2D u_position;
uniform sampler2D u_velocity;

uniform vec2 u_cursor;
uniform vec2 u_cursorVelocity;
uniform float u_cursorActive;
uniform float u_cursorPressed;
uniform float u_dt;
uniform float u_time;
uniform vec2 u_resolution;

// Simulation parameters
uniform float u_advectionSpeed;
uniform float u_curlStrength;
uniform float u_curlScale;
uniform int u_curlOctaves;
uniform float u_velocityDamping;
uniform int u_magneticMode; // 0: attract, 1: repel, 2: vortex, 3: dipole, 4: cross-flow, 5: orbit
uniform float u_magneticForce;
uniform float u_magneticRadius;
uniform int u_magneticPolesCount;
uniform float u_gridAlignment;
uniform float u_jitter;

// Pseudo-random hash generator
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 2D Value Noise
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian Motion for potential field
float fbm(vec2 p, int octaves) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
  for (int i = 0; i < 5; ++i) {
    if (i >= octaves) break;
    v += a * noise(p);
    p = rot * p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

// Analytical Incompressible 2D Curl Noise: v = (dPsi/dy, -dPsi/dx)
vec2 curlNoise(vec2 p, float time, int octaves) {
  float eps = 0.005;
  vec2 t = vec2(time * 0.15, time * 0.1);
  float psi_y1 = fbm((p + vec2(0.0, eps)) * u_curlScale + t, octaves);
  float psi_y0 = fbm((p - vec2(0.0, eps)) * u_curlScale + t, octaves);
  float psi_x1 = fbm((p + vec2(eps, 0.0)) * u_curlScale + t, octaves);
  float psi_x0 = fbm((p - vec2(eps, 0.0)) * u_curlScale + t, octaves);

  float dpsi_dy = (psi_y1 - psi_y0) / (2.0 * eps);
  float dpsi_dx = (psi_x1 - psi_x0) / (2.0 * eps);

  return vec2(dpsi_dy, -dpsi_dx);
}

void main() {
  vec4 posData = texture(u_position, v_uv);
  vec4 velData = texture(u_velocity, v_uv);

  vec2 pos = posData.xy;
  float life = posData.z;
  float mass = posData.w;
  vec2 vel = velData.xy;

  float aspect = u_resolution.x / max(1.0, u_resolution.y);

  // 1. Incompressible Curl Noise Field Force
  vec2 curl = curlNoise(pos, u_time, u_curlOctaves) * u_curlStrength;
  vec2 totalForce = curl;

  // 2. Cursor Magnetic Field Interaction
  if (u_cursorActive > 0.5) {
    vec2 toCursor = (u_cursor - pos);
    toCursor.x *= aspect;
    float dist = length(toCursor);

    if (dist < u_magneticRadius && dist > 0.001) {
      float normDist = dist / u_magneticRadius;
      float falloff = (1.0 - smoothstep(0.0, 1.0, normDist)) * (1.0 / (dist * 1.5 + 0.1));
      float pressMultiplier = u_cursorPressed > 0.5 ? 2.2 : 1.0;
      float forceMag = u_magneticForce * falloff * pressMultiplier;

      vec2 dir = normalize(toCursor);
      vec2 tangent = vec2(-dir.y, dir.x);

      // Mode evaluation
      if (u_magneticMode == 0) { // Attract
        totalForce += dir * forceMag * 4.0;
      } else if (u_magneticMode == 1) { // Repel
        totalForce -= dir * forceMag * 5.0;
      } else if (u_magneticMode == 2) { // Vortex
        totalForce += (tangent * 1.2 + dir * 0.35) * forceMag * 3.5;
      } else if (u_magneticMode == 3) { // Dipole
        vec2 dipoleAxis = normalize(u_cursorVelocity + vec2(0.0001, 0.0001));
        float align = dot(dir, dipoleAxis);
        vec2 dipoleField = (3.0 * align * dir - dipoleAxis) / (dist * dist + 0.05);
        totalForce += dipoleField * forceMag * 0.8;
      } else if (u_magneticMode == 4) { // Cross-flow
        vec2 crossHeading = normalize(vec2(-u_cursorVelocity.y, u_cursorVelocity.x) + vec2(0.0, 1.0));
        totalForce += crossHeading * forceMag * 3.0;
      } else if (u_magneticMode == 5) { // Orbit
        totalForce += tangent * forceMag * 4.0 + dir * (forceMag * 1.8 - length(vel) * 0.8);
      }
    }
  }

  // 3. Secondary 120px Grid Magnetic Lattice Poles
  if (u_magneticPolesCount > 0) {
    float gridStep = 120.0;
    vec2 gridCount = max(vec2(1.0), floor(u_resolution / gridStep));
    for (int i = 0; i < 8; ++i) {
      if (i >= u_magneticPolesCount) break;
      float fi = float(i + 1);
      // Fixed deterministic pole coordinates distributed across 120px grid intersections
      float poleX = (mod(fi * 3.0, gridCount.x) + 0.5) / gridCount.x;
      float poleY = (mod(fi * 2.0, gridCount.y) + 0.5) / gridCount.y;
      vec2 polePos = vec2(poleX, poleY);

      vec2 toPole = (polePos - pos);
      toPole.x *= aspect;
      float pDist = length(toPole);
      float poleRadius = 0.28;
      if (pDist < poleRadius && pDist > 0.001) {
        float pFalloff = (1.0 - smoothstep(0.0, 1.0, pDist / poleRadius)) * (0.8 / (pDist * 2.0 + 0.1));
        float poleSign = mod(float(i), 2.0) == 0.0 ? 1.0 : -1.0;
        vec2 pDir = normalize(toPole);
        vec2 pTangent = vec2(-pDir.y, pDir.x);
        totalForce += (pDir * poleSign * 1.5 + pTangent * 0.8) * pFalloff * (u_magneticForce * 0.4);
      }
    }
  }

  // 4. Paper 120px Grid Snapping & Alignment
  if (u_gridAlignment > 0.01) {
    vec2 pixelPos = pos * u_resolution;
    vec2 gridMod = mod(pixelPos, 120.0);
    vec2 gridDist = abs(gridMod - 60.0);
    vec2 gridAttract = (vec2(60.0) - gridMod) / 60.0;
    totalForce += gridAttract * u_gridAlignment * 0.6;
  }

  // 5. Thermal Brownian Jitter
  if (u_jitter > 0.01) {
    float rand1 = hash(pos + vec2(u_time * 0.01, float(gl_FragCoord.x))) - 0.5;
    float rand2 = hash(pos + vec2(float(gl_FragCoord.y), u_time * 0.01)) - 0.5;
    totalForce += vec2(rand1, rand2) * u_jitter * 2.5;
  }

  // 6. Physics Integration (Euler / Velocity-Verlet with Damping)
  vel = vel * u_velocityDamping + totalForce * u_dt;
  pos += vel * u_dt * u_advectionSpeed * 0.1;
  life += u_dt * 0.15;

  // 7. Boundary Respawn & Life Regeneration
  bool outOfBounds = pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0;
  if (outOfBounds || life >= 1.0) {
    float seedX = hash(v_uv + vec2(u_time * 0.1, 12.34));
    float seedY = hash(v_uv + vec2(56.78, u_time * 0.1));

    // Prefer spawning along 120px grid nodes if grid alignment is high
    if (u_gridAlignment > 0.4) {
      float gx = floor(seedX * (u_resolution.x / 120.0)) * 120.0 / u_resolution.x;
      float gy = floor(seedY * (u_resolution.y / 120.0)) * 120.0 / u_resolution.y;
      pos = vec2(gx, gy) + (vec2(seedX, seedY) - 0.5) * 0.04;
    } else {
      pos = vec2(seedX, seedY);
    }
    vel = curlNoise(pos, u_time, 2) * 0.2;
    life = hash(v_uv * 19.1) * 0.2; // Staggered initial life
    mass = 0.8 + hash(v_uv * 37.3) * 0.4;
  }

  outPosition = vec4(pos, life, mass);
  outVelocity = vec4(vel, length(curl), length(vel));
}`

/**
 * Particle Point Sprite Vertex Shader:
 * Decodes particle texture positions, modulates point size with speed and lifecycle.
 */
export const particleRenderVertexShader = `#version 300 es
precision highp float;

uniform sampler2D u_position;
uniform sampler2D u_velocity;
uniform int u_texWidth;
uniform int u_texHeight;
uniform float u_particleSize;
uniform float u_time;
uniform vec2 u_resolution;

out vec2 v_pos;
out vec2 v_vel;
out float v_life;
out float v_speed;
out float v_curl;
out float v_mass;

void main() {
  int id = gl_VertexID;
  int x = id % u_texWidth;
  int y = id / u_texWidth;

  vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(float(u_texWidth), float(u_texHeight));

  vec4 posData = texture(u_position, uv);
  vec4 velData = texture(u_velocity, uv);

  v_pos = posData.xy;
  v_life = posData.z;
  v_mass = posData.w;
  v_vel = velData.xy;
  v_curl = velData.z;
  v_speed = velData.w;

  // Convert normalized [0, 1] to clip space [-1, 1]
  gl_Position = vec4(v_pos * 2.0 - 1.0, 0.0, 1.0);

  // Smooth lifecycle envelope: fade in -> sustain -> fade out
  float lifeEnvelope = smoothstep(0.0, 0.1, v_life) * (1.0 - smoothstep(0.85, 1.0, v_life));

  // Point size attenuation with speed & mass
  float speedBoost = clamp(v_speed * 1.5, 0.0, 3.0);
  gl_PointSize = max(1.0, u_particleSize * v_mass * (0.85 + speedBoost * 0.3) * lifeEnvelope);
}`

/**
 * Particle Point Sprite Fragment Shader:
 * Renders smooth circular antialiased particle sprites mapped to Paper design system colors.
 */
export const particleRenderFragmentShader = `#version 300 es
precision highp float;

in vec2 v_pos;
in vec2 v_vel;
in float v_life;
in float v_speed;
in float v_curl;
in float v_mass;

uniform int u_colorMode; // 0: palette, 1: monochrome, 2: velocity, 3: magnetic-flow, 4: aurora, 5: paper-blueprint
uniform float u_glowIntensity;

// Paper Palette Uniforms
uniform vec3 u_palette[8];
uniform int u_paletteCount;

out vec4 outColor;

vec3 getPaletteColor(float t) {
  t = clamp(t, 0.0, 1.0);
  float n = float(u_paletteCount - 1);
  float idx = t * n;
  int i = int(floor(idx));
  int j = min(i + 1, u_paletteCount - 1);
  float f = fract(idx);

  vec3 c1 = u_palette[0];
  vec3 c2 = u_palette[1];
  for (int k = 0; k < 8; ++k) {
    if (k == i) c1 = u_palette[k];
    if (k == j) c2 = u_palette[k];
  }
  return mix(c1, c2, f);
}

void main() {
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;

  // Soft Gaussian-like alpha falloff
  float alpha = smoothstep(0.5, 0.08, dist);

  // Lifespan fade
  float lifeAlpha = smoothstep(0.0, 0.1, v_life) * (1.0 - smoothstep(0.85, 1.0, v_life));

  vec3 rgb = vec3(0.929, 0.922, 0.882); // Default Paper #edebe1

  if (u_colorMode == 0) { // Palette interpolation
    float t = fract(v_life * 0.7 + v_speed * 0.3);
    rgb = getPaletteColor(t);
  } else if (u_colorMode == 1) { // Monochrome
    rgb = vec3(0.93, 0.92, 0.88);
  } else if (u_colorMode == 2) { // Velocity heatmap
    float normSpeed = clamp(v_speed * 1.2, 0.0, 1.0);
    vec3 cCold = vec3(0.03, 0.03, 0.03); // Deep charcoal #080808
    vec3 cMid = vec3(0.505, 0.678, 0.925); // Paper blue #81adec
    vec3 cHot = vec3(0.95, 0.94, 0.90); // White paper #edebe1
    rgb = normSpeed < 0.5 ? mix(cCold, cMid, normSpeed * 2.0) : mix(cMid, cHot, (normSpeed - 0.5) * 2.0);
  } else if (u_colorMode == 3) { // Magnetic Flow
    float angle = atan(v_vel.y, v_vel.x);
    float t = fract((angle / 6.283185) + 0.5);
    rgb = getPaletteColor(t);
  } else if (u_colorMode == 4) { // Aurora
    float t = sin(v_pos.x * 3.14 + v_life * 2.0) * 0.5 + 0.5;
    vec3 aGreen = vec3(0.2, 0.9, 0.6);
    vec3 aCyan = vec3(0.2, 0.7, 0.95);
    vec3 aViolet = vec3(0.75, 0.35, 0.9);
    rgb = t < 0.5 ? mix(aGreen, aCyan, t * 2.0) : mix(aCyan, aViolet, (t - 0.5) * 2.0);
  } else if (u_colorMode == 5) { // Paper Blueprint
    vec3 blueprintBase = vec3(0.505, 0.678, 0.925); // #81adec
    vec3 highlight = vec3(0.95, 0.95, 0.95);
    rgb = mix(blueprintBase, highlight, clamp(v_speed * 0.8, 0.0, 1.0));
  }

  // Additive glow factor
  float glow = 1.0 + (1.0 - smoothstep(0.0, 0.35, dist)) * u_glowIntensity * 0.6;
  rgb *= glow;

  outColor = vec4(rgb, alpha * lifeAlpha);
}`

/**
 * Phosphorescent Motion Trail Persistence Shader:
 * Blends the previous display frame with exponential decay and additive/alpha particle injection.
 */
export const trailCompositeFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_prevTrail;
uniform sampler2D u_currentParticles;
uniform float u_trailDecay;

void main() {
  vec4 prev = texture(u_prevTrail, v_uv);
  vec4 current = texture(u_currentParticles, v_uv);

  // Phosphorescent exponential decay
  vec4 decayed = prev * u_trailDecay;

  // Additive composite with alpha blend
  vec3 rgb = decayed.rgb + current.rgb * current.a;
  float alpha = clamp(decayed.a * u_trailDecay + current.a, 0.0, 1.0);

  outColor = vec4(rgb, alpha);
}`

/**
 * Display Composite & Diagnostics Fragment Shader:
 * Renders final trails, particles, Paper 120px grid lines, and diagnostic vector flow / magnetic potential modes.
 */
export const displayCompositeFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_trails;
uniform sampler2D u_particles;
uniform vec2 u_resolution;
uniform float u_time;
uniform int u_viewMode; // 0: field-composite, 1: particles-only, 2: flow-vectors, 3: magnetic-potential, 4: velocity-stream, 5: trails-only
uniform vec2 u_cursor;
uniform float u_cursorActive;
uniform int u_magneticMode;
uniform float u_magneticForce;
uniform float u_magneticRadius;
uniform float u_curlStrength;
uniform float u_curlScale;

// 120px Engineering Grid Line overlay
float getGridOverlay(vec2 uv, vec2 res) {
  vec2 px = uv * res;
  vec2 distToLine = abs(mod(px, 120.0) - vec2(0.5));
  float lineX = 1.0 - smoothstep(0.0, 1.2, distToLine.x);
  float lineY = 1.0 - smoothstep(0.0, 1.2, distToLine.y);
  return max(lineX, lineY);
}

void main() {
  vec4 trail = texture(u_trails, v_uv);
  vec4 particles = texture(u_particles, v_uv);

  // Diagnostic View Modes
  if (u_viewMode == 1) { // Particles Only
    outColor = particles;
    return;
  }
  if (u_viewMode == 5) { // Trails Only
    outColor = trail;
    return;
  }
  if (u_viewMode == 2) { // Flow Vectors Diagnostic
    vec2 cell = floor(v_uv * (u_resolution / 24.0)) / (u_resolution / 24.0);
    float angle = sin(cell.x * u_curlScale + u_time * 0.2) * cos(cell.y * u_curlScale + u_time * 0.2) * 3.14;
    vec2 flowDir = vec2(cos(angle), sin(angle));
    vec3 col = mix(vec3(0.03, 0.03, 0.03), vec3(0.505, 0.678, 0.925), 0.5 + 0.5 * flowDir.x);
    outColor = vec4(col, 1.0);
    return;
  }
  if (u_viewMode == 3) { // Magnetic Potential Field Diagnostic
    float aspect = u_resolution.x / max(1.0, u_resolution.y);
    vec2 toCursor = (u_cursor - v_uv);
    toCursor.x *= aspect;
    float dist = length(toCursor);
    float potential = 1.0 / (dist * 4.0 + 0.1);
    float rings = abs(sin(potential * 15.0 - u_time * 2.0));
    vec3 potColor = mix(vec3(0.03, 0.03, 0.03), vec3(0.505, 0.678, 0.925), smoothstep(0.85, 0.95, rings));
    outColor = vec4(potColor, 1.0);
    return;
  }
  if (u_viewMode == 4) { // Velocity Stream Diagnostic
    vec3 streamColor = mix(vec3(0.03, 0.03, 0.03), vec3(0.505, 0.678, 0.925), trail.a);
    outColor = vec4(streamColor, 1.0);
    return;
  }

  // Mode 0: Field Composite
  // Background: Transparent or dark canvas
  vec3 composite = trail.rgb + particles.rgb * (1.0 - trail.a * 0.2);
  float alpha = clamp(trail.a + particles.a, 0.0, 1.0);

  // Subtle Paper 120px Engineering Grid Lines
  float grid = getGridOverlay(v_uv, u_resolution);
  vec3 gridColor = vec3(0.505, 0.678, 0.925); // #81adec faint line
  composite = mix(composite, gridColor, grid * 0.08);

  outColor = vec4(composite, max(alpha, grid * 0.08));
}`

/** Converts ParticleSimulationParams into WebGL uniforms. */
export function particleUniforms(params: ParticleSimulationParams) {
  const magneticModeMap: Record<ParticleSimulationParams['magneticMode'], number> = {
    attract: 0,
    repel: 1,
    vortex: 2,
    dipole: 3,
    'cross-flow': 4,
    orbit: 5,
  }

  const colorModeMap: Record<ParticleSimulationParams['colorMode'], number> = {
    palette: 0,
    monochrome: 1,
    velocity: 2,
    'magnetic-flow': 3,
    aurora: 4,
    'paper-blueprint': 5,
  }

  const viewModeMap: Record<ParticleSimulationParams['viewMode'], number> = {
    'field-composite': 0,
    'particles-only': 1,
    'flow-vectors': 2,
    'magnetic-potential': 3,
    'velocity-stream': 4,
    'trails-only': 5,
  }

  const palette = params.particleColors.map(parseColorToRgb)
  const paletteRgbList: number[] = []
  for (let i = 0; i < 8; i++) {
    const col = palette[i] ?? palette[palette.length - 1] ?? { r: 0.93, g: 0.92, b: 0.88 }
    paletteRgbList.push(col.r, col.g, col.b)
  }

  return {
    u_particleSize: params.particleSize,
    u_advectionSpeed: params.advectionSpeed,
    u_curlStrength: params.curlStrength,
    u_curlScale: params.curlScale,
    u_curlOctaves: params.curlOctaves,
    u_velocityDamping: params.velocityDamping,
    u_magneticMode: magneticModeMap[params.magneticMode] ?? 0,
    u_magneticForce: params.magneticForce,
    u_magneticRadius: params.magneticRadius,
    u_magneticPolesCount: params.magneticPolesCount,
    u_trailDecay: params.trailDecay,
    u_colorMode: colorModeMap[params.colorMode] ?? 0,
    u_viewMode: viewModeMap[params.viewMode] ?? 0,
    u_gridAlignment: params.gridAlignment,
    u_glowIntensity: params.glowIntensity,
    u_jitter: params.jitter,
    u_paletteCount: Math.min(8, params.particleColors.length),
    u_palette: new Float32Array(paletteRgbList),
  }
}
