import { send, HttpError } from './_nebius.js';
import { geocode, buildings, facts } from './_places.js';

/**
 * PLACES: name a real place, get its buildings as a hologram plus a few cited facts.
 * 1. Nominatim (OpenStreetMap) finds the place.
 * 2. Overpass returns building footprints and heights around it.
 * 3. Tavily searches the place; Nemotron writes one fact per named landmark, citing a result.
 * Responses are cached at the edge for a day, so a demo place loads instantly the second time.
 */

export default async function handler(req: { method: string; body: { query?: string; radius?: number } }, res: { status: (n: number) => { json: (b: unknown) => void }; setHeader?: (k: string, v: string) => void }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const query = String(req.body?.query || '').trim().slice(0, 120);
    if (!query) throw new HttpError(400, 'Name a place');
    const radius = Math.min(400, Math.max(120, Number(req.body?.radius) || 220));
    const g = await geocode(query);
    const features = await buildings(g.lat, g.lon, radius);
    if (!features.length) throw new HttpError(404, `OpenStreetMap has no buildings mapped around ${g.name}`);
    const named = [...new Set(features.filter((f) => f.n).map((f) => f.n))].slice(0, 12);
    const f = await facts(g.name, named).catch(() => ({ facts: [], model: undefined }));
    res.setHeader?.('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ query, name: g.name, lat: g.lat, lon: g.lon, radius, features, facts: f.facts, model: f.model, attribution: 'Map data © OpenStreetMap contributors, ODbL' });
  } catch (err) {
    send(res, err);
  }
}
