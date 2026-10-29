import { send, HttpError } from './_nebius.js';

/**
 * GET /api/alerts?probe=1
 * Reachability probe for India's SACHET (NDMA) public CAP feed from a Vercel function.
 * Returns status, timing, item count and one raw CAP document so the parser can be designed
 * against real data. Replaced by the real adapter once reachability is confirmed.
 */
const RSS = 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml';

async function timed(url: string, ms: number) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ATLAS-Live/0.3 (github.com/victorisaacchinta-eng/atlas-live)' }, signal: AbortSignal.timeout(ms) });
    const text = await r.text();
    return { ok: r.ok, status: r.status, ms: Date.now() - t, type: r.headers.get('content-type'), text };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t, type: null, text: '', error: String(e) };
  }
}

export default async function handler(req: { method: string; query: Record<string, string | string[]> }, res: { status: (n: number) => { json: (b: unknown) => void }; setHeader?: (k: string, v: string) => void }) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'GET only');
    const rss = await timed(RSS, 15000);
    const items = rss.text.split('<item>').slice(1);
    const links = items.map((i) => (i.match(/<link>([^<]+)<\/link>/) || [])[1]).filter(Boolean) as string[];
    const cap = links[0] ? await timed(links[0].trim(), 15000) : null;
    res.setHeader?.('Cache-Control', 'no-store');
    res.status(200).json({
      region: process.env.VERCEL_REGION || null,
      rss: { ok: rss.ok, status: rss.status, ms: rss.ms, type: rss.type, items: items.length, error: (rss as { error?: string }).error, head: rss.text.slice(0, 400) },
      firstItem: items[0]?.slice(0, 1500) || null,
      cap: cap ? { ok: cap.ok, status: cap.status, ms: cap.ms, type: cap.type, text: cap.text.slice(0, 4000) } : null,
    });
  } catch (err) { send(res, err); }
}
