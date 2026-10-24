import { Math as CesiumMath, type CesiumWidget } from 'cesium';
import type { Op } from './ops';
import { boxAround, bboxWidthKm, formatAltitude, haversineKm, SCALE_BANDS, type BBox, type LatLon } from '../core/geo';
import { relativeTime, type Provenance } from '../core/provenance';
import { searchPlaces, GEOCODER_SOURCE, type Place } from '../services/geocode';
import { aqiBand, compass, describeWeather, getAirQuality, getConditions, getElevation } from '../services/weather';
import { quakesNear } from '../data/usgs';
import { eventsNear } from '../data/eonet';
import { FEATURE_QUERIES, findFeatures } from '../data/overpass';
import type { Navigator } from '../engine/navigator';
import type { LayerManager } from '../layers/manager';
import type { QuakeLayer, EventLayer } from '../layers/live';
import type { SatelliteLayer } from '../layers/satellites';
import type { ResultMarks } from '../layers/results';
import type { Comparison } from '../layers/imagery';
import type { InspectTarget, LayerContext } from '../layers/types';
import { S2_YEARS } from '../layers/imagery';
import { findLandmark, type Landmark } from '../data/landmarks';

export type StepKind = 'action' | 'finding' | 'note' | 'limit' | 'error';

export interface StepItem {
  name: string;
  detail?: string;
  position?: LatLon;
}

export interface Step {
  kind: StepKind;
  text: string;
  provenance?: Provenance;
  items?: StepItem[];
}

export interface AppApi {
  widget: CesiumWidget;
  nav: Navigator;
  layers: LayerManager;
  layerCtx: LayerContext;
  quakes: QuakeLayer;
  events: EventLayer;
  satellites: SatelliteLayer;
  results: ResultMarks;
  comparison: Comparison;
  setBase(id: string): Promise<boolean>;
  setDate(date: string): Promise<void>;
  setExaggeration(f: number): void;
  inspect(t: InspectTarget): void;
  inspectPoint(p: LatLon, title?: string, subtitle?: string): void;
  /** Flies to a landmark, frames it in 3D and circles it. */
  showLandmark(l: Landmark): Promise<void>;
  /** Circles the selection or the centre of the view. */
  orbit(): boolean;
  closeInspector(): void;
  selected(): InspectTarget | null;
  today(): string;
}

const SCALE_ALT = Object.fromEntries(SCALE_BANDS.map((b) => [b.id, b.target])) as Record<string, number>;

const BASE_LAYER_ID: Record<string, string> = {
  sentinel: 'base-sentinel',
  daily: 'base-daily',
  bluemarble: 'base-bluemarble',
  streets: 'base-streets',
  aerial: 'base-aerial',
};

const LAYER_TITLE = (app: AppApi, id: string) => app.layers.get(id)?.title ?? id;

/** Picks a sensible camera altitude for a geocoded place from its extent or type. */
export function altitudeForPlace(p: Place): number {
  if (p.bbox) {
    const w = Math.max(bboxWidthKm(p.bbox), haversineKm({ lat: p.bbox.south, lon: p.bbox.west }, { lat: p.bbox.north, lon: p.bbox.west }));
    return Math.max(1_600, Math.min(9_000_000, w * 1000 * 1.25));
  }
  const k = p.kind.toLowerCase();
  if (/country/.test(k)) return 2_500_000;
  if (/state|province|region/.test(k)) return 700_000;
  if (/city|town|county|district/.test(k)) return 30_000;
  return 2_200;
}

export class Executor {
  constructor(private readonly app: AppApi) {}

  private focus(): LatLon | null {
    return this.app.selected()?.position ?? this.app.nav.centerPoint();
  }

  private async resolve(place: string, signal?: AbortSignal): Promise<Place | null> {
    const near = this.app.nav.centerPoint();
    const hits = await searchPlaces(place, { signal, near: this.app.nav.altitude() < 2_000_000 ? near : null, limit: 1 });
    return hits[0] ?? null;
  }

  private viewBox(maxWidthKm: number): { box: BBox; shrunk: boolean } | null {
    const rect = this.app.widget.camera.computeViewRectangle();
    const center = this.focus();
    if (!center) return null;
    if (rect) {
      const b: BBox = {
        west: CesiumMath.toDegrees(rect.west),
        east: CesiumMath.toDegrees(rect.east),
        south: CesiumMath.toDegrees(rect.south),
        north: CesiumMath.toDegrees(rect.north),
      };
      if (b.east > b.west && bboxWidthKm(b) <= maxWidthKm) return { box: b, shrunk: false };
    }
    return { box: boxAround(center, maxWidthKm / 2), shrunk: true };
  }

  async run(ops: Op[], signal?: AbortSignal, onStep?: (s: Step) => void): Promise<Step[]> {
    const steps: Step[] = [];
    const push = (s: Step) => {
      steps.push(s);
      onStep?.(s);
    };
    for (const op of ops) {
      if (signal?.aborted) break;
      try {
        await this.one(op, push, signal);
      } catch (err) {
        if (signal?.aborted) break;
        push({ kind: 'error', text: err instanceof Error ? err.message : 'That step failed.' });
      }
    }
    return steps;
  }

  private async flyToPlace(place: string, scale: string | undefined, push: (s: Step) => void, signal?: AbortSignal): Promise<Place | null> {
    const p = await this.resolve(place, signal);
    if (!p) {
      push({ kind: 'limit', text: `No place called "${place}" was found in OpenStreetMap. Check the spelling or add a country.` });
      return null;
    }
    const alt = scale ? SCALE_ALT[scale] : altitudeForPlace(p);
    push({
      kind: 'action',
      text: `Flying to ${p.name}${p.context ? `, ${p.context}` : ''} (${p.kind.toLowerCase()}), viewed from ${formatAltitude(alt)}.`,
      provenance: { ...GEOCODER_SOURCE, fetchedAt: new Date().toISOString() },
    });
    void this.app.nav.lookAt(p.position, alt);
    return p;
  }

  private async one(op: Op, push: (s: Step) => void, signal?: AbortSignal): Promise<void> {
    const app = this.app;
    switch (op.op) {
      case 'fly_to': {
        const landmark = findLandmark(op.place);
        if (landmark) {
          push({ kind: 'action', text: `Flying to ${landmark.name} and circling it.` });
          await app.showLandmark(landmark);
          return;
        }
        const p = await this.flyToPlace(op.place, op.scale, push, signal);
        if (p) app.inspectPoint(p.position, p.name, [p.kind, p.context].filter(Boolean).join(', '));
        return;
      }
      case 'fly_to_coords': {
        const alt = op.scale ? SCALE_ALT[op.scale] : 50_000;
        push({ kind: 'action', text: `Flying to ${op.lat.toFixed(3)}, ${op.lon.toFixed(3)}.` });
        void app.nav.lookAt({ lat: op.lat, lon: op.lon }, alt);
        app.inspectPoint({ lat: op.lat, lon: op.lon });
        return;
      }
      case 'fly_to_satellite': {
        await app.layers.enable('satellites');
        const s = app.satellites.find(op.name);
        const pos = s ? app.satellites.positionOf(s) : null;
        if (!s || !pos) {
          push({ kind: 'limit', text: `"${op.name}" is not in the station or bright-satellite lists loaded from CelesTrak.` });
          return;
        }
        push({
          kind: 'finding',
          text: `${s.name} is over ${pos.lat.toFixed(1)}°, ${pos.lon.toFixed(1)}° at ${Math.round(pos.heightKm)} km, computed from orbital elements published ${relativeTime(s.epoch + 'Z')}.`,
          provenance: app.satellites.provenance,
        });
        void app.nav.lookAt({ lat: pos.lat, lon: pos.lon }, pos.heightKm * 1000 + 2_500_000, { pitch: -90 });
        const t = app.satellites.pick?.({ id: { layer: 'satellites', item: s } });
        if (t) app.inspect(t);
        return;
      }
      case 'set_scale': {
        push({ kind: 'action', text: `Changing scale to ${op.scale}.` });
        void app.nav.toBand(op.scale);
        return;
      }
      case 'tilt': {
        push({ kind: 'action', text: op.degrees > 0 ? 'Tilting the view towards the horizon.' : 'Tilting the view to look straight down.' });
        app.nav.tilt(op.degrees);
        return;
      }
      case 'set_layer': {
        const ok = op.on ? await app.layers.enable(op.layer) : (app.layers.disable(op.layer), true);
        const title = LAYER_TITLE(app, op.layer);
        if (!ok) {
          const st = app.layers.state(op.layer);
          push({ kind: 'limit', text: st.status === 'locked' ? `${title} needs a Cesium ion token, added under Sources and keys.` : `${title} did not load. ${st.message ?? ''}`.trim() });
        } else {
          push({ kind: 'action', text: op.on ? `Showing ${title.charAt(0).toLowerCase()}${title.slice(1)}.` : `Hid ${title.charAt(0).toLowerCase()}${title.slice(1)}.`, provenance: op.on ? app.layers.get(op.layer)?.provenance : undefined });
        }
        return;
      }
      case 'set_base': {
        const id = BASE_LAYER_ID[op.base];
        const ok = await app.setBase(id);
        push(ok ? { kind: 'action', text: `Ground imagery: ${LAYER_TITLE(app, id)}.`, provenance: app.layers.get(id)?.provenance } : { kind: 'limit', text: `${LAYER_TITLE(app, id)} is not available right now.` });
        return;
      }
      case 'set_date': {
        const today = app.today();
        if (op.date > today) {
          push({ kind: 'limit', text: `${op.date} is in the future. Daily imagery exists up to ${today}, and today's is still being assembled.` });
          return;
        }
        if (op.date < '2018-01-05') {
          push({ kind: 'limit', text: 'Daily NOAA-20 imagery starts in January 2018.' });
          return;
        }
        await app.setBase('base-daily');
        await app.setDate(op.date);
        push({ kind: 'action', text: `Showing satellite passes from ${op.date} (UTC day).` });
        return;
      }
      case 'set_exaggeration': {
        app.setExaggeration(op.factor);
        push({ kind: 'action', text: `Terrain height ${op.factor === 1 ? 'at true scale' : `exaggerated ${op.factor} times`}.` });
        return;
      }
      case 'conditions': {
        let at = this.focus();
        let label = app.selected()?.title ?? 'the centre of the view';
        if (op.place) {
          const p = await this.flyToPlace(op.place, undefined, push, signal);
          if (!p) return;
          at = p.position;
          label = p.name;
        }
        if (!at) {
          push({ kind: 'limit', text: 'Point the view at the ground or name a place to get conditions.' });
          return;
        }
        const [wx, aq, el] = await Promise.allSettled([getConditions(at, signal), getAirQuality(at, signal), getElevation(at, signal)]);
        if (wx.status === 'fulfilled') {
          const w = wx.value;
          const temps = w.next24.map((h) => h.temperature);
          const rain = Math.max(0, ...w.next24.map((h) => h.precipProbability));
          push({
            kind: 'finding',
            text: `${label}: ${Math.round(w.temperature)}°C and ${describeWeather(w.weatherCode).toLowerCase()}, feels like ${Math.round(w.feelsLike)}°C. Wind ${Math.round(w.windSpeed)} km/h from the ${compass(w.windDirection)}, gusting ${Math.round(w.windGusts)}. Next 24 hours: ${Math.round(Math.min(...temps))} to ${Math.round(Math.max(...temps))}°C, highest chance of rain ${rain}%.`,
            provenance: w.provenance,
          });
        } else push({ kind: 'error', text: 'Weather could not be loaded from Open-Meteo.' });
        if (aq.status === 'fulfilled' && aq.value.usAqi != null) {
          push({
            kind: 'finding',
            text: `Air quality: US AQI ${Math.round(aq.value.usAqi)} (${aqiBand(aq.value.usAqi).toLowerCase()}), PM2.5 ${aq.value.pm25?.toFixed(0) ?? 'n/a'} µg/m³.`,
            provenance: aq.value.provenance,
          });
        }
        if (el.status === 'fulfilled') {
          push({ kind: 'finding', text: `Ground elevation ${Math.round(el.value.metres)} m above sea level.`, provenance: el.value.provenance });
        }
        if (!op.place) app.inspectPoint(at, app.selected()?.title);
        return;
      }
      case 'find_quakes': {
        await app.layers.enable('quakes');
        let near = op.near ? null : this.focus();
        let label = op.near ?? 'the view';
        if (op.near) {
          const p = await this.flyToPlace(op.near, 'country', push, signal);
          if (!p) return;
          app.closeInspector();
          near = p.position;
          label = p.name;
        }
        const radius = op.radius_km ?? (op.near ? 600 : null);
        const list = quakesNear(app.quakes.quakes, radius ? near : null, radius ?? 1e9, op.min_magnitude ?? 0);
        const where = radius ? ` within ${radius} km of ${label}` : ' worldwide';
        const mag = op.min_magnitude ? `M${op.min_magnitude}+` : 'M2.5+';
        if (!list.length) {
          push({ kind: 'finding', text: `No ${mag} earthquakes${where} in the past 7 days.`, provenance: app.quakes.provenance });
          return;
        }
        const top = list[0];
        push({
          kind: 'finding',
          text: `${list.length} ${mag} earthquake${list.length === 1 ? '' : 's'}${where} in the past 7 days. Largest: M${top.mag.toFixed(1)}, ${top.place}, ${relativeTime(top.time)}.`,
          provenance: app.quakes.provenance,
          items: list.slice(0, 8).map((q) => ({
            name: `M${q.mag.toFixed(1)} ${q.place}`,
            detail: `${relativeTime(q.time)}, ${q.depthKm.toFixed(0)} km deep`,
            position: q.position,
          })),
        });
        if (!op.near && !radius) void app.nav.lookAt(top.position, 4_000_000);
        return;
      }
      case 'find_events': {
        await app.layers.enable('events');
        if (op.category === 'seaLakeIce') app.events.setHidden(app.layerCtx, 'seaLakeIce', false);
        let near = op.near ? null : this.focus();
        let label = op.near ?? 'the view';
        if (op.near) {
          const p = await this.flyToPlace(op.near, 'country', push, signal);
          if (!p) return;
          app.closeInspector();
          near = p.position;
          label = p.name;
        }
        const radius = op.radius_km ?? (op.near ? 1000 : null);
        const list = eventsNear(app.events.events, radius ? near : null, radius ?? 1e9, op.category);
        const what = op.category ? (app.events.events.find((e) => e.category === op.category)?.categoryTitle ?? op.category).toLowerCase() : 'natural events';
        const where = radius ? ` within ${radius} km of ${label}` : '';
        if (!list.length) {
          push({ kind: 'finding', text: `NASA EONET lists no open ${what}${where} from the last 30 days.`, provenance: app.events.provenance });
          if (op.category === 'wildfires') push({ kind: 'limit', text: 'EONET wildfire coverage comes mostly from US agencies, so fires elsewhere are often missing.' });
          return;
        }
        push({
          kind: 'finding',
          text: `${list.length} open ${what}${where}. Most recent: ${list[0].title}, reported ${relativeTime(list[0].date)}.`,
          provenance: app.events.provenance,
          items: list.slice(0, 8).map((e) => ({ name: e.title, detail: `${e.categoryTitle}, ${relativeTime(e.date)}`, position: e.position })),
        });
        return;
      }
      case 'find_features': {
        const spec = FEATURE_QUERIES[op.kind];
        let box: BBox | null = null;
        let shrunk = false;
        if (op.place) {
          const p = await this.flyToPlace(op.place, undefined, push, signal);
          if (!p) return;
          const b = p.bbox && bboxWidthKm(p.bbox) <= spec.maxWidthKm ? p.bbox : boxAround(p.position, Math.min(spec.maxWidthKm / 2, 40));
          box = b;
        } else {
          const v = this.viewBox(spec.maxWidthKm);
          if (!v) {
            push({ kind: 'limit', text: 'Point the view at land first, or name a place.' });
            return;
          }
          box = v.box;
          shrunk = v.shrunk;
        }
        push({ kind: 'action', text: `Asking OpenStreetMap for ${spec.label.toLowerCase()} in an area about ${Math.round(bboxWidthKm(box))} km wide.` });
        const res = await findFeatures(op.kind, box, signal);
        const provenance: Provenance = {
          kind: 'cached',
          source: 'OpenStreetMap contributors via Overpass API',
          url: 'https://www.openstreetmap.org/copyright',
          fetchedAt: new Date(res.fetchedAt).toISOString(),
          observedAt: res.osmBase ?? undefined,
          licence: 'ODbL 1.0',
          note: 'Only what local mappers have added. Absence here does not mean absence on the ground.',
        };
        if (!res.features.length) {
          push({ kind: 'finding', text: `OpenStreetMap has no ${spec.label.toLowerCase()} mapped in this area.`, provenance });
          app.results.clear();
          return;
        }
        app.results.show(
          spec.label,
          res.features.map((f) => ({ name: f.name, detail: f.detail, position: f.position, url: `https://www.openstreetmap.org/${f.osmType}/${f.id}` })),
          provenance,
        );
        const ranking = op.kind === 'rivers' ? ' Ranked by how many mapped segments each has, a rough proxy for length in this area.' : op.kind === 'peaks' ? ' Highest first, by mapped elevation.' : '';
        push({
          kind: 'finding',
          text: `${res.features.length} ${spec.label.toLowerCase()} found.${ranking}`,
          provenance,
          items: res.features.slice(0, 10).map((f) => ({ name: f.name, detail: f.detail ?? undefined, position: f.position })),
        });
        if (shrunk) push({ kind: 'limit', text: `The view was wider than ${spec.maxWidthKm} km, so only the area around its centre was searched.` });
        return;
      }
      case 'compare': {
        if (op.kind === 'years') {
          const ya = Number(op.a);
          const yb = Number(op.b);
          const valid = (y: number) => (S2_YEARS as readonly number[]).includes(y);
          if (!valid(ya) || !valid(yb)) {
            push({ kind: 'limit', text: `Sentinel-2 yearly mosaics exist for ${S2_YEARS[0]} to ${S2_YEARS[S2_YEARS.length - 1]}. Using those years instead.` });
          }
          const a = String(valid(ya) ? ya : S2_YEARS[0]);
          const b = String(valid(yb) ? yb : S2_YEARS[S2_YEARS.length - 1]);
          app.comparison.start('years', a, b);
          push({ kind: 'action', text: `Comparing the ${a} mosaic (left) with ${b} (right), both at 10 m per pixel.` });
        } else {
          app.comparison.start('days', op.a, op.b);
          push({ kind: 'action', text: `Comparing satellite passes from ${op.a} (left) and ${op.b} (right).` });
        }
        if (app.nav.altitude() > 400_000) push({ kind: 'note', text: 'Zoom to city scale to see change in streets and new construction.' });
        return;
      }
      case 'stop_compare':
        app.comparison.stop();
        push({ kind: 'action', text: 'Comparison closed.' });
        return;
      case 'reset':
        void app.nav.home();
        push({ kind: 'action', text: 'Back to the whole planet.' });
        return;
      case 'back': {
        const ok = await app.nav.back();
        push(ok ? { kind: 'action', text: 'Back to the previous view.' } : { kind: 'limit', text: 'There is no earlier view to go back to.' });
        return;
      }
      case 'orbit':
        push(app.orbit() ? { kind: 'action', text: 'Circling the view. Drag or press any key to take over.' } : { kind: 'limit', text: 'There is nothing under the centre of the view to circle.' });
        return;
      case 'note':
        push({ kind: 'note', text: op.text });
        return;
      case 'unsupported':
        push({ kind: 'limit', text: op.suggestion ? `${op.reason} ${op.suggestion}` : op.reason });
        return;
    }
  }
}
