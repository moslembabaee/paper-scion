export const vertexShader = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const header = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_source;
uniform sampler2D u_aux;
uniform vec2 u_resolution;
uniform vec4 u_params;
uniform vec4 u_extra;
uniform vec4 u_params2;
uniform vec4 u_params3;
uniform vec3 u_color;
uniform vec3 u_color2;
uniform float u_time;
uniform float u_opacity;
uniform int u_blend;
vec3 blend(vec3 a, vec3 b) {
  if (u_blend == 1) return 1.0 - (1.0-a)*(1.0-b);
  if (u_blend == 2) return a*b;
  if (u_blend == 3) return mix(2.0*a*b, 1.0-2.0*(1.0-a)*(1.0-b), step(vec3(.5),a));
  return b;
}
vec3 straight(vec4 c) { return c.a > .00001 ? c.rgb/c.a : vec3(0.0); }
void finish(vec4 src, vec3 effect) {
  // All intermediate textures use premultiplied alpha; grade in straight RGB.
  outColor = vec4(mix(straight(src), blend(straight(src), effect), u_opacity)*src.a, src.a);
}
`

export const fragments = {
  copy: `${header}void main() { outColor = texture(u_source, v_uv); }`,
  threshold: `${header}void main() {
    vec4 src = texture(u_source, v_uv);
    float l = dot(straight(src), vec3(.2126,.7152,.0722));
    float knee = max(.0001, u_params.y);
    float soft = clamp(l-u_params.x+knee, 0.0, 2.0*knee);
    float weight = max(l-u_params.x, soft*soft/(4.0*knee))/max(l,.0001);
    outColor = vec4(src.rgb*weight,src.a);
  }`,
  blur: `${header}void main() {
    vec2 d = u_params.xy/u_resolution;
    vec4 c = texture(u_source,v_uv)*.227027;
    c += (texture(u_source,v_uv+d*1.384615)+texture(u_source,v_uv-d*1.384615))*.316216;
    c += (texture(u_source,v_uv+d*3.230769)+texture(u_source,v_uv-d*3.230769))*.070270;
    outColor = c;
  }`,
  bloom: `${header}void main() {
    vec4 src = texture(u_source,v_uv);
    vec3 glow = texture(u_aux,v_uv).rgb*u_params.x;
    // Screen is the optical default; other blend modes remain explicit.
    vec3 effect = u_blend == 1 ? glow : straight(src)+glow;
    finish(src,effect);
  }`,
  'chromatic-aberration': `${header}void main() {
    vec4 src = texture(u_source,v_uv);
    vec2 direction = u_params.z > .5 ? (v_uv-.5)*2.0 : vec2(cos(u_params.w),sin(u_params.w));
    vec2 offset = direction*u_params.x*(1.0+u_params.y*3.0)*8.0/u_resolution;
    vec4 r = texture(u_source,clamp(v_uv+offset,vec2(0.0),vec2(1.0)));
    vec4 b = texture(u_source,clamp(v_uv-offset,vec2(0.0),vec2(1.0)));
    finish(src,vec3(straight(r).r,straight(src).g,straight(b).b));
  }`,
  'film-grain': `${header}
  float noise(vec2 p, float seed) { return fract(sin(dot(p,vec2(127.1,311.7))+seed*74.7)*43758.5453); }
  void main() {
    vec4 src=texture(u_source,v_uv);
    vec2 p=floor(v_uv*u_resolution/u_params.y);
    float t = u_extra.x > .5 ? floor(u_time*u_params.z*60.0) : 0.0;
    vec3 n=vec3(noise(p,t));
    if (u_extra.y < .5) n=vec3(n.r,noise(p,t+17.0),noise(p,t+41.0));
    vec3 effect=clamp(straight(src)+(n-.5)*u_params.x,0.0,1.0);
    if(u_blend == 3) effect=.5+(n-.5)*u_params.x;
    finish(src,effect);
  }`,
  vignette: `${header}void main() {
    vec4 src=texture(u_source,v_uv);
    vec2 p=(v_uv-.5)*2.0;
    p.x*=mix(1.0,u_resolution.x/u_resolution.y,u_params.w);
    float edge=smoothstep(u_params.y, u_params.y+max(.001,u_params.z),length(p));
    vec3 effect=mix(straight(src),u_color,edge*u_params.x);
    if(u_blend == 2) effect=mix(vec3(1.0),u_color,edge*u_params.x);
    finish(src,effect);
  }`,
  'color-grade': `${header}void main() {
    vec4 src=texture(u_source,v_uv);
    vec3 c=straight(src)*exp2(u_params.w);
    c=(c-.5)*u_params.x+.5+u_params.y;
    c=mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c,u_params.z)*u_color;
    finish(src,clamp(c,0.0,1.0));
  }`,
  'frosted-glass': `${header}
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
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i); float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0)); float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise2D(p);
      p = p * 2.02 + vec2(1.4, 3.2);
      a *= 0.5;
    }
    return v;
  }
  float worley2D(vec2 p) {
    vec2 n = floor(p); vec2 f = fract(p);
    float f1 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash22(n + g);
        vec2 delta = g + o - f;
        f1 = min(f1, dot(delta, delta));
      }
    }
    return clamp(sqrt(f1), 0.0, 1.0);
  }
  float sampleHeight(vec2 coord, float t) {
    vec2 sp = coord * max(0.1, u_extra.y);
    float pat = u_extra.z;
    float h = 0.0;
    if (pat < 0.5) {
      float d = clamp(length(coord) * 1.4, 0.0, 1.0);
      h = sqrt(max(0.0, 1.0 - d * d * 0.9));
    } else if (pat < 1.5) {
      h = fbm(sp * 4.0 + vec2(t * 0.05)) * 0.8;
      h += (noise2D(sp * 16.0) - 0.5) * 0.25;
    } else if (pat < 2.5) {
      float rib = sin(sp.x * 6.2831853);
      float sub = sin(sp.x * 12.56637) * 0.2;
      h = rib * 0.8 + sub;
    } else if (pat < 3.5) {
      float r1 = sin(length(sp - vec2(0.2)) * 8.0 - t * 1.5);
      float r2 = cos(sp.y * 6.0 + sp.x * 4.0 + t * 1.2);
      h = (r1 + r2) * 0.35;
    } else {
      float w1 = worley2D(sp * 2.5);
      float w2 = worley2D(sp * 5.0 + vec2(1.2, -0.8));
      h = (1.0 - w1) * 0.7 + (1.0 - w2) * 0.3;
    }
    float microRough = (noise2D(coord * 40.0 + vec2(t * 0.02)) - 0.5) * u_params.z * 0.3;
    return h * (0.35 + u_extra.x * 0.65) + microRough;
  }
  void main() {
    vec4 src = texture(u_source, v_uv);
    vec2 p = (v_uv - 0.5) * (u_resolution / min(u_resolution.x, u_resolution.y));
    float eps = 2.0 / min(u_resolution.x, u_resolution.y);
    float hL = sampleHeight(p - vec2(eps, 0.0), u_time);
    float hR = sampleHeight(p + vec2(eps, 0.0), u_time);
    float hD = sampleHeight(p - vec2(0.0, eps), u_time);
    float hU = sampleHeight(p + vec2(0.0, eps), u_time);
    float dhdx = (hR - hL) / (2.0 * eps);
    float dhdy = (hU - hD) / (2.0 * eps);
    float bump = 1.6 * (1.0 + u_extra.x * 2.2);
    vec3 N = normalize(vec3(-dhdx * bump, -dhdy * bump, 1.0));
    vec3 V = vec3(0.0, 0.0, 1.0);
    float ior = max(1.0, u_params.x);
    float disp = u_params.y * 0.04;
    float iorR = ior - disp;
    float iorG = ior;
    float iorB = ior + disp;
    vec3 refrR = refract(-V, N, 1.0 / iorR);
    vec3 refrG = refract(-V, N, 1.0 / iorG);
    vec3 refrB = refract(-V, N, 1.0 / iorB);
    vec3 refl = reflect(-V, N);
    if (length(refrR) < 0.01) refrR = refl;
    if (length(refrG) < 0.01) refrG = refl;
    if (length(refrB) < 0.01) refrB = refl;
    float refrScale = (ior - 1.0) * 0.25;
    vec2 offR = refrR.xy * refrScale;
    vec2 offG = refrG.xy * refrScale;
    vec2 offB = refrB.xy * refrScale;
    float blurRadius = (u_params.w * 0.04 + u_params.z * 0.045);
    vec3 accum = vec3(0.0);
    float totWeight = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float angle = fi * 2.39996323;
      float r = sqrt((fi + 1.0) / 12.0) * blurRadius;
      vec2 tap = vec2(cos(angle), sin(angle)) * r;
      float w = exp(-2.0 * (r / max(0.001, blurRadius)) * (r / max(0.001, blurRadius)));
      vec4 sR = texture(u_source, clamp(v_uv + offR + tap, vec2(0.0), vec2(1.0)));
      vec4 sG = texture(u_source, clamp(v_uv + offG + tap, vec2(0.0), vec2(1.0)));
      vec4 sB = texture(u_source, clamp(v_uv + offB + tap, vec2(0.0), vec2(1.0)));
      accum += vec3(straight(sR).r, straight(sG).g, straight(sB).b) * w;
      totWeight += w;
    }
    vec3 refractedCol = accum / max(0.0001, totWeight);
    float pathLen = 1.0 + length(refrG.xy) * 2.0;
    vec3 absorp = exp(-((vec3(1.0) - u_color) * u_params2.x * pathLen * 1.5));
    vec3 glassCol = mix(refractedCol * absorp, u_color, u_params2.x * 0.4);
    float f0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
    float cosTheta = clamp(dot(V, N), 0.0, 1.0);
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
    float bevel = pow(1.0 - cosTheta, 3.5) * u_extra.w * 1.2;
    vec3 L = normalize(vec3(cos(u_params2.z), sin(u_params2.z), 0.7));
    vec3 H = normalize(L + V);
    float specPower = mix(48.0, 8.0, u_params.z);
    float spec = pow(max(dot(N, H), 0.0), specPower) * u_params2.y;
    vec3 litGlass = glassCol * (1.0 - fresnel * 0.5) + vec3(fresnel * 0.35 + bevel) + vec3(spec);
    float dither = (hash12(gl_FragCoord.xy) - 0.5) * (0.015 + u_params.z * 0.02);
    finish(src, clamp(litGlass + vec3(dither), 0.0, 1.0));
  }`,
  'procedural-grain': `${header}
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec2 hash22(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453123);
  }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  float pnoise(vec2 P) {
    vec2 Pi = floor(P); vec2 Pf = fract(P);
    Pi = mod289(Pi);
    vec2 w = Pf * Pf * Pf * (Pf * (Pf * 6.0 - 15.0) + 10.0);
    float n00 = hash12(Pi);
    float n10 = hash12(Pi + vec2(1.0, 0.0));
    float n01 = hash12(Pi + vec2(0.0, 1.0));
    float n11 = hash12(Pi + vec2(1.0, 1.0));
    return mix(mix(n00, n10, w.x), mix(n01, n11, w.x), w.y) * 2.0 - 1.0;
  }
  float wnoise(vec2 p) {
    vec2 n = floor(p); vec2 f = fract(p);
    float f1 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash22(n + g);
        vec2 delta = g + o - f;
        f1 = min(f1, dot(delta, delta));
      }
    }
    return clamp(sqrt(f1), 0.0, 1.0) * 2.0 - 1.0;
  }
  float sampleGenerator(vec2 p, float t, float genType, int octaves, float freq, float turb) {
    float total = 0.0; float maxAmp = 0.0; float amp = 1.0; float f = freq;
    for (int o = 0; o < 6; o++) {
      if (o >= octaves) break;
      vec2 coord = p * f + vec2(t * 0.07, t * 0.05);
      float n = 0.0;
      if (genType < 0.5) n = snoise(coord);
      else if (genType < 1.5) n = pnoise(coord);
      else if (genType < 2.5) n = wnoise(coord);
      else n = (hash12(coord) - 0.5) * 2.0;
      if (turb > 0.0) n = mix(n, abs(n) * 2.0 - 1.0, turb);
      total += n * amp;
      maxAmp += amp;
      amp *= 0.5;
      f *= 2.02;
    }
    return maxAmp > 0.0 ? total / maxAmp : 0.0;
  }
  void main() {
    vec4 src = texture(u_source, v_uv);
    vec2 p = (v_uv * u_resolution) / max(0.5, u_params.y);
    float t = u_extra.x > 0.5 ? u_time * u_params.z * 10.0 : 0.0;
    int octaves = int(clamp(u_params2.x, 1.0, 6.0));
    float genType = u_extra.z;
    float freq = max(0.1, u_params.w);
    float turb = u_extra.w;
    vec3 grain;
    if (u_extra.y > 0.5) {
      float n = sampleGenerator(p, t, genType, octaves, freq, turb);
      grain = vec3(n * 0.5 + 0.5);
    } else {
      float nr = sampleGenerator(p, t, genType, octaves, freq, turb);
      float ng = sampleGenerator(p + vec2(17.3, 31.7), t + 1.6, genType, octaves, freq, turb);
      float nb = sampleGenerator(p + vec2(43.1, 71.9), t + 3.2, genType, octaves, freq, turb);
      grain = vec3(nr * 0.5 + 0.5, ng * 0.5 + 0.5, nb * 0.5 + 0.5);
    }
    vec3 effect;
    if (u_blend == 3) {
      effect = 0.5 + (grain - 0.5) * u_params.x;
    } else {
      effect = clamp(straight(src) + (grain - 0.5) * u_params.x, 0.0, 1.0);
    }
    finish(src, effect);
  }`,
  'ambient-occlusion': `${header}
  float getLuminance(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }
  void main() {
    vec4 src = texture(u_source, v_uv);
    float centerLum = getLuminance(straight(src));
    float radius = u_params.y / min(u_resolution.x, u_resolution.y);
    float bias = u_params.z;
    float power = max(0.1, u_params.w);
    float intensity = u_params.x;

    float occlusion = 0.0;
    float totalWeight = 0.0;
    const int SAMPLES = 16;
    float goldenAngle = 2.39996323;

    for (int i = 1; i <= SAMPLES; i++) {
      float fi = float(i);
      float r = sqrt(fi / float(SAMPLES)) * radius;
      float theta = fi * goldenAngle;
      vec2 offset = vec2(cos(theta), sin(theta)) * r;
      vec2 sampleUv = clamp(v_uv + offset, vec2(0.0), vec2(1.0));

      vec4 s = texture(u_source, sampleUv);
      float sampleLum = getLuminance(straight(s));

      // Crevice / shadow gradient comparison
      float diff = centerLum - sampleLum;
      if (diff > bias) {
        float weight = 1.0 - (r / max(0.001, radius));
        occlusion += (diff - bias) * weight;
        totalWeight += weight;
      }
    }

    float aoFactor = totalWeight > 0.0 ? clamp(occlusion / totalWeight, 0.0, 1.0) : 0.0;
    aoFactor = pow(aoFactor, power) * intensity * 2.5;
    aoFactor = clamp(aoFactor, 0.0, 1.0);

    vec3 occluded = mix(straight(src), u_color, aoFactor);
    finish(src, occluded);
  }`,
} as const
