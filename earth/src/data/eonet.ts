import { fetchJson } from '../core/http';
import { haversineKm, type LatLon } from '../core/geo';

export const EONET_FEED = 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30';

export interface NaturalEvent {
  id: string;
  title: string;
  description: string | null;
  category: string;
  categoryTitle: string;
  /** Latest reported position. */
  position: LatLon;
  /** Date of the latest reported position. */
  date: string;
  /** All reported positions in time order (storm tracks have several). */
  track: Array<LatLon & { date: string }>;
  magnitude: string | null;
  sources: Array<{ id: string; url: string }>;
}

interface EonetFeed {
  features: Array<{
    properties: {
      id: string;
      title: string;
      description: string | null;
      date: string;
      magnitudeValue: number | null;
      magnitudeUnit: string | null;
      categories: Array<{ id: string; title: string }>;
      sources: Array<{ id: string; url: string }>;
    };
    geometry: { type: 'Point' | 'LineString' | 'Polygon'; coordinates: unknown };
  }>;
}

function representativePoint(g: EonetFeed['features'][number]['geometry']): LatLon | null {
  if (g.type === 'Point') {
    const [lon, lat] = g.coordinates as [number, number];
    return Number.isFinite(lat) ? { lat, lon } : null;
  }
  const flat: Array<[number, number]> = g.type === 'LineString' ? (g.coordinates as Array<[number, number]>) : ((g.coordinates as Array<Array<[number, number]>>)[0] ?? []);
  if (!flat.length) return null;
  const lat = flat.reduce((s, c) => s + c[1], 0) / flat.length;
  const lon = flat.reduce((s, c) => s + c[0], 0) / flat.length;
  return { lat, lon };
}

function magnitudeText(v: number | null, unit: string | null): string | null {
  if (v == null) return null;
  const u = unit === 'kts' ? 'knots sustained wind' : unit === 'acres' ? 'acres burned' : unit === 'NM^2' ? 'square nautical miles' : unit ?? '';
  return `${v.toLocaleString('en-US')} ${u}`.trim();
}

/** EONET repeats an event once per reported position; this folds them into one event with a track. */
export function parseEonet(feed: EonetFeed): NaturalEvent[] {
  const byId = new Map<string, NaturalEvent>();
  for (const f of feed.features ?? []) {
    const p = f.properties;
    const pos = f.geometry ? representativePoint(f.geometry) : null;
    if (!p?.id || !pos) continue;
    const cat = p.categories?.[0] ?? { id: 'other', title: 'Other' };
    const existing = byId.get(p.id);
    const point = { ...pos, date: p.date };
    if (!existing) {
      byId.set(p.id, {
        id: p.id,
        title: p.title,
        description: p.description || null,
        category: cat.id,
        categoryTitle: cat.title,
        position: pos,
        date: p.date,
        track: [point],
        magnitude: magnitudeText(p.magnitudeValue, p.magnitudeUnit),
        sources: p.sources ?? [],
      });
    } else {
      existing.track.push(point);
      if (p.date > existing.date) {
        existing.date = p.date;
        existing.position = pos;
        existing.magnitude = magnitudeText(p.magnitudeValue, p.magnitudeUnit) ?? existing.magnitude;
      }
    }
  }
  for (const e of byId.values()) e.track.sort((a, b) => a.date.localeCompare(b.date));
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function loadEvents(signal?: AbortSignal) {
  const { data, fetchedAt, fromCache } = await fetchJson<EonetFeed>(EONET_FEED, { signal, cacheMs: 15 * 60_000, timeoutMs: 25_000 });
  return { events: parseEonet(data), fetchedAt, fromCache };
}

export function eventsNear(events: NaturalEvent[], near: LatLon | null, radiusKm: number, category?: string): Array<NaturalEvent & { distanceKm: number | null }> {
  return events
    .filter((e) => !category || e.category === category)
    .map((e) => ({ ...e, distanceKm: near ? haversineKm(near, e.position) : null }))
    .filter((e) => e.distanceKm == null || e.distanceKm <= radiusKm)
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0) || b.date.localeCompare(a.date));
}

/** EONET category ids the assistant understands, with the words people use for them. */
export const EVENT_CATEGORIES: Record<string, string[]> = {
  wildfires: ['fire', 'fires', 'wildfire', 'wildfires', 'bushfire', 'burning'],
  severeStorms: ['storm', 'storms', 'cyclone', 'cyclones', 'hurricane', 'hurricanes', 'typhoon', 'typhoons'],
  volcanoes: ['volcano', 'volcanoes', 'eruption', 'eruptions'],
  floods: ['flood', 'floods', 'flooding'],
  seaLakeIce: ['ice', 'iceberg', 'icebergs', 'sea ice'],
  dustHaze: ['dust', 'haze', 'smoke'],
  landslides: ['landslide', 'landslides', 'mudslide'],
  drought: ['drought'],
  snow: ['snow', 'blizzard'],
  tempExtremes: ['heatwave', 'heat wave', 'cold wave'],
};
