import { send, HttpError } from './_nebius.js';
import { facts } from './_places.js';

/** A few cited facts about one named place (Tavily search, then the model writes from the results only). */
export default async function handler(req: { method: string; body: { name?: string; city?: string } }, res: { status: (n: number) => { json: (b: unknown) => void }; setHeader?: (k: string, v: string) => void }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const city = String(req.body?.city || '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'name is required');
    const f = await facts(city ? `${name}, ${city}` : name, [name]);
    res.setHeader?.('Cache-Control', 's-maxage=86400');
    res.status(200).json(f);
  } catch (err) { send(res, err); }
}
