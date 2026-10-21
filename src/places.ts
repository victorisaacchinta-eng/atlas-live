import * as THREE from 'three';
import SunCalc from 'suncalc';
import { HoloModel } from './model';

export interface PlaceFeature { n: string; h: number | null; l: number | null; t: string; p: [number, number][] }
export interface PlaceFact { name: string; fact: string; source?: { title: string; url: string } }
export interface PlaceData {
  query: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
  features: PlaceFeature[];
  facts: PlaceFact[];
  attribution: string;
  model?: string;
}

/** Real heights where OpenStreetMap has them, else levels x 3.2 m, else a modest default. */
function heightOf(f: PlaceFeature) {
  if (f.h && f.h > 0) return f.h;
  if (f.l && f.l > 0) return f.l * 3.2;
  return f.t === 'yes' || f.t === 'house' ? 7 : 9;
}

/**
 * Turns OpenStreetMap footprints into a hologram model. Each named landmark is its own part;
 * unnamed buildings are grouped by compass quarter, so the explode lifts the city in a few
 * readable pieces. Heights are exaggerated 2.5x so a low old city still reads as 3D; the UI says so.
 */
export function buildPlace(d: PlaceData): { model: HoloModel; names: Record<string, string>; exaggeration: number } {
  const exaggeration = 2.5;
  const root = new THREE.Group();
  const named = new Map<string, THREE.Group>();
  const quarters: Record<string, THREE.Group> = {};
  const names: Record<string, string> = {};
  const quarterName = (x: number, z: number) => {
    const a = Math.atan2(-z, x);
    if (a > Math.PI / 4 && a <= (3 * Math.PI) / 4) return 'North blocks';
    if (a > -Math.PI / 4 && a <= Math.PI / 4) return 'East blocks';
    if (a > (-3 * Math.PI) / 4 && a <= -Math.PI / 4) return 'South blocks';
    return 'West blocks';
  };

  for (const f of d.features) {
    if (f.p.length < 3) continue;
    const shape = new THREE.Shape(f.p.map(([x, z]) => new THREE.Vector2(x, -z)));
    const h = heightOf(f) * exaggeration;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo);
    if (f.n) {
      const key = f.n;
      if (!named.has(key)) { const g = new THREE.Group(); g.name = key; named.set(key, g); names[key] = key; root.add(g); }
      named.get(key)!.add(mesh);
    } else {
      const cx = f.p.reduce((s, q) => s + q[0], 0) / f.p.length;
      const cz = f.p.reduce((s, q) => s + q[1], 0) / f.p.length;
      const q = quarterName(cx, cz);
      if (!quarters[q]) { const g = new THREE.Group(); g.name = q; quarters[q] = g; names[q] = q; root.add(g); }
      quarters[q].add(mesh);
    }
  }
  // A ground plate so the city has a floor to lift off.
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(d.radius, d.radius, 1, 72, 1, true));
  plate.position.y = -0.5;
  const ground = new THREE.Group();
  ground.name = 'Ground';
  names.Ground = `Ground, ${Math.round(d.radius)} m radius`;
  ground.add(plate);
  root.add(ground);
  return { model: HoloModel.fromObject(root, names), names, exaggeration };
}

/** Sun direction in the place's local frame (x east, y up, -z north) for a given time. */
export function sunDirection(lat: number, lon: number, when: Date): { dir: THREE.Vector3; altitudeDeg: number; azimuthDeg: number } {
  const p = SunCalc.getPosition(when, lat, lon);
  // suncalc 1.9: azimuth in radians measured from south, positive toward west.
  const az = p.azimuth + Math.PI; // now from north, clockwise
  const alt = p.altitude;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
  return { dir, altitudeDeg: (alt * 180) / Math.PI, azimuthDeg: (((az * 180) / Math.PI) % 360 + 360) % 360 };
}

export async function fetchPlace(query: string): Promise<PlaceData> {
  const r = await fetch('/api/place', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j as PlaceData;
}
