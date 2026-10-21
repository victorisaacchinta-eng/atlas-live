import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { dust, projectorPad } from './hologram';
import { theme } from './theme';
import type { Hologram } from './model';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
  readonly controls: OrbitControls;
  readonly pivot = new THREE.Group();
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private clock = new THREE.Clock();
  private pad: THREE.Group;
  private motes: THREE.Points;
  model: Hologram | null = null;
  /** Called every frame after the scene updates, with delta time and elapsed time. */
  onFrame: ((dt: number, t: number) => void) | null = null;
  /** 0..1, how far the model is exploded; the camera backs off to keep it framed. */
  framing = 0;
  private baseDistance = 7.6;
  /** Spin applied by hands, in radians per second, decays to the idle spin. */
  spin = 0;
  idleSpin = 0.12;
  /** Once someone zooms by hand, the automatic framing stops fighting them. */
  userZoomed = false;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(theme.ground);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(theme.ground), 0.05);
    this.camera.position.set(4.4, 2.6, 5.6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.renderer.domElement.addEventListener('wheel', () => { this.userZoomed = true; }, { passive: true });

    this.pad = projectorPad();
    this.motes = dust();
    this.scene.add(this.pad, this.motes, this.pivot);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.32, 0.62);
    if (theme.glow && !new URLSearchParams(location.search).has('nobloom')) this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  setModel(m: Hologram | null) {
    if (this.model) { this.pivot.remove(this.model.root); this.model.dispose(); }
    this.model = m;
    if (m) this.pivot.add(m.root);
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the model framed on narrow screens.
    this.camera.fov = w / h < 0.8 ? 46 : 32;
    // On wide screens the left column holds text, so centre the hologram in the space to its right.
    if (w > 900) this.camera.setViewOffset(w, h, -w * 0.09, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** Screen position (CSS px) of a world point, or null when behind the camera. */
  project(p: THREE.Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * this.host.clientWidth, y: (-v.y * 0.5 + 0.5) * this.host.clientHeight };
  }

  /** A ray from normalised device coordinates. */
  rayFrom(ndcX: number, ndcY: number): THREE.Raycaster {
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return r;
  }

  private tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const motion = this.reducedMotion ? 0 : 1;
    this.spin += (0 - this.spin) * Math.min(1, dt * 2.2);
    this.pivot.rotation.y += (this.idleSpin * motion + this.spin) * dt;
    const sweep = this.pad.getObjectByName('sweep');
    if (sweep) sweep.rotation.y -= dt * 0.9 * motion;
    this.motes.rotation.y += dt * 0.01 * motion;
    this.model?.update(dt, t);
    // Back the camera off as the model explodes so parts stay on screen.
    const want = this.baseDistance * (1 + this.framing * 0.42);
    const off = this.camera.position.clone().sub(this.controls.target);
    const d = off.length();
    if (!this.userZoomed) off.setLength(d + (want - d) * Math.min(1, dt * 3));
    this.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
    this.onFrame?.(dt, t);
    this.composer.render();
  }
}
