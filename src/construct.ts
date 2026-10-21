import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HoloModel } from './model';

/**
 * Turn a Construct blueprint (parts made of primitives in the shape grammar, see api/construct.ts)
 * into a hologram you can explode. Each part becomes one group; its primitives, repeats included,
 * are merged into a single mesh so the hologram stays light.
 */

export interface Prim {
  type: string;
  at: number[];
  rot?: number[];
  size?: number[];
  r?: number; r2?: number; h?: number; tube?: number; t?: number; sides?: number;
  ring?: { n: number; r: number };
  row?: { n: number; step: number[] };
  mirror?: 'x' | 'z' | 'xz';
}
export interface BuiltPart { id: string; name: string; role: string; prims: Prim[]; zone?: string }

const D2R = THREE.MathUtils.DEG2RAD;

/** Geometry for one primitive, with its bottom centre at the origin. */
function shape(p: Prim): THREE.BufferGeometry | null {
  const s = p.size || [1, 1, 1];
  const r = p.r ?? 1, h = p.h ?? r;
  let g: THREE.BufferGeometry | null = null;
  switch (p.type) {
    case 'box': g = new THREE.BoxGeometry(s[0], s[1], s[2]).translate(0, s[1] / 2, 0); break;
    case 'cylinder': g = new THREE.CylinderGeometry(p.r2 ?? r, r, p.h ?? 1, p.sides ?? 24).translate(0, (p.h ?? 1) / 2, 0); break;
    case 'cone': g = new THREE.ConeGeometry(r, p.h ?? 1, p.sides ?? 24).translate(0, (p.h ?? 1) / 2, 0); break;
    case 'spire': g = new THREE.ConeGeometry(r, p.h ?? r * 8, 8).translate(0, (p.h ?? r * 8) / 2, 0); break;
    case 'dome': g = new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, h / r, 1); break;
    case 'sphere': g = new THREE.SphereGeometry(r, 20, 14).translate(0, r, 0); break;
    case 'torus': g = new THREE.TorusGeometry(r, p.tube ?? r * 0.1, 8, 32).rotateX(Math.PI / 2).translate(0, p.tube ?? r * 0.1, 0); break;
    case 'pyramid': g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(s[0], s[1], s[2]).translate(0, s[1] / 2, 0); break;
    case 'onion': {
      // A bulb that swells past its base, then draws in to a point.
      const pts: THREE.Vector2[] = [];
      const hh = p.h ?? r * 1.6;
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const y = t * hh;
        const w = t < 0.75 ? Math.sin((t / 0.75) * Math.PI * 0.62) * 1.0 + 0.62 * (1 - t / 0.75) * 0.6 : (1 - (t - 0.75) / 0.25) * 0.98;
        pts.push(new THREE.Vector2(Math.max(0.001, w * r * (t < 0.06 ? 0.7 + t * 5 : 1)), y));
      }
      g = new THREE.LatheGeometry(pts, 24);
      break;
    }
    case 'gable': {
      const tri = new THREE.Shape([new THREE.Vector2(-s[0] / 2, 0), new THREE.Vector2(s[0] / 2, 0), new THREE.Vector2(0, s[1])]);
      g = new THREE.ExtrudeGeometry(tri, { depth: s[2], bevelEnabled: false }).translate(0, 0, -s[2] / 2);
      break;
    }
    case 'arch': {
      const [w, ht, d] = s;
      const t = Math.min(p.t ?? Math.min(w, ht) * 0.18, w * 0.45);
      const ow = w / 2, iw = Math.max(0.01, ow - t), springY = Math.max(0.01, ht - t - iw);
      const outer = new THREE.Shape([new THREE.Vector2(-ow, 0), new THREE.Vector2(ow, 0), new THREE.Vector2(ow, ht), new THREE.Vector2(-ow, ht)]);
      const hole = new THREE.Path();
      hole.moveTo(-iw, 0);
      hole.lineTo(iw, 0);
      hole.lineTo(iw, springY);
      hole.absarc(0, springY, iw, 0, Math.PI, false);
      hole.lineTo(-iw, 0);
      outer.holes.push(hole);
      g = new THREE.ExtrudeGeometry(outer, { depth: d, bevelEnabled: false, curveSegments: 12 }).translate(0, 0, -d / 2);
      break;
    }
  }
  if (g && g.index) g = g.toNonIndexed();
  return g;
}

/** Every placement of a primitive after ring, row and mirror repeats. */
function placements(p: Prim): THREE.Matrix4[] {
  const base = new THREE.Vector3(p.at[0], p.at[1], p.at[2]);
  const rot = new THREE.Euler((p.rot?.[0] ?? 0) * D2R, (p.rot?.[1] ?? 0) * D2R, (p.rot?.[2] ?? 0) * D2R);
  let list: { pos: THREE.Vector3; yaw: number }[] = [{ pos: base, yaw: 0 }];
  if (p.ring && p.ring.n > 1 || p.ring?.r) {
    const n = p.ring!.n, rr = p.ring!.r;
    list = list.flatMap((l) => Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + Math.PI / 4;
      return { pos: l.pos.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr)), yaw: -a };
    }));
  }
  if (p.row && p.row.n > 1) {
    const st = new THREE.Vector3(...(p.row.step as [number, number, number]));
    list = list.flatMap((l) => Array.from({ length: p.row!.n }, (_, i) => ({ pos: l.pos.clone().addScaledVector(st, i), yaw: l.yaw })));
  }
  if (p.mirror) {
    const mx = p.mirror.includes('x'), mz = p.mirror.includes('z');
    list = list.flatMap((l) => {
      const out = [l];
      if (mx) out.push({ pos: new THREE.Vector3(-l.pos.x, l.pos.y, l.pos.z), yaw: Math.PI - l.yaw });
      if (mz) out.push(...out.map((o) => ({ pos: new THREE.Vector3(o.pos.x, o.pos.y, -o.pos.z), yaw: -o.yaw })));
      return out;
    });
  }
  return list.map(({ pos, yaw }) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(new THREE.Quaternion().setFromEuler(rot));
    return new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  });
}

/** Group of one mesh per part, named by part id. */
export function assemble(parts: BuiltPart[]): THREE.Group {
  const root = new THREE.Group();
  for (const part of parts) {
    const geos: THREE.BufferGeometry[] = [];
    for (const p of part.prims) {
      const g0 = shape(p);
      if (!g0) continue;
      for (const m of placements(p)) geos.push(g0.clone().applyMatrix4(m));
      g0.dispose();
    }
    if (!geos.length) continue;
    const merged = mergeGeometries(geos.map((g) => { g.deleteAttribute('uv'); return g; }), false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeVertexNormals();
    const group = new THREE.Group();
    group.name = part.id;
    const mesh = new THREE.Mesh(merged);
    mesh.name = part.id;
    group.add(mesh);
    root.add(group);
  }
  return root;
}

export function toHologram(parts: BuiltPart[]) {
  const names: Record<string, string> = {};
  for (const p of parts) names[p.id] = p.name;
  return HoloModel.fromObject(assemble(parts), names);
}

/** Apply a critic's fixes to the current parts. */
export function applyFixes(parts: BuiltPart[], fix: { replace?: BuiltPart[]; add?: BuiltPart[]; remove?: string[] }): BuiltPart[] {
  const out = parts.filter((p) => !(fix.remove || []).includes(p.id)).map((p) => {
    const r = (fix.replace || []).find((x) => x.id === p.id);
    return r ? { ...r, zone: p.zone } : p;
  });
  for (const a of fix.add || []) if (!out.some((p) => p.id === a.id)) out.push(a);
  return out;
}
