import { HttpError } from './_nebius.js';
import { geocode } from './_places.js';
import { LGD } from './_lgd.js';

/**
 * India's official alerts: NDMA SACHET, the national Common Alerting Protocol (CAP 1.2) feed.
 * IMD, CWC, INCOIS and the state disaster authorities publish through it, in English and in the
 * regional language. Nayan reads the public RSS index, then each alert's own CAP document.
 *
 * Location: CAP areas here carry LGD district codes, not polygons (the polygon endpoint refuses
 * automated requests). Each code maps to a district point from the Census 2011 boundaries, or an
 * OpenStreetMap point for districts created after 2011. An alert sits at the mean of its districts.
 */

export const SACHET_RSS = 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml';
const UA = 'Nayan/0.3 (github.com/victorisaacchinta-eng/atlas-live)';

export interface AlertText { lang: string; event: string; headline: string; description: string; instruction: string }
export interface District { code: number; name: string; state: string; lat: number; lon: number }
export interface IndiaAlert {
  id: string;               // the CAP identifier, e.g. "IN-1795483307084007_43"
  sender: string;           // e.g. "IMD Visakhapatnam", "Andhra Pradesh SDMA"
  sent: string;             // ISO with offset, as published
  msgType: string;          // Alert | Update | Cancel
  status: string;           // Actual (others are dropped)
  scope: string;            // Public (others are dropped)
  category: string;         // Met, Geo, Hydro...
  onset?: string;
  references: string[];     // CAP identifiers of earlier messages this one updates or cancels
  geocodes: { name: string; value: string }[]; // exactly as published, with their code system
  districtSource: 'lgd' | 'text' | 'none';     // where the district list came from
  unknownCodes: number[];   // LGD codes Nayan's table cannot name
  areaLevel: 'district' | 'sub-district';      // mandal, tehsil or block level areas cover part of a district
  polygonUrl?: string;
  event: string;            // English event name, e.g. "Heavy Rain"
  severity: string;         // Extreme | Severe | Moderate | Minor | Unknown
  urgency: string;
  certainty: string;
  effective?: string;
  expires?: string;
  areaDesc: string;
  state: string;
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
// SACHET's own language tags are not all ISO 639-1: Telugu arrives as "TL", Odia as "OD".
const LANG_FIX: Record<string, string> = { tl: 'te', od: 'or', ori: 'or', tel: 'te', hin: 'hi', ben: 'bn', tam: 'ta', mal: 'ml', kan: 'kn', mar: 'mr', guj: 'gu', pun: 'pa', asm: 'as' };
export const langCode = (raw: string) => { const c = raw.trim().toLowerCase().split(/[-_]/)[0]; return LANG_FIX[c] || c.slice(0, 2); };
export const langName = (code: string) => LANG[langCode(code)] || code;

// District names as they appear in alert text, for alerts that carry no LGD codes. Compact keys
// ("rudraprayag" matches "Rudra Prayag"); a name used by two states is kept with both.
const compact = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
const BY_NAME = new Map<string, number[]>();
for (const [code, [name]] of Object.entries(LGD)) { const k = compact(name); if (k.length >= 4) BY_NAME.set(k, [...(BY_NAME.get(k) || []), Number(code)]); }
const STATES = [...new Set(Object.values(LGD).map((v) => v[1]))];
const stateIn = (t: string) => STATES.filter((st) => compact(t).includes(compact(st))).sort((a, b) => b.length - a.length)[0];

/** District codes named in free text (one to three word runs), limited to one state when it is known. */
function districtsIn(text: string, state?: string): number[] {
  const w = text.replace(/[_/]/g, ' ').split(/[^A-Za-z]+/).filter(Boolean);
  const found = new Set<number>();
  for (let i = 0; i < w.length; i++) for (let n = 3; n >= 1; n--) {
    const codes = BY_NAME.get(compact(w.slice(i, i + n).join('')));
    if (!codes) continue;
    const pick = state ? codes.filter((c) => LGD[c][1] === state) : codes.length === 1 ? codes : [];
    pick.forEach((c) => found.add(c));
    if (pick.length) break;
  }
  return [...found];
}

/** The CAP host is fixed. A URL from the browser is only fetched if it points there. */
export function isSachetUrl(u: string) {
  try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'sachet.ndma.gov.in' && x.pathname.startsWith('/cap_public_website/'); } catch { return false; }
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
    lang: langCode(tag(i, 'language') || 'en'), event: tag(i, 'event'), headline: tag(i, 'headline'),
    description: tag(i, 'description'), instruction: tag(i, 'instruction'),
  }));
  const en = infos.find((i) => /^en/i.test(tag(i, 'language'))) || infos[0];
  const area = all(en, 'area')[0] || all(xml, 'area')[0] || '';
  const areaDesc0 = tag(area, 'areaDesc');
  const sender0 = tag(xml, 'sender').replace(/[-_]/g, ' ');
  const geocodes = all(xml, 'geocode').map((g) => ({ name: tag(g, 'valueName'), value: tag(g, 'value') })).filter((g) => g.name || g.value);
  const geoSeen = new Set<string>();
  const geocodesU = geocodes.filter((g) => { const k = `${g.name}|${g.value}`; if (geoSeen.has(k)) return false; geoSeen.add(k); return true; });
  let codes = [...new Set(all(area || xml, 'geocode').map((g) => /LGD District/i.test(g) ? Number(tag(g, 'value')) : NaN).filter(Number.isFinite))];
  const unknownCodes = codes.filter((c) => !LGD[c]);
  let districtSource: IndiaAlert['districtSource'] = codes.some((c) => LGD[c]) ? 'lgd' : 'none';
  // No codes: find district names in the area description, then in the English headline.
  const enText = `${tag(en, 'headline')} ${tag(en, 'description')}`;
  const state0 = stateIn(areaDesc0) || stateIn(sender0) || stateIn(enText);
  if (!codes.some((c) => LGD[c])) {
    codes = [...new Set([...districtsIn(areaDesc0, state0), ...districtsIn(enText, state0)])];
    if (codes.length) districtSource = 'text';
  }
  const districts: District[] = codes.map((code) => LGD[code] ? { code, name: LGD[code][0], state: LGD[code][1], lat: LGD[code][2], lon: LGD[code][3] } : null).filter(Boolean) as District[];
  const areaDesc = areaDesc0;
  const sender = tag(xml, 'sender');
  let lat = NaN, lon = NaN, located: IndiaAlert['located'] = 'districts';
  if (districts.length) {
    lat = districts.reduce((s, d) => s + d.lat, 0) / districts.length;
    lon = districts.reduce((s, d) => s + d.lon, 0) / districts.length;
  } else {
    // No known district code (a district created after the code table): use the names in areaDesc,
    // "Almora, Bageshwar districts of Uttarakhand", then the state, then the sender's state.
    const m = areaDesc.match(/^(.*?)\s+districts? of\s+(.+)$/i);
    const state = (m?.[2] || state0 || '').trim();
    // "Palmanpeta To Bhimunipatnam", "Srikakulam, Narasannapeta, Tekkali", "vamsadhara_80000_cap_footprint"
    const names = (m ? m[1] : areaDesc).replace(/_\d.*$/, '').replace(/_/g, ' ').split(/,|\s+to\s+|\band\b/i)
      .map((x) => x.trim()).filter((x) => x.length > 2 && !/^\d+$/.test(x) && !/^(some|few|many) parts$|^districts? of/i.test(x) && /[a-z]/.test(x)).slice(0, 3);
    const pts = state ? (await Promise.all(names.map((n) => place(`${n}, ${state}, India`)))).filter(Boolean) as { lat: number; lon: number }[] : [];
    if (pts.length) {
      lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length; lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
      located = 'area-name';
    } else {
      const g = state ? await place(`${state}, India`) : null;
      if (!g) return null;
      ({ lat, lon } = g);
      located = 'state';
    }
  }
  const event = tag(en, 'event') || texts[0].event;
  const polygon = all(en, 'parameter').find((p) => /polygon/i.test(tag(p, 'valueName')));
  const references = tag(xml, 'references').split(/\s+/).map((t) => t.split(',')[1]).filter(Boolean);
  return {
    id: tag(xml, 'identifier'), sender: sender.replace(/[-_]/g, ' '), sent: tag(xml, 'sent'), msgType: tag(xml, 'msgType'),
    status: tag(xml, 'status'), scope: tag(xml, 'scope'), category: tag(en, 'category'), onset: tag(en, 'onset') || undefined,
    references, geocodes: geocodesU, districtSource, unknownCodes,
    areaLevel: /\b(mandals?|tehsils?|taluk[as]?|blocks?|villages?|sub-?divisions?|circles?|gram panchayats?)\b/i.test(areaDesc) ? 'sub-district' : 'district',
    polygonUrl: polygon ? tag(polygon, 'value') : undefined,
    event, severity: tag(en, 'severity') || 'Unknown', urgency: tag(en, 'urgency'), certainty: tag(en, 'certainty'),
    effective: tag(en, 'effective') || undefined, expires: tag(en, 'expires') || undefined,
    areaDesc, state: districts[0]?.state || state0 || '', districts, lat: +lat.toFixed(4), lon: +lon.toFixed(4), located, texts, feedTitle: decode(feedTitle).trim(), url,
  };
}

// SACHET's integration guide asks every consumer to cache each CAP document with its ETag and send
// If-None-Match, using the cached copy on 304. A warm serverless instance keeps these between calls.
// A document whose alert has expired is never fetched again: CAP messages do not change once expired.
interface Cached { etag?: string; xml: string; alert: IndiaAlert | null; at: number }
const capCache = new Map<string, Cached>();
let rssCache: { etag?: string; modified?: string; text: string } | null = null;

async function getCond(url: string, ms: number, etag?: string, modified?: string) {
  const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' };
  if (etag) headers['If-None-Match'] = etag;
  if (modified) headers['If-Modified-Since'] = modified;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  if (r.status === 304) return { status: 304 as const };
  if (!r.ok) throw new HttpError(502, `SACHET answered ${r.status}`);
  return { status: 200 as const, text: await r.text(), etag: r.headers.get('etag') || undefined, modified: r.headers.get('last-modified') || undefined };
}

/** Pull the RSS index and the CAP documents behind it. Expired, cancelled, superseded and duplicate alerts are dropped. */
export async function fetchSachet(max = 150): Promise<{ updated: string; alerts: IndiaAlert[]; failed: number; listed: number; conditional: number }> {
  const got = await getCond(SACHET_RSS, 12000, rssCache?.etag, rssCache?.modified);
  if (got.status === 200) rssCache = { etag: got.etag, modified: got.modified, text: got.text! };
  const rss = rssCache?.text ?? '';
  const items = rss.split(/<item>/).slice(1).map((it) => ({
    title: tag(it, 'title'), link: tag(it, 'link'), pub: tag(it, 'pubDate'), author: tag(it, 'author'),
  })).filter((x) => isSachetUrl(x.link)).slice(0, max);
  let failed = 0, conditional = 0;
  const out: IndiaAlert[] = [];
  const queue = [...items];
  const now = Date.now();
  // A cold server has no copies yet and must read every listed document once; 16 at a time keeps
  // that first read near ten seconds. After that, almost every request is a 304 or skipped.
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      const hit = capCache.get(it.link);
      if (hit && hit.alert?.expires && Date.parse(hit.alert.expires) <= now) continue;
      try {
        const r = await getCond(it.link, 6000, hit?.etag);
        if (r.status === 304 && hit) { conditional++; if (hit.alert) out.push(hit.alert); continue; }
        const xml = r.text ?? hit?.xml ?? '';
        const a = await parseCap(xml, it.link, it.title);
        capCache.set(it.link, { etag: r.etag, xml, alert: a, at: now });
        if (a) out.push(a);
      } catch {
        failed++;
        if (hit?.alert) out.push(hit.alert); // the last good copy of this document
      }
    }
  }));
  const live = out.filter((a) => a.msgType !== 'Cancel' && (!a.expires || Date.parse(a.expires) > now));
  // A message that updates or cancels another removes the one it names. SACHET serves the newest
  // version of each alert at its own link, so updates usually name an earlier version of themselves.
  const base = (id: string) => id.replace(/^IN-/, '').replace(/_\d+$/, '');
  const replaced = new Set(out.flatMap((a) => a.references.filter((r) => base(r) !== base(a.id)).map(base)));
  const current = live.filter((a) => !replaced.has(base(a.id)));
  // Same warning re-issued: keep the newest per sender, event and set of districts.
  const seen = new Map<string, IndiaAlert>();
  for (const a of current.sort((x, y) => Date.parse(y.sent) - Date.parse(x.sent))) {
    const k = `${a.sender}|${a.event}|${a.districts.map((d) => d.code).sort().join(',') || a.areaDesc}`;
    if (!seen.has(k)) seen.set(k, a);
  }
  const newest = items.map((x) => Date.parse(x.pub)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return { updated: new Date(newest || now).toISOString(), alerts: [...seen.values()], failed, listed: items.length, conditional };
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
