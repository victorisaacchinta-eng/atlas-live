import { send, HttpError } from './_nebius.js';
import { geocode } from './_places.js';

/** Find a place by name (OpenStreetMap Nominatim). Cached at the edge for a week. */
export default async function handler(req: { method: string; body: { query?: string } }, res: { status: (n: number) => { json: (b: unknown) => void }; setHeader?: (k: string, v: string) => void }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const q = String(req.body?.query || '').trim().slice(0, 120);
    if (!q) throw new HttpError(400, 'Name a place');
    const g = await geocode(q);
    res.setHeader?.('Cache-Control', 's-maxage=604800');
    res.status(200).json(g);
  } catch (err) { send(res, err); }
}
