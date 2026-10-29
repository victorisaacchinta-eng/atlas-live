import { chat, tavily, extractJson, send, MODELS, PROVIDER, HttpError, indicModel, indicFallbacks, type TavilyResult } from './_nebius.js';
import { geocode } from './_places.js';
import { isSachetUrl, parseCap, alertRecord } from './_sachet.js';
import { LANGS as LANG_LIST, LANG_BY_CODE, langOf as pickLang } from './_langs.js';

/**
 * SHORT: turn a live event or a place into a 60-second explainer package.
 * The browser calls four stages in order, so each one is real, timed and retryable on its own:
 *
 *   research  the source's own record (USGS event page, NASA EONET entry) as source 0, plus Tavily
 *   write     Nemotron writes six beats: one spoken line, one caption, at most one factual claim
 *             tied to one numbered source, and a camera shot from a fixed list
 *   check     a second Nemotron model reads each claim beside the text of its cited source only and
 *             returns supported / partly / contradicted / unsupported / needs_review with a reason
 *             and a quote. The quote must appear in the source text, or the verdict is downgraded
 *   stage     shots are resolved to coordinates on the server; the model never writes coordinates
 *
 * "Supported" means the cited text says it. It is a source check, not a truth check.
 */

interface SignalIn { id?: string; layer?: string; kind?: string; title: string; lat: number; lon: number; time?: string; mag?: number; magUnit?: string; depthKm?: number; alert?: string | null; tsunami?: boolean; url?: string; severity?: string; sender?: string; area?: string; districts?: string[]; texts?: { lang: string; language: string; headline: string }[] }
type Lang = string;
const LANGS: Record<string, string> = Object.fromEntries(LANG_LIST.map((l) => [l.code, l.name]));
export interface Source { title: string; url: string; kind: 'record' | 'web'; publisher: string; published?: string; retrieved: string; text: string }
type Shot = 'orbit' | 'region' | 'area' | 'close';
interface DraftBeat { say: string; caption: string; claim: string | null; source: number | null; shot: Shot; focus: string }
export type Verdict = 'supported' | 'partly' | 'contradicted' | 'unsupported' | 'needs_review';

interface Body {
  step: 'research' | 'write' | 'check' | 'stage';
  lang?: Lang;
  topic?: string; lat?: number; lon?: number; signal?: SignalIn;
  subject?: { lat: number; lon: number };
  sources?: Source[];
  beats?: DraftBeat[];
}

const SHOT: Record<Shot, { range: number; tilt: number }> = {
  orbit: { range: 9_000_000, tilt: 0 },
  region: { range: 700_000, tilt: 25 },
  area: { range: 90_000, tilt: 45 },
  close: { range: 9_000, tilt: 60 },
};
const VERDICTS: Verdict[] = ['supported', 'partly', 'contradicted', 'unsupported', 'needs_review'];

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** Seconds to say a line: about 2.6 English words a second; Indic words are longer, about 1.9 a second. */
const spoken = (s: string) => /[^\u0000-\u024F\s\d.,:;!?'"()-]/.test(s) ? words(s) / 1.9 : words(s) / 2.6;
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// Unicode-aware: Telugu and Devanagari letters and their vowel signs survive; punctuation does not.
const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}.%]+/gu, ' ').trim();
const langOf = (x: unknown): Lang => pickLang(x);

/** The source's own record for a live signal, as plain text the writer and checker can both read. */
async function recordFor(sig: SignalIn): Promise<Source> {
  if (sig.layer === 'india') return indiaRecord(sig);
  const lines: string[] = [`Title: ${sig.title}`];
  if (sig.time) lines.push(`${sig.layer === 'events' ? 'Last observed' : 'Origin time'} (UTC): ${sig.time.slice(0, 16).replace('T', ' ')}`);
  lines.push(`Location: latitude ${sig.lat.toFixed(3)}, longitude ${sig.lon.toFixed(3)}`);
  if (sig.mag !== undefined) lines.push(`${sig.layer === 'quakes' ? 'Magnitude' : 'Magnitude value'}: ${sig.mag}${sig.magUnit && sig.layer !== 'quakes' ? ` ${sig.magUnit}` : ''}`);
  if (sig.depthKm !== undefined) lines.push(`Depth: ${Math.round(sig.depthKm)} km`);
  if (sig.tsunami) lines.push('USGS tsunami flag: set (the event is in a region where tsunamis are possible; the flag does not mean one occurred)');
  if (sig.alert) lines.push(`USGS PAGER alert level: ${sig.alert}`);
  if (sig.layer === 'events') lines.push('Status: open in NASA EONET (NASA has not closed the event; this is not a statement that it is active right now)');
  let published = sig.time;
  // USGS detail adds felt reports and shaking intensity. Optional: the summary record stands on its own.
  if (sig.layer === 'quakes' && sig.id && /^[a-z0-9]+$/i.test(sig.id)) {
    try {
      const r = await fetch(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${sig.id}.geojson`, { signal: AbortSignal.timeout(7000) });
      if (r.ok) {
        const p = ((await r.json()) as { properties: Record<string, unknown> }).properties || {};
        if (p.place) lines.push(`USGS place description: ${p.place}`);
        if (Number(p.felt) > 0) lines.push(`"Did You Feel It?" reports: ${p.felt}`);
        if (p.mmi !== null && p.mmi !== undefined) lines.push(`Maximum estimated shaking (MMI): ${p.mmi}`);
        if (p.cdi !== null && p.cdi !== undefined) lines.push(`Maximum reported intensity (CDI): ${p.cdi}`);
        if (Number(p.updated)) published = new Date(Number(p.updated)).toISOString();
      }
    } catch { /* the summary record stands */ }
  }
  const publisher = sig.layer === 'events' ? 'NASA EONET' : 'USGS Earthquake Hazards Program';
  return { title: `${publisher}: ${sig.title}`, url: sig.url || '', kind: 'record', publisher, published, retrieved: new Date().toISOString(), text: lines.join('\n') };
}

/**
 * An India alert's record is re-read from its own CAP document on the server, so the browser can't
 * put words in the government's mouth. If SACHET can't be reached, the feed's own fields are used
 * and the record says so.
 */
async function indiaRecord(sig: SignalIn): Promise<Source> {
  const retrieved = new Date().toISOString();
  if (sig.url && isSachetUrl(sig.url)) {
    try {
      const r = await fetch(sig.url, { headers: { 'User-Agent': 'ATLAS-Live/0.3' }, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const a = await parseCap(await r.text(), sig.url);
        if (a) return { title: `NDMA SACHET alert from ${a.sender}: ${a.event}`, url: sig.url, kind: 'record', publisher: `NDMA SACHET · ${a.sender}`, published: a.sent, retrieved, text: alertRecord(a) };
      }
    } catch { /* fall through */ }
  }
  const lines = [`Alert (as listed in the NDMA SACHET feed; the full CAP document could not be re-read): ${sig.title}`];
  if (sig.sender) lines.push(`Issued by: ${sig.sender}`);
  if (sig.severity) lines.push(`Severity: ${sig.severity}`);
  if (sig.area) lines.push(`Area: ${sig.area}`);
  if (sig.districts?.length) lines.push(`Districts: ${sig.districts.join(', ')}`);
  for (const t of sig.texts || []) lines.push(`--- ${t.language} ---`, clip(t.headline, 400));
  return { title: `NDMA SACHET alert: ${clip(sig.title, 100)}`, url: sig.url || 'https://sachet.ndma.gov.in/', kind: 'record', publisher: `NDMA SACHET${sig.sender ? ` · ${clip(sig.sender, 40)}` : ''}`, published: sig.time, retrieved, text: lines.join('\n') };
}

async function web(queries: string[]): Promise<Source[]> {
  const out: Source[] = [];
  const found = await Promise.all(queries.map((q) => tavily(q, 4).catch(() => ({ results: [] as TavilyResult[] }))));
  const retrieved = new Date().toISOString();
  for (const f of found) for (const r of f.results) {
    if (out.length >= 7 || out.some((s) => s.url === r.url) || !r.content) continue;
    out.push({ title: clip(r.title, 120), url: r.url, kind: 'web', publisher: host(r.url), retrieved, text: clip(r.content, 1100) });
  }
  return out;
}

const geo = new Map<string, { lat: number; lon: number }>();
async function locate(q: string) {
  const k = q.toLowerCase();
  if (geo.has(k)) return geo.get(k)!;
  const g = await geocode(q);
  geo.set(k, g);
  return g;
}

/** Sources come back from the browser between stages: re-validate them rather than trust them. */
function cleanSources(list: unknown): Source[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 9).map((s: Partial<Source>) => ({
    title: clip(s.title, 140), url: clip(s.url, 600), kind: s.kind === 'record' ? 'record' : 'web',
    publisher: clip(s.publisher, 80), published: s.published ? clip(s.published, 40) : undefined, retrieved: clip(s.retrieved, 40), text: clip(s.text, 1600),
  } as Source));
}

const served = (r: { servedBy?: string }) => String(r.servedBy || `${PROVIDER?.label ?? 'unknown'} · ${MODELS.agent}`);

export default async function handler(req: { method: string; body: Body }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const b = req.body || ({} as Body);
    const t0 = Date.now();

    if (b.step === 'research') {
      const sig = b.signal && Number.isFinite(b.signal.lat) && Number.isFinite(b.signal.lon) ? b.signal : undefined;
      const topic = clip(sig?.title || b.topic, 160);
      if (!topic) throw new HttpError(400, 'topic or signal is required');
      let subject: { lat: number; lon: number };
      if (sig) subject = { lat: sig.lat, lon: sig.lon };
      else if (Number.isFinite(b.lat) && Number.isFinite(b.lon)) subject = { lat: Number(b.lat), lon: Number(b.lon) };
      else subject = await locate(topic);
      const region = topic.replace(/^M\s?[\d.]+\s*-\s*/i, '').replace(/^\d+\s*km\s+[NSEW]{1,3}\s+of\s+/i, '');
      const state = sig?.layer === 'india' ? (sig.title.split(',').pop() || '').trim() : '';
      const queries = sig?.layer === 'india'
        ? [`${sig.title.replace(/:.*/, '')} ${(sig.districts || []).slice(0, 3).join(' ')} ${state} ${sig.time?.slice(0, 10) ?? ''}`, `${state} ${sig.kind ?? 'weather'} IMD warning ${new Date().toISOString().slice(0, 7)}`]
        : sig?.layer === 'quakes'
        ? [`${region} earthquake ${sig.time?.slice(0, 10) ?? ''}`, `${region} tectonic setting earthquakes history`]
        : sig ? [`${topic} ${sig.time?.slice(0, 7) ?? ''}`, `${region} ${sig.kind ?? 'event'} causes`]
        : [`${topic} history`, `${topic} facts`];
      const [record, found] = await Promise.all([sig ? recordFor(sig) : Promise.resolve(null), web(queries)]);
      const sources = [...(record ? [record] : []), ...found];
      if (!sources.length) throw new HttpError(502, 'No sources could be retrieved for this topic, so ATLAS will not write about it.');
      res.status(200).json({ topic, subject, sources, live: !!sig, ms: Date.now() - t0 });
      return;
    }

    if (b.step === 'write') {
      const topic = clip(b.topic, 160);
      const sources = cleanSources(b.sources);
      if (!topic || !sources.length || !b.subject) throw new HttpError(400, 'topic, subject and sources are required');
      const lang = langOf(b.lang);
      const alert = sources[0]?.publisher.startsWith('NDMA SACHET');
      const list = sources.map((s, i) => `[${i}] ${s.kind === 'record' ? 'OFFICIAL RECORD' : 'WEB'} ${s.title} (${s.publisher}${s.published ? `, ${s.published.slice(0, 10)}` : ''})\n${s.text}`).join('\n\n');
      const writer = lang === 'en' ? MODELS.agent : await indicModel();
      const voice = lang === 'en'
        ? (alert ? 'Voice: a calm, clear Indian news explainer.' : 'Voice: a witty, warm British documentary host.')
        : `Voice: a calm, clear ${LANGS[lang]} news explainer, the way a good regional news channel speaks to families. Write "say" and "caption" in ${LANGS[lang]} (${LANG_BY_CODE[lang].native}), in the ${LANG_BY_CODE[lang].script} script, in everyday spoken ${LANGS[lang]}${lang === 'sa' ? '' : ', not formal or Sanskritised'}. Write numbers as digits. Keep units as the alert gives them (mm, km/h). Write "claim" in plain English so it can be checked against the record, and make the ${LANGS[lang]} line say exactly that claim and nothing more.`;
      const alertRules = alert ? `
- This is an official public-safety alert. Do not dramatise. Never mention damage, injuries or deaths unless a source states them.
- One beat says who issued the alert, for which districts, and until when it is in force (from the record).
- One beat gives the official instruction from the record, in plain words.
- Beat 6 tells viewers to follow their district administration and the official alert, not forwarded messages.` : '';
      const r = await chat({
        op: 'short.write',
        // A Short is a live-news tool: an overloaded model gets 40 s, then the next one is tried.
        timeout_ms: 40_000,
        fallbacks: lang === 'en' ? [] : [...(await indicFallbacks()), MODELS.agent],
        model: writer,
        temperature: 0.4,
        max_tokens: 2200,
        messages: [
          { role: 'system', content: `You are the head writer of a science-and-news explainer channel that publishes 60-second vertical Shorts. ${voice} You write only what the sources support. Never invent numbers, dates, names, casualties or damage. If the official record and the web disagree, the official record wins. Today is ${new Date().toISOString().slice(0, 10)}.` },
          { role: 'user', content: `Write a Short about: ${topic}\nSubject coordinates: ${b.subject.lat.toFixed(3)}, ${b.subject.lon.toFixed(3)}\n\nSources:\n${list}\n\nReturn JSON only:
{"title":"<YouTube title under 60 characters${lang === 'en' ? '' : `, in ${LANGS[lang]}`}, no clickbait lies>","beats":[{"say":"<one spoken line, 12 to 26 words>","caption":"<on-screen caption, 2 to 6 words>","claim":"<the single factual claim this line makes, restated plainly, or null if it makes none>","source":<index of the source that states the claim, or null>,"shot":"orbit|region|area|close","focus":"subject | <a named real place from the sources>"}]}
Rules:
- Exactly 6 beats. Beat 1 is a hook (a question or a surprising true fact). Beat 6 lands the point and loops back to the hook.
- At least 4 beats carry a claim with a source. One claim per beat. Do not stack two facts in one line.
- A beat whose claim is null states no fact at all: no number, date, time, place-specific event or quote. Hooks and closers frame; they do not inform.
- Camera: beat 1 usually "orbit" on the subject; then move in (region, area, close). Use "focus": "subject" unless the beat is about another named place in the sources.
- Plain words. No hashtags, no emoji, no markdown.${alertRules}` },
        ],
      });
      const draft = extractJson<{ title: string; beats: DraftBeat[] }>(r.choices?.[0]?.message?.content || '{}');
      const beats = (draft.beats || []).slice(0, 7).map((x) => ({
        say: clip(x.say, lang === 'en' ? 220 : 320), caption: clip(x.caption, lang === 'en' ? 48 : 64), claim: x.claim ? clip(x.claim, 300) : null,
        source: x.claim && Number.isInteger(x.source) && sources[x.source as number] ? (x.source as number) : null,
        shot: (Object.keys(SHOT) as Shot[]).includes(x.shot) ? x.shot : 'region', focus: clip(x.focus, 80) || 'subject',
      }));
      if (beats.length < 3) throw new HttpError(502, 'The writer did not return a usable script. Try again.');
      res.status(200).json({ title: clip(draft.title, 90) || topic, beats, lang, model: served(r), ms: Date.now() - t0 });
      return;
    }

    if (b.step === 'check') {
      const sources = cleanSources(b.sources);
      const beats = Array.isArray(b.beats) ? b.beats.slice(0, 7) : [];
      const lang = langOf(b.lang);
      const claims = beats.map((x, i) => ({ i, claim: x.claim ? clip(x.claim, 300) : '', say: clip(x.say, 320), src: Number.isInteger(x.source) && sources[x.source as number] ? (x.source as number) : -1 })).filter((c) => c.claim);
      if (!claims.length) { res.status(200).json({ checks: [], model: null, ms: 0 }); return; }
      // Claims without a cited source never reach the model: there is nothing to check them against.
      const askable = claims.filter((c) => c.src >= 0);
      type Check = { beat: number; verdict: Verdict; evidence: string; reason: string; quoteFound?: boolean; line_ok?: boolean };
      let got: Check[] = [];
      let model: string | null = null;
      if (askable.length) {
        const items = askable.map((c) => `CLAIM ${c.i}: ${c.claim}${lang === 'en' ? '' : `\nSPOKEN LINE (${LANGS[lang]}): ${c.say}`}\nSOURCE [${c.src}] ${sources[c.src].title}\n${sources[c.src].text}`).join('\n\n---\n\n');
        const lineRule = lang === 'en' ? '' : `\nAlso set "line_ok": true only if the ${LANGS[lang]} spoken line says the same thing as the claim and adds no fact, number, place or time the claim does not have; otherwise false.`;
        const r = await chat({
          op: 'short.check',
          timeout_ms: 30_000,
          model: MODELS.fast,
          temperature: 0,
          max_tokens: 1800,
          messages: [
            { role: 'system', content: 'You are a strict source checker. For each claim you judge only whether the source text printed under it supports the claim. You do not use outside knowledge and you do not judge whether the claim is true in the world.' },
            { role: 'user', content: `${items}\n\nReturn JSON only: {"checks":[{"beat":<claim number>,"verdict":"supported|partly|contradicted|unsupported|needs_review","evidence":"<copy the exact words from the source that the verdict rests on, under 25 words, or empty>","reason":"<one short sentence>"${lang === 'en' ? '' : ',"line_ok":true|false'}}]}${lineRule}\nsupported: the source states it. partly: the source states only part of it, or it rounds or qualifies it differently. contradicted: the source says something incompatible. unsupported: the source does not say it. needs_review: the source is ambiguous or too thin to decide.` },
          ],
        });
        model = served(r);
        got = (extractJson<{ checks: Check[] }>(r.choices?.[0]?.message?.content || '{}').checks || []);
      }
      const checks: Check[] = claims.map((c) => {
        if (c.src < 0) return { beat: c.i, verdict: 'unsupported', evidence: '', reason: 'No source was cited for this claim.' };
        const g = got.find((x) => Number(x.beat) === c.i);
        if (!g || !VERDICTS.includes(g.verdict)) return { beat: c.i, verdict: 'needs_review', evidence: '', reason: 'The checker did not return a verdict for this claim.' };
        const evidence = clip(g.evidence, 220);
        // The quote must really be in the source. A positive verdict resting on words the source
        // does not contain is not evidence, so it is downgraded for a human to look at.
        // An elided quote ("A... B") counts only if every piece is in the source, in order.
        const src = norm(sources[c.src].text);
        const pieces = evidence.split(/\.{3}|…/).map(norm).filter((x) => x.length >= 3);
        let at = 0;
        const found = !!pieces.length && pieces.every((p) => { const i = src.indexOf(p, at); if (i < 0) return false; at = i + p.length; return true; });
        if ((g.verdict === 'supported' || g.verdict === 'partly') && !found) {
          return { beat: c.i, verdict: 'needs_review', evidence, reason: `The checker said "${g.verdict}" but its quote is not in the source text.`, quoteFound: false };
        }
        // In Hindi or Telugu the checked claim is English; the spoken line must not drift from it.
        if (lang !== 'en' && g.line_ok === false && (g.verdict === 'supported' || g.verdict === 'partly')) {
          return { beat: c.i, verdict: 'needs_review', evidence, reason: `The claim checks out, but the ${LANGS[lang]} line says more or something different.`, quoteFound: found, line_ok: false };
        }
        return { beat: c.i, verdict: g.verdict, evidence, reason: clip(g.reason, 200), quoteFound: found, line_ok: lang === 'en' ? undefined : g.line_ok !== false };
      });
      res.status(200).json({ checks, model, ms: Date.now() - t0 });
      return;
    }

    if (b.step === 'stage') {
      const subject = b.subject;
      const beats = Array.isArray(b.beats) ? b.beats.slice(0, 7) : [];
      if (!subject || !beats.length) throw new HttpError(400, 'subject and beats are required');
      const out = [];
      for (let k = 0; k < beats.length; k++) {
        const x = beats[k];
        const shot: Shot = (Object.keys(SHOT) as Shot[]).includes(x.shot) ? x.shot : 'region';
        let at = subject;
        const focus = clip(x.focus, 80);
        let resolved = 'subject';
        if (focus && !/^(subject|epicent|event|the subject)/i.test(focus)) {
          try {
            const g = await locate(focus);
            // A beat must stay on the story: anything over 3,000 km from the subject is a geocoder miss.
            const d = Math.hypot(g.lat - subject.lat, (g.lon - subject.lon) * Math.cos((subject.lat * Math.PI) / 180)) * 111;
            if (d <= 3000) { at = g; resolved = focus; }
          } catch { /* keep the subject */ }
        }
        out.push({
          shot, focus: resolved, lat: +at.lat.toFixed(5), lon: +at.lon.toFixed(5),
          range: SHOT[shot].range, tilt: SHOT[shot].tilt, heading: (k * 40) % 360,
          // About 2.6 spoken words a second, plus a beat to breathe.
          seconds: Math.max(3.5, Math.round((spoken(clip(x.say, 320)) + 0.8) * 10) / 10),
        });
      }
      res.status(200).json({ shots: out, ms: Date.now() - t0 });
      return;
    }

    throw new HttpError(400, 'step must be research, write, check or stage');
  } catch (err) {
    send(res, err);
  }
}
