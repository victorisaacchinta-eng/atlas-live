import * as THREE from 'three';
import { HOLO } from './hologram';
import { theme } from './theme';
import type { Hologram, HoloPart } from './model';

export interface ScanResult {
  object: string;
  category: string;
  summary: string;
  object_box: [number, number, number, number];
  parts: { name: string; role: string; box: [number, number, number, number] }[];
  model?: string;
}

type DepthPipe = (img: string) => Promise<{ predicted_depth?: { data: Float32Array; dims: number[] }; depth: { data: Uint8ClampedArray | Uint8Array; width: number; height: number } }>;

let depthPipe: DepthPipe | null = null;

/** Loads Depth Anything V2 (small) in the browser. WebGPU when available, WASM otherwise. */
export async function loadDepth(onProgress?: (p: number) => void): Promise<DepthPipe> {
  if (depthPipe) return depthPipe;
  const tf = await import('@huggingface/transformers');
  const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const opts = (device: 'webgpu' | 'wasm') => ({
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
    progress_callback: (e: { status: string; progress?: number }) => { if (e.status === 'progress' && e.progress) onProgress?.(e.progress / 100); },
  });
  try {
    depthPipe = (await tf.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', opts(hasGpu ? 'webgpu' : 'wasm') as never)) as unknown as DepthPipe;
  } catch (err) {
    if (!hasGpu) throw err;
    depthPipe = (await tf.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', opts('wasm') as never)) as unknown as DepthPipe;
  }
  return depthPipe;
}

/** Ask Nemotron what the object is. Falls back to an unnamed scan when the server has no key. */
export async function identify(image: string): Promise<ScanResult | null> {
  try {
    const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
    const j = await r.json();
    if (!r.ok || j.error) { console.warn('scan identify failed', j.error); return null; }
    return j as ScanResult;
  } catch (err) {
    console.warn(err);
    return null;
  }
}

interface Pixels { data: Uint8ClampedArray; width: number; height: number }

async function readPixels(image: string, maxSide = 320): Promise<Pixels> {
  const img = new Image();
  img.src = image;
  await img.decode();
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, w, h);
  return { data: g.getImageData(0, 0, w, h).data, width: w, height: h };
}

/** Resample a depth map to the colour grid. Values are relative inverse depth: bigger is nearer. */
function depthAt(depth: { data: ArrayLike<number>; width: number; height: number }, u: number, v: number) {
  const x = Math.min(depth.width - 1, Math.max(0, Math.round(u * (depth.width - 1))));
  const y = Math.min(depth.height - 1, Math.max(0, Math.round(v * (depth.height - 1))));
  return depth.data[y * depth.width + x];
}

const pointVertex = /* glsl */ `
  attribute float aShade;
  uniform float uSize;
  uniform float uTime;
  varying float vShade;
  void main() {
    vShade = aShade;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (6.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const pointFragment = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uHotColor;
  uniform vec3 uGround;
  uniform float uHot;
  uniform float uDim;
  varying float vShade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    vec3 ink = mix(uInk, uHotColor, uHot);
    float k = (0.35 + vShade * 0.65) * (1.0 - uDim * 0.7);
    gl_FragColor = vec4(mix(uGround, ink, k), 1.0);
  }
`;

function pointMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uInk: { value: HOLO.bone.clone() },
      uHotColor: { value: HOLO.signal.clone() },
      uGround: { value: HOLO.ground.clone() },
      uHot: { value: 0 },
      uDim: { value: 0 },
      uSize: { value: theme.glow ? 3.2 : 3.6 },
      uTime: { value: 0 },
    },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
  });
}

/**
 * A scanned object as a point-cloud hologram. Each part the vision model named is its own
 * point cloud; whatever no part claims becomes the body. Exploding moves parts out from the body.
 */
export class ScanModel implements Hologram {
  readonly root = new THREE.Group();
  parts: HoloPart[] = [];
  roles: string[] = [];
  explode = 0;
  private hot = -1;
  private focus = -1;
  private mats: THREE.ShaderMaterial[] = [];
  private printed = 0;

  static async build(image: string, scan: ScanResult | null, onStep: (s: string) => void): Promise<ScanModel> {
    onStep('reading depth');
    const pipe = await loadDepth((p) => onStep(`loading depth model ${Math.round(p * 100)}%`));
    const out = await pipe(image);
    const depth = out.predicted_depth
      ? { data: out.predicted_depth.data, width: out.predicted_depth.dims[out.predicted_depth.dims.length - 1], height: out.predicted_depth.dims[out.predicted_depth.dims.length - 2] }
      : { data: out.depth.data, width: out.depth.width, height: out.depth.height };
    const px = await readPixels(image);
    onStep('building hologram');
    const m = new ScanModel();
    m.assemble(px, depth, scan);
    return m;
  }

  private assemble(px: Pixels, depth: { data: ArrayLike<number>; width: number; height: number }, scan: ScanResult | null) {
    const box = scan?.object_box || [0.12, 0.08, 0.88, 0.92];
    const parts = scan?.parts?.length ? scan.parts : [];
    // Depth range inside the object box, so near and far are measured on the object, not the room.
    let dmin = Infinity, dmax = -Infinity;
    for (let v = box[1]; v <= box[3]; v += 0.02) for (let u = box[0]; u <= box[2]; u += 0.02) {
      const d = depthAt(depth, u, v); if (d < dmin) dmin = d; if (d > dmax) dmax = d;
    }
    const span = Math.max(1e-6, dmax - dmin);
    // Keep the nearest 70% of the box: the background behind the object drops out.
    const cutoff = dmin + span * 0.3;

    const buckets = new Map<number, { pos: number[]; shade: number[] }>();
    const bucket = (k: number) => { if (!buckets.has(k)) buckets.set(k, { pos: [], shade: [] }); return buckets.get(k)!; };
    const bw = box[2] - box[0], bh = box[3] - box[1];
    const aspect = (bw * px.width) / (bh * px.height);
    // Longest side becomes 2.4 units, like the library models.
    const width = aspect >= 1 ? 2.4 : 2.4 * aspect;
    const height = aspect >= 1 ? 2.4 / aspect : 2.4;
    const step = 1;

    for (let y = 0; y < px.height; y += step) for (let x = 0; x < px.width; x += step) {
      const u = x / (px.width - 1), v = y / (px.height - 1);
      if (u < box[0] || u > box[2] || v < box[1] || v > box[3]) continue;
      const d = depthAt(depth, u, v);
      if (d < cutoff) continue;
      // Which named part owns this pixel: the smallest box that contains it.
      let owner = -1, ownerArea = Infinity;
      parts.forEach((p, i) => {
        const [a, b, c, e] = p.box;
        if (u >= a && u <= c && v >= b && v <= e) { const area = (c - a) * (e - b); if (area < ownerArea) { ownerArea = area; owner = i; } }
      });
      const near = (d - dmin) / span;
      const i4 = (y * px.width + x) * 4;
      const lum = (px.data[i4] * 0.3 + px.data[i4 + 1] * 0.59 + px.data[i4 + 2] * 0.11) / 255;
      const X = ((u - box[0]) / bw - 0.5) * width;
      const Y = (1 - (v - box[1]) / bh) * height + 0.05;
      // Depth gets a gentle curve so near surfaces bulge forward and the cloud reads as a solid.
      const Z = (Math.pow(near, 0.8) - 0.5) * Math.max(width, height) * 0.42;
      const bk = bucket(owner);
      bk.pos.push(X, Y, Z);
      bk.shade.push(0.25 + lum * 0.55 + near * 0.2);
    }

    const center = new THREE.Vector3(0, height / 2 + 0.05, 0);
    const order = [...buckets.keys()].sort((a, b) => a - b);
    for (const k of order) {
      const b = buckets.get(k)!;
      if (b.pos.length < 30) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('aShade', new THREE.Float32BufferAttribute(b.shade, 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const mat = pointMaterial();
      this.mats.push(mat);
      const pts = new THREE.Points(g, mat);
      pts.userData.partIndex = this.parts.length;
      const pivot = new THREE.Group();
      pivot.add(pts);
      this.root.add(pivot);
      const c = g.boundingBox!.getCenter(new THREE.Vector3());
      const dir = c.clone().sub(center);
      dir.z += 0.25; // pull parts toward the viewer so they lift off the body
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
      const isBody = k < 0;
      const name = isBody ? (parts.length ? 'Body' : 'Scanned object') : parts[k].name;
      this.roles.push(isBody ? '' : parts[k].role);
      this.parts.push({ index: this.parts.length, name, object: pivot, home: new THREE.Vector3(), out: isBody ? new THREE.Vector3(0, 0, -0.3) : dir.normalize().multiplyScalar(0.55), center: c });
    }
    this.root.position.y = 0.02;
  }

  setHot(i: number) { this.hot = i; }
  setFocus(i: number) { this.focus = i; }
  get focused() { return this.focus; }

  pick(ray: THREE.Raycaster): number {
    ray.params.Points = { threshold: 0.04 };
    const objs: THREE.Object3D[] = [];
    this.parts.forEach((p) => p.object.traverse((o) => { if ((o as THREE.Points).isPoints) objs.push(o); }));
    const hit = ray.intersectObjects(objs, false)[0];
    return hit ? (hit.object.userData.partIndex as number) : -1;
  }

  anchor(i: number, target = new THREE.Vector3()) {
    return new THREE.Box3().setFromObject(this.parts[i].object).getCenter(target);
  }

  update(dt: number, time: number) {
    this.printed = Math.min(1, this.printed + dt * 0.8);
    const e = this.explode < 0.5 ? 4 * this.explode ** 3 : 1 - Math.pow(-2 * this.explode + 2, 3) / 2;
    this.parts.forEach((p, i) => {
      const focus = i === this.focus;
      p.object.position.copy(p.home).addScaledVector(p.out, e * (focus ? 1.3 : 1));
      p.object.scale.setScalar(0.6 + 0.4 * this.printed);
      const u = this.mats[i].uniforms;
      u.uTime.value = time;
      const hot = i === this.hot || focus ? 1 : 0;
      const dim = this.focus >= 0 && !focus ? 1 : 0;
      u.uHot.value += (hot - u.uHot.value) * Math.min(1, dt * 10);
      u.uDim.value += (dim - u.uDim.value) * Math.min(1, dt * 6);
    });
  }

  dispose() {
    this.root.traverse((o) => { const m = o as THREE.Points; if (m.geometry) m.geometry.dispose(); });
    this.mats.forEach((m) => m.dispose());
  }
}
