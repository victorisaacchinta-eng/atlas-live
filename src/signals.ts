import * as THREE from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { HOLO } from './hologram';

/**
 * Live signals drawn on the photoreal globe: one point cloud per layer, positioned in the tiles'
 * own Earth-centred frame so they sit on the real coordinates however the globe is turned.
 * Points keep a constant size on screen, hide behind the horizon, and lift off the ground in
 * proportion to the camera's height so terrain never swallows them. Fresh items pulse.
 */

export type LayerId = 'quakes' | 'events';

export interface Signal {
  id: string; layer: LayerId; kind: string; title: string; lat: number; lon: number; time: string;
  mag?: number; magUnit?: string; depthKm?: number; alert?: string | null; tsunami?: boolean; url: string;
}

export interface LayerData {
  layer: LayerId; name: string; source: string; sourceUrl: string; license: string;
  updated: string; fetchedAt: string; signals: Signal[];
}

export type LayerStatus = 'off' | 'loading' | 'ok' | 'failed';

interface LayerState {
  id: LayerId;
  on: boolean;
  status: LayerStatus;
  error?: string;
  data?: LayerData;
  points?: THREE.Points;
  ecef: THREE.Vector3[];
}

const vert = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aFresh;
  uniform vec3 uCam;
  uniform float uLift;
  uniform float uTime;
  uniform float uPixel;
  uniform float uMotion;
  varying vec3 vColor;
  varying float vFresh;
  varying float vPulse;
  void main() {
    vec3 up = normalize(position);
    vec3 p = position + up * uLift;
    // Behind the planet: collapse the point.
    float facing = dot(up, normalize(uCam - p));
    vColor = aColor;
    vFresh = aFresh;
    vPulse = fract(uTime * 0.45 + position.x * 1e-6) * uMotion;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = facing < -0.02 ? 0.0 : aSize * uPixel * (1.0 + aFresh * 1.4);
  }
`;

const frag = /* glsl */ `
  varying vec3 vColor;
  varying float vFresh;
  varying float vPulse;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    // Fresh items get a ring that expands outward; every point has a solid core and a dark rim.
    float scale = 1.0 + vFresh * 1.4;
    float core = 1.0 - smoothstep(0.62 / scale, 0.7 / scale, r);
    float rim = smoothstep(0.62 / scale, 0.7 / scale, r) * (1.0 - smoothstep(0.82 / scale, 0.9 / scale, r));
    float ring = vFresh * (1.0 - smoothstep(0.0, 0.08, abs(r - (0.45 + vPulse * 0.55)))) * (1.0 - vPulse);
    vec3 col = mix(vec3(0.05, 0.06, 0.16), vColor, core);
    float a = max(core + rim * 0.85, ring * 0.9);
    if (a < 0.02) discard;
    gl_FragColor = vec4(core > 0.01 ? col : vColor, a);
  }
`;

const KIND_COLOR: Record<string, THREE.Color> = {
  earthquake: new THREE.Color('#EF4444'),
  wildfire: new THREE.Color('#F59E0B'),
  storm: new THREE.Color('#38BDF8'),
  ice: new THREE.Color('#9FD8FF'),
  volcano: new THREE.Color('#FB7185'),
};

export class SignalLayers {
  readonly group = new THREE.Group();
  private layers = new Map<LayerId, LayerState>();
  private material: THREE.ShaderMaterial;
  private tiles: () => TilesRenderer | null;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private selected: THREE.Mesh;
  private selectedAt: THREE.Vector3 | null = null;
  onChange: (() => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, tiles: () => TilesRenderer | null, reducedMotion: boolean) {
    this.camera = camera;
    this.renderer = renderer;
    this.tiles = tiles;
    this.group.matrixAutoUpdate = false;
    this.group.renderOrder = 20;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, depthTest: true,
      uniforms: { uCam: { value: new THREE.Vector3() }, uLift: { value: 0 }, uTime: { value: 0 }, uPixel: { value: 1 }, uMotion: { value: reducedMotion ? 0 : 1 } },
    });
    // The selected signal: a thin ring that stays on top.
    const ring = new THREE.RingGeometry(0.8, 1, 48);
    this.selected = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: HOLO.signal.clone(), transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
    this.selected.visible = false;
    this.selected.renderOrder = 30;
    for (const id of ['quakes', 'events'] as LayerId[]) this.layers.set(id, { id, on: false, status: 'off', ecef: [] });
  }

  state(id: LayerId) { return this.layers.get(id)!; }
  get active() { return [...this.layers.values()].filter((l) => l.on).map((l) => l.id); }

  async set(id: LayerId, on: boolean) {
    const l = this.layers.get(id)!;
    l.on = on;
    if (l.points) l.points.visible = on;
    if (on && (!l.data || Date.now() - Date.parse(l.data.fetchedAt) > 5 * 60e3)) await this.load(id);
    this.onChange?.();
  }

  async load(id: LayerId) {
    const l = this.layers.get(id)!;
    l.status = 'loading';
    l.error = undefined;
    this.onChange?.();
    try {
      const r = await fetch(`/api/signals?layer=${id}`);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      l.data = j as LayerData;
      l.status = 'ok';
      this.build(l);
    } catch (err) {
      l.status = 'failed';
      l.error = err instanceof Error ? err.message : String(err);
    }
    this.onChange?.();
  }

  private build(l: LayerState) {
    if (l.points) { this.group.remove(l.points); l.points.geometry.dispose(); l.points = undefined; }
    const tiles = this.tiles();
    if (!tiles || !l.data) return;
    const n = l.data.signals.length;
    const pos = new Float32Array(n * 3), size = new Float32Array(n), color = new Float32Array(n * 3), fresh = new Float32Array(n);
    const v = new THREE.Vector3();
    const now = Date.now();
    l.ecef = [];
    l.data.signals.forEach((s, i) => {
      tiles.ellipsoid.getCartographicToPosition(s.lat * THREE.MathUtils.DEG2RAD, s.lon * THREE.MathUtils.DEG2RAD, 0, v);
      l.ecef.push(v.clone());
      pos.set([v.x, v.y, v.z], i * 3);
      // Earthquakes scale with magnitude (each step is ~32x the energy; on screen, a gentle step).
      size[i] = s.layer === 'quakes' ? 5 + Math.max(0, (s.mag ?? 2.5) - 2.5) * 3.4 : s.kind === 'storm' ? 12 : 7;
      const c = KIND_COLOR[s.kind] || KIND_COLOR.storm;
      color.set([c.r, c.g, c.b], i * 3);
      fresh[i] = s.layer === 'quakes' && now - Date.parse(s.time) < 24 * 3600e3 ? 1 : 0;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aFresh', new THREE.BufferAttribute(fresh, 1));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, this.material);
    pts.frustumCulled = false;
    pts.visible = l.on;
    pts.renderOrder = 20;
    l.points = pts;
    this.group.add(pts);
    if (!this.selected.parent) this.group.add(this.selected);
  }

  /** Rebuild after the globe restarted (positions live in the tiles' frame). */
  rebuild() { for (const l of this.layers.values()) if (l.data) this.build(l); }

  /** Keep the layer in the globe's frame and update screen-space uniforms. Call every frame. */
  update(t: number) {
    const tiles = this.tiles();
    this.group.visible = !!tiles;
    if (!tiles) return;
    this.group.matrix.copy(tiles.group.matrix);
    this.group.updateMatrixWorld(true);
    const inv = this.group.matrixWorld.clone().invert();
    const camLocal = this.camera.position.clone().applyMatrix4(inv);
    const u = this.material.uniforms;
    u.uCam.value.copy(camLocal);
    const h = Math.max(1, camLocal.length() - 6.37e6);
    u.uLift.value = THREE.MathUtils.clamp(h * 0.004, 30, 40000);
    u.uTime.value = t;
    u.uPixel.value = this.renderer.getPixelRatio();
    if (this.selectedAt && this.selected.visible) {
      const up = this.selectedAt.clone().normalize();
      this.selected.position.copy(this.selectedAt).addScaledVector(up, u.uLift.value);
      this.selected.lookAt(camLocal);
      const d = camLocal.distanceTo(this.selected.position);
      this.selected.scale.setScalar(d * 0.022);
    }
  }

  /** The signal nearest a screen point (CSS pixels), within `radius` pixels and on the visible side. */
  pick(x: number, y: number, radius = 16): Signal | null {
    const el = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    const camLocal = this.material.uniforms.uCam.value as THREE.Vector3;
    let best: Signal | null = null, bestD = radius;
    for (const l of this.layers.values()) {
      if (!l.on || !l.data) continue;
      l.ecef.forEach((p, i) => {
        const up = p.clone().normalize();
        if (up.dot(camLocal.clone().sub(p).normalize()) < 0) return;
        v.copy(p).applyMatrix4(this.group.matrixWorld).project(this.camera);
        if (v.z > 1) return;
        const sx = el.left + (v.x * 0.5 + 0.5) * el.width, sy = el.top + (-v.y * 0.5 + 0.5) * el.height;
        const d = Math.hypot(sx - x, sy - y);
        if (d < bestD) { bestD = d; best = l.data!.signals[i]; }
      });
    }
    return best;
  }

  select(s: Signal | null) {
    this.selected.visible = !!s;
    this.selectedAt = null;
    if (!s) return;
    const l = this.layers.get(s.layer);
    const i = l?.data?.signals.findIndex((x) => x.id === s.id) ?? -1;
    if (l && i >= 0) this.selectedAt = l.ecef[i];
  }

  /** Where a signal is on screen (CSS pixels), or null when it is behind the planet. */
  screenPos(s: Signal): { x: number; y: number } | null {
    const l = this.layers.get(s.layer);
    const i = l?.data?.signals.findIndex((x) => x.id === s.id) ?? -1;
    if (!l || i < 0) return null;
    const p = l.ecef[i];
    const camLocal = this.material.uniforms.uCam.value as THREE.Vector3;
    if (p.clone().normalize().dot(camLocal.clone().sub(p).normalize()) < 0) return null;
    const v = p.clone().applyMatrix4(this.group.matrixWorld).project(this.camera);
    const el = this.renderer.domElement.getBoundingClientRect();
    return { x: el.left + (v.x * 0.5 + 0.5) * el.width, y: el.top + (-v.y * 0.5 + 0.5) * el.height };
  }

  find(id: string): Signal | null {
    for (const l of this.layers.values()) { const s = l.data?.signals.find((x) => x.id === id); if (s) return s; }
    return null;
  }
}

/** "3 min ago", "5 h ago", "2 d ago". */
export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
