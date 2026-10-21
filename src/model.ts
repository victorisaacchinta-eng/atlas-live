import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HOLO, holoEdges, holoSurface } from './hologram';

/** What the stage, labels, gestures and agent need from any hologram (library model or scan). */
export interface HoloPart {
  index: number;
  name: string;
  object: THREE.Object3D;
  home: THREE.Vector3;
  out: THREE.Vector3;
  center: THREE.Vector3;
}

export interface Hologram {
  readonly root: THREE.Group;
  parts: HoloPart[];
  explode: number;
  readonly focused: number;
  setHot(i: number): void;
  setFocus(i: number): void;
  pick(ray: THREE.Raycaster): number;
  anchor(i: number, target?: THREE.Vector3): THREE.Vector3;
  update(dt: number, time: number): void;
  dispose(): void;
}

export interface Part extends HoloPart {
  index: number;
  id: string;
  name: string;
  object: THREE.Object3D;
  home: THREE.Vector3;
  /** Offset applied at full explode, in model space. */
  out: THREE.Vector3;
  center: THREE.Vector3;
  surfaces: THREE.ShaderMaterial[];
  edges: THREE.LineBasicMaterial[];
  meshes: THREE.Mesh[];
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/** Fit size: the longest side of every model becomes this many world units. */
const FIT = 2.4;
/** How many parts read well when exploded. Fewer looks empty, more turns to noise. */
const MIN_PARTS = 8;
const MAX_PARTS = 28;

export class HoloModel implements Hologram {
  readonly root = new THREE.Group();
  parts: Part[] = [];
  explode = 0;
  private hot = -1;
  private focus = -1;
  private revealTop = 3;
  private reveal = -2;

  static async load(url: string, partNames?: Record<string, string>): Promise<HoloModel> {
    const gltf = await loader.loadAsync(url);
    const m = new HoloModel();
    m.build(gltf.scene, partNames);
    return m;
  }

  /** Build from any object tree (also used for generated schematics). */
  static fromObject(obj: THREE.Object3D, partNames?: Record<string, string>): HoloModel {
    const m = new HoloModel();
    m.build(obj, partNames);
    return m;
  }

  private build(scene: THREE.Object3D, partNames?: Record<string, string>) {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = FIT / Math.max(size.x, size.y, size.z, 1e-6);
    const center = box.getCenter(new THREE.Vector3());

    // Normalise: centred on x/z, standing on y = 0.
    const holder = new THREE.Group();
    holder.scale.setScalar(scale);
    holder.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    holder.add(scene);
    this.root.add(holder);
    this.root.updateMatrixWorld(true);

    const groups = pickPartGroups(scene);
    const modelCenter = new THREE.Box3().setFromObject(this.root).getCenter(new THREE.Vector3());

    groups.forEach((g) => {
      const meshes: THREE.Mesh[] = [];
      g.objects.forEach((o) => o.traverse((c) => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); }));
      if (!meshes.length) return;

      // Re-parent every member under one pivot so a part moves as one piece.
      const pivot = new THREE.Group();
      pivot.name = g.name;
      this.root.add(pivot);
      g.objects.forEach((o) => pivot.attach(o));

      const surfaces: THREE.ShaderMaterial[] = [];
      const edges: THREE.LineBasicMaterial[] = [];
      const surf = holoSurface();
      const edge = holoEdges();
      surfaces.push(surf);
      edges.push(edge);
      for (const mesh of meshes) {
        if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
        mesh.material = surf;
        mesh.userData.partIndex = this.parts.length;
        const eg = new THREE.EdgesGeometry(mesh.geometry, 32);
        const lines = new THREE.LineSegments(eg, edge);
        lines.raycast = () => {};
        mesh.add(lines);
      }

      const pc = new THREE.Box3().setFromObject(pivot).getCenter(new THREE.Vector3());
      const dir = pc.clone().sub(modelCenter);
      // Spread mostly sideways and up; nothing explodes through the floor.
      dir.y = Math.max(dir.y, -0.15) + 0.18;
      const len = dir.length();
      if (len < 1e-3) dir.set(0, 1, 0);
      dir.normalize();
      const reach = 0.55 + Math.min(len, 1.4) * 1.25;

      this.parts.push({
        index: this.parts.length,
        id: g.name,
        name: (partNames && partNames[g.name]) || prettify(g.name),
        object: pivot,
        home: pivot.position.clone(),
        out: dir.multiplyScalar(reach),
        center: pc,
        surfaces,
        edges,
        meshes,
      });
    });

    const top = new THREE.Box3().setFromObject(this.root);
    this.revealTop = top.max.y + 0.2;
    this.reveal = top.min.y - 0.1;
  }

  /** Index of the part under a ray, or -1. */
  pick(ray: THREE.Raycaster): number {
    const meshes = this.parts.flatMap((p) => p.meshes);
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit ? (hit.object.userData.partIndex as number) : -1;
  }

  /** Skip the reveal sweep (used before taking a still for the critic). */
  finishReveal() { this.reveal = 1e4; this.update(0, 0); }

  setHot(i: number) { this.hot = i; }
  setFocus(i: number) { this.focus = i; }
  get focused() { return this.focus; }

  update(dt: number, time: number) {
    // Sweep up once; after that reveal everything, so exploded parts above the old top still show.
    if (this.reveal < this.revealTop) this.reveal += dt * 1.6;
    else this.reveal = 1e4;
    const e = easeInOut(this.explode);
    for (const p of this.parts) {
      const isFocus = p.index === this.focus;
      const lift = isFocus ? 1.25 : 1;
      p.object.position.copy(p.home).addScaledVector(p.out, e * lift);
      const hot = p.index === this.hot || isFocus ? 1 : 0;
      const dim = this.focus >= 0 && !isFocus ? 1 : 0;
      for (const s of p.surfaces) {
        const u = s.uniforms;
        u.uTime.value = time;
        u.uReveal.value = this.reveal;
        u.uHot.value += (hot - u.uHot.value) * Math.min(1, dt * 10);
        u.uDim.value += (dim - u.uDim.value) * Math.min(1, dt * 6);
      }
      for (const l of p.edges) {
        const target = dim ? 0.08 : hot ? 0.9 : 0.38;
        l.opacity += (target - l.opacity) * Math.min(1, dt * 8);
        l.color.lerpColors(HOLO.bone, HOLO.signal, p.surfaces[0].uniforms.uHot.value);
      }
    }
  }

  /** World-space anchor of a part, for labels and leader lines. */
  anchor(i: number, target = new THREE.Vector3()): THREE.Vector3 {
    const p = this.parts[i];
    return new THREE.Box3().setFromObject(p.object).getCenter(target);
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const p of this.parts) { p.surfaces.forEach((s) => s.dispose()); p.edges.forEach((e) => e.dispose()); }
  }
}

interface Group { name: string; objects: THREE.Object3D[]; }

function hasMesh(o: THREE.Object3D): boolean {
  let found = false;
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) found = true; });
  return found;
}

/**
 * Choose the level of the scene tree that gives a readable number of parts.
 * Walk down through single-child wrappers, expand the biggest group while there are
 * too few parts, and cluster by position when a flat file has hundreds of meshes.
 */
function pickPartGroups(scene: THREE.Object3D): Group[] {
  let level: THREE.Object3D[] = [scene];
  for (let guard = 0; guard < 12; guard++) {
    const withMesh = level.filter(hasMesh);
    if (withMesh.length >= MIN_PARTS) { level = withMesh; break; }
    // Expand the member with the most children.
    let best = -1, bestCount = 0;
    withMesh.forEach((o, i) => { const n = o.children.filter(hasMesh).length; if (n > bestCount) { bestCount = n; best = i; } });
    if (best < 0 || bestCount <= 1 && withMesh.length > 1) { level = withMesh; break; }
    const expanded = withMesh[best];
    const kids = expanded.children.filter(hasMesh);
    if (!kids.length) { level = withMesh; break; }
    level = [...withMesh.slice(0, best), ...kids, ...withMesh.slice(best + 1)];
  }

  if (level.length <= MAX_PARTS) return level.map((o) => ({ name: o.name || `part_${o.id}`, objects: [o] }));
  return clusterByPosition(level, MAX_PARTS - 4);
}

function clusterByPosition(objs: THREE.Object3D[], k: number): Group[] {
  const pts = objs.map((o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()));
  // k-means++ style seeding by farthest point, then a few Lloyd iterations.
  const centers: THREE.Vector3[] = [pts[0].clone()];
  while (centers.length < k) {
    let far = 0, farD = -1;
    pts.forEach((p, i) => { const d = Math.min(...centers.map((c) => c.distanceToSquared(p))); if (d > farD) { farD = d; far = i; } });
    centers.push(pts[far].clone());
  }
  let assign = new Array(pts.length).fill(0);
  for (let it = 0; it < 8; it++) {
    assign = pts.map((p) => { let b = 0, bd = Infinity; centers.forEach((c, j) => { const d = c.distanceToSquared(p); if (d < bd) { bd = d; b = j; } }); return b; });
    centers.forEach((c, j) => {
      const mine = pts.filter((_, i) => assign[i] === j);
      if (mine.length) c.copy(mine.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(mine.length));
    });
  }
  const groups: Group[] = [];
  centers.forEach((_, j) => {
    const members = objs.filter((_, i) => assign[i] === j);
    if (!members.length) return;
    groups.push({ name: commonName(members.map((m) => m.name)) || `section_${j + 1}`, objects: members });
  });
  return groups;
}

/** The most frequent meaningful word across member names, so clusters get a sensible label. */
function commonName(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const words = n.split(/[:_.\-\s]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w) && !/^v\d+$/i.test(w));
    const last = words.slice(-3);
    for (const w of new Set(last)) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) || 0) + 1);
  }
  let best = '', bc = 0;
  counts.forEach((c, w) => { if (c > bc) { bc = c; best = w; } });
  return best;
}

export function prettify(id: string): string {
  const s = id
    .replace(/^.*:/, '')
    .replace(/\.\d+$/, '')
    .replace(/_(obj|objs)$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+\d+$/, '')
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Part';
}

function easeInOut(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
