import type { FluidSimulationParams } from './types.ts'
import { parseColorToRgb } from './fluidSimulation.ts'

export const baseVertexShader = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export const advectionFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_velocity;
uniform sampler2D u_source;
uniform vec2 u_texelSize;
uniform float u_dt;
uniform float u_dissipation;

void main() {
  vec2 vel = texture(u_velocity, v_uv).xy;
  vec2 backCoord = v_uv - vel * u_dt * u_texelSize;
  outColor = texture(u_source, backCoord) * u_dissipation;
}`

export const divergenceFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_velocity;
uniform vec2 u_texelSize;

void main() {
  float L = texture(u_velocity, v_uv - vec2(u_texelSize.x, 0.0)).x;
  float R = texture(u_velocity, v_uv + vec2(u_texelSize.x, 0.0)).x;
  float T = texture(u_velocity, v_uv - vec2(0.0, u_texelSize.y)).y;
  float B = texture(u_velocity, v_uv + vec2(0.0, u_texelSize.y)).y;
  float div = 0.5 * (R - L + B - T);
  outColor = vec4(div, 0.0, 0.0, 1.0);
}`

export const jacobiPressureFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_pressure;
uniform sampler2D u_divergence;
uniform vec2 u_texelSize;

void main() {
  float L = texture(u_pressure, v_uv - vec2(u_texelSize.x, 0.0)).x;
  float R = texture(u_pressure, v_uv + vec2(u_texelSize.x, 0.0)).x;
  float T = texture(u_pressure, v_uv - vec2(0.0, u_texelSize.y)).x;
  float B = texture(u_pressure, v_uv + vec2(0.0, u_texelSize.y)).x;
  float div = texture(u_divergence, v_uv).x;
  float p = (L + R + T + B - div) * 0.25;
  outColor = vec4(p, 0.0, 0.0, 1.0);
}`

export const gradientSubtractFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_pressure;
uniform sampler2D u_velocity;
uniform vec2 u_texelSize;

void main() {
  float L = texture(u_pressure, v_uv - vec2(u_texelSize.x, 0.0)).x;
  float R = texture(u_pressure, v_uv + vec2(u_texelSize.x, 0.0)).x;
  float T = texture(u_pressure, v_uv - vec2(0.0, u_texelSize.y)).x;
  float B = texture(u_pressure, v_uv + vec2(0.0, u_texelSize.y)).x;
  vec2 grad = 0.5 * vec2(R - L, B - T);
  vec2 vel = texture(u_velocity, v_uv).xy - grad;
  outColor = vec4(vel, 0.0, 1.0);
}`

export const vorticityFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_velocity;
uniform vec2 u_texelSize;

void main() {
  float L = texture(u_velocity, v_uv - vec2(u_texelSize.x, 0.0)).y;
  float R = texture(u_velocity, v_uv + vec2(u_texelSize.x, 0.0)).y;
  float T = texture(u_velocity, v_uv - vec2(0.0, u_texelSize.y)).x;
  float B = texture(u_velocity, v_uv + vec2(0.0, u_texelSize.y)).x;
  float curl = 0.5 * (R - L - (B - T));
  outColor = vec4(curl, 0.0, 0.0, 1.0);
}`

export const vorticityForceFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_velocity;
uniform sampler2D u_curl;
uniform vec2 u_texelSize;
uniform float u_curlStrength;
uniform float u_dt;

void main() {
  float L = abs(texture(u_curl, v_uv - vec2(u_texelSize.x, 0.0)).x);
  float R = abs(texture(u_curl, v_uv + vec2(u_texelSize.x, 0.0)).x);
  float T = abs(texture(u_curl, v_uv - vec2(0.0, u_texelSize.y)).x);
  float B = abs(texture(u_curl, v_uv + vec2(0.0, u_texelSize.y)).x);
  vec2 grad = 0.5 * vec2(R - L, B - T);
  float len = length(grad) + 1e-5;
  vec2 N = grad / len;
  float omega = texture(u_curl, v_uv).x;
  vec2 force = vec2(N.y, -N.x) * omega * u_curlStrength;
  vec2 vel = texture(u_velocity, v_uv).xy + force * u_dt;
  outColor = vec4(vel, 0.0, 1.0);
}`

export const splatFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_target;
uniform vec2 u_point;
uniform vec3 u_color;
uniform float u_radius;
uniform float u_aspect;

void main() {
  vec2 p = v_uv - u_point;
  p.x *= u_aspect;
  float r = u_radius;
  vec3 splat = exp(-dot(p, p) / (r * r)) * u_color;
  vec3 base = texture(u_target, v_uv).xyz;
  outColor = vec4(base + splat, 1.0);
}`

/**
 * Display Fragment Shader:
 * Renders the simulated fluid field with normal-mapped Snell refraction,
 * Cauchy chromatic dispersion, Blinn-Phong specular glints, Fresnel reflections,
 * and Paper design system palette branding (#edebe1 / #080808, #81adec, #222222).
 */
export const displayFragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_dye;
uniform sampler2D u_velocity;
uniform sampler2D u_pressure;
uniform vec2 u_resolution;
uniform vec2 u_texelSize;
uniform float u_time;

// Optics & Lighting Uniforms
uniform float u_refractionIndex;
uniform float u_dispersion;
uniform float u_surfaceTension;
uniform float u_normalPerturbation;
uniform float u_specularStrength;
uniform float u_lightAngle;
uniform int u_viewMode; // 0: composite, 1: dye, 2: velocity, 3: pressure, 4: normal, 5: refraction

// Paper Brand Colors
uniform vec3 u_colorDye1;
uniform vec3 u_colorDye2;
uniform vec3 u_colorDye3;
uniform vec3 u_colorDye4;

vec3 straight(vec4 c) { return c.a > 0.0001 ? c.rgb / c.a : vec3(0.0); }

void main() {
  vec4 dye = texture(u_dye, v_uv);
  vec2 vel = texture(u_velocity, v_uv).xy;
  float pressure = texture(u_pressure, v_uv).x;

  // View mode diagnostics:
  if (u_viewMode == 1) { // Dye only
    outColor = vec4(dye.rgb, 1.0);
    return;
  }
  if (u_viewMode == 2) { // Velocity field
    vec3 velColor = vec3(vel * 0.05 + 0.5, length(vel) * 0.05);
    outColor = vec4(velColor, 1.0);
    return;
  }
  if (u_viewMode == 3) { // Pressure Poisson field
    float pNorm = clamp(pressure * 0.05 + 0.5, 0.0, 1.0);
    vec3 pCol = mix(vec3(0.03, 0.03, 0.03), vec3(0.505, 0.678, 0.925), pNorm);
    outColor = vec4(pCol, 1.0);
    return;
  }

  // Normal calculation from dye density and velocity turbulence
  float dL = texture(u_dye, v_uv - vec2(u_texelSize.x, 0.0)).a;
  float dR = texture(u_dye, v_uv + vec2(u_texelSize.x, 0.0)).a;
  float dT = texture(u_dye, v_uv - vec2(0.0, u_texelSize.y)).a;
  float dB = texture(u_dye, v_uv + vec2(0.0, u_texelSize.y)).a;

  float bump = u_normalPerturbation * 2.5;
  float dhdx = (dR - dL) * bump;
  float dhdy = (dB - dT) * bump;

  // Ripple perturbation from fluid velocity
  dhdx += vel.x * 0.02 * u_surfaceTension;
  dhdy += vel.y * 0.02 * u_surfaceTension;

  vec3 N = normalize(vec3(-dhdx, -dhdy, 1.0));

  if (u_viewMode == 4) { // Normal map
    outColor = vec4(N * 0.5 + 0.5, 1.0);
    return;
  }

  // Refraction calculation with Cauchy dispersion
  vec3 V = vec3(0.0, 0.0, 1.0);
  float ior = max(1.0, u_refractionIndex);
  float disp = u_dispersion * 0.04;

  float iorR = ior - disp;
  float iorG = ior;
  float iorB = ior + disp;

  vec3 refrR = refract(-V, N, 1.0 / iorR);
  vec3 refrG = refract(-V, N, 1.0 / iorG);
  vec3 refrB = refract(-V, N, 1.0 / iorB);

  float refrScale = (ior - 1.0) * 0.35;
  vec2 offR = refrR.xy * refrScale;
  vec2 offG = refrG.xy * refrScale;
  vec2 offB = refrB.xy * refrScale;

  if (u_viewMode == 5) { // Refraction offset field
    outColor = vec4(offG * 5.0 + 0.5, abs(offR.x - offB.x) * 20.0, 1.0);
    return;
  }

  // Samples refracted dye with dispersion
  float dyeValR = texture(u_dye, clamp(v_uv + offR, vec2(0.0), vec2(1.0))).r;
  float dyeValG = texture(u_dye, clamp(v_uv + offG, vec2(0.0), vec2(1.0))).g;
  float dyeValB = texture(u_dye, clamp(v_uv + offB, vec2(0.0), vec2(1.0))).b;
  vec3 refractedDye = vec3(dyeValR, dyeValG, dyeValB);

  // Background Paper canvas base (#edebe1 with subtle #080808 grid tone)
  vec3 paperBg = vec3(0.929, 0.922, 0.882); // #edebe1
  vec3 fluidFluid = mix(paperBg, refractedDye, clamp(length(refractedDye) * 1.2, 0.0, 1.0));

  // Lighting & Specular glints (Blinn-Phong)
  float rad = u_lightAngle * 0.01745329;
  vec3 L = normalize(vec3(cos(rad), sin(rad), 0.7));
  vec3 H = normalize(L + V);

  float NdotL = max(0.0, dot(N, L));
  float NdotH = max(0.0, dot(N, H));
  float spec = pow(NdotH, 32.0) * u_specularStrength;

  // Fresnel reflection
  float f0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
  float cosTheta = clamp(dot(V, N), 0.0, 1.0);
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);

  // Subtle caustic ripple brightness
  float caustic = pow(clamp(dhdx * dhdx + dhdy * dhdy, 0.0, 1.0), 1.5) * 0.35;

  vec3 finalColor = fluidFluid * (0.85 + NdotL * 0.25) + vec3(spec + fresnel * 0.4 + caustic);
  outColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
}`

export function fluidUniforms(params: FluidSimulationParams) {
  const viewModeMap = {
    'fluid-composite': 0,
    'dye-only': 1,
    velocity: 2,
    pressure: 3,
    'normal-map': 4,
    'refraction-only': 5,
  }

  const c1 = parseColorToRgb(params.dyeColors[0] ?? '#080808')
  const c2 = parseColorToRgb(params.dyeColors[1] ?? '#222222')
  const c3 = parseColorToRgb(params.dyeColors[2] ?? '#516b94')
  const c4 = parseColorToRgb(params.dyeColors[3] ?? '#81adec')

  return {
    u_refractionIndex: params.refractionIndex,
    u_dispersion: params.dispersion,
    u_surfaceTension: params.surfaceTension,
    u_normalPerturbation: params.normalPerturbation,
    u_specularStrength: params.specularStrength,
    u_lightAngle: params.lightAngle,
    u_viewMode: viewModeMap[params.viewMode] ?? 0,
    u_colorDye1: [c1.r, c1.g, c1.b],
    u_colorDye2: [c2.r, c2.g, c2.b],
    u_colorDye3: [c3.r, c3.g, c3.b],
    u_colorDye4: [c4.r, c4.g, c4.b],
  }
}
