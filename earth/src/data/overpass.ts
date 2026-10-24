import { fetchJson, isAbort } from '../core/http';
import { CONFIG } from '../config';
import type { BBox, LatLon } from '../core/geo';

/**
 * OpenStreetMap queries through the public Overpass API. The public instance
 * asks for roughly fewer than 10,000 requests and 1 GB per day per user, so
 * queries are small (one view at a time), cached, and spaced out.
 */
export const OVERPASS_URL = CONFIG.overpassUrls[0];
const OVERPASS_OPTS = { cacheMs: 30 * 60_000, timeoutMs: 30_000, minIntervalMs: 1100 };

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  osm3s?: { timestamp_osm_base?: string };
  elements: OverpassElement[];
  remark?: string;
}

function bboxString(b: BBox): string {
  return `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
}

/** The endpoint that last answered, tried first next time. */
let preferred = 0;

async function run(query: string, signal?: AbortSignal) {
  const urls = CONFIG.overpassUrls;
  let result: { data: OverpassResponse; fetchedAt: number; fromCache: boolean } | null = null;
  let lastError: unknown = null;
  for (let i = 0; i < urls.length && !result; i++) {
    const index = (preferred + i) % urls.length;
    try {
      result = await fetchJson<OverpassResponse>(`${urls[index]}?data=${encodeURIComponent(query)}`, { ...OVERPASS_OPTS, signal });
      preferred = index;
    } catch (err) {
      if (isAbort(err)) throw err;
      lastError = err;
    }
  }
  if (!result) throw lastError instanceof Error ? lastError : new Error('The OpenStreetMap Overpass API could not be reached.');
  const { data, fetchedAt, fromCache } = result;
  if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark)) {
    throw new Error('OpenStreetMap query timed out for this area. Zoom in and try again.');
  }
  return { data, fetchedAt, fromCache, osmBase: data.osm3s?.timestamp_osm_base ?? null };
}

/* -------------------------------------------------------------- buildings */

export type HeightSource = 'tagged' | 'levels' | 'default';

export interface Building {
  id: number;
  name: string | null;
  kind: string;
  outline: LatLon[];
  centroid: LatLon;
  height: number;
  minHeight: number;
  heightSource: HeightSource;
  levels: number | null;
  address: string | null;
  tags: Record<string, string>;
}

const LEVEL_M = 3;
const DEFAULT_HEIGHT: Record<string, number> = {
  house: 7,
  detached: 7,
  residential: 10,
  apartments: 15,
  garage: 3,
  garages: 3,
  shed: 3,
  hut: 3,
  roof: 4,
  kiosk: 3,
  commercial: 12,
  retail: 6,
  industrial: 9,
  warehouse: 9,
  school: 10,
  hospital: 15,
  church: 14,
  temple: 12,
  mosque: 14,
  office: 15,
};

/** Parses OSM length values: "12", "12 m", "12.5m", "40'", "40 ft". Returns metres or null. */
export function parseLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(',', '.');
  const ft = /^([\d.]+)\s*(ft|feet|')$/.exec(s);
  if (ft) return Number(ft[1]) * 0.3048;
  const ftIn = /^(\d+)'\s*(\d+)"?$/.exec(s);
  if (ftIn) return Number(ftIn[1]) * 0.3048 + Number(ftIn[2]) * 0.0254;
  const m = /^([\d.]+)\s*(m|metres|meters)?$/.exec(s);
  if (m) {
    const v = Number(m[1]);
    return Number.isFinite(v) && v >= 0 && v < 1000 ? v : null;
  }
  return null;
}

export function buildingHeight(tags: Record<string, string>): { height: number; minHeight: number; source: HeightSource; levels: number | null } {
  const levels = tags['building:levels'] ? Number.parseFloat(tags['building:levels']) : NaN;
  const roofLevels = tags['roof:levels'] ? Number.parseFloat(tags['roof:levels']) : 0;
  const minLevel = tags['building:min_level'] ? Number.parseFloat(tags['building:min_level']) : 0;
  const minHeight = parseLength(tags.min_height) ?? (Number.isFinite(minLevel) ? minLevel * LEVEL_M : 0);
  const tagged = parseLength(tags.height);
  if (tagged != null && tagged > 0) {
    return { height: Math.max(tagged, minHeight + 1), minHeight, source: 'tagged', levels: Number.isFinite(levels) ? levels : null };
  }
  if (Number.isFinite(levels) && levels > 0) {
    const h = (levels + (Number.isFinite(roofLevels) ? roofLevels : 0)) * LEVEL_M;
    return { height: Math.max(h, minHeight + 1), minHeight, source: 'levels', levels };
  }
  const kind = tags.building ?? 'yes';
  return { height: DEFAULT_HEIGHT[kind] ?? 8, minHeight, source: 'default', levels: null };
}

export function addressOf(t: Record<string, string>): string | null {
  const line = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const parts = [line, t['addr:suburb'], t['addr:city'], t['addr:postcode']].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function humanKind(t: Record<string, string>): string {
  const b = t.building;
  if (!b || b === 'yes') return t.amenity ? t.amenity.replace(/_/g, ' ') : 'Building';
  return b.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function parseBuildings(res: OverpassResponse, cap = 4000): Building[] {
  const out: Building[] = [];
  for (const el of res.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 4 || !el.tags) continue;
    // Building parts render separately when present; skip the outline to avoid z-fighting.
    if (el.tags['building:part']) continue;
    const ring = el.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first.lat === last.lat && first.lon === last.lon) ring.pop();
    if (ring.length < 3) continue;
    const centroid = {
      lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length,
      lon: ring.reduce((s, p) => s + p.lon, 0) / ring.length,
    };
    const h = buildingHeight(el.tags);
    out.push({
      id: el.id,
      name: el.tags.name ?? el.tags['name:en'] ?? null,
      kind: humanKind(el.tags),
      outline: ring,
      centroid,
      height: h.height,
      minHeight: h.minHeight,
      heightSource: h.source,
      levels: h.levels,
      address: addressOf(el.tags),
      tags: el.tags,
    });
    if (out.length >= cap) break;
  }
  return out;
}

export async function loadBuildings(b: BBox, signal?: AbortSignal) {
  const q = `[out:json][timeout:25];way["building"](${bboxString(b)});out tags geom qt 4000;`;
  const res = await run(q, signal);
  return { buildings: parseBuildings(res.data), fetchedAt: res.fetchedAt, osmBase: res.osmBase };
}

/* ------------------------------------------------- the building at a point */

export interface Structure {
  id: number;
  type: 'way' | 'relation';
  name: string | null;
  kind: string;
  /** Outer ring, when OpenStreetMap has one for it. */
  outline: LatLon[] | null;
  height: number | null;
  heightSource: HeightSource | null;
  levels: number | null;
  address: string | null;
  tags: Record<string, string>;
}

const STRUCTURE_KEYS = ['building', 'building:part', 'man_made', 'historic', 'tourism', 'amenity', 'leisure'];

function ringArea(r: LatLon[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].lon + r[i].lon) * (r[j].lat - r[i].lat);
  return Math.abs(a / 2);
}

/** Picks the most specific mapped structure: buildings before landmarks before sites, smaller before larger. */
export function parseStructures(res: OverpassResponse): Structure[] {
  const out: Array<Structure & { area: number; rank: number }> = [];
  for (const el of res.elements) {
    if ((el.type !== 'way' && el.type !== 'relation') || !el.tags) continue;
    const tags = el.tags;
    const rank = tags.building || tags['building:part'] ? 0 : tags.man_made || tags.historic ? 1 : 2;
    let ring: LatLon[] | null = null;
    if (el.type === 'way' && el.geometry && el.geometry.length >= 4) ring = el.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
    const members = (el as OverpassElement & { members?: Array<{ role: string; geometry?: Array<{ lat: number; lon: number }> }> }).members;
    if (el.type === 'relation' && members) {
      const outer = members.find((m) => m.role === 'outer' && m.geometry && m.geometry.length >= 4);
      if (outer?.geometry) ring = outer.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
    }
    if (ring) {
      const f = ring[0];
      const l = ring[ring.length - 1];
      if (f.lat === l.lat && f.lon === l.lon) ring.pop();
      if (ring.length < 3) ring = null;
    }
    const h = tags.building || tags['building:part'] || tags.height || tags['building:levels'] ? buildingHeight(tags) : null;
    out.push({
      id: el.id,
      type: el.type,
      name: tags.name ?? tags['name:en'] ?? null,
      kind: humanKind(tags),
      outline: ring,
      height: h ? h.height : null,
      heightSource: h ? h.source : null,
      levels: h ? h.levels : null,
      address: addressOf(tags),
      tags,
      area: ring ? ringArea(ring) : Number.POSITIVE_INFINITY,
      rank,
    });
  }
  return out.sort((a, b) => a.rank - b.rank || a.area - b.area).map(({ area: _a, rank: _r, ...s }) => s);
}

/**
 * The mapped structure under a point: the building whose outline contains it,
 * or failing that the nearest one within 20 m.
 */
export async function structureAt(p: LatLon, signal?: AbortSignal) {
  const filter = STRUCTURE_KEYS.map((k) => `wr(pivot.a)["${k}"];`).join('');
  const inside = await run(`[out:json][timeout:20];is_in(${p.lat.toFixed(6)},${p.lon.toFixed(6)})->.a;(${filter});out tags geom;`, signal);
  let list = parseStructures(inside.data);
  if (!list.length) {
    const near = await run(`[out:json][timeout:20];way(around:20,${p.lat.toFixed(6)},${p.lon.toFixed(6)})["building"];out tags geom 5;`, signal);
    list = parseStructures(near.data);
  }
  return { structure: list[0] ?? null, fetchedAt: inside.fetchedAt, osmBase: inside.osmBase };
}

/* ---------------------------------------------------- feature questions */

export type FeatureKind = 'rivers' | 'transit' | 'peaks' | 'airports' | 'hospitals' | 'universities' | 'parks';

export const FEATURE_QUERIES: Record<FeatureKind, { label: string; maxWidthKm: number; body: (bb: string) => string }> = {
  rivers: { label: 'Named rivers', maxWidthKm: 400, body: (bb) => `rel["waterway"="river"]["name"](${bb});way["waterway"="river"]["name"](${bb});` },
  transit: {
    label: 'Public transport stations',
    maxWidthKm: 60,
    body: (bb) => `nwr["public_transport"="station"]["name"](${bb});nwr["railway"="station"]["name"](${bb});nwr["amenity"="bus_station"]["name"](${bb});`,
  },
  peaks: { label: 'Named peaks', maxWidthKm: 300, body: (bb) => `node["natural"="peak"]["name"](${bb});node["natural"="volcano"]["name"](${bb});` },
  airports: { label: 'Airports with IATA codes', maxWidthKm: 1500, body: (bb) => `nwr["aeroway"="aerodrome"]["iata"](${bb});` },
  hospitals: { label: 'Hospitals', maxWidthKm: 40, body: (bb) => `nwr["amenity"="hospital"]["name"](${bb});` },
  universities: { label: 'Universities', maxWidthKm: 80, body: (bb) => `nwr["amenity"="university"]["name"](${bb});` },
  parks: { label: 'Named parks', maxWidthKm: 25, body: (bb) => `nwr["leisure"="park"]["name"](${bb});` },
};

export interface FoundFeature {
  osmType: string;
  id: number;
  name: string;
  position: LatLon;
  detail: string | null;
  tags: Record<string, string>;
  /** How many OSM objects were merged into this entry (rivers are split into many ways). */
  parts: number;
}

export function parseFeatures(kind: FeatureKind, res: OverpassResponse): FoundFeature[] {
  const byName = new Map<string, FoundFeature>();
  for (const el of res.elements) {
    const t = el.tags ?? {};
    const name = t['name:en'] ?? t.name;
    const pos = el.center ?? (el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : null);
    if (!name || !pos) continue;
    let detail: string | null = null;
    if (kind === 'peaks') detail = t.ele ? `${Math.round(Number.parseFloat(t.ele))} m` : null;
    if (kind === 'airports') detail = [t.iata, t.icao].filter(Boolean).join(' / ') || null;
    if (kind === 'transit') detail = t.railway === 'station' ? (t.station === 'subway' ? 'Metro station' : 'Railway station') : t.amenity === 'bus_station' ? 'Bus station' : 'Station';
    const key = kind === 'rivers' ? name.toLowerCase() : `${el.type}/${el.id}`;
    const existing = byName.get(key);
    if (existing) {
      existing.parts += 1;
      if (el.type === 'relation') existing.position = pos;
      continue;
    }
    byName.set(key, { osmType: el.type, id: el.id, name, position: { lat: pos.lat, lon: pos.lon }, detail, tags: t, parts: 1 });
  }
  const list = [...byName.values()];
  if (kind === 'peaks') list.sort((a, b) => Number.parseFloat(b.tags.ele ?? '0') - Number.parseFloat(a.tags.ele ?? '0'));
  else if (kind === 'rivers') list.sort((a, b) => b.parts - a.parts);
  else list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

export async function findFeatures(kind: FeatureKind, b: BBox, signal?: AbortSignal) {
  const q = `[out:json][timeout:25];(${FEATURE_QUERIES[kind].body(bboxString(b))});out tags center 400;`;
  const res = await run(q, signal);
  return { features: parseFeatures(kind, res.data), fetchedAt: res.fetchedAt, osmBase: res.osmBase };
}
