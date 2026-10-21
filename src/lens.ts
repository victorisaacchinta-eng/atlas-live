import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { HOLO } from './hologram';

/**
 * Lenses re-render the whole world through a different sensor, after the scene is drawn.
 * 0 none · 1 thermal (ironbow) · 2 night vision (green phosphor) · 3 riso (two-ink halftone print).
 * Hologram is not a lens here: it swaps the tiles' materials (see earth.ts), so it can light edges.
 */
export type Lens = 'photo' | 'hologram' | 'thermal' | 'night' | 'riso';
export const LENSES: { id: Lens; label: string; key: string }[] = [
  { id: 'photo', label: 'Photo', key: '1' },
  { id: 'hologram', label: 'Hologram', key: '2' },
  { id: 'thermal', label: 'Thermal', key: '3' },
  { id: 'night', label: 'Night', key: '4' },
  { id: 'riso', label: 'Riso', key: '5' },
];
const MODE: Record<Lens, number> = { photo: 0, hologram: 0, thermal: 1, night: 2, riso: 3 };

const frag = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform int uMode;
  uniform float uTime;
  uniform float uMotion;
  uniform vec2 uRes;
  uniform vec3 uPaper;
  uniform vec3 uInkA;
  uniform vec3 uInkB;
  varying vec2 vUv;

  vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
  vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 tap(vec2 uv) { return toSrgb(texture2D(tDiffuse, uv).rgb); }

  // Ironbow: black, indigo, magenta, red, orange, yellow, near-white.
  vec3 ironbow(float t) {
    vec3 c0 = vec3(0.0), c1 = vec3(0.13, 0.0, 0.42), c2 = vec3(0.55, 0.0, 0.56);
    vec3 c3 = vec3(0.89, 0.19, 0.12), c4 = vec3(1.0, 0.62, 0.0), c5 = vec3(1.0, 0.95, 0.6);
    t = clamp(t, 0.0, 1.0) * 5.0;
    if (t < 1.0) return mix(c0, c1, t);
    if (t < 2.0) return mix(c1, c2, t - 1.0);
    if (t < 3.0) return mix(c2, c3, t - 2.0);
    if (t < 4.0) return mix(c3, c4, t - 3.0);
    return mix(c4, c5, t - 4.0);
  }

  // One halftone screen: a dot grid rotated by a, dot size grows with coverage.
  float screen(vec2 px, float a, float cell, float cover) {
    mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 p = r * px / cell;
    vec2 f = fract(p) - 0.5;
    float d = length(f);
    float rad = sqrt(clamp(cover, 0.0, 1.0)) * 0.62;
    return 1.0 - smoothstep(rad - 0.06, rad + 0.06, d);
  }

  void main() {
    vec3 src = tap(vUv);
    if (uMode == 0) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
    vec2 px = vUv * uRes;
    vec2 texel = 1.0 / uRes;
    float vig = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.6);
    vec3 col;

    if (uMode == 1) {
      // Thermal imagers are soft: average a small cross, then lift local contrast.
      vec3 s = src * 0.4 + (tap(vUv + vec2(texel.x * 1.5, 0.0)) + tap(vUv - vec2(texel.x * 1.5, 0.0)) + tap(vUv + vec2(0.0, texel.y * 1.5)) + tap(vUv - vec2(0.0, texel.y * 1.5))) * 0.15;
      float l = luma(s);
      // Sunlit roofs and paving read hot, vegetation and water read cold.
      float green = max(0.0, s.g - max(s.r, s.b));
      float heat = l * 1.15 - green * 1.6 + 0.04;
      col = ironbow(pow(clamp(heat, 0.0, 1.0), 1.15));
      col += (hash(px + floor(uTime * 12.0) * uMotion) - 0.5) * 0.03;
      col *= mix(0.75, 1.0, vig);
    } else if (uMode == 2) {
      float l = luma(src);
      float bloom = luma(tap(vUv + texel * 2.0) + tap(vUv - texel * 2.0)) * 0.5;
      float g = pow(clamp(l * 1.6 + bloom * 0.35, 0.0, 1.0), 0.8);
      float grain = (hash(px * 0.5 + floor(uTime * 24.0) * uMotion) - 0.5) * 0.16;
      float scan = 0.94 + 0.06 * sin(px.y * 1.6);
      col = vec3(0.12, 1.0, 0.35) * (g + grain) * scan;
      col *= mix(0.25, 1.0, vig);
    } else {
      // Riso: cream paper, a blue screen for the shadows, a fluoro pink screen for warm light,
      // printed slightly out of register like a real two-drum print.
      float l = luma(src);
      float warm = clamp((src.r - src.b) * 1.8 + 0.15, 0.0, 1.0);
      float blue = screen(px + vec2(1.2, -0.8), 0.26, 6.0, pow(1.0 - l, 1.2));
      float pink = screen(px, 1.31, 6.0, warm * (0.35 + l * 0.65));
      col = uPaper;
      col = mix(col, col * uInkA, blue);
      col = mix(col, col * uInkB, pink * 0.85);
      col += (hash(px) - 0.5) * 0.04;
    }
    gl_FragColor = vec4(toLin(col), 1.0);
  }
`;

export function lensPass() {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uMode: { value: 0 },
      uTime: { value: 0 },
      uMotion: { value: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uPaper: { value: HOLO.bone.clone().convertLinearToSRGB() },
      uInkA: { value: HOLO.ground.clone().convertLinearToSRGB() },
      uInkB: { value: HOLO.signal.clone().convertLinearToSRGB() },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: frag,
  });
  pass.enabled = false;
  return {
    pass,
    set(lens: Lens) {
      pass.uniforms.uMode.value = MODE[lens];
      pass.enabled = MODE[lens] !== 0;
    },
    tick(t: number) { pass.uniforms.uTime.value = t; },
    resize(w: number, h: number) { pass.uniforms.uRes.value.set(w, h); },
  };
}
