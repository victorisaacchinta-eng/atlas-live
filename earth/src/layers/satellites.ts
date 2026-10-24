import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  LabelCollection,
  LabelStyle,
  Material,
  NearFarScalar,
  PolylineCollection,
  VerticalOrigin,
  type Billboard,
  type Label,
  type Polyline,
} from 'cesium';
import { eciToGeodetic, gstime, json2satrec, propagate, type SatRec } from 'satellite.js';
import { fetchJson, local } from '../core/http';
import { relativeTime } from '../core/provenance';
import { toDecimal, toDeg } from '../core/geo';
import { marker, SWATCH } from './markers';
import type { InspectTarget, LayerDef } from './types';

type Omm = Parameters<typeof json2satrec>[0] & { OBJECT_NAME: string; NORAD_CAT_ID: number; EPOCH: string; INCLINATION: number; MEAN_MOTION: number };

interface Sat {
  name: string;
  norad: number;
  group: 'stations' | 'visual';
  epoch: string;
  inclination: number;
  periodMin: number;
  rec: SatRec;
  billboard: Billboard | null;
  label: Label | null;
  last: { lat: number; lon: number; heightKm: number; speedKms: number } | null;
}

const GROUPS = [
  { id: 'stations' as const, url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json' },
  { id: 'visual' as const, url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json' },
];
// CelesTrak asks clients not to download the same data more than once every two hours.
const CELESTRAK_MIN_AGE = 2 * 3600_000;

async function loadGroup(url: string): Promise<{ omm: Omm[]; at: number }> {
  const stored = local.get<{ at: number; omm: Omm[] } | null>(`celestrak:${url}`, null);
  if (stored && Date.now() - stored.at < CELESTRAK_MIN_AGE) return stored;
  try {
    const { data } = await fetchJson<Omm[]>(url, { timeoutMs: 20_000 });
    const entry = { at: Date.now(), omm: data };
    local.set(`celestrak:${url}`, entry);
    return entry;
  } catch (err) {
    if (stored) return stored; // stale, but its age is shown in the layer summary
    throw err;
  }
}

export interface SatelliteLayer extends LayerDef {
  sats: Sat[];
  selected: Sat | null;
  find(query: string): Sat | null;
  positionOf(s: Sat): { lat: number; lon: number; heightKm: number } | null;
}

export function satelliteLayer(): SatelliteLayer {
  let billboards: BillboardCollection | null = null;
  let labels: LabelCollection | null = null;
  let orbits: PolylineCollection | null = null;
  let orbit: Polyline | null = null;
  let dataAt = 0;

  const state = (rec: SatRec, when: Date) => {
    const pv = propagate(rec, when);
    if (!pv) return null;
    const geo = eciToGeodetic(pv.position, gstime(when));
    const v = pv.velocity;
    return {
      lat: toDeg(geo.latitude),
      lon: toDeg(geo.longitude),
      heightKm: geo.height,
      speedKms: Math.hypot(v.x, v.y, v.z),
    };
  };

  const def: SatelliteLayer = {
    id: 'satellites',
    title: 'Satellites overhead',
    group: 'live',
    sats: [],
    selected: null,
    purpose: 'Crewed stations and the brightest satellites, placed from their published orbital elements. Select one to draw its next orbit.',
    provenance: {
      kind: 'near-real-time',
      source: 'CelesTrak general perturbations elements, propagated in the browser with SGP4 (satellite.js)',
      url: 'https://celestrak.org/NORAD/elements/',
      licence: 'Public orbital data',
      note: 'Positions are computed, not observed. Accuracy is a few kilometres and degrades as the element set ages.',
    },
    legend: {
      items: [
        { label: 'Crewed stations and visiting craft', swatch: SWATCH.station, shape: 'square' },
        { label: 'Bright satellites', swatch: SWATCH.satellite, shape: 'square' },
      ],
    },
    async enable(ctx) {
      // One group failing (CelesTrak throttles bursts) should not hide the other.
      const settled = await Promise.allSettled(GROUPS.map(async (g) => ({ g, data: await loadGroup(g.url) })));
      const results = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      if (!results.length) throw new Error('CelesTrak could not be reached. Try again in a few minutes.');
      if (results.length < GROUPS.length) ctx.notify('Some satellite groups did not load from CelesTrak. Showing the rest.', 'warn');
      dataAt = Math.min(...results.map((r) => r.data.at));
      def.provenance.fetchedAt = new Date(dataAt).toISOString();
      const seen = new Set<number>();
      def.sats = [];
      for (const { g, data } of results) {
        for (const o of data.omm) {
          if (seen.has(o.NORAD_CAT_ID)) continue;
          seen.add(o.NORAD_CAT_ID);
          try {
            def.sats.push({
              name: o.OBJECT_NAME,
              norad: o.NORAD_CAT_ID,
              group: g.id,
              epoch: o.EPOCH,
              inclination: o.INCLINATION,
              periodMin: 1440 / o.MEAN_MOTION,
              rec: json2satrec(o),
              billboard: null,
              label: null,
              last: null,
            });
          } catch {
            /* malformed element set: skip it */
          }
        }
      }
      const scene = ctx.widget.scene;
      orbits = scene.primitives.add(new PolylineCollection()) as PolylineCollection;
      billboards = scene.primitives.add(new BillboardCollection()) as BillboardCollection;
      labels = scene.primitives.add(new LabelCollection()) as LabelCollection;
      for (const s of def.sats) {
        const station = s.group === 'stations';
        s.billboard = billboards.add({
          position: Cartesian3.ZERO,
          image: marker('square', station ? 8 : 6, station ? SWATCH.station : SWATCH.satellite),
          scaleByDistance: new NearFarScalar(1e6, 1.4, 4e7, 0.7),
          id: { layer: 'satellites', item: s },
          show: false,
        });
        if (station && /ISS \(ZARYA\)|CSS \(TIANHE\)/.test(s.name)) {
          s.label = labels.add({
            position: Cartesian3.ZERO,
            text: s.name.includes('ISS') ? 'ISS' : 'Tiangong',
            font: '600 12px "Hubot Sans Variable", system-ui, sans-serif',
            fillColor: Color.fromCssColorString('#eef0ea'),
            outlineColor: Color.fromCssColorString('#05070a'),
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(10, -2),
            verticalOrigin: VerticalOrigin.CENTER,
            translucencyByDistance: new NearFarScalar(2e6, 1, 4e7, 0.6),
            show: false,
          });
        }
      }
      update(new Date());
    },
    disable(ctx) {
      for (const c of [billboards, labels, orbits]) if (c) ctx.widget.scene.primitives.remove(c);
      billboards = labels = orbits = null;
      orbit = null;
      def.selected = null;
      for (const s of def.sats) s.billboard = s.label = null;
    },
    tick(_ctx, now) {
      update(now);
    },
    pick(picked) {
      const id = (picked as { id?: { layer?: string; item?: Sat } })?.id;
      if (id?.layer !== 'satellites' || !id.item) return null;
      select(id.item);
      return target(id.item);
    },
    find(query) {
      const q = query.toLowerCase();
      if (/\b(iss|space station)\b/.test(q)) return def.sats.find((s) => s.name.startsWith('ISS (ZARYA)')) ?? null;
      if (/tiangong|chinese station|css/.test(q)) return def.sats.find((s) => s.name.startsWith('CSS (TIANHE)')) ?? null;
      return def.sats.find((s) => s.name.toLowerCase().includes(q)) ?? null;
    },
    positionOf(s) {
      return state(s.rec, new Date());
    },
    summary: () => (def.sats.length ? `${def.sats.length} objects, elements fetched ${relativeTime(dataAt)}` : ''),
  };

  function update(now: Date) {
    for (const s of def.sats) {
      const p = state(s.rec, now);
      s.last = p;
      if (!s.billboard) continue;
      if (!p || !Number.isFinite(p.heightKm) || p.heightKm < 80) {
        s.billboard.show = false;
        if (s.label) s.label.show = false;
        continue;
      }
      const pos = Cartesian3.fromDegrees(p.lon, p.lat, p.heightKm * 1000);
      s.billboard.position = pos;
      s.billboard.show = true;
      if (s.label) {
        s.label.position = pos;
        s.label.show = true;
      }
    }
  }

  function select(s: Sat) {
    def.selected = s;
    if (!orbits) return;
    if (orbit) orbits.remove(orbit);
    const pts: Cartesian3[] = [];
    const start = Date.now();
    const steps = 180;
    for (let i = 0; i <= steps; i++) {
      const p = state(s.rec, new Date(start + (i / steps) * s.periodMin * 60_000));
      if (p) pts.push(Cartesian3.fromDegrees(p.lon, p.lat, p.heightKm * 1000));
    }
    orbit = orbits.add({
      positions: pts,
      width: 1.5,
      material: Material.fromType('Color', { color: Color.fromCssColorString('#f3a83b').withAlpha(0.85) }),
    });
  }

  function target(s: Sat): InspectTarget {
    const p = s.last ?? state(s.rec, new Date());
    const facts = [
      { label: 'NORAD catalogue number', value: String(s.norad) },
      { label: 'Altitude', value: p ? `${Math.round(p.heightKm).toLocaleString('en-US')} km` : 'Could not compute' },
      { label: 'Speed', value: p ? `${p.speedKms.toFixed(2)} km/s` : '' },
      { label: 'Orbital period', value: `${s.periodMin.toFixed(1)} min` },
      { label: 'Inclination', value: `${s.inclination.toFixed(2)}°` },
      { label: 'Sub-satellite point', value: p ? toDecimal(p, 2) : '' },
      { label: 'Element set epoch', value: `${s.epoch.slice(0, 16).replace('T', ' ')} UTC (${relativeTime(s.epoch + 'Z')})` },
    ].filter((f) => f.value);
    return {
      kind: 'satellite',
      title: s.name,
      subtitle: s.group === 'stations' ? 'Space station or visiting craft' : 'Bright satellite',
      position: p ? { lat: p.lat, lon: p.lon } : { lat: 0, lon: 0 },
      facts,
      provenance: [
        {
          kind: 'estimated',
          source: 'CelesTrak elements, SGP4 propagation in your browser',
          url: `https://celestrak.org/NORAD/elements/gp.php?CATNR=${s.norad}&FORMAT=json`,
          observedAt: s.epoch + 'Z',
          fetchedAt: new Date(dataAt).toISOString(),
          note: 'Position computed from orbital elements, not tracked live.',
        },
      ],
      links: [{ label: 'CelesTrak element set', url: `https://celestrak.org/NORAD/elements/gp.php?CATNR=${s.norad}&FORMAT=tle` }],
      enrich: false,
    };
  }

  return def;
}
