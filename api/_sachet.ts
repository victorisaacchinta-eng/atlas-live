import { HttpError } from './_nebius.js';
import { geocode } from './_places.js';
import { LGD } from './_lgd.js';

/**
 * India's official alerts: NDMA SACHET, the national Common Alerting Protocol (CAP 1.2) feed.
 * IMD, CWC, INCOIS and the state disaster authorities publish through it, in English and in the
 * regional language. ATLAS reads the public RSS index, then each alert's own CAP document.
 *
 * Location: CAP areas here carry LGD district codes, not polygons (the polygon endpoint refuses
 * automated requests). Each code maps to a district point from the Census 2011 boundaries, or an
 * OpenStreetMap point for districts created after 2011. An alert sits at the mean of its districts.
 */

export const SACHET_RSS = 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml';
const UA = 'ATLAS-Live/0.3 (github.com/victorisaacchinta-eng/atlas-live)';

export interface AlertText { lang: string; event: string; headline: string; description: string; instruction: string }
export interface District { code: number; name: string; state: string; lat: number; lon: number }
export interface IndiaAlert {
  id: string;
  sender: string;           // e.g. "IMD Visakhapatnam", "Andhra Pradesh SDMA"
  sent: string;             // ISO with offset, as published
  msgType: string;          // Alert | Update | Cancel
  event: string;            // English event name, e.g. "Heavy Rain"
  severity: string;         // Extreme | Severe | Moderate | Minor | Unknown
  urgency: string;
  certainty: string;
  effective?: string;
  expires?: string;
  areaDesc: string;
  districts: District[];
  lat: number;
  lon: number;
  located: 'districts' | 'area-name' | 'state';
  texts: AlertText[];       // one per language in the CAP document, original wording
  feedTitle: string;        // the RSS item title, often in the regional language
  url: string;              // the CAP document itself
}

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<(?:cap:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:cap:)?${name}>`));
  return m ? decode(m[1]).trim() : '';
};
const all = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:cap:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:cap:)?${name}>`, 'g'))].map((m) => m[1]);
function decode(s: string) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
}
const LANG: Record<string, string> = { hi: 'Hindi', te: 'Telugu', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', bn: 'Bengali', mr: 'Marathi', gu: 'Gujarati', or: 'Odia', pa: 'Punjabi', as: 'Assamese', ur: 'Urdu', en: 'English' };
export const langName = (code: string) => LANG[code.slice(0, 2).toLowerCase()] || code;

/** The CAP host is fixed. A URL from the browser is only fetched if it points there. */
export function isSachetUrl(u: string) {
  try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'sachet.ndma.gov.in' && x.pathname.startsWith('/cap_public_website/'); } catch { return false; }
}

async function get(url: string, ms: number) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new HttpError(502, `SACHET answered ${r.status}`);
  return r.text();
}

const KIND: [RegExp, string][] = [
  [/cyclon|depression|storm surge/i, 'cyclone'], [/flood|inundat|dam|barrage|river/i, 'flood'], [/tsunami/i, 'tsunami'],
  [/landslide|mudslide/i, 'landslide'], [/avalanche/i, 'avalanche'], [/earthquake/i, 'earthquake'],
  [/thunder|lightning|squall|hail|gust/i, 'thunderstorm'], [/rain/i, 'rain'], [/heat/i, 'heat'], [/cold|frost/i, 'cold'],
  [/fog/i, 'fog'], [/dust|sand/i, 'dust'], [/fire/i, 'wildfire'], [/drought/i, 'drought'],
];
export const kindOf = (event: string, headline = '') => KIND.find(([re]) => re.test(event))?.[1] || KIND.find(([re]) => re.test(headline))?.[1] || 'alert';
export const SEVERITY_RANK: Record<string, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };

const placeCache = new Map<string, { lat: number; lon: number } | null>();
// Nominatim allows one request a second: lookups queue behind each other.
let lane: Promise<unknown> = Promise.resolve();
function place(q: string): Promise<{ lat: number; lon: number } | null> {
  if (placeCache.has(q)) return Promise.resolve(placeCache.get(q)!);
  const run = lane.then(() => lookup(q));
  lane = run.then(() => new Promise((r) => setTimeout(r, 1000)));
  return run;
}
async function lookup(q: string) {
  if (placeCache.has(q)) return placeCache.get(q)!;
  let g: { lat: number; lon: number } | null = null;
  try { const x = await geocode(q); if (x.lat > 5 && x.lat < 38 && x.lon > 67 && x.lon < 98) g = { lat: x.lat, lon: x.lon }; } catch { /* stays null */ }
  placeCache.set(q, g);
  return g;
}

/** Parse one CAP document. Returns null for anything that is not a current, public, actual alert. */
export async function parseCap(xml: string, url: string, feedTitle = ''): Promise<IndiaAlert | null> {
  if (tag(xml, 'status') !== 'Actual' || tag(xml, 'scope') !== 'Public') return null;
  const infos = all(xml, 'info');
  if (!infos.length) return null;
  const texts: AlertText[] = infos.map((i) => ({
    lang: tag(i, 'language') || 'en-IN', event: tag(i, 'event'), headline: tag(i, 'headline'),
    description: tag(i, 'description'), instruction: tag(i, 'instruction'),
  }));
  const en = infos.find((i) => /^en/i.test(tag(i, 'language'))) || infos[0];
  const area = all(en, 'area')[0] || all(xml, 'area')[0] || '';
  const codes = [...new Set(all(area || xml, 'geocode').map((g) => /LGD District/i.test(g) ? Number(tag(g, 'value')) : NaN).filter(Number.isFinite))];
  const districts: District[] = codes.map((code) => LGD[code] ? { code, name: LGD[code][0], state: LGD[code][1], lat: LGD[code][2], lon: LGD[code][3] } : null).filter(Boolean) as District[];
  const areaDesc = tag(area, 'areaDesc');
  const sender = tag(xml, 'sender');
  let lat = NaN, lon = NaN, located: IndiaAlert['located'] = 'districts';
  if (districts.length) {
    lat = districts.reduce((s, d) => s + d.lat, 0) / districts.length;
    lon = districts.reduce((s, d) => s + d.lon, 0) / districts.length;
  } else {
    // No known district code (a district created after the code table): use the names in areaDesc,
    // "Almora, Bageshwar districts of Uttarakhand", then the state, then the sender's state.
    const m = areaDesc.match(/^(.*?)\s+districts? of\s+(.+)$/i);
    const state = (m?.[2] || sender.replace(/[-_]/g, ' ').replace(/^IMD\s+/i, '').replace(/\s*SDMA$/i, '')).trim();
    const names = m && !/^\d+$/.test(m[1].trim()) ? m[1].split(/,|\band\b/).map((x) => x.trim()).filter(Boolean).slice(0, 4) : [];
    const pts = (await Promise.all(names.map((n) => place(`${n} district, ${state}, India`)))).filter(Boolean) as { lat: number; lon: number }[];
    if (pts.length) {
      lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length; lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
      located = 'area-name';
    } else {
      const g = (areaDesc && !m ? await place(`${areaDesc}, India`) : null) || (state ? await place(`${state}, India`) : null);
      if (!g) return null;
      ({ lat, lon } = g);
      located = 'state';
    }
  }
  const event = tag(en, 'event') || texts[0].event;
  return {
    id: tag(xml, 'identifier'), sender: sender.replace(/[-_]/g, ' '), sent: tag(xml, 'sent'), msgType: tag(xml, 'msgType'),
    event, severity: tag(en, 'severity') || 'Unknown', urgency: tag(en, 'urgency'), certainty: tag(en, 'certainty'),
    effective: tag(en, 'effective') || undefined, expires: tag(en, 'expires') || undefined,
    areaDesc, districts, lat: +lat.toFixed(4), lon: +lon.toFixed(4), located, texts, feedTitle: decode(feedTitle).trim(), url,
  };
}

/** Pull the RSS index and the CAP documents behind it. Expired, cancelled and duplicate alerts are dropped. */
export async function fetchSachet(max = 60): Promise<{ updated: string; alerts: IndiaAlert[]; failed: number }> {
  const rss = await get(SACHET_RSS, 12000);
  const items = rss.split(/<item>/).slice(1).map((it) => ({
    title: tag(it, 'title'), link: tag(it, 'link'), pub: tag(it, 'pubDate'), author: tag(it, 'author'),
  })).filter((x) => isSachetUrl(x.link)).slice(0, max);
  let failed = 0;
  const out: IndiaAlert[] = [];
  const queue = [...items];
  await Promise.all(Array.from({ length: 10 }, async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      try {
        const a = await parseCap(await get(it.link, 7000), it.link, it.title);
        if (a) out.push(a);
      } catch { failed++; }
    }
  }));
  const now = Date.now();
  const live = out.filter((a) => a.msgType !== 'Cancel' && (!a.expires || Date.parse(a.expires) > now));
  // Updates re-issue the same warning: keep the newest per sender, event and set of districts.
  const seen = new Map<string, IndiaAlert>();
  for (const a of live.sort((x, y) => Date.parse(y.sent) - Date.parse(x.sent))) {
    const k = `${a.sender}|${a.event}|${a.districts.map((d) => d.code).sort().join(',') || a.areaDesc}`;
    if (!seen.has(k)) seen.set(k, a);
  }
  const newest = items.map((x) => Date.parse(x.pub)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return { updated: new Date(newest || now).toISOString(), alerts: [...seen.values()], failed };
}

/** The alert as a plain-text official record for the writer and the checker. */
export function alertRecord(a: IndiaAlert) {
  const lines = [
    `Issued by: ${a.sender} via NDMA SACHET (India's national Common Alerting Protocol system)`,
    `Sent: ${a.sent}`, `Message type: ${a.msgType}`,
    `Event: ${a.event}`, `Severity: ${a.severity}. Urgency: ${a.urgency}. Certainty: ${a.certainty}.`,
  ];
  if (a.effective) lines.push(`Effective: ${a.effective}`);
  if (a.expires) lines.push(`Expires: ${a.expires}`);
  if (a.areaDesc) lines.push(`Area: ${a.areaDesc}`);
  if (a.districts.length) lines.push(`Districts (LGD): ${a.districts.map((d) => `${d.name} (${d.state})`).join(', ')}`);
  for (const t of a.texts) {
    lines.push(`--- Alert text in ${langName(t.lang)} ---`);
    if (t.headline) lines.push(t.headline);
    if (t.description && t.description !== t.headline) lines.push(t.description);
    if (t.instruction) lines.push(`Instruction: ${t.instruction}`);
  }
  if (a.feedTitle && !a.texts.some((t) => t.headline === a.feedTitle)) lines.push(`--- Feed title ---`, a.feedTitle);
  return lines.join('\n');
}
