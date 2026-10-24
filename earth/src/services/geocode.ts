import { fetchJson } from '../core/http';
import type { BBox, LatLon } from '../core/geo';

/**
 * Place search through Photon, the komoot-hosted OpenStreetMap geocoder.
 * Photon supports search-as-you-type on its public instance (Nominatim's
 * public instance does not allow autocomplete), under a fair-use policy, so
 * requests are debounced by the caller, cancelled when superseded, cached,
 * and spaced at least 350 ms apart.
 */
const PHOTON = 'https://photon.komoot.io';

export interface Place {
  id: string;
  name: string;
  /** "Telangana, India" */
  context: string;
  kind: string;
  position: LatLon;
  bbox: BBox | null;
  osm: { type: string; id: number } | null;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: 'N' | 'W' | 'R';
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    extent?: [number, number, number, number];
  };
}

const OSM_TYPE: Record<string, string> = { N: 'node', W: 'way', R: 'relation' };

export function photonToPlace(f: PhotonFeature): Place | null {
  const p = f.properties;
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = p.name ?? ([p.housenumber, p.street].filter(Boolean).join(' ') || p.city || p.state || p.country);
  if (!name) return null;
  const ctxParts = [p.city !== name ? p.city : null, p.state !== name ? p.state : null, p.country !== name ? p.country : null].filter(Boolean);
  const addressOnly = p.type === 'house' && (!p.osm_value || p.osm_key === 'building' || p.osm_key === 'place' || p.osm_value === 'yes');
  const kind = addressOnly ? 'Address' : (p.osm_value ?? p.type ?? 'place').replace(/_/g, ' ');
  // Photon extent is [minLon, maxLat, maxLon, minLat].
  const e = p.extent;
  return {
    id: `${p.osm_type ?? 'X'}${p.osm_id ?? `${lat},${lon}`}`,
    name,
    context: ctxParts.join(', '),
    kind: kind.charAt(0).toUpperCase() + kind.slice(1),
    position: { lat, lon },
    bbox: e ? { west: e[0], north: e[1], east: e[2], south: e[3] } : null,
    osm: p.osm_type && p.osm_id ? { type: OSM_TYPE[p.osm_type] ?? 'node', id: p.osm_id } : null,
  };
}

/**
 * A replacement forward geocoder. Google's terms only allow its Photorealistic
 * 3D Tiles alongside Google's own geocoder, so while those tiles are on, place
 * search goes through Google instead of Photon.
 */
export interface ForwardGeocoder {
  label: string;
  search(query: string, limit: number): Promise<Place[]>;
}
let forward: ForwardGeocoder | null = null;

export function useForwardGeocoder(g: ForwardGeocoder | null): void {
  forward = g;
}

/** Who answers place searches right now, for the search box. */
export function geocoderLabel(): string {
  return forward?.label ?? 'OpenStreetMap';
}

export async function searchPlaces(query: string, opts: { signal?: AbortSignal; near?: LatLon | null; limit?: number } = {}): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (forward) {
    const results = await forward.search(q, opts.limit ?? 6);
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return results;
  }
  const params = new URLSearchParams({ q, limit: String(opts.limit ?? 6), lang: 'en' });
  if (opts.near) {
    params.set('lat', opts.near.lat.toFixed(3));
    params.set('lon', opts.near.lon.toFixed(3));
    params.set('location_bias_scale', '0.2');
  }
  const { data } = await fetchJson<{ features: PhotonFeature[] }>(`${PHOTON}/api/?${params}`, {
    signal: opts.signal,
    cacheMs: 24 * 3600_000,
    timeoutMs: 10_000,
    minIntervalMs: 350,
  });
  const seen = new Set<string>();
  return (data.features ?? [])
    .map(photonToPlace)
    .filter((p): p is Place => !!p)
    .filter((p) => {
      const key = `${p.name}|${p.context}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function reverseGeocode(p: LatLon, signal?: AbortSignal): Promise<Place | null> {
  const params = new URLSearchParams({ lat: p.lat.toFixed(5), lon: p.lon.toFixed(5), lang: 'en' });
  const { data } = await fetchJson<{ features: PhotonFeature[] }>(`${PHOTON}/reverse?${params}`, {
    signal,
    cacheMs: 24 * 3600_000,
    timeoutMs: 10_000,
    minIntervalMs: 350,
  });
  const f = data.features?.[0];
  return f ? photonToPlace(f) : null;
}

export const GEOCODER_SOURCE = { kind: 'cached' as const, source: 'Photon by komoot, OpenStreetMap data', url: 'https://photon.komoot.io', licence: 'ODbL 1.0' };
