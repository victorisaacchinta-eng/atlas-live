import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { dust, projectorPad } from './hologram';
import { theme } from './theme';
import type { Hologram } from './model';
import { EarthView } from './earth';
import { lensPass } from './lens';

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
  /** Pick how close the camera sits and how far it can tilt for each kind of hologram. */
  frame(kind: 'object' | 'scan' | 'place') {
    this.baseDistance = kind === 'place' ? 5.4 : kind === 'scan' ? 6.2 : 7.6;
    this.controls.maxPolarAngle = Math.PI * (kind === 'place' ? 0.42 : 0.52);
    this.idleSpin = kind === 'place' ? 0.05 : 0.12;
    this.userZoomed = false;
  }
  /** Spin applied by hands, in radians per second, decays to the idle spin. */
  spin = 0;
  idleSpin = 0.12;
  sway: { center: number; arc: number; t: number } | null = null;

  /** Present a model from its good side: a slow swing of +-arc instead of a full turn, and drag limited to that arc. */
  setSway(arc: number | null) {
    if (arc === null) {
      this.sway = null;
      this.controls.minAzimuthAngle = -Infinity;
      this.controls.maxAzimuthAngle = Infinity;
      return;
    }
    const off = this.camera.position.clone().sub(this.controls.target);
    const az = Math.atan2(off.x, off.z);
    this.sway = { center: az, arc, t: 0 };
    this.pivot.rotation.y = az;
    this.controls.minAzimuthAngle = az - arc;
    this.controls.maxAzimuthAngle = az + arc;
  }
  /** Once someone zooms by hand, the automatic framing stops fighting them. */
  userZoomed = false;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  private host: HTMLElement;
  /** Screen-space sensor lens (thermal, night, riso). */
  readonly lens = lensPass();
  /** Real-world 3D places (Google Photorealistic 3D Tiles). Active only in Earth mode. */
  readonly earth: EarthView;
  earthOn = false;
  /** Base auto-orbit speed in Earth mode (OrbitControls units); the agent can change it. */
  orbitSpeed = 0.35;
  /** A scripted camera move in Earth mode. `step` receives eased-free progress 0..1. */
  private flight: { t: number; dur: number; step: (k: number) => void; done?: () => void } | null = null;
  /** The point the current landing is aimed at; ground corrections move it. */
  private landing: THREE.Vector3 | null = null;
  private clearanceTimer = 0;
  /** Lowest the eye may go right now: measured surface under the camera plus clearance. */
  private floor = -Infinity;

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
    this.earth = new EarthView(this.camera, this.renderer);
    this.scene.add(this.earth.group);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.32, 0.62);
    if (theme.glow && !new URLSearchParams(location.search).has('nobloom')) this.composer.addPass(this.bloom);
    this.composer.addPass(this.lens.pass);
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

  /** Switch between the hologram stage (units of about a metre-ish model) and real-world metres. */
  setEarth(on: boolean) {
    this.earthOn = on;
    this.pad.visible = !on;
    this.motes.visible = !on;
    this.pivot.visible = !on;
    this.earth.group.visible = on;
    this.scene.fog = on ? null : new THREE.FogExp2(new THREE.Color(theme.ground), 0.05);
    this.camera.near = on ? 2 : 0.05;
    this.camera.far = on ? 60000 : 200;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = on ? 40 : 2.2;
    // In Earth mode you can zoom all the way back out to orbit.
    this.controls.maxDistance = on ? 2.2e7 : 14;
    this.controls.maxPolarAngle = Math.PI * (on ? 0.47 : 0.52);
    this.controls.autoRotate = on && !this.reducedMotion;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.zoomSpeed = on ? 1.4 : 1;
    this.floor = -Infinity;
    if (!on) this.setIsolate(0, 0);
    if (!on) { this.earth.stop(); this.camera.position.set(4.4, 2.6, 5.6); this.controls.target.set(0, 0.95, 0); this.flight = null; this.landing = null; }
  }

  get flying() { return this.flight !== null; }

  /** Run a scripted move. A new move replaces the one in progress. */
  run(dur: number, step: (k: number) => void, done?: () => void) {
    this.flight = { t: 0, dur: this.reducedMotion ? 0.001 : dur, step, done };
    this.controls.enabled = false;
  }

  /**
   * Fall from `fromDistance` metres straight above `target` to an oblique orbit of `radius`.
   * Distance eases in log space, so the drop reads like a satellite dive: fast through the
   * empty kilometres, slow over the rooftops. The view tilts from top-down only near the end.
   * `target` is held by reference, so ground corrections during the dive move the landing.
   */
  dive(target: THREE.Vector3, radius: number, fromDistance: number, dur = 6.5, done?: () => void) {
    this.landing = target;
    const end = this.approach.clone();
    const top = Stage.topDir(end);
    const l0 = Math.log(Math.max(fromDistance, radius)), l1 = Math.log(radius);
    const dir = new THREE.Vector3();
    this.run(dur, (k) => {
      // Linger on the globe, fall fast through the empty kilometres, settle over the rooftops.
      const e = 0.5 - 0.5 * Math.cos(Math.PI * Math.pow(k, 0.85));
      const dist = Math.exp(l0 + (l1 - l0) * e);
      const tilt = THREE.MathUtils.smoothstep(k, 0.62, 1);
      dir.copy(top).lerp(end, tilt).normalize();
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.controls.target.copy(target);
    }, done);
  }

  /**
   * Direction the camera approaches a landmark from. In this frame +z is north and -x is east,
   * so this sits south-south-east of the target, looking north: north is up on screen.
   */
  approach = new THREE.Vector3(-0.3, 0.42, -0.86).normalize();

  /** Straight up, nudged a hair toward `d` so a top-down view keeps a defined, north-up heading. */
  static topDir(d: THREE.Vector3) {
    return new THREE.Vector3(d.x * 1e-3, 1, d.z * 1e-3).normalize();
  }

  /** Hold top-down at `height` until `ready()` (after at least `min` s, at most `max` s). */
  holdUntil(height: number, ready: () => boolean, min: number, max: number, done: () => void) {
    const total = this.reducedMotion ? 0.001 : max;
    this.run(total, (k) => {
      this.holdTopDown(height);
      if (this.flight && k * total >= min && ready()) this.flight.t = 1;
    }, done);
    if (this.flight) this.flight.dur = total;
  }

  /** Hold the camera top-down `height` metres above the origin, north up. */
  holdTopDown(height: number) {
    this.camera.position.copy(Stage.topDir(this.approach)).multiplyScalar(height);
    this.controls.target.set(0, 0, 0);
  }

  /** Climb straight up above the current target to `height` metres, levelling to top-down. */
  rise(height: number, dur = 2.2, done?: () => void) {
    const target = this.controls.target.clone();
    const off = this.camera.position.clone().sub(target);
    const l0 = Math.log(Math.max(off.length(), 1)), l1 = Math.log(height);
    const dir0 = off.normalize(), up = Stage.topDir(this.approach), dir = new THREE.Vector3();
    this.run(dur, (k) => {
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      dir.copy(dir0).lerp(up, THREE.MathUtils.smoothstep(k, 0, 0.6)).normalize();
      this.camera.position.copy(target).addScaledVector(dir, Math.exp(l0 + (l1 - l0) * e));
      this.controls.target.copy(target);
    }, done);
  }

  /** The ground under the landing turned out higher or lower than first measured. */
  shiftGround(dy: number) {
    if (this.landing) this.landing.y += dy;
    if (this.flight) return; // the move in progress reads the landing point every frame
    const from = this.camera.position.clone(), fromT = this.controls.target.clone();
    const up = new THREE.Vector3(0, dy, 0);
    this.run(1.2, (k) => {
      const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.copy(from).addScaledVector(up, e);
      this.controls.target.copy(fromT).addScaledVector(up, e);
    });
  }

  /**
   * Isolate: cut a square block of the world around the landmark so it floats on the stage like
   * an architect's diorama. Done with clipping planes at draw time; nothing is extracted or kept.
   */
  private isoPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()];
  private isoFrame: THREE.LineLoop | null = null;
  isolated = 0;
  setIsolate(half: number, groundY: number) {
    this.isolated = half;
    if (this.isoFrame) { this.scene.remove(this.isoFrame); this.isoFrame.geometry.dispose(); this.isoFrame = null; }
    if (!half) { this.renderer.clippingPlanes = []; return; }
    this.isoPlanes[0].set(new THREE.Vector3(-1, 0, 0), half);
    this.isoPlanes[1].set(new THREE.Vector3(1, 0, 0), half);
    this.isoPlanes[2].set(new THREE.Vector3(0, 0, -1), half);
    this.isoPlanes[3].set(new THREE.Vector3(0, 0, 1), half);
    this.renderer.clippingPlanes = this.isoPlanes;
    const y = groundY + 0.5;
    const pts = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, z]) => new THREE.Vector3(x, y, z));
    this.isoFrame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(theme.accent), transparent: true, opacity: 0.9 }));
    this.isoFrame.renderOrder = 10;
    this.scene.add(this.isoFrame);
  }

  /** Glide to frame a block of half-width `half` around (0, y, 0), keeping the current heading. */
  frameBlock(half: number, y: number) {
    const fromP = this.camera.position.clone(), fromT = this.controls.target.clone();
    const toT = new THREE.Vector3(0, y, 0);
    const flat = fromP.clone().sub(fromT); flat.y = 0;
    if (flat.lengthSq() < 1) flat.set(this.approach.x, 0, this.approach.z);
    flat.normalize();
    const dist = half * 3.1;
    const toP = toT.clone().addScaledVector(flat, dist * Math.cos(0.5)).add(new THREE.Vector3(0, dist * Math.sin(0.5), 0));
    this.run(1.6, (k) => {
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(fromP, toP, e);
      this.controls.target.lerpVectors(fromT, toT, e);
    });
  }

  /** Keep a sensible depth range from street level to orbit. */
  private fitDepth() {
    const ground = this.earth.ground ?? 0;
    const alt = Math.max(1, this.camera.position.y - ground);
    const near = THREE.MathUtils.clamp(alt * 0.01, 1, 1e5);
    const far = Math.max(60000, alt * 2.5 + Math.sqrt(2 * 6.371e6 * alt) * 1.5);
    if (Math.abs(near - this.camera.near) / this.camera.near > 0.05 || Math.abs(far - this.camera.far) / this.camera.far > 0.05) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Never leave the eye inside a hill or a building. Every 0.4 s sample the surface under the
   * camera (and fall back to the landmark's ground); every frame, hold the eye above that floor.
   * This runs during scripted moves too, since a dive can outrun the tiles.
   */
  private guardClearance(dt: number) {
    const p = this.camera.position;
    const g = this.earth.ground;
    this.clearanceTimer += dt;
    if (this.clearanceTimer >= 0.4) {
      this.clearanceTimer = 0;
      const near = p.y - (g ?? 0) < 4000;
      const h = near ? this.earth.heightAt(p.x, p.z) : null;
      this.floor = Math.max(h ?? -Infinity, g ?? -Infinity) + 25;
    }
    if (p.y < this.floor) p.y = this.floor;
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.lens.resize(w, h);
    this.camera.aspect = w / h;
    // Keep the model framed on narrow screens.
    this.camera.fov = w / h < 0.8 ? 46 : 32;
    // On wide screens the left column holds text, so centre the hologram in the space to its right.
    if (w > 900) this.camera.setViewOffset(w, h, -w * 0.09, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /**
   * A still of the current model from a fixed front-left three-quarter view, for the Construct
   * critic. Renders one frame off the normal camera, reads it back, then restores the view.
   */
  snapshot(width = 768): string {
    const cam = this.camera.clone();
    const box = new THREE.Box3().setFromObject(this.pivot);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 2.1 + 0.5;
    cam.clearViewOffset();
    cam.aspect = 4 / 3;
    cam.fov = 32;
    cam.position.copy(c).add(new THREE.Vector3(-0.62, 0.38, -0.68).normalize().multiplyScalar(dist));
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    const h = Math.round(width * 0.75);
    const rt = new THREE.WebGLRenderTarget(width, h, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    (this.model as { finishReveal?: () => void } | null)?.finishReveal?.();
    const pad = this.pad.visible, motes = this.motes.visible, rotY = this.pivot.rotation.y;
    this.pad.visible = false; this.motes.visible = false; this.pivot.rotation.y = 0;
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, cam);
    const px = new Uint8Array(width * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, width, h, px);
    this.renderer.setRenderTarget(null);
    this.pad.visible = pad; this.motes.visible = motes; this.pivot.rotation.y = rotY;
    rt.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(width, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * width * 4, (h - y) * width * 4), y * width * 4);
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
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
    if (this.sway) {
      // Show one side only: swing gently around the angle that faces the camera.
      this.sway.t += dt * motion;
      this.pivot.rotation.y = this.sway.center + Math.sin(this.sway.t * 0.3) * this.sway.arc;
    } else this.pivot.rotation.y += (this.idleSpin * motion + this.spin) * dt;
    const sweep = this.pad.getObjectByName('sweep');
    if (sweep) sweep.rotation.y -= dt * 0.9 * motion;
    this.motes.rotation.y += dt * 0.01 * motion;
    if (this.earthOn) {
      if (this.flight) {
        const f = this.flight;
        f.t = Math.min(1, f.t + dt / f.dur);
        f.step(f.t);
        this.guardClearance(dt);
        this.camera.lookAt(this.controls.target);
        if (f.t >= 1) {
          this.flight = null;
          this.controls.enabled = true;
          f.done?.();
        }
      } else {
        // A hand swipe speeds up the orbit, then it settles back to a slow turn.
        this.controls.autoRotateSpeed = this.orbitSpeed + this.spin * 25;
        this.controls.update();
        this.guardClearance(dt);
      }
      this.fitDepth();
      this.earth.update(dt);
    } else {
      this.model?.update(dt, t);
      // Back the camera off as the model explodes so parts stay on screen.
      const want = this.baseDistance * (1 + this.framing * 0.42);
      const off = this.camera.position.clone().sub(this.controls.target);
      const d = off.length();
      if (!this.userZoomed) off.setLength(d + (want - d) * Math.min(1, dt * 3));
      this.camera.position.copy(this.controls.target).add(off);
      this.controls.update();
    }
    this.lens.tick(t);
    this.onFrame?.(dt, t);
    this.composer.render();
  }
}
