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
  /** The theme asks for phosphor glow (bloom) on holograms. */
  private glow = false;
  /**
   * Adaptive quality. Render resolution starts at up to 1.5× (retina is 2×) and moves in
   * 0.25 steps: down when frames run slow, up when they hold 60 fps with room to spare. A
   * step up that turns out too slow becomes the ceiling, so it never see-saws. Bloom only ever
   * runs on holograms, at half resolution, and is the first thing to go when frames run slow.
   */
  private quality = (() => {
    const max = Math.min(window.devicePixelRatio || 1, 2);
    const q = new URLSearchParams(location.search).get('dpr');
    const dpr = q ? THREE.MathUtils.clamp(Number(q) || 1, 0.5, max) : Math.min(max, 1.5);
    return { dpr, max, min: Math.min(1, max), ft: 16.7, slow: 0, good: 0, cooldown: 0, ceiling: max, bloomOk: true, bloomFailed: false, fixed: !!q, acc: 0 };
  })();
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
  /**
   * Held navigation input from the keyboard or the NAV pad, each -1..1: forward, sideways,
   * turn (positive turns right) and zoom (positive closes in). Applied every frame the
   * viewer has the camera.
   */
  readonly nav = { fwd: 0, side: 0, turn: 0, zoom: 0, fast: false };
  /** Stage size in CSS pixels, kept by resize() so per-frame code never reads layout. */
  private viewW = 1;
  private viewH = 1;
  /** Picture shift in CSS px (x right, y down): current and goal. See setShift(). */
  private shift = { x: 0, y: 0, gx: 0, gy: 0 };
  /** Metres of ground correction still to ease into camera and target (see shiftGround). */
  private groundLift = 0;
  /** A scripted camera move in Earth mode. `step` receives eased-free progress 0..1. */
  private flight: { t: number; dur: number; step: (k: number) => void; done?: () => void } | null = null;
  /** The point the current landing is aimed at; ground corrections move it. */
  private landing: THREE.Vector3 | null = null;
  private clearanceTimer = 0;
  /** Lowest the eye may go right now: measured surface under the camera plus clearance. */
  private floor = -Infinity;

  constructor(host: HTMLElement) {
    this.host = host;
    // No preserveDrawingBuffer: nothing reads this canvas back (snapshot() renders to its own
    // target), and keeping the buffer costs a full-screen copy every frame.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.quality.dpr);
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
    // The slow showcase orbit stops the moment the viewer grabs the camera, so the view
    // stays where they leave it instead of drifting away under their hand.
    this.controls.addEventListener('start', () => { if (this.earthOn) this.controls.autoRotate = false; });

    this.pad = projectorPad();
    this.motes = dust();
    this.scene.add(this.pad, this.motes, this.pivot);
    this.earth = new EarthView(this.camera, this.renderer);
    this.scene.add(this.earth.group);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.32, 0.62);
    this.glow = theme.glow && !new URLSearchParams(location.search).has('nobloom');
    if (this.glow) this.composer.addPass(this.bloom);
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
    this.pivot.visible = !this.earthOn;
  }

  /** Hide or show the hologram without unloading it (Scan and Build start on an empty stage). */
  showHologram(on: boolean) {
    this.pivot.visible = on && !this.earthOn;
  }

  private running = true;

  /** Stop drawing the hologram while another full-screen renderer (the NASA globe) is shown. */
  pause() {
    if (!this.running) return;
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  /** Resume after pause(), discarding the idle time so nothing jumps. */
  resume() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
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
    // On the real Earth, right-drag slides along the ground (forward and back) rather than
    // up into the sky, and the wheel flies toward whatever is under the cursor.
    this.controls.screenSpacePanning = !on;
    this.controls.zoomToCursor = on;
    this.floor = -Infinity;
    if (!on) this.setIsolate(0, 0);
    if (!on) {
      this.earth.stop();
      this.camera.position.set(4.4, 2.6, 5.6);
      this.controls.target.set(0, 0.95, 0);
      // Earth mode points the camera's up at north for top-down views. Leaving it there rolls
      // every hologram, and a flight cut short leaves the mouse controls switched off.
      this.camera.up.set(0, 1, 0);
      this.flight = null;
      this.landing = null;
      this.groundLift = 0;
      this.controls.enabled = true;
    }
    // Hologram framing comes back at once; the Earth starts centred and its caller shifts it.
    this.shift.gx = !on && this.viewW > 900 ? this.viewW * 0.09 : 0; this.shift.gy = 0;
    this.shift.x = this.shift.gx; this.shift.y = 0;
    this.applyShift();
  }

  get flying() { return this.flight !== null; }

  /** Run a scripted move. A new move replaces the one in progress. */
  run(dur: number, step: (k: number) => void, done?: () => void) {
    this.groundLift = 0;
    this.flight = { t: 0, dur: this.reducedMotion ? 0.001 : dur, step, done };
    this.controls.enabled = false;
  }

  /**
   * Fall from `fromDistance` metres straight above `target` to an oblique orbit of `radius`.
   * Distance eases in log space, so the drop reads like a satellite dive: fast through the
   * empty kilometres, slow over the rooftops. The view tilts from top-down only near the end.
   * `target` is held by reference, so ground corrections during the dive move the landing.
   */
  dive(target: THREE.Vector3, radius: number, fromDistance: number, dur = 6.5, done?: () => void, topDown = false) {
    this.landing = target;
    const end = this.approachDir;
    // Top-down maps sit a hair south of straight up, so north stays up on screen once the
    // camera's up axis goes back to the local vertical.
    const top = this.topDirHere(topDown ? this.southDir : end);
    const l0 = Math.log(Math.max(fromDistance, radius)), l1 = Math.log(radius);
    const dir = new THREE.Vector3();
    const up0 = this.camera.up.clone();
    const up1 = this.localUp;
    this.run(dur, (k) => {
      // Linger on the globe, fall fast through the empty kilometres, settle over the rooftops.
      const e = 0.5 - 0.5 * Math.cos(Math.PI * Math.pow(k, 0.85));
      const dist = Math.exp(l0 + (l1 - l0) * e);
      // Countries, states and counties read as maps: stay north-up and top-down. Cities and
      // landmarks tilt to the approach angle so their height and facades are visible.
      const tilt = topDown ? 0 : THREE.MathUtils.smoothstep(k, 0.62, 1);
      dir.copy(top).lerp(end, tilt).normalize();
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.controls.target.copy(target);
      // Keep the horizon level: as the view tilts, the up axis moves from north to the local vertical.
      if (!topDown) this.camera.up.copy(up0).lerp(up1, tilt).normalize();
    }, () => {
      // Orbit controls turn around the local vertical; any other up axis rolls the view as you drag.
      this.camera.up.copy(up1);
      done?.();
    });
  }

  /**
   * Direction the camera approaches a landmark from. In the hologram frame +z is north and
   * -x is east, so this sits south-south-east of the target, looking north: north is up on
   * screen. On the Earth the same heading is rebuilt from the live local frame.
   */
  approach = new THREE.Vector3(-0.3, 0.42, -0.86).normalize();

  /** The approach heading in the frame the camera is actually in. */
  private get approachDir(): THREE.Vector3 {
    if (!this.earthOn) return this.approach;
    const e = this.earth.eastAxis;
    const n = this.earth.northAxis;
    const u = this.earth.upAxis;
    return e.clone().multiplyScalar(0.3).addScaledVector(n, -0.86).addScaledVector(u, 0.42).normalize();
  }

  /** Local vertical: the camera's up axis whenever the view is not top-down. */
  private get localUp(): THREE.Vector3 {
    return this.earthOn ? this.earth.upAxis.clone() : new THREE.Vector3(0, 1, 0);
  }

  /** Due south in the live frame (+z is north in the hologram frame). */
  private get southDir(): THREE.Vector3 {
    return this.earthOn ? this.earth.northAxis.clone().negate() : new THREE.Vector3(0, 0, -1);
  }

  /** Straight up, nudged a hair toward `d` so a top-down view keeps a defined, north-up heading. */
  static topDir(d: THREE.Vector3) {
    return new THREE.Vector3(d.x * 1e-3, 1, d.z * 1e-3).normalize();
  }

  /** Straight up in the live frame, with the same hair of heading. */
  private topDirHere(d: THREE.Vector3) {
    if (!this.earthOn) return Stage.topDir(d);
    const u = this.earth.upAxis;
    const n = this.earth.northAxis;
    const e = this.earth.eastAxis;
    const heading = e.clone().multiplyScalar(d.dot(this.earth.eastAxis)).addScaledVector(n, d.dot(n));
    return u.clone().addScaledVector(heading, 1e-3).normalize();
  }

  /** Hold top-down at `height` until `ready()` (after at least `min` s, at most `max` s). */
  holdUntil(height: number, ready: () => boolean, min: number, max: number, done: () => void, wholeEarth = false) {
    const total = this.reducedMotion ? 0.001 : max;
    this.run(total, (k) => {
      if (wholeEarth) this.holdWholeEarth(height); else this.holdTopDown(height);
      if (this.flight && k * total >= min && ready()) this.flight.t = 1;
    }, done);
    if (this.flight) this.flight.dur = total;
  }

  /** Hold the camera top-down `height` metres above the origin, north up. */
  holdTopDown(height: number) {
    this.camera.position.copy(this.topDirHere(this.approachDir)).multiplyScalar(height);
    if (this.earthOn) this.camera.up.copy(this.earth.northAxis);
    this.controls.target.set(0, 0, 0);
  }

  /**
   * Move in or out over the current target to `radius` metres, tilting from top-down (0 degrees)
   * toward the oblique approach (about 65 degrees). Used by the Short director between beats that
   * stay on the same subject, so the camera glides instead of climbing and diving again.
   */
  zoomTo(radius: number, tiltDeg: number, dur = 2.4, done?: () => void) {
    const target = this.controls.target.clone();
    const off = this.camera.position.clone().sub(target);
    const l0 = Math.log(Math.max(off.length(), 1)), l1 = Math.log(Math.max(radius, 40));
    const dir0 = off.normalize();
    const dir1 = this.topDirHere(this.approachDir).lerp(this.approachDir, THREE.MathUtils.clamp(tiltDeg / 65, 0, 1)).normalize();
    const dir = new THREE.Vector3();
    this.run(dur, (k) => {
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      dir.copy(dir0).lerp(dir1, e).normalize();
      this.camera.position.copy(target).addScaledVector(dir, Math.exp(l0 + (l1 - l0) * e));
      this.controls.target.copy(target);
    }, done);
  }
  /**
   * Whole-Earth orbit for photoreal tiles. The reorientation plugin turns the planet so
   * that +z is north and -x is east, which is not the same as +y being up, so the camera
   * is placed along the real local up axis and aimed at the Earth's centre in that frame.
   */
  holdWholeEarth(height: number) {
    const e = this.earth;
    this.camera.position.copy(e.center).addScaledVector(e.upAxis, height);
    this.camera.up.copy(e.northAxis);
    this.controls.target.copy(e.center);
  }

  /** Climb straight up above the current target to `height` metres, levelling to top-down. */
  rise(height: number, dur = 2.2, done?: () => void) {
    const target = this.controls.target.clone();
    const off = this.camera.position.clone().sub(target);
    const l0 = Math.log(Math.max(off.length(), 1)), l1 = Math.log(height);
    const dir0 = off.normalize(), up = this.topDirHere(this.approachDir), dir = new THREE.Vector3();
    // Rising to top-down: north becomes the screen's up, as in the whole-Earth view that follows.
    const up0 = this.camera.up.clone(), up1 = this.earthOn ? this.earth.northAxis.clone() : up0.clone();
    this.run(dur, (k) => {
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const s = THREE.MathUtils.smoothstep(k, 0, 0.6);
      dir.copy(dir0).lerp(up, s).normalize();
      this.camera.position.copy(target).addScaledVector(dir, Math.exp(l0 + (l1 - l0) * e));
      this.controls.target.copy(target);
      this.camera.up.copy(up0).lerp(up1, THREE.MathUtils.smoothstep(k, 0.35, 0.6)).normalize();
    }, done);
  }

  /** The ground under the landing turned out higher or lower than first measured. */
  shiftGround(dy: number) {
    if (this.landing) this.landing.y += dy;
    if (this.flight) return; // the move in progress reads the landing point every frame
    // Eased in over the next frames without taking the camera away: sharper tiles keep
    // correcting the ground, and a scripted move here used to cut out the mouse mid-drag.
    this.groundLift += dy;
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
  /** True while any navigation input is held. */
  get navigating() { const n = this.nav; return !!(n.fwd || n.side || n.turn || n.zoom); }

  /**
   * Walk the camera with held keys or the NAV pad. On the real Earth, forward and sideways
   * slide camera and target together across the ground, at a speed that scales with height,
   * so a city block and a country both take a second or two. On a hologram the target stays
   * on the model: forward closes in and sideways walks around it.
   */
  private applyNav(dt: number) {
    if (!this.navigating) return;
    const n = this.nav;
    const boost = n.fast ? 3 : 1;
    const up = this.camera.up;
    const target = this.controls.target;
    const off = this.camera.position.clone().sub(target);
    const dist = off.length();
    let zoom = n.zoom, turn = n.turn;
    if (this.earthOn) {
      this.controls.autoRotate = false;
      if (n.fwd || n.side) {
        // Heading is the view direction laid flat; looking straight down, it is screen-up.
        const fwd = off.clone().negate().projectOnPlane(up);
        if (fwd.lengthSq() < dist * dist * 1e-4) fwd.set(0, 1, 0).applyQuaternion(this.camera.quaternion).projectOnPlane(up);
        fwd.normalize();
        const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
        const step = Math.max(dist, 80) * 0.75 * boost * dt;
        const move = fwd.multiplyScalar(n.fwd * step).addScaledVector(right, n.side * step);
        target.add(move);
      }
    } else {
      zoom += n.fwd;
      turn += n.side;
      this.userZoomed = true;
    }
    if (turn) off.applyAxisAngle(up, -THREE.MathUtils.clamp(turn, -1, 1) * 1.1 * boost * dt);
    if (zoom) {
      const k = Math.exp(-THREE.MathUtils.clamp(zoom, -1, 1) * 1.4 * boost * dt);
      off.setLength(THREE.MathUtils.clamp(dist * k, this.controls.minDistance, this.controls.maxDistance));
    }
    this.camera.position.copy(target).add(off);
  }

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

  /**
   * Post-processing only when an effect is on. Photoreal Earth with the plain lens goes
   * straight to the screen: no extra full-screen passes, and the canvas's own antialiasing.
   */
  private draw() {
    this.bloom.enabled = this.glow && !this.earthOn && this.quality.bloomOk;
    if (this.bloom.enabled || this.lens.pass.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Read the frame interval and step resolution (then bloom) down or up. Runs once a second. */
  private adapt(raw: number) {
    const q = this.quality;
    if (raw > 1 || document.hidden) return; // a stall or a background tab says nothing about load
    q.ft += (Math.min(raw * 1000, 250) - q.ft) * 0.1;
    q.acc += raw;
    if (q.acc < 1) return;
    q.acc = 0;
    if (q.fixed) return;
    if (q.cooldown > 0) q.cooldown--;
    if (q.ft > 24) { q.slow++; q.good = 0; } else if (q.ft < 18.5) { q.good++; q.slow = 0; } else { q.slow = 0; q.good = 0; }
    if (q.slow >= 2) {
      q.slow = 0;
      if (this.bloom.enabled) {
        // Glow goes first: sharp lines without glow read better than soft lines with it.
        q.bloomOk = false;
        if (q.cooldown > 0) q.bloomFailed = true;
      } else if (q.dpr > q.min) {
        // The level just tried was too much: it becomes the ceiling for this session.
        if (q.cooldown > 0) q.ceiling = Math.max(q.min, q.dpr - 0.25);
        this.setDpr(q.dpr - 0.25);
      }
      q.cooldown = 6;
    } else if (q.good >= 5 && q.cooldown === 0) {
      q.good = 0;
      if (q.dpr < Math.min(q.max, q.ceiling)) { this.setDpr(q.dpr + 0.25); q.cooldown = 6; }
      else if (!q.bloomOk && !q.bloomFailed && this.glow && !this.earthOn) { q.bloomOk = true; q.cooldown = 6; }
    }
  }

  private setDpr(v: number) {
    const q = this.quality;
    q.dpr = THREE.MathUtils.clamp(Math.round(v * 4) / 4, q.min, q.max);
    this.renderer.setPixelRatio(q.dpr);
    this.composer.setPixelRatio(q.dpr);
    this.resize();
  }

  /** Stage size in CSS pixels (cached; safe to read every frame). */
  get viewSize() { return { w: this.viewW, h: this.viewH }; }

  /** Current render scale and frame time, for the console readout and tests. */
  get perf() { const q = this.quality; return { dpr: q.dpr, ms: +q.ft.toFixed(1), bloom: this.bloom.enabled }; }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.viewW = w; this.viewH = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    // Bloom is soft by nature: half resolution looks the same and costs a quarter.
    this.bloom.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.lens.resize(w, h);
    this.camera.aspect = w / h;
    // Keep the model framed on narrow screens.
    this.camera.fov = w / h < 0.8 ? 46 : 32;
    // On wide screens the left column holds text, so centre the hologram in the space to its
    // right. (On the Earth the caller owns the shift; a resize must not move the view.)
    if (!this.earthOn) { this.shift.gx = w > 900 ? w * 0.09 : 0; this.shift.gy = 0; }
    this.applyShift();
  }

  /**
   * Move the picture right/down by (x, y) CSS pixels to clear a side panel. Eased in tick(),
   * and dropped to the centre while the panels are tucked away.
   */
  setShift(x: number, y = 0) { this.shift.gx = x; this.shift.gy = y; }

  private easeShift(dt: number) {
    const sh = this.shift;
    const tucked = document.documentElement.classList.contains('tucked');
    const gx = tucked ? 0 : sh.gx, gy = tucked ? 0 : sh.gy;
    if (Math.abs(gx - sh.x) < 0.3 && Math.abs(gy - sh.y) < 0.3) return;
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    sh.x += (gx - sh.x) * k; sh.y += (gy - sh.y) * k;
    if (Math.abs(gx - sh.x) < 0.3) sh.x = gx;
    if (Math.abs(gy - sh.y) < 0.3) sh.y = gy;
    this.applyShift();
  }

  private applyShift() {
    const { x, y } = this.shift, w = this.viewW, h = this.viewH;
    if (Math.abs(x) < 0.3 && Math.abs(y) < 0.3) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -x, -y, w, h);
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
    // Cached size: reading clientWidth here after a label moved forced a fresh layout per label.
    return { x: (v.x * 0.5 + 0.5) * this.viewW, y: (-v.y * 0.5 + 0.5) * this.viewH };
  }

  /** A ray from normalised device coordinates. */
  rayFrom(ndcX: number, ndcY: number): THREE.Raycaster {
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return r;
  }

  private tick() {
    const raw = this.clock.getDelta();
    // Motion keeps real time down to 10 fps; below that it slows rather than jumps.
    const dt = Math.min(raw, 0.1);
    this.adapt(raw);
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
        if (this.controls.enabled) this.applyNav(dt);
        if (this.groundLift) {
          const step = Math.abs(this.groundLift) < 0.05 ? this.groundLift : this.groundLift * Math.min(1, dt * 3.5);
          this.camera.position.y += step;
          this.controls.target.y += step;
          this.groundLift -= step;
        }
        // Zooming toward the cursor only makes sense near the ground, not from orbit.
        this.controls.zoomToCursor = this.camera.position.distanceTo(this.controls.target) < 30000;
        this.controls.update();
        this.guardClearance(dt);
      }
      this.fitDepth();
      this.earth.update(dt);
    } else {
      this.model?.update(dt, t);
      // Back the camera off as the model explodes so parts stay on screen. A model that knows its
      // exploded size gets exactly that much room, and the view follows its centre up as it opens.
      const ext = this.model?.extent;
      const k = this.framing;
      let want = this.baseDistance * (1 + k * 0.42);
      if (ext) {
        want = this.baseDistance * Math.max(1, 1 + (ext.r1 / ext.r0 - 1) * k * 0.9);
        const goalY = 0.95 + (ext.c1.y - ext.c0.y) * k * 0.8;
        const dy = (goalY - this.controls.target.y) * Math.min(1, dt * 3);
        if (!this.userZoomed && Math.abs(dy) > 1e-5) { this.controls.target.y += dy; this.camera.position.y += dy; }
      }
      const off = this.camera.position.clone().sub(this.controls.target);
      const d = off.length();
      if (!this.userZoomed) off.setLength(d + (want - d) * Math.min(1, dt * 3));
      this.camera.position.copy(this.controls.target).add(off);
      if (this.controls.enabled) this.applyNav(dt);
      this.controls.update();
    }
    this.lens.tick(t);
    this.onFrame?.(dt, t);
    this.easeShift(dt);
    this.draw();
  }
}
