import { send, HttpError } from './_nebius.js';
import { layer, weather, type LayerId } from './_signals.js';

/** GET /api/signals?layer=quakes|events  ·  GET /api/signals?layer=weather&lat=..&lon=.. */
export default async function handler(req: { method: string; query: Record<string, string | string[]> }, res: { status: (n: number) => { json: (b: unknown) => void }; setHeader?: (k: string, v: string) => void }) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'GET only');
    const id = String(req.query.layer || '');
    if (id === 'weather') {
      const lat = Number(req.query.lat), lon = Number(req.query.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, 'lat and lon are required');
      res.setHeader?.('Cache-Control', 's-maxage=600');
      res.status(200).json(await weather(lat, lon));
      return;
    }
    if (id !== 'quakes' && id !== 'events') throw new HttpError(400, 'layer must be quakes, events or weather');
    const data = await layer(id as LayerId);
    res.setHeader?.('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (err) { send(res, err); }
}
