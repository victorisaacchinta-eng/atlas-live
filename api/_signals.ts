import { HttpError } from './_nebius.js';
import { fetchSachet, kindOf, SEVERITY_RANK, langName } from './_sachet.js';

/**
 * Live signals on the globe. Two layers, both keyless public-domain feeds, plus weather on demand:
 * - quakes: USGS, magnitude 2.5+ over the past 7 days (updated every few minutes by USGS)
 * - events: NASA EONET open natural events of the last 60 days (wildfires, storms, sea ice)
 * - weather: Open-Meteo current conditions at a point (CC BY 4.0)
 * Every response says when the source last updated and when ATLAS fetched it. Nothing is invented:
 * if a feed fails, the layer reports the failure instead of showing old or made-up points.
 */

export type LayerId = 'quakes' | 'events' | 'india';

export interface Signal {
  id: string;
  layer: LayerId;
  kind: string;          // 'earthquake' | 'wildfire' | 'storm' | 'ice' | ...
  title: string;
  lat: number;
  lon: number;
  time: string;          // ISO time of the observation
  mag?: number;          // earthquake magnitude, storm wind, fire acres
  magUnit?: string;
  depthKm?: number;
  alert?: string | null;
  tsunami?: boolean;
  url: string;           // the source's own page for this item
  // India (NDMA SACHET) alerts only
  severity?: string;
  sender?: string;
  expires?: string;
  area?: string;
  districts?: string[];
  located?: string;
  texts?: { lang: string; language: string; headline: string }[];
}

export interface LayerData {
  layer: LayerId;
  name: string;
  source: string;
  sourceUrl: string;
  license: string;
  updated: string;       // when the source says the data was generated
  fetchedAt: string;
  signals: Signal[];
}

const META: Record<LayerId, Omit<LayerData, 'updated' | 'fetchedAt' | 'signals' | 'layer'> & { ttl: number }> = {
  quakes: { name: 'Earthquakes, M2.5+, past 7 days', source: 'USGS Earthquake Hazards Program', sourceUrl: 'https://earthquake.usgs.gov/earthquakes/map/', license: 'U.S. public domain', ttl: 5 * 60e3 },
  events: { name: 'Natural events, open', source: 'NASA EONET', sourceUrl: 'https://eonet.gsfc.nasa.gov/', license: 'U.S. public domain (NASA)', ttl: 15 * 60e3 },
  india: { name: 'India official alerts, in force now', source: 'NDMA SACHET (IMD, CWC, INCOIS, state disaster authorities)', sourceUrl: 'https://sachet.ndma.gov.in/', license: 'Government of India public alerts', ttl: 8 * 60e3 },
};

const cache = new Map<LayerId, { at: number; data: LayerData }>();

async function getJson(url: string, ms: number) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ATLAS-Live/0.2 (github.com/victorisaacchinta-eng/atlas-live)' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new HttpError(502, `${new URL(url).host} answered ${r.status}`);
  return r.json();
}

async function fetchQuakes(): Promise<Pick<LayerData, 'updated' | 'signals'>> {
  const j = await getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson', 9000) as {
    metadata: { generated: number };
    features: { id: string; properties: { mag: number; place: string; time: number; url: string; title: string; alert: string | null; tsunami: number }; geometry: { coordinates: [number, number, number] } }[];
  };
  return {
    updated: new Date(j.metadata.generated).toISOString(),
    signals: j.features.filter((f) => f.geometry?.coordinates && Number.isFinite(f.properties.mag)).map((f) => ({
      id: f.id, layer: 'quakes', kind: 'earthquake', title: f.properties.title,
      lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depthKm: f.geometry.coordinates[2],
      time: new Date(f.properties.time).toISOString(), mag: f.properties.mag, magUnit: 'M',
      alert: f.properties.alert, tsunami: f.properties.tsunami === 1, url: f.properties.url,
    })),
  };
}

async function fetchIndia(): Promise<Pick<LayerData, 'updated' | 'signals'>> {
  const { updated, alerts } = await fetchSachet();
  return {
    updated,
    signals: alerts.map((a) => ({
      id: a.id, layer: 'india' as const, kind: kindOf(a.event, a.texts[0]?.headline), lat: a.lat, lon: a.lon, time: a.sent,
      title: `${a.event}: ${a.districts.length ? a.districts.slice(0, 3).map((d) => d.name).join(', ') + (a.districts.length > 3 ? ` and ${a.districts.length - 3} more` : '') + `, ${a.districts[0].state}` : a.areaDesc}`,
      mag: SEVERITY_RANK[a.severity] ?? 1, magUnit: 'severity',
      severity: a.severity, sender: a.sender, expires: a.expires, area: a.areaDesc, located: a.located,
      districts: a.districts.map((d) => d.name),
      texts: a.texts.map((t) => ({ lang: t.lang, language: langName(t.lang), headline: t.headline.slice(0, 400) })),
      url: a.url,
    })),
  };
}

const KIND: Record<string, string> = { wildfires: 'wildfire', severeStorms: 'storm', seaLakeIce: 'ice', volcanoes: 'volcano', floods: 'flood', drought: 'drought', dustHaze: 'dust', landslides: 'landslide', snow: 'snow', tempExtremes: 'heat', waterColor: 'water', manmade: 'manmade', earthquakes: 'earthquake' };

async function fetchEvents(): Promise<Pick<LayerData, 'updated' | 'signals'>> {
  const j = await getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=60', 12000) as {
    events: { id: string; title: string; link: string; categories: { id: string }[]; sources: { url: string }[]; geometry: { date: string; type: string; coordinates: number[] | number[][][]; magnitudeValue?: number | null; magnitudeUnit?: string | null }[] }[];
  };
  const signals: Signal[] = [];
  let latest = 0;
  for (const e of j.events) {
    const g = e.geometry?.[e.geometry.length - 1];
    if (!g) continue;
    let lon: number, lat: number;
    if (g.type === 'Point') [lon, lat] = g.coordinates as number[];
    else {
      // Polygon: use the centre of its first ring.
      const ring = (g.coordinates as number[][][])[0] || [];
      if (!ring.length) continue;
      lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    latest = Math.max(latest, Date.parse(g.date) || 0);
    signals.push({
      id: e.id, layer: 'events', kind: KIND[e.categories?.[0]?.id] || 'event', title: e.title, lat, lon, time: g.date,
      mag: g.magnitudeValue ?? undefined, magUnit: g.magnitudeUnit ?? undefined,
      url: e.sources?.[0]?.url || e.link,
    });
  }
  // EONET has no feed timestamp; the newest observation is the honest "updated".
  return { updated: new Date(latest || Date.now()).toISOString(), signals };
}

export async function layer(id: LayerId): Promise<LayerData> {
  const meta = META[id];
  if (!meta) throw new HttpError(400, `Unknown layer ${id}`);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < meta.ttl) return hit.data;
  try {
    const got = id === 'quakes' ? await fetchQuakes() : id === 'india' ? await fetchIndia() : await fetchEvents();
    const { ttl: _ttl, ...rest } = meta;
    const data: LayerData = { layer: id, ...rest, ...got, fetchedAt: new Date().toISOString() };
    cache.set(id, { at: Date.now(), data });
    return data;
  } catch (err) {
    // Serve the last good copy rather than nothing, but only if it is under 6 hours old; the client shows its age.
    if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.data;
    throw err instanceof HttpError ? err : new HttpError(502, `${meta.source} is not responding (${err instanceof Error ? err.name : 'error'})`);
  }
}

/** Great-circle distance in km. */
export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const WMO: Record<number, string> = { 0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'heavy rain showers', 82: 'violent rain showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail' };

export async function weather(lat: number, lon: number) {
  const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m&timezone=auto`, 8000) as {
    current: { time: string; temperature_2m: number; relative_humidity_2m: number; apparent_temperature: number; precipitation: number; weather_code: number; wind_speed_10m: number; wind_gusts_10m: number };
    timezone: string;
  };
  const c = j.current;
  return {
    time: c.time, timezone: j.timezone, temperatureC: c.temperature_2m, feelsLikeC: c.apparent_temperature, humidity: c.relative_humidity_2m,
    precipitationMm: c.precipitation, windKmh: c.wind_speed_10m, gustKmh: c.wind_gusts_10m, conditions: WMO[c.weather_code] ?? `code ${c.weather_code}`,
    source: 'Open-Meteo (CC BY 4.0)', sourceUrl: 'https://open-meteo.com/',
  };
}
