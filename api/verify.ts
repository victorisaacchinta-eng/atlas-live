import { chat, extractJson, send, MODELS, HttpError } from './_nebius.js';
import { isSachetUrl, parseCap, alertRecord, kindOf, type IndiaAlert } from './_sachet.js';

/**
 * POST /api/verify { text?, image?, alerts, feed } -> { verdict, reason, claims, match, extracted, sources }
 *
 * Checks a forwarded "alert" against the official NDMA SACHET alerts in force right now.
 *   1. Read: a model lists what the forward claims (hazard, places, timing, who issued it).
 *      A screenshot is read by a vision model.
 *   2. Match, by code: alerts in force whose hazard and districts or state overlap the claims.
 *   3. Re-read the matched alert from SACHET itself, so the comparison never trusts the browser.
 *   4. Compare: a model labels each claim supported, contradicted or not in the alert.
 * The verdict is computed by code from those labels, in four steps only:
 *   match      every claim is in the official alert
 *   partial    a related official alert exists, but the forward changes or adds details
 *   no_match   no alert in force in the sources checked covers this place and hazard
 *   unable     too little to check: not a warning, no place named, unreadable, or the feed is down
 * Never "fake": absence from SACHET right now does not prove a message false.
 */

interface ClientAlert {
  id: string; url: string; event?: string; kind?: string; sender?: string; severity?: string; expires?: string;
  state?: string; districts?: string[]; title?: string; texts?: { lang: string; headline: string; description?: string }[];
}
interface Extracted {
  is_alert: boolean; text: string; language: string; hazard: string; places: string[]; states: string[];
  when: string; issuer: string; severity: string; claims: string[];
}
type Status = 'supported' | 'contradicted' | 'not_in_alert';

const EXTRACT = `You read a message that someone forwarded on WhatsApp or SMS and say exactly what it claims. Do not judge whether it is true.
Return ONLY JSON:
{"is_alert": true if it warns about a disaster, weather or hazard, else false,
 "text": "the message text, transcribed exactly (from the image if one is given)",
 "language": "the language it is written in",
 "hazard": "the hazard in plain English, e.g. heavy rain, cyclone, thunderstorm and lightning, heat wave, flood, earthquake, tsunami",
 "places": ["every district, city, town or area it names, in English spelling"],
 "states": ["every Indian state or union territory it names or clearly implies"],
 "when": "the timing it claims, as written",
 "issuer": "who it says issued it (IMD, NDMA, a collector, police...), or empty",
 "severity": "any level it claims (red alert, orange, extreme...), or empty",
 "claims": ["3 to 6 short, separate factual claims the message makes, each checkable on its own"]}`;

const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
function placeHit(names: string[], cands: string[]) {
  const ns = names.map(norm).filter((x) => x.length >= 4);
  return cands.some((c) => { const k = norm(c); return k.length >= 4 && ns.some((n) => n === k || n.startsWith(k) || k.startsWith(n)); });
}
const HAZ: [RegExp, string][] = [
  [/cyclon|storm surge|depression/i, 'cyclone'], [/flood|inundat/i, 'flood'], [/tsunami/i, 'tsunami'], [/landslide/i, 'landslide'],
  [/earthquake|tremor/i, 'earthquake'], [/thunder|lightning|squall|hail/i, 'thunderstorm'], [/rain/i, 'rain'], [/heat/i, 'heat'], [/cold|frost/i, 'cold'],
];
const kindOfText = (t: string) => HAZ.find(([re]) => re.test(t))?.[1] ?? '';
const related = (a: string, b: string) => !!a && !!b && (a === b || (['rain', 'flood', 'thunderstorm'].includes(a) && ['rain', 'flood', 'thunderstorm'].includes(b)));

const COVERAGE = 'NDMA SACHET carries the CAP alerts of IMD, CWC, INCOIS and the state disaster authorities that publish through it. It does not carry district WhatsApp messages, local announcements or news, and only alerts still in force were checked.';

export default async function handler(req: { method: string; body: { text?: string; image?: string; alerts?: ClientAlert[]; feed?: { fetchedAt?: string; stale?: boolean } } }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const text = String(req.body?.text || '').trim().slice(0, 4000);
    const image = req.body?.image;
    if (!text && !image) throw new HttpError(400, 'Paste the message or attach a screenshot.');
    if (image && (!image.startsWith('data:image/') || image.length > 3_500_000)) throw new HttpError(400, 'The screenshot must be an image under 2.5 MB.');
    const alerts = (Array.isArray(req.body?.alerts) ? req.body!.alerts! : []).filter((a) => a && isSachetUrl(String(a.url))).slice(0, 80);
    const feed = req.body?.feed ?? {};
    const sources = [{ name: 'NDMA SACHET, all-India CAP feed (alerts in force)', url: 'https://sachet.ndma.gov.in/', checkedAt: String(feed.fetchedAt || ''), alerts: alerts.length, stale: !!feed.stale }];
    const base = { sources, coverage: COVERAGE };
    if (!Array.isArray(req.body?.alerts) || feed.stale) {
      res.status(200).json({ ...base, verdict: 'unable', reason: 'feed', claims: [] });
      return;
    }

    // 1. Read the forward.
    const r1 = await chat({
      op: 'verify.read', model: image ? MODELS.vision : MODELS.fast, temperature: 0, max_tokens: 1200, timeout_ms: 25_000,
      messages: [{ role: 'user', content: image
        ? [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: `${EXTRACT}${text ? `\n\nThe sender also typed: ${text}` : ''}` }]
        : `${EXTRACT}\n\nMessage:\n"""${text}"""` }],
    });
    const x = extractJson<Extracted>(r1.choices?.[0]?.message?.content || '{}');
    const ex: Extracted = {
      is_alert: x.is_alert !== false, text: String(x.text || text).slice(0, 4000), language: String(x.language || ''),
      hazard: String(x.hazard || ''), places: (x.places || []).map(String).slice(0, 20), states: (x.states || []).map(String).slice(0, 8),
      when: String(x.when || ''), issuer: String(x.issuer || ''), severity: String(x.severity || ''),
      claims: (x.claims || []).map(String).filter(Boolean).slice(0, 6),
    };
    if (!ex.is_alert) { res.status(200).json({ ...base, verdict: 'unable', reason: 'not_alert', extracted: ex, claims: [], model: r1.servedBy }); return; }
    if (!ex.places.length && !ex.states.length) { res.status(200).json({ ...base, verdict: 'unable', reason: 'no_place', extracted: ex, claims: [], model: r1.servedBy }); return; }

    // 2. Match by code: same or related hazard, and a named place or state in the alert's area.
    const want = kindOfText(`${ex.hazard} ${ex.text}`);
    const scored = alerts.map((a) => {
      const k = a.kind || kindOf(a.event || '', a.texts?.[0]?.headline || '');
      const where = [...(a.districts ?? []), ...(a.state ? [a.state] : [])];
      const placeMatch = placeHit(where, ex.places);
      const stateMatch = placeHit(a.state ? [a.state] : [], [...ex.states, ...ex.places]);
      const hz = related(want, k);
      return { a, score: (placeMatch ? 3 : 0) + (stateMatch ? 1 : 0) + (hz ? 2 : 0), placeMatch, stateMatch, hz };
    }).filter((m) => (m.placeMatch || m.stateMatch) && (m.hz || !want)).sort((p, q) => q.score - p.score);
    if (!scored.length) {
      res.status(200).json({ ...base, verdict: 'no_match', extracted: ex, claims: ex.claims.map((c) => ({ claim: c, status: 'not_in_alert', reason: 'No alert in force in the sources checked covers this place and hazard.' })), checked: alerts.length, model: r1.servedBy });
      return;
    }
    const best = scored[0].a;

    // 3. Re-read the matched alert from SACHET, so the comparison uses the official record.
    let official = '', reread = false, rec: IndiaAlert | null = null;
    try {
      const r = await fetch(best.url, { headers: { 'User-Agent': 'Nayan/0.4 (github.com/victorisaacchinta-eng/atlas-live)' }, signal: AbortSignal.timeout(8000) });
      if (r.ok) { rec = await parseCap(await r.text(), best.url); if (rec) { official = alertRecord(rec); reread = true; } }
    } catch { /* fall back to the copy the browser loaded from our own feed */ }
    if (!official) official = [`Issued by: ${best.sender}`, `Event: ${best.event}`, `Severity: ${best.severity}`, best.expires ? `Expires: ${best.expires}` : '', best.districts?.length ? `Districts: ${best.districts.join(', ')}` : '', ...(best.texts ?? []).map((t) => `${t.headline}\n${t.description ?? ''}`)].filter(Boolean).join('\n');

    // 4. Compare each claim with the official record.
    const r2 = await chat({
      op: 'verify.compare', model: MODELS.fast, temperature: 0, max_tokens: 1200, timeout_ms: 25_000,
      messages: [
        { role: 'system', content: 'You compare claims from a forwarded message with an official disaster alert. Judge each claim only against the official alert text. Times in the alert are in UTC unless marked; IST is UTC+05:30. A claim that goes beyond the alert (bigger numbers, a stronger level, extra places, extra instructions such as school closures) is not_in_alert unless the alert says it. Return ONLY JSON.' },
        { role: 'user', content: `Official alert:\n"""${official.slice(0, 5000)}"""\n\nClaims:\n${ex.claims.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nReturn {"claims":[{"n":1,"status":"supported|contradicted|not_in_alert","reason":"under 25 words, citing the alert's words"}]}` },
      ],
    });
    const y = extractJson<{ claims?: { n: number; status: string; reason: string }[] }>(r2.choices?.[0]?.message?.content || '{}');
    const claims = ex.claims.map((c, i) => {
      const hit = y.claims?.find((z) => Number(z.n) === i + 1);
      const status: Status = hit && ['supported', 'contradicted', 'not_in_alert'].includes(hit.status) ? hit.status as Status : 'not_in_alert';
      return { claim: c, status, reason: String(hit?.reason || 'Not checked.').slice(0, 240) };
    });
    // The verdict is code, not model: one changed detail makes it a partial match at best.
    const contradictions = claims.filter((c) => c.status === 'contradicted').length;
    const verdict = !claims.length ? 'unable' : !contradictions && claims.every((c) => c.status === 'supported') ? 'match' : 'partial';
    res.status(200).json({
      ...base, verdict, reason: !claims.length ? 'no_claims' : '', contradictions, extracted: ex, claims, checked: alerts.length,
      match: { id: best.id, url: best.url, title: best.title, sender: rec?.sender ?? best.sender, event: rec?.event ?? best.event, severity: rec?.severity ?? best.severity, expires: rec?.expires ?? best.expires, sent: rec?.sent, reread },
      model: [r1.servedBy, r2.servedBy].filter(Boolean).join(', '),
    });
  } catch (err) { send(res, err); }
}
