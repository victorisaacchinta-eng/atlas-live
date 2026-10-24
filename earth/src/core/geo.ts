export interface LatLon {
  lat: number;
  lon: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

const R_EARTH_KM = 6371.0088;

export function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function toDeg(r: number): number {
  return (r * 180) / Math.PI;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function normaliseLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** 17.3850, 78.4867 -> 17°23′06″N 78°29′12″E */
export function toDms(p: LatLon): string {
  const f = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = Math.floor((a - d) * 60);
    let s = Math.round(((a - d) * 60 - m) * 60);
    if (s === 60) {
      s = 0;
      m += 1;
    }
    if (m === 60) {
      m = 0;
      d += 1;
    }
    return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″${v >= 0 ? pos : neg}`;
  };
  return `${f(p.lat, 'N', 'S')} ${f(p.lon, 'E', 'W')}`;
}

export function toDecimal(p: LatLon, digits = 4): string {
  return `${p.lat.toFixed(digits)}, ${p.lon.toFixed(digits)}`;
}

/** A square box of the given half-width (km) around a point, clamped to valid latitudes. */
export function boxAround(p: LatLon, halfKm: number): BBox {
  const dLat = halfKm / 110.574;
  const dLon = halfKm / (111.32 * Math.max(0.05, Math.cos(toRad(p.lat))));
  return {
    south: Math.max(-90, p.lat - dLat),
    north: Math.min(90, p.lat + dLat),
    west: p.lon - dLon,
    east: p.lon + dLon,
  };
}

export function bboxWidthKm(b: BBox): number {
  const midLat = (b.north + b.south) / 2;
  return haversineKm({ lat: midLat, lon: b.west }, { lat: midLat, lon: b.east });
}

/** The zoom hierarchy from the brief, as camera altitude bands in metres. */
export interface ScaleBand {
  id: 'planet' | 'continent' | 'country' | 'region' | 'city' | 'street';
  label: string;
  /** Lower bound of the band, metres above the ellipsoid. */
  min: number;
  /** Altitude the ladder flies to when this band is chosen. */
  target: number;
}

export const SCALE_BANDS: readonly ScaleBand[] = [
  { id: 'planet', label: 'Planet', min: 6_500_000, target: 18_000_000 },
  { id: 'continent', label: 'Continent', min: 1_800_000, target: 4_500_000 },
  { id: 'country', label: 'Country', min: 350_000, target: 1_100_000 },
  { id: 'region', label: 'Region', min: 45_000, target: 140_000 },
  { id: 'city', label: 'City', min: 3_500, target: 16_000 },
  { id: 'street', label: 'Street', min: -Infinity, target: 1_200 },
];

export function bandFor(altitudeM: number): ScaleBand {
  return SCALE_BANDS.find((b) => altitudeM >= b.min) ?? SCALE_BANDS[SCALE_BANDS.length - 1];
}

/** "18,000 km", "4.2 km", "640 m" */
export function formatAltitude(m: number): string {
  if (!Number.isFinite(m)) return '';
  if (m >= 100_000) return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
  if (m >= 10_000) return `${(m / 1000).toFixed(0)} km`;
  if (m >= 1_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/** Position of an altitude on the ladder, 0 at the top (orbit) to 1 at street level, log scale. */
export function ladderPosition(altitudeM: number): number {
  const top = Math.log10(30_000_000);
  const bottom = Math.log10(300);
  const v = Math.log10(Math.max(300, Math.min(30_000_000, altitudeM)));
  return (top - v) / (top - bottom);
}
