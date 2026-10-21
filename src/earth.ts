import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { CesiumIonAuthPlugin, GoogleCloudAuthPlugin, GLTFExtensionsPlugin, ReorientationPlugin, TilesFadePlugin, TileCompressionPlugin, UpdateOnChangePlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { HOLO } from './hologram';

/**
 * Real places in real 3D: Google Photorealistic 3D Tiles, streamed through Cesium ion
 * (asset 2275207) or straight from Google's Map Tiles API. Two looks:
 * - Photo: the tiles as Google captured them.
 * - Hologram: the same geometry redrawn in ATLAS inks, with height contours and edge light.
 * Tiles are never cached or analysed, only rendered (Google's tile policies).
 */

export type EarthAuth = { kind: 'ion'; token: string } | { kind: 'google'; key: string } | { kind: 'url'; url: string };
export type EarthLook = 'photo' | 'hologram';

const DRACO = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

const holoVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec4 mv = viewMatrix * w;
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const holoFragment = /* glsl */ `
  uniform sampler2D map;
  uniform bool hasMap;
  uniform vec3 uGround;
  uniform vec3 uInk;
  uniform vec3 uAccent;
  uniform float uBase;
  uniform float uTime;
  uniform float uSpacing;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vView;
  void main() {
    // Photogrammetry has no reliable normals; rebuild a face normal from screen derivatives.
    vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
    float facing = abs(dot(n, normalize(-vView)));
    float rim = pow(1.0 - facing, 2.2);
    float lum = 0.55;
    if (hasMap) { vec3 c = texture2D(map, vUv).rgb; lum = dot(c, vec3(0.3, 0.59, 0.11)); }
    // Height contours every uSpacing metres above the site's ground, like a survey drawing.
    float h = vWorld.y - uBase;
    float f = fract(h / uSpacing);
    float w = fwidth(h / uSpacing) * 1.2;
    float contour = 1.0 - smoothstep(0.0, w, min(f, 1.0 - f));
    // A slow scan sweeping upwards.
    float scan = smoothstep(0.985, 1.0, sin(h * 0.05 - uTime * 0.8) * 0.5 + 0.5);
    vec3 col = mix(uGround, uInk, clamp(lum * 0.75 + rim * 0.45, 0.0, 1.0));
    col = mix(col, uInk, contour * 0.35);
    col = mix(col, uAccent, scan * 0.6);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class EarthView {
  readonly group = new THREE.Group();
  tiles: TilesRenderer | null = null;
  private reorient: ReorientationPlugin | null = null;
  private look: EarthLook = 'photo';
  private holoMats = new Map<THREE.Material, THREE.ShaderMaterial>();
  private originals = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private time = 0;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  /** Ground height (local y) under the origin, found by ray once tiles arrive. */
  ground: number | null = null;
  /** Called each time the measured ground moves; `first` is true for the first reading after a move. */
  onGround: ((y: number, first: boolean) => void) | null = null;
  onAttribution: ((html: string) => void) | null = null;
  private groundProbe = 0;
  private lastProbe = -1;
  private isEarth = true;

  constructor(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    this.camera = camera;
    this.renderer = renderer;
  }

  start(auth: EarthAuth, lat: number, lon: number) {
    this.stop();
    const tiles = auth.kind === 'url' ? new TilesRenderer(auth.url) : new TilesRenderer();
    if (auth.kind === 'ion') tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: auth.token, assetId: '2275207', autoRefreshToken: true }));
    if (auth.kind === 'google') tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: auth.key, autoRefreshToken: true }));
    const draco = new DRACOLoader().setDecoderPath(DRACO);
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 400 }));
    tiles.registerPlugin(new UpdateOnChangePlugin());
    if (auth.kind !== 'url') {
      this.reorient = new ReorientationPlugin({ lat: lat * THREE.MathUtils.DEG2RAD, lon: lon * THREE.MathUtils.DEG2RAD, height: 0, recenter: true });
      tiles.registerPlugin(this.reorient);
    } else {
      this.reorient = null;
      tiles.registerPlugin(new ReorientationPlugin({ recenter: true }));
    }
    tiles.errorTarget = 6;
    tiles.setCamera(this.camera);
    tiles.setResolutionFromRenderer(this.camera, this.renderer);
    tiles.addEventListener('load-model', (e: { scene: THREE.Object3D }) => this.styleModel(e.scene));
    tiles.addEventListener('tiles-load-end', () => this.emitAttribution());
    this.group.add(tiles.group);
    this.tiles = tiles;
    this.isEarth = auth.kind !== 'url';
    this.resetGround();
  }

  private resetGround() {
    this.ground = null;
    this.groundProbe = 0;
    this.lastProbe = -1;
  }

  /** Move to another place without rebuilding the renderer. */
  goTo(lat: number, lon: number) {
    if (!this.reorient || !this.tiles) return;
    this.reorient.transformLatLonHeightToOrigin(lat * THREE.MathUtils.DEG2RAD, lon * THREE.MathUtils.DEG2RAD, 0);
    this.resetGround();
  }

  setLook(look: EarthLook) {
    this.look = look;
    this.tiles?.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) this.applyLook(m); });
  }
  get currentLook() { return this.look; }

  private styleModel(scene: THREE.Object3D) {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!this.originals.has(m)) this.originals.set(m, m.material);
      this.applyLook(m);
    });
  }

  private applyLook(m: THREE.Mesh) {
    const orig = this.originals.get(m) ?? m.material;
    if (this.look === 'photo') { m.material = orig; return; }
    const base = Array.isArray(orig) ? orig[0] : orig;
    let holo = this.holoMats.get(base);
    if (!holo) {
      const map = (base as THREE.MeshBasicMaterial).map || null;
      holo = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: map },
          hasMap: { value: !!map },
          uGround: { value: HOLO.ground.clone() },
          uInk: { value: HOLO.bone.clone() },
          uAccent: { value: HOLO.signal.clone() },
          uBase: { value: this.ground ?? 0 },
          uTime: { value: 0 },
          uSpacing: { value: 4 },
        },
        vertexShader: holoVertex,
        fragmentShader: holoFragment,
      });
      this.holoMats.set(base, holo);
    }
    m.material = holo;
  }

  update(dt: number) {
    if (!this.tiles) return;
    this.time += dt;
    for (const mat of this.holoMats.values()) { mat.uniforms.uTime.value = this.time; if (this.ground !== null) mat.uniforms.uBase.value = this.ground; }
    this.camera.updateMatrixWorld();
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.update();
    this.groundProbe += dt;
    // Coarse tiles arrive first and can sit hundreds of metres off the real surface, so keep
    // measuring while sharper tiles stream in (first 15 s, or while anything is still downloading).
    const stats = (this.tiles as unknown as { stats?: { downloading?: number; parsing?: number } }).stats;
    const busy = !!stats && ((stats.downloading ?? 0) + (stats.parsing ?? 0)) > 0;
    const tick = Math.floor(this.groundProbe * 4);
    if (tick !== this.lastProbe && (this.ground === null || this.groundProbe < 15 || (busy && this.groundProbe < 40))) {
      this.lastProbe = tick;
      this.probeGround();
    }
    if (this.ground === null && this.groundProbe > 6) {
      if (this.isEarth) {
        // Nothing under the landmark yet: assume the ellipsoid and let later probes correct it.
        this.setGround(0);
      } else {
        // A non-Earth sample tileset: fall back to the data's bounds.
        const box = new THREE.Box3();
        if (this.tiles.getBoundingBox(box)) { box.applyMatrix4(this.tiles.group.matrixWorld); this.setGround(box.min.y); }
      }
    }
  }

  private setGround(y: number) {
    const first = this.ground === null;
    if (!first && Math.abs(y - this.ground!) < 2) return;
    this.ground = y;
    this.onGround?.(y, first);
  }

  /** Cast a ray straight down through the origin to find the real ground height. */
  private probeGround() {
    if (!this.tiles) return;
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 9000, 0), new THREE.Vector3(0, -1, 0), 0, 20000);
    (ray as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
    const hit = ray.intersectObject(this.tiles.group, true)[0];
    if (hit) this.setGround(hit.point.y);
  }

  private emitAttribution() {
    if (!this.tiles || !this.onAttribution) return;
    const parts: string[] = [];
    for (const a of this.tiles.getAttributions()) {
      if (a.type === 'string') parts.push(escapeHtml(String(a.value)));
      else if (a.type === 'html') parts.push(sanitize(String(a.value)));
      else if (a.type === 'image') parts.push(`<img src="${escapeHtml(String(a.value))}" alt="Google" class="attr-logo">`);
    }
    this.onAttribution(parts.join(' '));
  }

  stop() {
    if (!this.tiles) return;
    this.group.remove(this.tiles.group);
    this.tiles.dispose();
    this.tiles = null;
    for (const m of this.holoMats.values()) m.dispose();
    this.holoMats.clear();
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Attribution HTML comes from the tile service; keep only text, links and images. */
function sanitize(html: string) {
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('*').forEach((el) => {
    if (!['A', 'IMG', 'SPAN', 'B', 'I', 'BR'].includes(el.tagName)) { el.replaceWith(...Array.from(el.childNodes)); return; }
    for (const attr of Array.from(el.attributes)) {
      const keep = (el.tagName === 'A' && attr.name === 'href' && /^https:/.test(attr.value)) || (el.tagName === 'IMG' && (attr.name === 'src' || attr.name === 'alt') && (!attr.value.startsWith('javascript')));
      if (!keep) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
  });
  return t.innerHTML;
}
