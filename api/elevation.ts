import { meanSeaLevel } from 'egm96-universal';
import { send, HttpError } from './_nebius.js';

/**
 * Predict the ground height under a place before any 3D tiles arrive, so the camera can aim its
 * dive at the real surface instead of sea level (which buries it by the local elevation).
 * Elevation above sea level comes from Open-Meteo (Copernicus 90 m DEM, no key); the EGM96 geoid
 * turns it into height above the WGS84 ellipsoid, which is what the photoreal tiles use.
 * The live tiles still have the final word: the browser re-measures once they stream in.
 */
export default async function handler(req: { method: string; query?: Record<string, string>; body?: { lat?: number; lon?: number } }, res: { status: (n: number) => { json: (b: unknown) => void }; setHeader?: (k: string, v: string) => void }) {
  try {
    const lat = Number(req.query?.lat ?? req.body?.lat);
    const lon = Number(req.query?.lon ?? req.body?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, 'lat and lon are required');
    const geoid = meanSeaLevel(lat, lon);
    let orthometric: number | null = null;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const j = (await r.json()) as { elevation?: number[] };
        if (Number.isFinite(j.elevation?.[0])) orthometric = j.elevation![0];
      }
    } catch { /* fall back to the geoid alone */ }
    res.setHeader?.('Cache-Control', 's-maxage=2592000, stale-while-revalidate=2592000');
    res.status(200).json({ lat, lon, ellipsoid: (orthometric ?? 0) + geoid, orthometric, geoid, source: orthometric === null ? 'geoid only' : 'Open-Meteo DEM + EGM96' });
  } catch (err) {
    send(res, err);
  }
}
