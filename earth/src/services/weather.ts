import { fetchJson } from '../core/http';
import type { LatLon } from '../core/geo';
import type { Provenance } from '../core/provenance';

/**
 * Point conditions from Open-Meteo: forecast-model analysis for "now", the
 * next 24 hours, air quality from CAMS, and Copernicus GLO-90 elevation.
 * Free for non-commercial use under 10,000 calls a day, CC BY 4.0.
 */

export interface Conditions {
  time: string;
  timezone: string;
  utcOffsetSeconds: number;
  temperature: number;
  feelsLike: number;
  humidity: number;
  precipitation: number;
  cloudCover: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  weatherCode: number;
  isDay: boolean;
  next24: Array<{ time: string; temperature: number; precipProbability: number }>;
  provenance: Provenance;
}

export interface AirQuality {
  time: string;
  usAqi: number | null;
  pm25: number | null;
  pm10: number | null;
  provenance: Provenance;
}

const META = 'Weather data by Open-Meteo.com';

export async function getConditions(p: LatLon, signal?: AbortSignal): Promise<Conditions> {
  const params = new URLSearchParams({
    latitude: p.lat.toFixed(4),
    longitude: p.lon.toFixed(4),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,is_day',
    hourly: 'temperature_2m,precipitation_probability',
    forecast_hours: '24',
    timezone: 'auto',
    wind_speed_unit: 'kmh',
  });
  type R = {
    timezone: string;
    utc_offset_seconds: number;
    current: Record<string, number | string>;
    hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: Array<number | null> };
  };
  const { data, fetchedAt } = await fetchJson<R>(`https://api.open-meteo.com/v1/forecast?${params}`, { signal, cacheMs: 10 * 60_000, timeoutMs: 12_000 });
  const c = data.current;
  const n = (k: string) => Number(c[k]);
  return {
    time: String(c.time),
    timezone: data.timezone,
    utcOffsetSeconds: data.utc_offset_seconds,
    temperature: n('temperature_2m'),
    feelsLike: n('apparent_temperature'),
    humidity: n('relative_humidity_2m'),
    precipitation: n('precipitation'),
    cloudCover: n('cloud_cover'),
    windSpeed: n('wind_speed_10m'),
    windDirection: n('wind_direction_10m'),
    windGusts: n('wind_gusts_10m'),
    weatherCode: n('weather_code'),
    isDay: n('is_day') === 1,
    next24: data.hourly.time.map((t, i) => ({ time: t, temperature: data.hourly.temperature_2m[i], precipProbability: data.hourly.precipitation_probability[i] ?? 0 })),
    provenance: {
      kind: 'near-real-time',
      source: 'Open-Meteo forecast models (best match for this location)',
      url: 'https://open-meteo.com/',
      observedAt: localToIso(String(c.time), data.utc_offset_seconds),
      fetchedAt: new Date(fetchedAt).toISOString(),
      licence: 'CC BY 4.0',
      note: `${META}. "Now" is the model's current 15-minute analysis, not a station reading.`,
    },
  };
}

export async function getAirQuality(p: LatLon, signal?: AbortSignal): Promise<AirQuality> {
  const params = new URLSearchParams({ latitude: p.lat.toFixed(4), longitude: p.lon.toFixed(4), current: 'us_aqi,pm2_5,pm10', timezone: 'auto' });
  type R = { utc_offset_seconds: number; current: { time: string; us_aqi: number | null; pm2_5: number | null; pm10: number | null } };
  const { data, fetchedAt } = await fetchJson<R>(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`, { signal, cacheMs: 30 * 60_000, timeoutMs: 12_000 });
  return {
    time: data.current.time,
    usAqi: data.current.us_aqi,
    pm25: data.current.pm2_5,
    pm10: data.current.pm10,
    provenance: {
      kind: 'near-real-time',
      source: 'Open-Meteo Air Quality (CAMS global model)',
      url: 'https://open-meteo.com/en/docs/air-quality-api',
      observedAt: localToIso(data.current.time, data.utc_offset_seconds),
      fetchedAt: new Date(fetchedAt).toISOString(),
      licence: 'CC BY 4.0',
      note: 'Modelled at about 40 km resolution, so local spikes are smoothed out.',
    },
  };
}

export async function getElevation(p: LatLon, signal?: AbortSignal): Promise<{ metres: number; provenance: Provenance }> {
  const params = new URLSearchParams({ latitude: p.lat.toFixed(5), longitude: p.lon.toFixed(5) });
  const { data, fetchedAt } = await fetchJson<{ elevation: number[] }>(`https://api.open-meteo.com/v1/elevation?${params}`, { signal, cacheMs: 7 * 86400_000, timeoutMs: 10_000 });
  return {
    metres: data.elevation[0],
    provenance: {
      kind: 'static',
      source: 'Copernicus DEM GLO-90 via Open-Meteo',
      url: 'https://open-meteo.com/en/docs/elevation-api',
      fetchedAt: new Date(fetchedAt).toISOString(),
      licence: 'Copernicus DEM licence',
      note: '90 m grid, height above mean sea level.',
    },
  };
}

/** Open-Meteo returns local wall-clock time without an offset; convert it to UTC ISO. */
export function localToIso(local: string, offsetSeconds: number): string {
  // "2026-10-24T16:15" has no seconds; "2026-10-24T16:15:00" does.
  const withSeconds = /T\d{2}:\d{2}$/.test(local) ? `${local}:00` : local;
  const ms = Date.parse(`${withSeconds}Z`);
  return Number.isFinite(ms) ? new Date(ms - offsetSeconds * 1000).toISOString() : new Date().toISOString();
}

/** WMO weather interpretation codes, as documented by Open-Meteo. */
export function describeWeather(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm with hail';
  return 'Unknown conditions';
}

/** US EPA AQI bands. */
export function aqiBand(aqi: number | null): string {
  if (aqi == null) return 'No data';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

export function compass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
