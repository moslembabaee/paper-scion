import type { VectorExtrusionParams } from './types.ts'

export const extrusionVertexShader = `#version 300 es
precision highp float;
out vec2 v_uv;

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const extrusionFragmentShader = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_shapeTexture;
uniform int u_hasShapeTexture;
uniform int u_shapeType; // 0 = rect, 1 = ellipse, 2 = path/text
uniform vec4 u_shapeBounds; // x, y, width, height (normalized or relative)
uniform float u_cornerRadius;

uniform vec2 u_resolution;
uniform float u_extrusionDepth;
uniform float u_bevelDepth;
uniform float u_bevelWidth;
uniform int u_bevelProfile; // 0 = linear, 1 = curved, 2 = convex, 3 = concave, 4 = stepped
uniform int u_bevelSegments;

uniform float u_lightAzimuth; // degrees 0..360
uniform float u_lightElevation; // degrees 5..90
uniform float u_lightDistance;
uniform float u_lightIntensity;
uniform vec3 u_lightColor;

uniform float u_ambientOcclusion;
uniform float u_aoRadius;
uniform float u_shadowSoftness;
uniform float u_shadowLength;
uniform float u_shadowOpacity;

uniform float u_roughness;
uniform float u_metallic;
uniform vec3 u_baseColor;
uniform vec3 u_sideColor;
uniform float u_specularIntensity;
uniform float u_normalMapStrength;
uniform int u_viewMode; // 0 = shaded, 1 = normal-map, 2 = depth, 3 = ao, 4 = lighting-only

#define PI 3.14159265359

// Analytical signed distance functions for fundamental geometric shapes
float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdEllipse(vec2 p, vec2 r) {
  float k1 = length(p / r);
  float k2 = length(p / (r * r));
  return (k1 - 1.0) * (k1 / max(0.0001, k2));
}

// Distance estimation: returns positive distance inside shape, negative outside
float sampleDistanceField(vec2 uv) {
  if (u_hasShapeTexture == 1) {
    // Texture stores normalized distance in R channel, mask in G channel
    vec4 tex = texture(u_shapeTexture, uv);
    float distNorm = tex.r;
    float mask = tex.g;
    if (mask < 0.5) {
      return -((1.0 - mask) * 10.0);
    }
    // Scale normalized distance by shape dimension in pixels
    float dim = min(u_resolution.x, u_resolution.y);
    return distNorm * (dim * 0.5);
  }

  // Analytical fallbacks centered at (0.5, 0.5)
  vec2 p = (uv - vec2(0.5)) * u_resolution;
  vec2 halfSize = (u_resolution * 0.4);

  if (u_shapeType == 1) { // Ellipse
    float d = sdEllipse(p, halfSize);
    return -d;
  }

  // Default Rounded Rectangle
  float radius = min(min(halfSize.x, halfSize.y), max(2.0, u_cornerRadius));
  float d = sdRoundedBox(p, halfSize, radius);
  return -d;
}

// Evaluate bevel profile curve
float evaluateBevel(float t, int profile, int segments) {
  t = clamp(t, 0.0, 1.0);
  if (profile == 0) {
    // Linear chamfer
    return t;
  } else if (profile == 1) {
    // Curved quarter-circle fillet
    return sin(t * (PI * 0.5));
  } else if (profile == 2) {
    // Convex dome
    return 1.0 - pow(1.0 - t, 2.2);
  } else if (profile == 3) {
    // Concave scooped fillet
    return pow(t, 2.2);
  } else if (profile == 4) {
    // Stepped architectural terrace
    float segs = max(2.0, float(segments));
    return floor(t * segs + 0.05) / segs;
  }
  return t;
}

// Heightfield evaluation at a given UV coordinate
float sampleHeight(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return 0.0;
  }

  float dist = sampleDistanceField(uv);
  if (dist <= 0.0) {
    return 0.0;
  }

  float bWidth = max(1.0, u_bevelWidth);
  if (dist < bWidth) {
    float t = dist / bWidth;
    float bevelProfileVal = evaluateBevel(t, u_bevelProfile, u_bevelSegments);
    return u_extrusionDepth + bevelProfileVal * u_bevelDepth;
  }

  return u_extrusionDepth + u_bevelDepth;
}

// Compute normal map via finite difference gradient of the 3D extrusion heightfield
vec3 calculateNormal(vec2 uv, float h, out float curvature) {
  vec2 eps = vec2(1.5) / u_resolution;
  float hL = sampleHeight(uv - vec2(eps.x, 0.0));
  float hR = sampleHeight(uv + vec2(eps.x, 0.0));
  float hD = sampleHeight(uv - vec2(0.0, eps.y));
  float hU = sampleHeight(uv + vec2(0.0, eps.y));

  float dhdx = (hR - hL) / (2.0 * eps.x * u_resolution.x);
  float dhdy = (hU - hD) / (2.0 * eps.y * u_resolution.y);

  // Surface curvature estimation
  float laplacian = abs((hR + hL + hU + hD) - 4.0 * h);
  curvature = clamp(laplacian * 0.15, 0.0, 1.0);

  float strength = max(0.01, u_normalMapStrength) * 0.8;
  return normalize(vec3(-dhdx * strength, -dhdy * strength, 1.0));
}

// Raymarched directional shadow across heightfield
float calculateShadow(vec2 uv, float currentHeight, vec3 L) {
  if (u_shadowOpacity <= 0.001 || L.z <= 0.001) return 1.0;

  // Cast ray backwards towards light direction
  vec2 rayDir = normalize(L.xy);
  float tanElev = tan(radians(max(5.0, u_lightElevation)));
  float totalH = max(1.0, u_extrusionDepth + u_bevelDepth);
  float maxRayDist = (totalH * u_shadowLength * 2.5) / (min(u_resolution.x, u_resolution.y) * tanElev);
  maxRayDist = min(maxRayDist, 0.6);

  int steps = 16;
  float stepSize = maxRayDist / float(steps);
  float shadow = 1.0;

  for (int i = 1; i <= 16; i++) {
    float t = float(i) * stepSize;
    vec2 sampleUv = uv - rayDir * t;
    if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) break;

    float blockerH = sampleHeight(sampleUv);
    float rayH = currentHeight + t * min(u_resolution.x, u_resolution.y) * tanElev;

    if (blockerH > rayH) {
      float diff = (blockerH - rayH) / totalH;
      float penumbra = clamp(diff * (1.0 / max(0.05, u_shadowSoftness)), 0.0, 1.0);
      shadow = min(shadow, 1.0 - penumbra * u_shadowOpacity);
    }
  }

  return clamp(shadow, 0.0, 1.0);
}

// Multi-sample disk ambient occlusion
float calculateAO(vec2 uv, float currentHeight) {
  if (u_ambientOcclusion <= 0.001) return 1.0;

  float totalH = max(1.0, u_extrusionDepth + u_bevelDepth);
  float radius = (u_aoRadius * 2.5) / min(u_resolution.x, u_resolution.y);
  float occlusion = 0.0;
  float totalWeight = 0.0;
  float goldenAngle = 2.39996323;

  for (int i = 1; i <= 12; i++) {
    float fi = float(i);
    float r = sqrt(fi / 12.0) * radius;
    float theta = fi * goldenAngle;
    vec2 offset = vec2(cos(theta), sin(theta)) * r;
    vec2 sampleUv = uv + offset;

    float neighborH = sampleHeight(sampleUv);
    float diff = max(0.0, neighborH - currentHeight);
    float weight = 1.0 - (r / max(0.001, radius));
    occlusion += (diff / totalH) * weight;
    totalWeight += weight;
  }

  occlusion = (occlusion / max(0.0001, totalWeight)) * u_ambientOcclusion * 3.5;
  return clamp(1.0 - occlusion, 0.0, 1.0);
}

void main() {
  vec2 uv = v_uv;
  float dist = sampleDistanceField(uv);
  float h = sampleHeight(uv);
  float totalH = max(1.0, u_extrusionDepth + u_bevelDepth);

  // Directional Light Vector
  float azRad = radians(u_lightAzimuth);
  float elRad = radians(u_lightElevation);
  vec3 L = normalize(vec3(cos(azRad) * cos(elRad), -sin(azRad) * cos(elRad), sin(elRad)));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);

  float curvature = 0.0;
  vec3 N = calculateNormal(uv, h, curvature);

  // Surface lighting calculations
  float NdotL = max(0.0, dot(N, L));
  float NdotH = max(0.0, dot(N, H));
  float NdotV = max(0.0, dot(N, V));

  // Material specular response (Cook-Torrance / Blinn-Phong hybrid)
  float shininess = mix(140.0, 6.0, u_roughness);
  float specFactor = pow(NdotH, shininess) * (1.0 - u_roughness * 0.65) * u_specularIntensity;

  // Fresnel rim enhancement for tactile 3D depth
  float fresnel = pow(1.0 - NdotV, 4.0) * (0.2 + 0.8 * u_metallic);

  // Shadow and AO
  float shadow = calculateShadow(uv, h, L);
  float ao = calculateAO(uv, h);

  // Diagnostic View Modes
  if (u_viewMode == 1) { // Normal map
    outColor = vec4(N * 0.5 + 0.5, 1.0);
    return;
  } else if (u_viewMode == 2) { // Depth
    float depthNorm = clamp(h / totalH, 0.0, 1.0);
    outColor = vec4(vec3(depthNorm), 1.0);
    return;
  } else if (u_viewMode == 3) { // Ambient occlusion
    outColor = vec4(vec3(ao), 1.0);
    return;
  } else if (u_viewMode == 4) { // Lighting only
    vec3 lightOnly = vec3(NdotL * shadow + specFactor * shadow);
    outColor = vec4(lightOnly, 1.0);
    return;
  }

  // Full Shaded Composite
  // Top face vs bevel/side wall color blending based on surface slope
  float slope = clamp(1.0 - N.z, 0.0, 1.0);
  vec3 albedo = mix(u_baseColor, u_sideColor, slope * 0.85);

  vec3 diffuse = albedo * u_lightColor * (NdotL * u_lightIntensity + 0.18);
  vec3 specularColor = mix(vec3(1.0), albedo, u_metallic) * u_lightColor;
  vec3 specular = specularColor * (specFactor + fresnel * 0.35);

  vec3 litSurface = (diffuse * shadow + specular * shadow) * ao;

  // Outside shape: cast shadow on plane, else transparent / plane ground
  if (dist <= 0.0) {
    if (shadow < 0.999) {
      // Cast drop shadow on background plane
      float shadowDarkness = (1.0 - shadow) * u_shadowOpacity;
      vec3 groundColor = mix(vec3(1.0), vec3(0.04), shadowDarkness);
      outColor = vec4(groundColor * (0.95 + ao * 0.05), shadowDarkness);
    } else {
      outColor = vec4(0.0);
    }
    return;
  }

  outColor = vec4(clamp(litSurface, 0.0, 1.0), 1.0);
}
`

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '')
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255
    const g = parseInt(clean[1] + clean[1], 16) / 255
    const b = parseInt(clean[2] + clean[2], 16) / 255
    return [r, g, b]
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return [r, g, b]
}

export function extrusionUniforms(
  params: VectorExtrusionParams,
  width: number,
  height: number,
  hasShapeTexture = false,
  shapeType = 0,
  cornerRadius = 0
): Record<string, unknown> {
  const profileMap: Record<string, number> = {
    linear: 0,
    curved: 1,
    convex: 2,
    concave: 3,
    stepped: 4,
  }
  const viewModeMap: Record<string, number> = {
    shaded: 0,
    'normal-map': 1,
    depth: 2,
    'ambient-occlusion': 3,
    'lighting-only': 4,
  }

  const [baseR, baseG, baseB] = hexToRgb(params.baseColor)
  const [sideR, sideG, sideB] = hexToRgb(params.sideColor)
  const [lightR, lightG, lightB] = hexToRgb(params.lightColor)

  return {
    u_resolution: [width, height],
    u_hasShapeTexture: hasShapeTexture ? 1 : 0,
    u_shapeType: shapeType,
    u_cornerRadius: cornerRadius,
    u_extrusionDepth: params.extrusionDepth,
    u_bevelDepth: params.bevelDepth,
    u_bevelWidth: params.bevelWidth,
    u_bevelProfile: profileMap[params.bevelProfile] ?? 1,
    u_bevelSegments: params.bevelSegments,
    u_lightAzimuth: params.lightAzimuth,
    u_lightElevation: params.lightElevation,
    u_lightDistance: params.lightDistance,
    u_lightIntensity: params.lightIntensity,
    u_lightColor: [lightR, lightG, lightB],
    u_ambientOcclusion: params.ambientOcclusion,
    u_aoRadius: params.aoRadius,
    u_shadowSoftness: params.shadowSoftness,
    u_shadowLength: params.shadowLength,
    u_shadowOpacity: params.shadowOpacity,
    u_roughness: params.roughness,
    u_metallic: params.metallic,
    u_baseColor: [baseR, baseG, baseB],
    u_sideColor: [sideR, sideG, sideB],
    u_specularIntensity: params.specularIntensity,
    u_normalMapStrength: params.normalMapStrength,
    u_viewMode: viewModeMap[params.viewMode] ?? 0,
  }
}
