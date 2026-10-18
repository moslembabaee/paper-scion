/**
 * GPU Fragment Shader for Paper Multi-Stop Gradient Engine.
 * Supports Linear, Radial, and Angular (conic) multi-stop color evaluation,
 * focal length shift, spread scaling, hermite curve smoothing, and anti-banding dithering.
 */
export const gradientFragmentShader = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform float u_animated;

// 0.0 = linear, 1.0 = radial, 2.0 = angular (conic)
uniform float u_gradientType;
uniform float u_stopCount;
uniform float u_stopOffsets[16];
uniform vec4 u_stopColors[16];

uniform float u_angle;          // Radians
uniform vec2 u_origin;          // Normalized element space [0, 1]
uniform float u_focalLength;    // Focal offset / distance
uniform float u_spread;         // Spread / scale factor
uniform float u_dither;         // Anti-banding dither intensity
uniform float u_smoothness;     // 0 = linear, 1 = smoothstep hermite

out vec4 fragColor;

// High-frequency pseudo-random hash for anti-banding triangular dither
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // Screen space UV (top-left 0,0 to bottom-right 1,1)
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y);
  float aspect = u_resolution.x / max(1.0, u_resolution.y);

  // Gentle time-based drift when animated
  float timeDrift = u_animated > 0.5 ? sin(u_time * 0.001 * max(0.1, u_speed)) * 0.03 : 0.0;

  float t = 0.0;

  if (u_gradientType < 0.5) {
    // ------------------- LINEAR GRADIENT -------------------
    vec2 dir = vec2(cos(u_angle), sin(u_angle));
    vec2 p = uv - u_origin;
    // Aspect-adjusted projection so angle aligns with geometric canvas coordinates
    p.y /= max(0.001, aspect);
    float spreadHalf = max(0.001, u_spread * 0.5);
    float proj = dot(p, dir) / spreadHalf;
    t = proj * 0.5 + 0.5 + timeDrift;
  } else if (u_gradientType < 1.5) {
    // ------------------- RADIAL GRADIENT -------------------
    // Focal point shifted along angle by focalLength
    vec2 focalDir = vec2(cos(u_angle), sin(u_angle));
    vec2 focal = u_origin + focalDir * (u_focalLength * 0.25);
    vec2 delta = uv - focal;
    delta.y /= max(0.001, aspect);
    float r = max(0.001, u_spread * 0.5);
    t = (length(delta) / r) + timeDrift;
  } else {
    // ------------------- ANGULAR (CONIC) GRADIENT -------------------
    vec2 p = uv - u_origin;
    p.y /= max(0.001, aspect);
    float theta = atan(p.y, p.x) - u_angle;
    float twoPi = 6.283185307179586;
    theta = mod(theta, twoPi);
    if (theta < 0.0) theta += twoPi;
    float norm = theta / twoPi;
    t = (norm / max(0.01, u_spread)) + timeDrift;
  }

  t = clamp(t, 0.0, 1.0);

  // Multi-stop color interpolation
  int count = int(clamp(u_stopCount, 2.0, 16.0));
  vec4 color = u_stopColors[0];

  if (t <= u_stopOffsets[0]) {
    color = u_stopColors[0];
  } else if (t >= u_stopOffsets[count - 1]) {
    color = u_stopColors[count - 1];
  } else {
    for (int i = 0; i < 15; i++) {
      if (i >= count - 1) break;
      float o0 = u_stopOffsets[i];
      float o1 = u_stopOffsets[i + 1];
      if (t >= o0 && t <= o1) {
        float f = (t - o0) / max(0.00001, o1 - o0);
        if (u_smoothness > 0.0) {
          float hermite = f * f * (3.0 - 2.0 * f);
          f = mix(f, hermite, u_smoothness);
        }
        color = mix(u_stopColors[i], u_stopColors[i + 1], f);
        break;
      }
    }
  }

  // High-craft triangular noise dither to eliminate 8-bit color banding
  if (u_dither > 0.0) {
    float noise1 = hash(gl_FragCoord.xy);
    float noise2 = hash(gl_FragCoord.yx + vec2(19.3, 47.7));
    float ditherVal = (noise1 + noise2 - 1.0) * (1.0 / 255.0) * u_dither;
    color.rgb = clamp(color.rgb + vec3(ditherVal), 0.0, 1.0);
  }

  fragColor = color;
}
`
