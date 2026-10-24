import { send, HttpError } from './_nebius.js';

/**
 * Read-only OpenStreetMap queries for God's Eye View, run from the server because some
 * networks block the public Overpass mirrors. Only JSON queries are passed on, mirrors
 * are asked at once, and answers are cached at the edge for half an hour.
 */

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'ATLAS-Live/1.0 (https://atlas-live-xi.vercel.app)';

type Req = { method: string; query: Record<string, string | string[] | undefined> };
type Res = { status: (n: number) => { json: (b: unknown) => void }; setHeader: (k: string, v: string) => void };

export default async function handler(req: Req, res: Res) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'GET only');
    const raw = req.query.data;
    const data = String(Array.isArray(raw) ? raw[0] : raw || '');
    if (!data.startsWith('[out:json]') || data.length > 3000) throw new HttpError(400, 'Expected an Overpass JSON query');
    // Ask every mirror at once and take the first good answer; public Overpass servers are often busy.
    const failures: string[] = [];
    const attempt = async (url: string) => {
      const host = new URL(url).host;
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: `data=${encodeURIComponent(data)}`,
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) throw new Error(`${host} ${r.status}`);
        return await r.json();
      } catch (err) {
        failures.push(err instanceof Error && err.message.startsWith(host) ? err.message : `${host} ${err instanceof Error ? err.name : 'error'}`);
        throw err;
      }
    };
    let json: unknown;
    try {
      json = await Promise.any(MIRRORS.map(attempt));
    } catch {
      throw new HttpError(502, `OpenStreetMap could not be reached (${failures.join(', ')})`);
    }
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.status(200).json(json);
  } catch (err) {
    send(res, err);
  }
}
