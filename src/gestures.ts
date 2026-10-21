import { HandTracker, type HandFrame } from './hands';
import type { Stage } from './stage';
import { ui } from './ui';

interface App {
  stage: Stage;
  setExplode: (v: number) => void;
  focusPart: (i: number) => void;
  unfocus: () => void;
  readonly explode: number;
}

/**
 * Maps hand poses onto the hologram.
 * - Open palm held: explode follows how far the hand is from the camera (closer = wider).
 * - Fist: assemble.
 * - Any pose, hand moving sideways: turns the model (velocity, not position, so the hand can rest).
 * - Point: aims a cursor; pinch while aiming picks that part.
 * - Two open hands: distance between them zooms.
 * Every action needs the pose held for a few frames, so passing gestures don't fire.
 */
export class GestureControl {
  private tracker: HandTracker;
  private cursor: HTMLDivElement;
  private caption: HTMLElement;
  private lastPalmX: number | null = null;
  private poseRun = { pose: '', frames: 0 };
  private pinchLatched = false;
  private twoHandBase: number | null = null;
  private baseZoom = 0;
  private openSizeBase: number | null = null;
  enabled = false;
  private app: App;

  constructor(app: App) {
    this.app = app;
    const video = document.getElementById('cam-video') as HTMLVideoElement;
    const overlay = document.getElementById('cam-overlay') as HTMLCanvasElement;
    this.caption = document.getElementById('cam-caption')!;
    this.tracker = new HandTracker(video, overlay);
    this.tracker.onFrame = (f) => this.onFrame(f);
    this.cursor = document.createElement('div');
    this.cursor.className = 'hand-cursor';
    this.cursor.hidden = true;
    document.body.appendChild(this.cursor);
  }

  get camera() { return this.tracker; }

  async toggle(): Promise<boolean> {
    const cam = document.getElementById('cam') as HTMLElement;
    if (this.enabled) {
      this.tracker.stop();
      this.enabled = false;
      cam.hidden = true;
      this.cursor.hidden = true;
      return false;
    }
    cam.hidden = false;
    this.caption.textContent = 'Starting camera';
    try {
      await this.tracker.start();
      this.enabled = true;
      ui.log('hands online. open your palm', 'sys');
      return true;
    } catch (err) {
      console.error(err);
      cam.hidden = true;
      ui.toast('Camera blocked. Allow camera access in the browser bar, then try again.');
      return false;
    }
  }

  private onFrame(f: HandFrame) {
    const { stage } = this.app;
    const hands = f.hands;
    if (!hands.length) {
      this.caption.textContent = 'Hands: show me your hand';
      this.cursor.hidden = true;
      this.lastPalmX = null;
      this.twoHandBase = null;
      this.openSizeBase = null;
      return;
    }

    // Two open hands: zoom by spreading them apart.
    if (hands.length === 2 && hands.every((h) => h.pose === 'open')) {
      const d = Math.hypot(hands[0].palm.x - hands[1].palm.x, hands[0].palm.y - hands[1].palm.y);
      if (this.twoHandBase === null) { this.twoHandBase = d; this.baseZoom = stage.camera.position.distanceTo(stage.controls.target); }
      const want = Math.min(12, Math.max(3, this.baseZoom * (this.twoHandBase / Math.max(d, 0.05))));
      const off = stage.camera.position.clone().sub(stage.controls.target).setLength(want);
      stage.camera.position.copy(stage.controls.target).add(off);
      stage.userZoomed = true;
      this.caption.textContent = 'Two hands: zoom';
      return;
    }
    this.twoHandBase = null;

    const h = hands[0];
    if (h.pose === this.poseRun.pose) this.poseRun.frames++;
    else this.poseRun = { pose: h.pose, frames: 1 };
    const held = this.poseRun.frames >= 4;

    // Turn: sideways palm velocity becomes spin. Ignore tiny drift.
    if (this.lastPalmX !== null && h.pose !== 'pinch') {
      const dx = h.palm.x - this.lastPalmX;
      if (Math.abs(dx) > 0.004) stage.spin += dx * 160;
    }
    this.lastPalmX = h.palm.x;

    if (held && h.pose === 'open') {
      // Closer hand = bigger palm = wider explode, measured from where the palm started.
      if (this.openSizeBase === null) this.openSizeBase = h.size;
      const rel = (h.size / this.openSizeBase - 1) * 2.4;
      this.app.setExplode(Math.max(this.app.explode, Math.min(1, 0.55 + rel)));
    } else {
      this.openSizeBase = null;
    }
    if (held && h.pose === 'fist') this.app.setExplode(Math.max(0, this.app.explode - 0.06));

    // Point + pinch to pick.
    const aiming = h.pose === 'point' || h.pose === 'pinch';
    if (aiming) {
      const r = stage.renderer.domElement.getBoundingClientRect();
      const x = r.left + h.tip.x * r.width;
      const y = r.top + h.tip.y * r.height;
      this.cursor.hidden = false;
      this.cursor.style.transform = `translate(${x}px, ${y}px)`;
      this.cursor.classList.toggle('pinch', h.pose === 'pinch');
      const ndcX = h.tip.x * 2 - 1, ndcY = -(h.tip.y * 2 - 1);
      const i = stage.model ? stage.model.pick(stage.rayFrom(ndcX, ndcY)) : -1;
      stage.model?.setHot(i);
      if (h.pose === 'pinch' && !this.pinchLatched && this.poseRun.frames >= 3) {
        this.pinchLatched = true;
        if (i >= 0) this.app.focusPart(i); else this.app.unfocus();
      }
    } else {
      this.cursor.hidden = true;
    }
    if (h.pose !== 'pinch') this.pinchLatched = false;

    const label: Record<string, string> = { open: 'Open palm: explode', fist: 'Fist: assemble', point: 'Point: aim', pinch: 'Pinch: pick', other: 'Hand seen' };
    this.caption.textContent = `Hands: ${label[h.pose]}`;
  }
}
