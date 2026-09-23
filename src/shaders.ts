// GLSL snippets for the watercolor look.

export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`;

// Shared "paint" lighting: cool violet shadows, warm paper highlights, soft banding
// and darker pigment pooling where the bands meet.
export const PAINT = /* glsl */ `
uniform vec3 uLightDir;
const vec3 PAPER = vec3(0.965, 0.937, 0.878);
vec3 paint(vec3 base, vec3 n, vec2 p, float bandNoise) {
  float diffuse = dot(normalize(n), normalize(uLightDir));
  float tone = smoothstep(-0.35, 1.0, diffuse);
  float b = tone * 4.0 + (bandNoise - 0.5) * 0.9;
  float band = floor(b) / 4.0;
  float edge = smoothstep(0.82, 1.0, fract(b));
  tone = mix(tone, band + 0.12, 0.45);
  vec3 shadow = base * vec3(0.58, 0.60, 0.86);
  vec3 col = mix(shadow, base, smoothstep(0.0, 0.75, tone));
  col = mix(col, mix(base, PAPER, 0.55), smoothstep(0.72, 1.05, tone));
  col *= 1.0 - edge * 0.07;
  return col;
}
`;

export const TERRAIN_VERT = /* glsl */ `
attribute float aDepth;
attribute float aEle;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying float vDepth;
varying float vEle;
void main() {
  vUv = uv;
  vDepth = aDepth;
  vEle = aEle;
  vNormal = normal;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const TERRAIN_FRAG = /* glsl */ `
uniform sampler2D uMask;   // r: water, g: distance from shore, b: inside basin
uniform float uFocus;      // 0..1: fade the scene back while a trail is selected
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUv;
varying float vDepth;
varying float vEle;
${NOISE}
${PAINT}

void main() {
  vec2 p = vWorld.xz;
  vec3 n = normalize(vNormal);
  float slope = 1.0 - n.y;
  float e = vEle;
  vec4 mask = texture2D(uMask, vUv);

  float wash = fbm(p * 0.035);         // big, loose washes
  float mid = fbm(p * 0.22 + 4.0);     // mid-scale patches
  float grain = vnoise(p * 9.0);       // pigment granulation

  // --- land palette
  vec3 meadow = vec3(0.80, 0.81, 0.52);
  vec3 forest = vec3(0.45, 0.60, 0.38);
  vec3 deepForest = vec3(0.26, 0.43, 0.35);
  vec3 granite = vec3(0.84, 0.79, 0.70);
  vec3 rock = vec3(0.70, 0.62, 0.63);
  vec3 snow = vec3(0.98, 0.97, 0.95);
  vec3 sage = vec3(0.66, 0.68, 0.50);

  float treeline = 2750.0 + (wash - 0.5) * 300.0;
  vec3 col = mix(forest, deepForest, smoothstep(0.35, 0.75, mid));
  // Drier, sagebrush-y east side at lower elevations
  col = mix(col, sage, smoothstep(0.52, 0.7, vUv.x + (wash - 0.5) * 0.3) * smoothstep(2500.0, 2100.0, e) * 0.7);
  // Meadows on flat, low ground
  float flat_ = smoothstep(0.035, 0.008, slope) * smoothstep(2500.0, 2000.0, e);
  col = mix(col, meadow, flat_ * smoothstep(0.35, 0.6, mid + 0.15));
  // Granite slabs: steep ground and exposed patches up high (hello, Desolation)
  float granitePatch = smoothstep(0.55, 0.72, mid + (e - 2350.0) / 1400.0 + slope * 0.9);
  col = mix(col, granite, granitePatch);
  float alpine = smoothstep(treeline - 80.0, treeline + 120.0, e);
  col = mix(col, mix(granite, rock, smoothstep(0.4, 0.7, wash)), alpine);
  col = mix(col, snow, smoothstep(3080.0, 3250.0, e + (mid - 0.5) * 200.0) * 0.8);

  col = paint(col, n, p, mid);

  // --- water
  float water = smoothstep(0.35, 0.65, mask.r);
  float depthF = clamp(max(sqrt(vDepth / 480.0), mask.g * 1.1), 0.0, 1.0);
  vec3 shallow = vec3(0.55, 0.83, 0.80);
  vec3 deep = vec3(0.22, 0.43, 0.68);
  vec3 lake = mix(shallow, deep, smoothstep(0.0, 0.85, depthF + (wash - 0.5) * 0.25));
  float ripple = fbm(vec2(p.x * 0.08, p.y * 0.35) + wash);
  lake *= 0.88 + 0.24 * ripple;
  lake = mix(lake, PAPER, smoothstep(0.62, 0.9, fbm(p * 0.05 + 9.0)) * 0.35);
  // Paper-white halo on the shore, with a darker pigment line just inside it
  float shoreLine = 1.0 - smoothstep(0.0, 0.18, abs(mask.r - 0.55));
  float halo = smoothstep(0.1, 0.35, mask.r) * (1.0 - smoothstep(0.35, 0.6, mask.r));
  col = mix(col, lake, water);
  col = mix(col, PAPER, halo * 0.5);
  col *= 1.0 - shoreLine * 0.18;

  // granulation + wash variation
  col *= 1.0 - (grain - 0.5) * 0.1;
  col *= 0.94 + 0.12 * wash;

  // Outside the basin: fade to a pale, unfinished wash
  float basin = mask.b;
  vec3 faded = mix(PAPER, col, 0.32) * vec3(0.99, 0.98, 0.97);
  col = mix(faded, col, basin);

  col = mix(col, mix(PAPER, col, 0.55), uFocus * 0.7);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SIDE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
varying float vTop;
attribute float aTop;
void main() {
  vNormal = normal;
  vTop = aTop;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const SIDE_FRAG = /* glsl */ `
uniform float uBase;
uniform float uFocus;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vTop;
${NOISE}
${PAINT}
void main() {
  float along = vWorld.x + vWorld.z;
  float depth = (vTop - vWorld.y);
  float t = vWorld.y + (fbm(vec2(along * 0.08, vWorld.y * 0.3)) - 0.5) * 3.0;
  // soil & rock strata
  vec3 c1 = vec3(0.62, 0.47, 0.34);
  vec3 c2 = vec3(0.74, 0.60, 0.43);
  vec3 c3 = vec3(0.52, 0.44, 0.44);
  float s = fract(t * 0.11);
  vec3 col = mix(c1, c2, smoothstep(0.2, 0.5, s));
  col = mix(col, c3, smoothstep(0.65, 0.9, s));
  // a thin grassy lip right below the surface
  col = mix(vec3(0.46, 0.55, 0.36), col, smoothstep(0.1, 0.9, depth));
  col = paint(col, vNormal, vWorld.xz, fbm(vec2(along, vWorld.y) * 0.2));
  col *= 0.95 + 0.1 * vnoise(vec2(along, vWorld.y) * 3.0);
  // fade toward paper at the bottom, like a wash running out of pigment
  float fade = smoothstep(uBase + 4.0, uBase, vWorld.y + (fbm(vec2(along * 0.1, 0.0)) - 0.5) * 3.0);
  col = mix(col, vec3(0.965, 0.937, 0.878), fade * 0.85);
  col = mix(col, mix(vec3(0.965, 0.937, 0.878), col, 0.55), uFocus * 0.7);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const TREE_VERT = /* glsl */ `
attribute vec3 aOffset;
attribute float aScale;
attribute float aTint;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vTint;
varying float vH;
void main() {
  vTint = aTint;
  vH = position.y;
  vNormal = normal;
  vec3 pos = position * aScale + aOffset;
  vWorld = pos;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

export const TREE_FRAG = /* glsl */ `
uniform float uFocus;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vTint;
varying float vH;
${NOISE}
${PAINT}
void main() {
  vec3 a = vec3(0.24, 0.45, 0.33);
  vec3 b = vec3(0.40, 0.58, 0.32);
  vec3 col = mix(a, b, vTint);
  col = paint(col, vNormal, vWorld.xz, vTint);
  col = mix(col, col * 0.75, smoothstep(0.3, 0.0, vH));
  col = mix(col, mix(vec3(0.965, 0.937, 0.878), col, 0.55), uFocus * 0.7);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Full-screen pass: wobbly edges, pigment pooling at color boundaries, paper texture.
export const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const POST_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uResolution;
uniform float uPixelRatio;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 px = 1.0 / uResolution;
  vec2 sp = vUv * uResolution / uPixelRatio;
  // hand-painted wobble
  vec2 wob = vec2(vnoise(sp * 0.035), vnoise(sp * 0.035 + 31.7)) - 0.5;
  wob += (vec2(vnoise(sp * 0.2), vnoise(sp * 0.2 + 7.3)) - 0.5) * 0.4;
  vec2 uv = vUv + wob * px * 3.0 * uPixelRatio;
  vec3 c = texture2D(tColor, uv).rgb;

  // pigment pools along edges between washes
  float r = 1.5 * uPixelRatio;
  vec3 cx = texture2D(tColor, uv + vec2(px.x * r, 0.0)).rgb - texture2D(tColor, uv - vec2(px.x * r, 0.0)).rgb;
  vec3 cy = texture2D(tColor, uv + vec2(0.0, px.y * r)).rgb - texture2D(tColor, uv - vec2(0.0, px.y * r)).rgb;
  float edge = length(cx) + length(cy);
  c *= 1.0 - smoothstep(0.08, 0.5, edge) * 0.16;

  // cold-press paper: soft blotches + fine tooth + a few fibers
  float blot = fbm(sp * 0.006);
  float tooth = vnoise(sp * 0.9) * 0.6 + vnoise(sp * 0.35) * 0.4;
  float fiber = smoothstep(0.93, 1.0, vnoise(vec2(sp.x * 0.05, sp.y * 1.2) + blot * 4.0));
  c *= 0.955 + 0.07 * blot;
  c *= 1.0 - (tooth - 0.5) * 0.07;
  c *= 1.0 - fiber * 0.025;

  // vignette into the paper
  vec2 q = vUv - 0.5;
  float vig = smoothstep(0.35, 0.85, length(q * vec2(1.0, 0.85)));
  c = mix(c, c * vec3(0.93, 0.89, 0.82), vig * 0.6);
  gl_FragColor = vec4(c, 1.0);
}
`;
