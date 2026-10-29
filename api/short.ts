import { chat, tavily, extractJson, send, MODELS, HttpError, type TavilyResult } from './_nebius.js';
import { geocode } from './_places.js';

/**
 * SHORT: turn a live event or a place into a 60-second explainer a creator can publish.
 *
 *   research  - the source's own record (USGS event page, NASA EONET entry) plus Tavily web search
 *   writer    - Nemotron writes six beats. Each beat is one spoken line, one caption, at most one
 *               factual claim tied to a numbered source, and a camera shot chosen from a fixed list
 *   verifier  - a second Nemotron model reads each claim beside the text of its source and marks it
 *               supported, partly supported or unsupported. Unsupported claims are cut, not softened
 *   camera    - shots are resolved on the server (geocoded, never guessed by the model)
 *
 * The browser plays the beats on the globe in a 9:16 frame and exports a Google Earth tour (KML),
 * the script with its sources, and captions (SRT). Google Earth is the licensed route for video.
 */

interface SignalIn { id?: string; layer?: string; kind?: string; title: string; lat: number; lon: number; time?: string; mag?: number; magUnit?: string; depthKm?: number; alert?: string | null; tsunami?: boolean; url?: string }
interface Body { topic?: string; lat?: number; lon?: number; signal?: SignalIn }

type Shot = 'orbit' | 'region' | 'area' | 'close';
interface DraftBeat { say: string; caption: string; claim: string | null; source: number | null; shot: Shot; focus: string }
interface Draft { title: string; beats: DraftBeat[] }
interface Source { title: string; url: string; kind: 'record' | 'web'; text: string }

const SHOT: Record<Shot, { range: number; tilt: number }> = {
  orbit: { range: 9_000_000, tilt: 0 },
  region: { range: 700_000, tilt: 25 },
  area: { range: 90_000, tilt: 45 },
  close: { range: 9_000, tilt: 60 },
};

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The source's own record for a live signal, as plain text the writer and verifier can both read. */
async function recordFor(sig: SignalIn): Promise<Source> {
  const lines: string[] = [`Title: ${sig.title}`];
  if (sig.time) lines.push(`${sig.layer === 'events' ? 'Last observed' : 'Origin time'} (UTC): ${sig.time.slice(0, 16).replace('T', ' ')}`);
  lines.push(`Location: latitude ${sig.lat.toFixed(3)}, longitude ${sig.lon.toFixed(3)}`);
  if (sig.mag !== undefined) lines.push(`${sig.layer === 'quakes' ? 'Magnitude' : 'Magnitude value'}: ${sig.mag}${sig.magUnit && sig.layer !== 'quakes' ? ` ${sig.magUnit}` : ''}`);
  if (sig.depthKm !== undefined) lines.push(`Depth: ${Math.round(sig.depthKm)} km`);
  if (sig.tsunami) lines.push('USGS tsunami flag: set (this means the event is in a region where tsunamis are possible, not that one occurred)');
  if (sig.alert) lines.push(`USGS PAGER alert level: ${sig.alert}`);
  // USGS detail adds felt reports and shaking intensity. Optional: the summary is enough on its own.
  if (sig.layer === 'quakes' && sig.id && /^[a-z0-9]+$/i.test(sig.id)) {
    try {
      const r = await fetch(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${sig.id}.geojson`, { signal: AbortSignal.timeout(7000) });
      if (r.ok) {
        const p = ((await r.json()) as { properties: Record<string, unknown> }).properties || {};
        if (p.place) lines.push(`USGS place description: ${p.place}`);
        if (Number(p.felt) > 0) lines.push(`"Did You Feel It?" reports: ${p.felt}`);
        if (p.mmi !== null && p.mmi !== undefined) lines.push(`Maximum estimated shaking (MMI): ${p.mmi}`);
        if (p.cdi !== null && p.cdi !== undefined) lines.push(`Maximum reported intensity (CDI): ${p.cdi}`);
      }
    } catch { /* the summary record stands */ }
  }
  const source = sig.layer === 'events' ? 'NASA EONET' : 'USGS Earthquake Hazards Program';
  return { title: `${source}: ${sig.title}`, url: sig.url || '', kind: 'record', text: lines.join('\n') };
}

async function web(queries: string[]): Promise<Source[]> {
  const out: Source[] = [];
  const found = await Promise.all(queries.map((q) => tavily(q, 4).catch(() => ({ results: [] as TavilyResult[] }))));
  for (const f of found) for (const r of f.results) {
    if (out.length >= 7 || out.some((s) => s.url === r.url)) continue;
    out.push({ title: clip(r.title, 120), url: r.url, kind: 'web', text: clip(r.content, 1100) });
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

export default async function handler(req: { method: string; body: Body }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const b = req.body || {};
    const sig = b.signal && Number.isFinite(b.signal.lat) && Number.isFinite(b.signal.lon) ? b.signal : undefined;
    const topic = clip(sig?.title || b.topic, 160);
    if (!topic) throw new HttpError(400, 'topic or signal is required');
    const t0 = Date.now();

    // Subject: where the Short is about. A signal brings its own coordinates; a place is geocoded.
    let subject: { lat: number; lon: number };
    if (sig) subject = { lat: sig.lat, lon: sig.lon };
    else if (Number.isFinite(b.lat) && Number.isFinite(b.lon)) subject = { lat: Number(b.lat), lon: Number(b.lon) };
    else subject = await locate(topic);

    // 1. Research.
    const region = topic.replace(/^M\s?[\d.]+\s*-\s*/i, '').replace(/^\d+\s*km\s+[NSEW]{1,3}\s+of\s+/i, '');
    const queries = sig?.layer === 'quakes'
      ? [`${region} earthquake ${sig.time?.slice(0, 10) ?? ''}`, `${region} tectonic plates fault earthquake history`]
      : sig ? [`${topic} ${sig.time?.slice(0, 7) ?? ''}`, `${region} ${sig.kind ?? 'event'} causes`]
      : [`${topic} history`, `${topic} facts architecture`];
    const [record, found] = await Promise.all([sig ? recordFor(sig) : Promise.resolve(null), web(queries)]);
    const sources: Source[] = [...(record ? [record] : []), ...found];
    if (!sources.length) throw new HttpError(502, 'No sources found for this topic, so ATLAS will not write a script about it.');
    const tResearch = Date.now();

    // 2. Writer.
    const list = sources.map((s, i) => `[${i}] ${s.kind === 'record' ? 'OFFICIAL RECORD' : 'WEB'} ${s.title}\n${s.text}`).join('\n\n');
    const today = new Date().toISOString().slice(0, 10);
    const writer = await chat({
      model: MODELS.agent,
      temperature: 0.4,
      max_tokens: 2200,
      messages: [
        { role: 'system', content: `You are the head writer of a science-and-news explainer channel that publishes 60-second vertical Shorts. Voice: a witty, warm British documentary host. You write only what the sources support. Never invent numbers, dates, names, casualties or damage. If the official record and the web disagree, the official record wins. Today is ${today}.` },
        { role: 'user', content: `Write a Short about: ${topic}\nSubject coordinates: ${subject.lat.toFixed(3)}, ${subject.lon.toFixed(3)}\n\nSources:\n${list}\n\nReturn JSON only:
{"title":"<YouTube title, under 60 characters, no clickbait lies>","beats":[{"say":"<one spoken line, 12 to 26 words>","caption":"<on-screen caption, 2 to 6 words>","claim":"<the single factual claim this line makes, restated plainly, or null if the line makes none>","source":<index of the source that supports the claim, or null>,"shot":"orbit|region|area|close","focus":"subject | <a named real place, e.g. Kathmandu, Nepal>"}]}
Rules:
- Exactly 6 beats. Beat 1 is a hook that makes a viewer stay (a question or a surprising true fact). Beat 6 lands the point and loops back to the hook.
- At least 4 beats carry a claim with a source. One claim per beat.
- Camera: beat 1 usually "orbit" on the subject; then move in (region, area, close). Use "focus": "subject" unless a beat is about another named place in the sources.
- Plain words. No hashtags, no emoji, no markdown.` },
      ],
    });
    const draft = extractJson<Draft>(writer.choices?.[0]?.message?.content || '{}');
    const raw = (draft.beats || []).slice(0, 7);
    if (raw.length < 3) throw new HttpError(502, 'The writer did not return a usable script. Try again.');
    const tWrite = Date.now();

    // 3. Verifier: a second model checks every claim against the text of the source it cites.
    const claims = raw.map((x, i) => ({ i, claim: x.claim ? clip(x.claim, 300) : '', src: Number.isInteger(x.source) && sources[x.source as number] ? (x.source as number) : -1 })).filter((c) => c.claim);
    type Check = { beat: number; verdict: 'supported' | 'partly' | 'unsupported'; evidence?: string };
    let checks: Check[] = [];
    let verifierModel = MODELS.fast;
    if (claims.length) {
      const items = claims.map((c) => `CLAIM ${c.i}: ${c.claim}\nSOURCE ${c.src >= 0 ? `[${c.src}] ${sources[c.src].title}\n${sources[c.src].text}` : 'none cited'}`).join('\n\n---\n\n');
      const verifier = await chat({
        model: MODELS.fast,
        temperature: 0,
        max_tokens: 1400,
        messages: [
          { role: 'system', content: 'You are a strict fact-checker. You judge each claim only against the source text shown under it. You do not use outside knowledge.' },
          { role: 'user', content: `${items}\n\nFor every claim return JSON only: {"checks":[{"beat":<claim number>,"verdict":"supported|partly|unsupported","evidence":"<the words from the source that support it, under 20 words, or empty>"}]}.\n"supported": the source states it. "partly": the source states some of it, or it rounds or paraphrases loosely. "unsupported": the source does not state it, or no source is cited.` },
        ],
      });
      verifierModel = String(verifier.servedBy || MODELS.fast);
      checks = (extractJson<{ checks: Check[] }>(verifier.choices?.[0]?.message?.content || '{}').checks || []);
    }
    const verdict = (i: number) => checks.find((c) => Number(c.beat) === i);
    const tVerify = Date.now();

    // 4. Assemble: cut unsupported claims, resolve every shot to real coordinates.
    let removed = 0;
    const kept = raw.filter((x, i) => {
      if (!x.claim) return true;
      const v = verdict(i)?.verdict;
      if (v === 'unsupported' || !v) { removed++; return false; }
      return true;
    });
    const beats = [];
    for (let k = 0; k < kept.length; k++) {
      const x = kept[k];
      const i = raw.indexOf(x);
      const shot: Shot = (['orbit', 'region', 'area', 'close'] as Shot[]).includes(x.shot) ? x.shot : 'region';
      let at = subject;
      const focus = clip(x.focus, 80);
      if (focus && !/^(subject|epicent|event|the subject)/i.test(focus)) {
        try { at = await locate(focus); } catch { at = subject; }
        // A beat must stay on the story: anything over 3,000 km from the subject is a geocoder miss.
        const d = Math.hypot(at.lat - subject.lat, (at.lon - subject.lon) * Math.cos((subject.lat * Math.PI) / 180)) * 111;
        if (d > 3000) at = subject;
      }
      const say = clip(x.say, 220);
      const v = x.claim ? verdict(i) : undefined;
      beats.push({
        say, caption: clip(x.caption, 48), claim: x.claim ? clip(x.claim, 300) : null,
        source: x.claim && Number.isInteger(x.source) && sources[x.source as number] ? (x.source as number) : null,
        verdict: v?.verdict ?? null, evidence: v?.evidence ? clip(v.evidence, 160) : null,
        shot, focus: focus || 'subject', lat: +at.lat.toFixed(5), lon: +at.lon.toFixed(5),
        range: SHOT[shot].range, tilt: SHOT[shot].tilt, heading: (k * 40) % 360,
        // About 2.6 spoken words a second, plus a beat to breathe.
        seconds: Math.max(3.5, Math.round((words(say) / 2.6 + 0.8) * 10) / 10),
      });
    }

    res.status(200).json({
      topic, title: clip(draft.title, 90) || topic, subject, beats,
      sources: sources.map(({ title, url, kind }) => ({ title, url, kind })),
      stats: { claims: claims.length, supported: checks.filter((c) => c.verdict === 'supported').length, partly: checks.filter((c) => c.verdict === 'partly').length, removed, seconds: Math.round(beats.reduce((s, x) => s + x.seconds, 0)) },
      models: { writer: String(writer.servedBy || MODELS.agent), verifier: verifierModel },
      ms: { research: tResearch - t0, write: tWrite - tResearch, verify: tVerify - tWrite, total: Date.now() - t0 },
    });
  } catch (err) {
    send(res, err);
  }
}
