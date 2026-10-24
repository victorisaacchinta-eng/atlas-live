import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  EasingFunction,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  Math as CesiumMath,
  Matrix4,
  Rectangle,
  Transforms,
  type CesiumWidget,
} from 'cesium';
import { bandFor, haversineKm, SCALE_BANDS, type BBox, type LatLon, type ScaleBand } from '../core/geo';

export interface CameraState {
  position: Cartesian3;
  heading: number;
  pitch: number;
  roll: number;
  label?: string;
}

export interface ViewInfo {
  center: LatLon | null;
  altitude: number;
  heading: number;
  pitch: number;
  band: ScaleBand;
}

/** Comfortable viewing pitch for each scale band, in degrees. */
const BAND_PITCH: Record<ScaleBand['id'], number> = {
  planet: -90,
  continent: -90,
  country: -88,
  region: -62,
  city: -48,
  street: -32,
};

/**
 * One owner for every programmatic camera move: search results, the scale
 * ladder, bookmarks, the assistant and keyboard controls all go through here,
 * so history, cancellation and reduced-motion behave the same everywhere.
 */
export class Navigator {
  private readonly history: CameraState[] = [];
  private readonly listeners = new Set<(v: ViewInfo) => void>();
  private readonly settleListeners = new Set<(v: ViewInfo) => void>();
  private flying = false;

  constructor(
    private readonly widget: CesiumWidget,
    private readonly reducedMotion: () => boolean,
    /** Ground height at a point on the active terrain, so close views are framed above the ground, not above sea level. */
    private readonly groundAt: (p: LatLon) => Promise<number> = async () => 0,
  ) {
    const camera = widget.camera;
    camera.percentageChanged = 0.02;
    camera.moveEnd.addEventListener(() => {
      this.emit();
      const v = this.view();
      for (const fn of this.settleListeners) fn(v);
    });
    camera.changed.addEventListener(() => this.emit());
  }

  private get camera() {
    return this.widget.camera;
  }

  /** Every camera change, at most once per frame (readouts). */
  onView(fn: (v: ViewInfo) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** When the camera comes to rest (data loading). */
  onSettle(fn: (v: ViewInfo) => void): () => void {
    this.settleListeners.add(fn);
    return () => this.settleListeners.delete(fn);
  }

  private scheduled = false;

  /** Coalesces bursts of camera events into one update per frame. */
  private emit(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      const v = this.view();
      for (const fn of this.listeners) fn(v);
    });
  }

  /** The point on the ground at the centre of the screen, when the globe is there. */
  centerPoint(): LatLon | null {
    const scene = this.widget.scene;
    const c = new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
    // Reading the depth buffer stalls the GPU, so over 3D tiles the answer is reused for a moment.
    if (!scene.globe.show && this.centerCache && performance.now() - this.centerCache.at < 250) return this.centerCache.p;
    const hit = this.surfaceAt(c);
    if (!hit) return null;
    const carto = Cartographic.fromCartesian(hit);
    const p = { lat: CesiumMath.toDegrees(carto.latitude), lon: CesiumMath.toDegrees(carto.longitude) };
    if (!scene.globe.show) this.centerCache = { at: performance.now(), p };
    return p;
  }
  private centerCache: { at: number; p: LatLon } | null = null;

  altitude(): number {
    const h = this.camera.positionCartographic.height;
    const ground = this.widget.scene.globe.getHeight(this.camera.positionCartographic) ?? 0;
    return Math.max(1, h - Math.max(0, ground));
  }

  view(): ViewInfo {
    const altitude = this.altitude();
    return {
      center: this.centerPoint(),
      altitude,
      heading: CesiumMath.toDegrees(this.camera.heading),
      pitch: CesiumMath.toDegrees(this.camera.pitch),
      band: bandFor(altitude),
    };
  }

  snapshot(label?: string): CameraState {
    return {
      position: Cartesian3.clone(this.camera.positionWC),
      heading: this.camera.heading,
      pitch: this.camera.pitch,
      roll: this.camera.roll,
      label,
    };
  }

  canGoBack(): boolean {
    return this.history.length > 0;
  }

  private record(): void {
    if (this.flying) return;
    this.history.push(this.snapshot());
    if (this.history.length > 50) this.history.shift();
  }

  private duration(from: LatLon | null, to: LatLon, altitude: number): number {
    if (this.reducedMotion()) return 0;
    const dist = from ? haversineKm(from, to) : 5000;
    const altRatio = Math.abs(Math.log10(Math.max(1, altitude)) - Math.log10(Math.max(1, this.altitude())));
    return Math.min(4.2, 1.1 + dist / 4000 + altRatio * 0.45);
  }

  /** Ground height under a point, from loaded terrain when there is some, else from the elevation tiles. */
  private async groundOf(target: LatLon, waitMs = 1200): Promise<number> {
    // From orbit the globe is a smooth ellipsoid (terrain loads lower down), so its height says nothing.
    const flat = this.widget.scene.terrainProvider instanceof EllipsoidTerrainProvider;
    const loaded = flat ? undefined : this.widget.scene.globe.getHeight(Cartographic.fromDegrees(target.lon, target.lat));
    return loaded != null
      ? loaded / (this.widget.scene.verticalExaggeration || 1)
      : await Promise.race([this.groundAt(target).catch(() => 0), new Promise<number>((r) => setTimeout(() => r(0), waitMs))]);
  }

  /** Flies so the camera looks at `target` from `altitude` metres, with a pitch that suits the scale. */
  async lookAt(target: LatLon, altitude: number, opts: { pitch?: number; heading?: number; record?: boolean; groundHeight?: number } = {}): Promise<boolean> {
    this.stopOrbit();
    if (opts.record !== false) this.record();
    let ground = opts.groundHeight;
    if (ground == null && altitude < 200_000) ground = await this.groundOf(target);
    const groundM = Math.max(0, ground ?? 0) * (this.widget.scene.verticalExaggeration || 1);
    const band = bandFor(altitude);
    const pitchDeg = opts.pitch ?? BAND_PITCH[band.id];
    const pitch = CesiumMath.toRadians(pitchDeg);
    const range = altitude / Math.max(0.2, Math.sin(-pitch));
    const center = Cartesian3.fromDegrees(target.lon, target.lat, groundM);
    const heading = opts.heading != null ? CesiumMath.toRadians(opts.heading) : pitchDeg < -80 ? 0 : this.camera.heading;
    const duration = this.duration(this.centerPoint(), target, altitude);
    return new Promise((resolve) => {
      this.flying = true;
      this.camera.flyToBoundingSphere(new BoundingSphere(center, 0), {
        offset: new HeadingPitchRange(heading, pitch, range),
        duration,
        easingFunction: EasingFunction.CUBIC_IN_OUT,
        complete: () => {
          this.flying = false;
          resolve(true);
        },
        cancel: () => {
          this.flying = false;
          resolve(false);
        },
      });
    });
  }

  /**
   * Frames a structure: the camera looks at a point `lift` metres above the
   * ground from `range` metres away, then (unless motion is reduced) circles it.
   */
  async focus(target: LatLon, opts: { range: number; lift?: number; pitch?: number; orbit?: boolean }): Promise<boolean> {
    this.stopOrbit();
    this.record();
    const lift = opts.lift ?? 0;
    const pitch = CesiumMath.toRadians(opts.pitch ?? -24);
    // Elevation tiles are heights above sea level and Google's mesh is above the ellipsoid,
    // which differ by tens of metres, so the first flight stops a little high and the
    // shot is then settled onto the real surface.
    const estimate = Math.max(0, await this.groundOf(target, 3000)) * (this.widget.scene.verticalExaggeration || 1);
    let center = Cartesian3.fromDegrees(target.lon, target.lat, estimate + lift + 120);
    let done = await this.flyAround(center, pitch, opts.range, this.duration(this.centerPoint(), target, opts.range));
    if (!done) return false;
    const mesh = await this.meshGround(target, Math.max(40, opts.range * 0.25));
    const ground = mesh ?? estimate;
    center = Cartesian3.fromDegrees(target.lon, target.lat, ground + lift);
    done = await this.flyAround(center, pitch, opts.range, this.reducedMotion() ? 0 : 1.2);
    if (!done) return false;
    // Circling keeps the camera moving, so tell listeners the view has arrived first.
    const v = this.view();
    for (const fn of this.settleListeners) fn(v);
    if (opts.orbit !== false && !this.reducedMotion()) this.orbit(center, opts.range, pitch);
    return true;
  }

  private flyAround(center: Cartesian3, pitch: number, range: number, duration: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.flying = true;
      this.camera.flyToBoundingSphere(new BoundingSphere(center, 0), {
        offset: new HeadingPitchRange(this.camera.heading, pitch, range),
        duration,
        easingFunction: EasingFunction.CUBIC_IN_OUT,
        complete: () => {
          this.flying = false;
          resolve(true);
        },
        cancel: () => {
          this.flying = false;
          resolve(false);
        },
      });
    });
  }

  /**
   * Ground height under a structure on the 3D mesh: the lowest of six samples
   * on a ring around it, so the structure's own roof does not count. Samples
   * whatever is drawn (the mesh, or the globe where there is none); null when
   * nothing answers in time.
   */
  private async meshGround(target: LatLon, radiusM: number): Promise<number | null> {
    const scene = this.widget.scene;
    if (!scene.sampleHeightSupported) return null;
    const dLat = radiusM / 111_320;
    const dLon = radiusM / (111_320 * Math.max(0.2, Math.cos(CesiumMath.toRadians(target.lat))));
    const points = Array.from({ length: 6 }, (_, k) => {
      const a = (k / 6) * Math.PI * 2;
      return Cartographic.fromDegrees(target.lon + Math.cos(a) * dLon, target.lat + Math.sin(a) * dLat);
    });
    const lowest = (hs: Array<number | undefined>) => {
      const ok = hs.filter((h): h is number => Number.isFinite(h));
      return ok.length ? Math.min(...ok) : null;
    };
    try {
      // The most detailed answer loads the finest tiles, which can take a while on a slow line.
      const sampled = await Promise.race([scene.sampleHeightMostDetailed(points.map((c) => c.clone())), new Promise<null>((r) => setTimeout(() => r(null), 12_000))]);
      const best = sampled ? lowest(sampled.map((c) => c?.height)) : null;
      if (best != null) return best;
    } catch {
      /* fall through to what is loaded now */
    }
    return lowest(points.map((c) => scene.sampleHeight(c)));
  }

  private orbitStop: (() => void) | null = null;
  private readonly orbitListeners = new Set<(on: boolean) => void>();

  /** Fires when circling starts or stops. */
  onOrbit(fn: (on: boolean) => void): () => void {
    this.orbitListeners.add(fn);
    return () => this.orbitListeners.delete(fn);
  }

  isOrbiting(): boolean {
    return !!this.orbitStop;
  }

  /**
   * Circles the camera around `center` at about 5 degrees a second. Any drag,
   * scroll, touch or key hands control straight back.
   */
  orbit(center: Cartesian3, range?: number, pitch?: number): void {
    this.stopOrbit();
    const camera = this.camera;
    const canvas = this.widget.scene.canvas;
    const r = range ?? Cartesian3.distance(camera.positionWC, center);
    const p = pitch ?? Math.min(-0.15, camera.pitch);
    const transform = Transforms.eastNorthUpToFixedFrame(center);
    let heading = camera.heading;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      heading += ((now - last) / 1000) * CesiumMath.toRadians(5);
      last = now;
      camera.lookAtTransform(transform, new HeadingPitchRange(heading, p, r));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const stop = () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', stop);
      canvas.removeEventListener('wheel', stop);
      window.removeEventListener('keydown', stop);
      camera.lookAtTransform(Matrix4.IDENTITY);
      this.orbitStop = null;
      for (const fn of this.orbitListeners) fn(false);
    };
    canvas.addEventListener('pointerdown', stop, { once: true });
    canvas.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('keydown', stop, { once: true });
    this.orbitStop = stop;
    for (const fn of this.orbitListeners) fn(true);
  }

  /** Circles whatever is at the centre of the screen. */
  orbitCenter(): boolean {
    const scene = this.widget.scene;
    const c = new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
    const hit = this.surfaceAt(c);
    if (!hit) return false;
    this.orbit(hit);
    return true;
  }

  stopOrbit(): void {
    this.orbitStop?.();
  }

  /** The visible surface under a screen point: 3D tiles when the globe is hidden, else the globe, else the ellipsoid. */
  surfaceAt(pos: Cartesian2): Cartesian3 | undefined {
    const scene = this.widget.scene;
    if (!scene.globe.show && scene.pickPositionSupported) {
      const p = scene.pickPosition(pos);
      if (p) return p;
    }
    const ray = this.camera.getPickRay(pos);
    return (ray && scene.globe.pick(ray, scene)) ?? this.camera.pickEllipsoid(pos, scene.globe.ellipsoid);
  }

  /** Frames an area such as a city's bounding box. */
  frame(b: BBox, opts: { record?: boolean } = {}): Promise<boolean> {
    this.stopOrbit();
    if (opts.record !== false) this.record();
    const rect = Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
    const center = Rectangle.center(rect);
    const to = { lat: CesiumMath.toDegrees(center.latitude), lon: CesiumMath.toDegrees(center.longitude) };
    return new Promise((resolve) => {
      this.flying = true;
      this.camera.flyTo({
        destination: rect,
        duration: this.duration(this.centerPoint(), to, 50_000),
        easingFunction: EasingFunction.CUBIC_IN_OUT,
        complete: () => {
          this.flying = false;
          resolve(true);
        },
        cancel: () => {
          this.flying = false;
          resolve(false);
        },
      });
    });
  }

  /** Changes scale over the current centre point (the ladder). */
  toBand(id: ScaleBand['id']): Promise<boolean> {
    const band = SCALE_BANDS.find((b) => b.id === id)!;
    const center = this.centerPoint() ?? { lat: 20, lon: 78 };
    return this.lookAt(center, band.target);
  }

  home(): Promise<boolean> {
    const c = this.centerPoint();
    return this.lookAt({ lat: c ? Math.max(-30, Math.min(30, c.lat)) : 18, lon: c?.lon ?? 78 }, 18_000_000, { pitch: -90, heading: 0 });
  }

  back(): Promise<boolean> {
    this.stopOrbit();
    const prev = this.history.pop();
    if (!prev) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.flying = true;
      this.camera.flyTo({
        destination: prev.position,
        orientation: { heading: prev.heading, pitch: prev.pitch, roll: prev.roll },
        duration: this.reducedMotion() ? 0 : 1.6,
        easingFunction: EasingFunction.CUBIC_IN_OUT,
        complete: () => {
          this.flying = false;
          resolve(true);
        },
        cancel: () => {
          this.flying = false;
          resolve(false);
        },
      });
    });
  }

  restore(s: CameraState): Promise<boolean> {
    this.stopOrbit();
    this.record();
    return new Promise((resolve) => {
      this.camera.flyTo({
        destination: s.position,
        orientation: { heading: s.heading, pitch: s.pitch, roll: s.roll },
        duration: this.reducedMotion() ? 0 : 2,
        complete: () => resolve(true),
        cancel: () => resolve(false),
      });
    });
  }

  /** Tilts the view about the centre point. Positive tilts towards the horizon. */
  tilt(deltaDeg: number): void {
    this.stopOrbit();
    const c = this.centerPoint();
    if (!c) return;
    const pitch = Math.max(-90, Math.min(-12, CesiumMath.toDegrees(this.camera.pitch) + deltaDeg));
    void this.lookAt(c, this.altitude(), { pitch, record: false });
  }

  /** Keyboard rotation and zoom, scaled to altitude so a key press feels the same at every scale. */
  nudge(kind: 'left' | 'right' | 'up' | 'down' | 'in' | 'out'): void {
    this.stopOrbit();
    const alt = this.altitude();
    const angle = Math.min(0.35, Math.max(0.00002, alt / 6.4e7));
    const cam = this.camera;
    switch (kind) {
      case 'left':
        cam.rotateRight(angle);
        break;
      case 'right':
        cam.rotateLeft(angle);
        break;
      case 'up':
        cam.rotateDown(angle);
        break;
      case 'down':
        cam.rotateUp(angle);
        break;
      case 'in':
        cam.zoomIn(alt * 0.35);
        break;
      case 'out':
        cam.zoomOut(alt * 0.5);
        break;
    }
  }

  cancel(): void {
    this.camera.cancelFlight();
    this.flying = false;
  }
}
