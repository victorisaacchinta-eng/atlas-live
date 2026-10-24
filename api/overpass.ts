import { send, HttpError } from './_nebius.js';

/**
 * Read-only OpenStreetMap queries for God's Eye View, run from the server because some
 * networks block the public Overpass mirrors. Only JSON queries are passed on, mirrors
 * are tried in turn, and answers are cached at the edge for half an hour.
 */

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'ATLAS-Live/1.0 (https://atlas-live-xi.vercel.app)';

type Req = { method: string; query: Record<string, string | string[] | undefined> };
type Res = { status: (n: number) => { json: (b: unknown) => void }; setHeader: (k: string, v: string) => void };

export default async function handler(req: Req, res: Res) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'GET only');
    const raw = req.query.data;
    const data = String(Array.isArray(raw) ? raw[0] : raw || '');
    if (!data.startsWith('[out:json]') || data.length > 3000) throw new HttpError(400, 'Expected an Overpass JSON query');
    let last = '';
    for (const url of MIRRORS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: `data=${encodeURIComponent(data)}`,
          signal: AbortSignal.timeout(25_000),
        });
        if (!r.ok) {
          last = `${new URL(url).host} ${r.status}`;
          continue;
        }
        const json = await r.json();
        res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
        return res.status(200).json(json);
      } catch (err) {
        last = `${new URL(url).host} ${err instanceof Error ? err.name : 'error'}`;
      }
    }
    throw new HttpError(502, `OpenStreetMap could not be reached (${last})`);
  } catch (err) {
    send(res, err);
  }
}
