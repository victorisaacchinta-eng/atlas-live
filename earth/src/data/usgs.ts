import { fetchJson } from '../core/http';
import { haversineKm, type LatLon } from '../core/geo';

export const USGS_FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';

export interface Quake {
  id: string;
  mag: number;
  magType: string;
  place: string;
  time: number;
  updated: number;
  depthKm: number;
  position: LatLon;
  url: string;
  alert: string | null;
  tsunami: boolean;
  felt: number | null;
  status: string;
}

interface UsgsFeed {
  metadata: { generated: number; title: string; count: number };
  features: Array<{
    id: string;
    properties: {
      mag: number | null;
      magType: string | null;
      place: string | null;
      time: number;
      updated: number;
      url: string;
      alert: string | null;
      tsunami: number;
      felt: number | null;
      status: string;
      type: string;
    };
    geometry: { coordinates: [number, number, number] };
  }>;
}

export function parseUsgs(feed: UsgsFeed): { quakes: Quake[]; generated: number; title: string } {
  const quakes: Quake[] = [];
  for (const f of feed.features ?? []) {
    const p = f.properties;
    const [lon, lat, depth] = f.geometry?.coordinates ?? [];
    if (p?.mag == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (p.type && p.type !== 'earthquake') continue;
    quakes.push({
      id: f.id,
      mag: p.mag,
      magType: p.magType ?? '',
      place: p.place ?? 'Unnamed location',
      time: p.time,
      updated: p.updated,
      depthKm: depth ?? 0,
      position: { lat, lon },
      url: p.url,
      alert: p.alert,
      tsunami: p.tsunami === 1,
      felt: p.felt,
      status: p.status,
    });
  }
  quakes.sort((a, b) => b.time - a.time);
  return { quakes, generated: feed.metadata?.generated ?? Date.now(), title: feed.metadata?.title ?? 'USGS earthquakes' };
}

export async function loadQuakes(signal?: AbortSignal) {
  const { data, fetchedAt, fromCache } = await fetchJson<UsgsFeed>(USGS_FEED, { signal, cacheMs: 4 * 60_000, timeoutMs: 20_000 });
  return { ...parseUsgs(data), fetchedAt, fromCache };
}

export function quakesNear(quakes: Quake[], near: LatLon | null, radiusKm: number, minMag = 0): Array<Quake & { distanceKm: number | null }> {
  return quakes
    .filter((q) => q.mag >= minMag)
    .map((q) => ({ ...q, distanceKm: near ? haversineKm(near, q.position) : null }))
    .filter((q) => q.distanceKm == null || q.distanceKm <= radiusKm)
    .sort((a, b) => b.mag - a.mag || b.time - a.time);
}

/**
 * USGS PAGER alert levels, as USGS describes the response each one implies
 * from estimated fatalities and economic losses.
 */
export function pagerText(alert: string | null): string | null {
  switch (alert) {
    case 'green':
      return 'Green: no response expected to be needed';
    case 'yellow':
      return 'Yellow: local or regional response';
    case 'orange':
      return 'Orange: national response';
    case 'red':
      return 'Red: international response';
    default:
      return null;
  }
}
