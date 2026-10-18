/** Authored for Paper's ShaderMount. GPU fragment shader accelerated 2D mesh gradient and procedural color field synthesizer. */
export const meshFragmentShader = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
// ShaderMount uploads JavaScript numbers with uniform1f, including enum values.
uniform float u_count;
uniform vec4 u_colors[10];
uniform vec4 u_anchors[10]; // x, y, radius, alpha
uniform vec3 u_anchorTangents[10]; // tx, ty, tension
uniform float u_interpolation; // 0.0 = bicubic spline, 1.0 = gaussian-rbf, 2.0 = catmull-rom
uniform float u_warpModulation;
uniform float u_noiseType; // 0.0 = simplex, 1.0 = perlin, 2.0 = worley
uniform float u_lacunarity;
uniform float u_octaves;
uniform float u_normalPerturbation;
uniform float u_grainDisplacement;
uniform float u_fluidAdvection;
uniform float u_fluidViscosity;
uniform float u_distortionMode; // 0.0 = curl-fluid, 1.0 = domain-warp, 2.0 = turbulent-swirl, 3.0 = simplex-flow
uniform float u_viewMode; // 0.0 = shaded, 1.0 = normal-map, 2.0 = displacement
uniform float u_turbulence, u_frequency, u_chromatic, u_distortion, u_swirl;
uniform float u_grainMixer, u_grainOverlay, u_scale, u_rotation;
uniform float u_grainBlend;
uniform vec2 u_offset;
// Grid mesh topology uniforms
uniform float u_gridMode; // 0.0 = freeform (default), 1.0 = grid topology
uniform float u_gridRows;
uniform float u_gridCols;
uniform float u_gridSmoothing;
uniform vec4 u_gridColors[64];
uniform vec3 u_gridTangents[64]; // tx, ty, tension
out vec4 fragColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}

// 2D Simplex Noise
float simplexNoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
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

// 2D Perlin Noise
float perlinNoise(vec2 P) {
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

// 2D Worley Cellular Noise
float worleyNoise(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n + g);
      vec2 delta = g + o - f;
      float d = dot(delta, delta);
      f1 = min(f1, d);
    }
  }
  return clamp(sqrt(f1), 0.0, 1.0);
}

// Multi-octave Procedural Noise Generator
float sampleMultiOctave(vec2 p, float t) {
  float total = 0.0;
  float maxAmp = 0.0;
  float amp = 1.0;
  float freq = max(0.5, u_frequency);
  float lacunarity = u_lacunarity > 0.0 ? u_lacunarity : 2.0;
  int octaves = int(clamp(u_octaves > 0.0 ? u_octaves : 3.0, 1.0, 6.0));

  for (int o = 0; o < 6; o++) {
    if (o >= octaves) break;
    vec2 coord = p * freq + vec2(t * 0.08, t * 0.05);
    float n = 0.0;
    if (u_noiseType < 0.5) {
      n = simplexNoise(coord);
    } else if (u_noiseType < 1.5) {
      n = perlinNoise(coord);
    } else {
      n = worleyNoise(coord) * 2.0 - 1.0;
    }

    if (u_turbulence > 0.0) {
      float turb = abs(n) * 2.0 - 1.0;
      n = mix(n, turb, u_turbulence);
    }

    total += n * amp;
    maxAmp += amp;
    amp *= 0.5;
    freq *= lacunarity;
  }

  return maxAmp > 0.0 ? total / maxAmp : 0.0;
}

// Incompressible 2D Curl-Noise formulation: nabla x psi
vec2 curlNoise(vec2 p, float t) {
  const float e = 0.005;
  float n1 = sampleMultiOctave(p + vec2(0.0, e), t);
  float n2 = sampleMultiOctave(p - vec2(0.0, e), t);
  float n3 = sampleMultiOctave(p + vec2(e, 0.0), t);
  float n4 = sampleMultiOctave(p - vec2(e, 0.0), t);
  float dy = (n1 - n2) / (2.0 * e);
  float dx = (n3 - n4) / (2.0 * e);
  return vec2(dy, -dx);
}

// NxM Grid Bicubic Patch Evaluator with per-vertex tangent, curve tension, and alpha control
vec4 gridField(vec2 uv) {
  int rows = int(u_gridRows);
  int cols = int(u_gridCols);
  if (rows < 2 || cols < 2) return u_gridColors[0];

  float uPos = clamp(uv.x, 0.0, 1.0) * float(cols - 1);
  float vPos = clamp(uv.y, 0.0, 1.0) * float(rows - 1);

  int colIdx = min(int(floor(uPos)), cols - 2);
  int rowIdx = min(int(floor(vPos)), rows - 2);

  float s = uPos - float(colIdx);
  float t = vPos - float(rowIdx);

  // Bicubic Hermite smoothstep with tangent-modulated control
  float ss = s * s * (3.0 - 2.0 * s);
  float st = t * t * (3.0 - 2.0 * t);

  float blendS = mix(s, ss, u_gridSmoothing);
  float blendT = mix(t, st, u_gridSmoothing);

  // Per-vertex tangent and curve tension
  int i00 = rowIdx * cols + colIdx;
  int i10 = rowIdx * cols + colIdx + 1;
  int i01 = (rowIdx + 1) * cols + colIdx;
  int i11 = (rowIdx + 1) * cols + colIdx + 1;

  vec3 t00 = u_gridTangents[i00];
  vec3 t10 = u_gridTangents[i10];
  vec3 t01 = u_gridTangents[i01];
  vec3 t11 = u_gridTangents[i11];

  // Tangent and curve tension weighted displacement
  float tangentS = blendS + (t00.x * t00.z * (1.0 - blendS) + t10.x * t10.z * blendS) * 0.18;
  float tangentT = blendT + (t00.y * t00.z * (1.0 - blendT) + t01.y * t01.z * blendT) * 0.18;
  tangentS = clamp(tangentS, 0.0, 1.0);
  tangentT = clamp(tangentT, 0.0, 1.0);

  vec4 c00 = u_gridColors[i00];
  vec4 c10 = u_gridColors[i10];
  vec4 c01 = u_gridColors[i01];
  vec4 c11 = u_gridColors[i11];

  // Premultiplied alpha blending across the bicubic patch
  vec4 p00 = vec4(c00.rgb * c00.a, c00.a);
  vec4 p10 = vec4(c10.rgb * c10.a, c10.a);
  vec4 p01 = vec4(c01.rgb * c01.a, c01.a);
  vec4 p11 = vec4(c11.rgb * c11.a, c11.a);

  vec4 top = mix(p00, p10, tangentS);
  vec4 bot = mix(p01, p11, tangentS);
  vec4 result = mix(top, bot, tangentT);
  return result.a > 0.0001 ? vec4(result.rgb / result.a, result.a) : vec4(0.0);
}

// 2D Bicubic / Spline / RBF Color Field Evaluator with per-vertex tangent and alpha anchors
vec4 field(vec2 uv) {
  if (u_gridMode > 0.5) return gridField(uv);

  vec4 color = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 10; i++) {
    if (float(i) >= u_count) break;
    vec2 anchorPos = u_anchors[i].xy;
    float r = max(0.05, u_anchors[i].z);
    float vertexAlpha = clamp(u_anchors[i].w, 0.0, 1.0);
    vec3 tangentData = u_anchorTangents[i]; // tx, ty, tension
    vec2 tangentOffset = tangentData.xy * tangentData.z * 0.18;

    vec2 delta = uv - (anchorPos + tangentOffset);
    float weight = 0.0;

    if (u_interpolation < 0.5) {
      // Smooth Bicubic Spline Hermite Tensor Interpolation with curve tension
      vec2 t = clamp(abs(delta) / r, 0.0, 1.0);
      vec2 h = (vec2(1.0) - t) * (vec2(1.0) - t) * (vec2(1.0) + vec2(2.0) * t);
      float rad = clamp(length(delta) / r, 0.0, 1.0);
      float hRad = (1.0 - rad) * (1.0 - rad) * (1.0 + 2.0 * rad);
      weight = (h.x * h.y * 0.7 + hRad * 0.3) + 0.00001;
    } else if (u_interpolation < 1.5) {
      // Gaussian RBF Inverse-Distance Field
      weight = exp(-dot(delta, delta) * 8.0 / (r * r)) + 0.00001;
    } else {
      // Catmull-Rom Cubic Spline Interpolation with tension falloff
      vec2 t = clamp(abs(delta) / r, 0.0, 1.0);
      vec2 cr = max(vec2(0.0), vec2(1.0) - 2.5 * t * t + 1.5 * t * t * t);
      weight = cr.x * cr.y + 0.00001;
    }

    float effAlpha = u_colors[i].a * vertexAlpha;
    color += vec4(u_colors[i].rgb * effAlpha, effAlpha) * weight;
    total += weight;
  }
  return total > 0.0 ? vec4(color.rgb / max(0.0001, color.a), color.a / total) : vec4(0.5, 0.68, 0.93, 1.0);
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y);
  vec2 p = uv - 0.5 - u_offset;
  float c = cos(u_rotation), s = sin(u_rotation);
  p = mat2(c, -s, s, c) * p / max(0.01, u_scale);

  // Warp distortion modulation & swirl
  float warpMod = clamp(u_warpModulation, 0.0, 1.0);
  float swirlAngle = (u_swirl * (1.0 + warpMod * 0.6)) * 3.0 * exp(-dot(p, p) * 3.0);
  p = mat2(cos(swirlAngle), -sin(swirlAngle), sin(swirlAngle), cos(swirlAngle)) * p;

  float t = u_time * 0.18;
  float turbulence = u_turbulence + u_distortion * 0.3;

  // Fluid dynamics, advection & multi-octave domain warping
  float advection = clamp(u_fluidAdvection, 0.0, 1.0);
  float viscosityDamp = 1.0 - clamp(u_fluidViscosity, 0.0, 1.0) * 0.7;

  if (advection > 0.0 || turbulence > 0.0 || warpMod > 0.0) {
    if (u_distortionMode < 0.5) {
      // Incompressible curl-noise fluid advection
      vec2 curl = curlNoise(p * 1.2 + vec2(t * 0.15, t * 0.12), t);
      p += curl * advection * viscosityDamp * (1.0 + turbulence * 1.5) * 0.35;
    } else if (u_distortionMode < 1.5) {
      // Multi-octave nested domain warping flow
      vec2 flow1 = vec2(sampleMultiOctave(p + vec2(t, 0.0), t),
                        sampleMultiOctave(p + vec2(7.3, t * 1.15), t));
      vec2 flow2 = vec2(sampleMultiOctave(p * 1.5 + flow1 * (1.0 + warpMod * 2.0) + vec2(3.1, t * 0.8), t),
                        sampleMultiOctave(p * 1.5 + flow1 * (1.0 + warpMod * 2.0) + vec2(9.4, t * 0.9), t));
      vec2 blendedFlow = mix(flow1, flow2, warpMod);
      p += blendedFlow * (turbulence + warpMod * 0.35) * viscosityDamp * 0.4;
    } else if (u_distortionMode < 2.5) {
      // Turbulent vortex swirl flow
      float distToCenter = length(p);
      float swirlF = sin(distToCenter * 6.0 - t * 2.0) * exp(-distToCenter * 2.0);
      vec2 rotVec = vec2(-p.y, p.x) * swirlF * (1.0 + warpMod * 1.5);
      vec2 turbFlow = vec2(sampleMultiOctave(p + rotVec, t), sampleMultiOctave(p.yx + rotVec, t));
      p += (rotVec * 0.4 + turbFlow * 0.25) * (turbulence + advection) * viscosityDamp;
    } else {
      // Simplex directional flow
      float angle = sampleMultiOctave(p * 1.5, t) * 6.2831853;
      vec2 dirFlow = vec2(cos(angle), sin(angle));
      p += dirFlow * (turbulence + warpMod * 0.4 + advection * 0.3) * viscosityDamp * 0.3;
    }
  }

  // High-frequency grain dithering & displacement
  float grain = hash(gl_FragCoord.xy);
  float disp = (grain - 0.5) * (u_grainMixer * 0.08 + u_grainDisplacement * 0.06);
  p += disp;
  p += 0.5;

  // Chromatic aberration pass
  vec2 shift = (uv - 0.5) * u_chromatic * 0.08;
  vec4 base = field(p);
  vec3 color = base.rgb / max(base.a, 0.0001);

  if (u_chromatic > 0.0) {
    vec4 red = field(p + shift), blue = field(p - shift);
    color = vec3(red.r / max(red.a, 0.0001), color.g, blue.b / max(blue.a, 0.0001));
  }

  // Normal-map surface perturbation pass & multi-octave displacement
  float eps = 0.004;
  float nL = sampleMultiOctave((p - vec2(eps, 0.0)) * 2.0, t) * (0.5 + u_grainDisplacement * 0.8);
  float nR = sampleMultiOctave((p + vec2(eps, 0.0)) * 2.0, t) * (0.5 + u_grainDisplacement * 0.8);
  float nD = sampleMultiOctave((p - vec2(0.0, eps)) * 2.0, t) * (0.5 + u_grainDisplacement * 0.8);
  float nU = sampleMultiOctave((p + vec2(0.0, eps)) * 2.0, t) * (0.5 + u_grainDisplacement * 0.8);

  vec4 fL = field(p - vec2(eps, 0.0));
  vec4 fR = field(p + vec2(eps, 0.0));
  vec4 fD = field(p - vec2(0.0, eps));
  vec4 fU = field(p + vec2(0.0, eps));

  float lumL = dot(fL.rgb, vec3(0.299, 0.587, 0.114)) * 0.35 + nL * 0.65;
  float lumR = dot(fR.rgb, vec3(0.299, 0.587, 0.114)) * 0.35 + nR * 0.65;
  float lumD = dot(fD.rgb, vec3(0.299, 0.587, 0.114)) * 0.35 + nD * 0.65;
  float lumU = dot(fU.rgb, vec3(0.299, 0.587, 0.114)) * 0.35 + nU * 0.65;

  float dhdx = (lumR - lumL) / (2.0 * eps);
  float dhdy = (lumU - lumD) / (2.0 * eps);
  float bumpStrength = max(0.08, u_normalPerturbation) * 5.5;
  vec3 nPerturb = normalize(vec3(-dhdx * bumpStrength,
                                 -dhdy * bumpStrength,
                                 1.0));

  // Mode 1: Tangent Space Normal Map [0, 1]
  if (u_viewMode > 0.5 && u_viewMode < 1.5) {
    fragColor = vec4(nPerturb * 0.5 + 0.5, base.a);
    return;
  }

  // Mode 2: Height / Displacement Map
  if (u_viewMode > 1.5) {
    float hCenter = dot(base.rgb, vec3(0.299, 0.587, 0.114)) * 0.35 + sampleMultiOctave(p * 2.0, t) * (0.5 + u_grainDisplacement * 0.8) * 0.65;
    float hNorm = clamp(hCenter * 0.5 + 0.5, 0.0, 1.0);
    fragColor = vec4(vec3(hNorm), base.a);
    return;
  }

  // Mode 0: Shaded Surface Material with Directional Lighting & Specular Relief
  if (u_normalPerturbation > 0.0) {
    vec3 lightDir = normalize(vec3(0.5, 0.5, 0.75));
    vec3 halfDir = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    float diff = max(dot(nPerturb, lightDir), 0.0) * 0.6 + 0.4;
    float spec = pow(max(dot(nPerturb, halfDir), 0.0), 16.0) * u_normalPerturbation * 0.35;
    color = clamp(color * diff + vec3(spec), 0.0, 1.0);
  }

  // Noise blending controls
  vec3 textureColor;
  if (u_grainBlend == 2.0) {
    textureColor = color * grain; // multiply
  } else if (u_grainBlend == 3.0) {
    textureColor = 1.0 - (1.0 - color) * (1.0 - grain); // screen
  } else if (u_grainBlend == 1.0) {
    textureColor = color - (1.0 - 2.0 * grain) * color * (1.0 - color); // soft-light
  } else if (u_grainBlend == 4.0) {
    textureColor = min(vec3(1.0), color + grain * 0.7); // linear-dodge (add)
  } else if (u_grainBlend == 5.0) {
    textureColor = min(vec3(1.0), color / max(vec3(0.001), 1.0 - grain * 0.6)); // color-dodge
  } else {
    // overlay (mode 0)
    textureColor = mix(2.0 * color * grain, 1.0 - 2.0 * (1.0 - color) * (1.0 - grain), step(vec3(0.5), color));
  }

  color = mix(color, textureColor, u_grainOverlay);
  fragColor = vec4(clamp(color, 0.0, 1.0) * base.a, base.a);
}
`
