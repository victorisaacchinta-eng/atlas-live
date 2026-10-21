import * as THREE from 'three';
import { theme } from './theme';

/** Every hologram surface draws from the active theme: ground, ink, and one accent. */
export const HOLO = {
  bone: new THREE.Color(theme.ink),
  signal: new THREE.Color(theme.accent),
  ground: new THREE.Color(theme.ground),
};

const vertexShader = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mv = viewMatrix * world;
    vViewDir = normalize(-mv.xyz);
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHotColor;
  uniform vec3 uGround;
  uniform float uHot;
  uniform float uDim;
  uniform float uTime;
  uniform float uScan;
  uniform float uReveal;
  uniform float uRim;
  uniform float uFill;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec3 vWorld;
  void main() {
    // Reveal sweep: the model prints in from the base upwards when it loads.
    if (vWorld.y > uReveal) discard;
    vec3 n = normalize(vNormalV);
    if (!gl_FrontFacing) n = -n;
    float facing = abs(dot(n, vViewDir));
    // Cap the rim so big surfaces seen edge-on read as a line, not a slab of light.
    float rim = min(pow(1.0 - facing, 3.0), 0.5);
    float lines = smoothstep(0.94, 1.0, 0.5 + 0.5 * sin(vWorld.y * uScan - uTime * 1.6));
    float front = smoothstep(0.05, 0.0, uReveal - vWorld.y);
    vec3 tint = mix(uColor, uHotColor, uHot);
    // Scan lines only on surfaces seen at an angle, so flat decks don't flash.
    float glow = (rim * uRim + lines * 0.08 * (1.0 - facing) + uFill + facing * 0.03 + uHot * 0.35) * (1.0 - uDim * 0.75);
    vec3 col = mix(uGround, tint, clamp(glow + front, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function holoSurface(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: HOLO.bone.clone() },
      uHotColor: { value: HOLO.signal.clone() },
      uGround: { value: HOLO.ground.clone() },
      uRim: { value: theme.glow ? 0.62 : 0.42 },
      uFill: { value: theme.glow ? 0.035 : 0.1 },
      uHot: { value: 0 },
      uDim: { value: 0 },
      uTime: { value: 0 },
      uScan: { value: 90 },
      uReveal: { value: 10 },
    },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function holoEdges(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: HOLO.bone.clone(),
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
}

/** The projector pad the hologram stands on: rings, ticks and a slow sweep. */
export function projectorPad(radius = 1.55): THREE.Group {
  const pad = new THREE.Group();
  const mat = (o: number, c = HOLO.bone) =>
    new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = (r: number, o: number, seg = 128) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat(o));
  };
  pad.add(ring(radius, 0.5), ring(radius * 0.97, 0.18), ring(radius * 0.62, 0.12), ring(radius * 1.08, 0.08));
  const ticks: THREE.Vector3[] = [];
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const long = i % 10 === 0;
    const r0 = radius * (long ? 1.0 : 1.0);
    const r1 = radius * (long ? 1.06 : 1.025);
    ticks.push(new THREE.Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0), new THREE.Vector3(Math.cos(a) * r1, 0, Math.sin(a) * r1));
  }
  pad.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), mat(0.35)));
  const sweepPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(radius, 0, 0)];
  const sweep = new THREE.Line(new THREE.BufferGeometry().setFromPoints(sweepPts), mat(0.6, HOLO.signal));
  sweep.name = 'sweep';
  pad.add(sweep);
  return pad;
}

/** Faint drifting dust so the volume reads as a volume. */
export function dust(count = 900, spread = 7): THREE.Points {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    p[i * 3] = (Math.random() - 0.5) * spread;
    p[i * 3 + 1] = Math.random() * spread * 0.6 - 0.6;
    p[i * 3 + 2] = (Math.random() - 0.5) * spread;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return new THREE.Points(
    g,
    new THREE.PointsMaterial({ color: HOLO.bone, size: 0.012, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
}
