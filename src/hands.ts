import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Pinned to the installed package so the wasm matches the JS. */
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export type Pose = 'open' | 'fist' | 'point' | 'pinch' | 'other';

export interface HandFrame {
  /** Hands seen this frame (max 2). */
  hands: TrackedHand[];
}

export interface TrackedHand {
  pose: Pose;
  /** Mirrored screen space 0..1, smoothed: index fingertip. */
  tip: { x: number; y: number };
  /** Mirrored screen space 0..1, smoothed: palm centre. */
  palm: { x: number; y: number };
  /** Palm width in normalised units; grows as the hand comes closer. */
  size: number;
  landmarks: NormalizedLandmark[];
}

/** One Euro filter (Casiez et al., CHI 2012): low jitter at rest, low lag in fast moves. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }
  private alpha(cutoff: number, dt: number) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v: number, tMs: number): number {
    if (this.x === null) { this.x = v; this.t = tMs; return v; }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const d = (v - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}

const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.6);

/** Finger is extended when its tip is clearly farther from the wrist than its middle joint. */
function extended(l: NormalizedLandmark[], tip: number, pip: number) {
  return dist(l[tip], l[0]) > dist(l[pip], l[0]) * 1.12;
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement;
  private overlay: HTMLCanvasElement;
  private running = false;
  private lastTs = -1;
  private filters = [0, 1].map(() => ({ tx: new OneEuro(), ty: new OneEuro(), px: new OneEuro(0.8), py: new OneEuro(0.8) }));
  /** Pinch needs hysteresis: closes under 0.32 palm widths, opens over 0.48. */
  private pinched = [false, false];
  onFrame: ((f: HandFrame) => void) | null = null;

  constructor(video: HTMLVideoElement, overlay: HTMLCanvasElement) {
    this.video = video;
    this.overlay = overlay;
  }

  async start() {
    if (this.running) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    this.video.srcObject = stream;
    await this.video.play();
    if (!this.landmarker) {
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
    }
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    const s = this.video.srcObject as MediaStream | null;
    s?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.filters.forEach((f) => Object.values(f).forEach((o) => o.reset()));
  }

  /** The current camera frame as a JPEG data URL, for SCAN. */
  snapshot(maxSide = 768): string | null {
    if (!this.video.videoWidth) return null;
    const s = Math.min(1, maxSide / Math.max(this.video.videoWidth, this.video.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(this.video.videoWidth * s);
    c.height = Math.round(this.video.videoHeight * s);
    c.getContext('2d')!.drawImage(this.video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.86);
  }

  get stream(): MediaStream | null { return (this.video.srcObject as MediaStream) || null; }

  private loop = () => {
    if (!this.running || !this.landmarker) return;
    const now = performance.now();
    if (this.video.readyState >= 2 && now !== this.lastTs) {
      this.lastTs = now;
      const res = this.landmarker.detectForVideo(this.video, now);
      const hands: TrackedHand[] = [];
      res.landmarks.slice(0, 2).forEach((l, i) => hands.push(this.read(l, i, now)));
      this.draw(hands);
      this.onFrame?.({ hands });
    }
    requestAnimationFrame(this.loop);
  };

  private read(l: NormalizedLandmark[], i: number, now: number): TrackedHand {
    const f = this.filters[i];
    const palmW = Math.max(1e-3, dist(l[5], l[17]));
    const pinchD = Math.hypot(l[4].x - l[8].x, l[4].y - l[8].y) / palmW;
    if (this.pinched[i] ? pinchD > 0.48 : pinchD < 0.32) this.pinched[i] = !this.pinched[i];

    const ext = [extended(l, 8, 6), extended(l, 12, 10), extended(l, 16, 14), extended(l, 20, 18)];
    const n = ext.filter(Boolean).length;
    let pose: Pose = 'other';
    if (this.pinched[i]) pose = 'pinch';
    else if (n >= 4) pose = 'open';
    else if (n === 0) pose = 'fist';
    else if (ext[0] && !ext[1] && !ext[2]) pose = 'point';

    const cx = (l[0].x + l[5].x + l[17].x) / 3;
    const cy = (l[0].y + l[5].y + l[17].y) / 3;
    return {
      pose,
      // Mirror x so moving your hand right moves things right.
      tip: { x: f.tx.filter(1 - l[8].x, now), y: f.ty.filter(l[8].y, now) },
      palm: { x: f.px.filter(1 - cx, now), y: f.py.filter(cy, now) },
      size: palmW,
      landmarks: l,
    };
  }

  private draw(hands: TrackedHand[]) {
    const c = this.overlay;
    const w = (c.width = c.clientWidth * devicePixelRatio);
    const h = (c.height = c.clientHeight * devicePixelRatio);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    const bones = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]];
    for (const hand of hands) {
      const p = (k: number) => [(1 - hand.landmarks[k].x) * w, hand.landmarks[k].y * h];
      g.strokeStyle = hand.pose === 'pinch' ? '#FF5A1F' : '#EFE6DA';
      g.lineWidth = 1.5 * devicePixelRatio;
      for (const chain of bones) {
        g.beginPath();
        chain.forEach((k, j) => { const [x, y] = p(k); if (j) g.lineTo(x, y); else g.moveTo(x, y); });
        g.stroke();
      }
      g.fillStyle = g.strokeStyle;
      for (let k = 0; k < 21; k++) { const [x, y] = p(k); g.fillRect(x - 2, y - 2, 4, 4); }
    }
  }
}
