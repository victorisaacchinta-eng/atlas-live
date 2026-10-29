import JSZip from 'jszip';
import { ui } from './ui';

/**
 * The Short director: Discover (the globe) -> Create (this workspace) -> Deliver (the export kit).
 *
 * Create runs the server pipeline in four real stages, each its own request (api/short.ts):
 *   research -> write -> source check -> stage camera
 * so the screen shows what is actually running, how long each stage took, and lets a failed stage
 * be retried without redoing the ones before it. Nothing here invents progress.
 *
 * The source check answers one narrow question per claim: does the cited text say this? It is not a
 * truth check. Claims marked unsupported or contradicted are cut and listed with the reason.
 *
 * Deliver packs what a creator needs to finish the video in Google Earth, which is licensed for
 * online video. ATLAS never records or exports Google's 3D tiles.
 */

export type Verdict = 'supported' | 'partly' | 'contradicted' | 'unsupported' | 'needs_review';
export interface Source { title: string; url: string; kind: 'record' | 'web'; publisher: string; published?: string; retrieved: string; text: string }
interface Draft { say: string; caption: string; claim: string | null; source: number | null; shot: 'orbit' | 'region' | 'area' | 'close'; focus: string }
interface Check { beat: number; verdict: Verdict; evidence: string; reason: string; quoteFound?: boolean }
interface Shot { shot: Draft['shot']; focus: string; lat: number; lon: number; range: number; tilt: number; heading: number; seconds: number }
export interface Beat extends Draft, Shot { check: Check | null }

export interface ShortInput {
  topic: string; lat?: number; lon?: number;
  signal?: { id?: string; layer?: string; kind?: string; title: string; lat: number; lon: number; time?: string; mag?: number; magUnit?: string; depthKm?: number; alert?: string | null; tsunami?: boolean; url?: string };
}
export interface DirectorDeps {
  flyTo: (b: Beat) => Promise<void>;
  zoomTo: (b: Beat) => Promise<void>;
  setOrbit: (on: boolean) => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  onOpen: () => void;
  onClose: () => void;
}

type StageId = 'research' | 'write' | 'check' | 'stage';
const STAGES: { id: StageId; label: string; doing: string }[] = [
  { id: 'research', label: 'Research', doing: 'Reading the official record and the web (Tavily)' },
  { id: 'write', label: 'Write', doing: 'Nemotron is writing six beats' },
  { id: 'check', label: 'Source check', doing: 'A second Nemotron model is reading each claim beside its source' },
  { id: 'stage', label: 'Camera', doing: 'Placing each shot on the globe' },
];
const LABEL: Record<Verdict, string> = { supported: 'Supported', partly: 'Partly supported', needs_review: 'Needs review', unsupported: 'Unsupported', contradicted: 'Contradicted' };
const KEEP: Verdict[] = ['supported', 'partly', 'needs_review'];

interface Run {
  input: ShortInput;
  topic: string; subject?: { lat: number; lon: number }; live?: boolean;
  sources?: Source[]; title?: string; draft?: Draft[]; checks?: Check[]; shots?: Shot[];
  models: { writer?: string; checker?: string };
  ms: Partial<Record<StageId, number>>; wall: Partial<Record<StageId, number>>;
  failed?: { stage: StageId; error: string };
  started: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const shortModel = (m?: string | null) => (m ? m.split('·').pop()!.trim().split('/').pop()! : 'none');
const provider = (m?: string | null) => (m && m.includes('·') ? m.split('·')[0].trim() : '');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const secs = (ms?: number) => (ms === undefined ? '' : `${(ms / 1000).toFixed(1)} s`);
const day = (iso?: string) => (iso ? iso.slice(0, 10) : '');
const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch('/api/short', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `The server answered ${r.status} without a readable body` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}

export class Director {
  private root = $('director');
  private run: Run | null = null;
  private beats: Beat[] = [];
  private cut: { draft: Draft; check: Check }[] = [];
  private selected = 0;
  private playing = 0;
  private busy = false;
  private deps: DirectorDeps;

  constructor(deps: DirectorDeps) {
    this.deps = deps;
    document.documentElement.style.setProperty('--contour', `url("${contours()}")`);
    $('dir-close').addEventListener('click', () => this.close());
    $('dir-play').addEventListener('click', () => (this.playing ? this.stop() : this.play(this.selected)));
    $('dir-export').addEventListener('click', () => this.exportKit());
    $('dir-retry').addEventListener('click', () => this.resume());
    document.querySelectorAll<HTMLButtonElement>('.dir-tab').forEach((t) => t.addEventListener('click', () => this.tab(t.dataset.tab as string)));
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      if (e.key === 'Escape') this.close();
      if (e.key === ' ' && !$('dir-play').hasAttribute('disabled')) { e.preventDefault(); $('dir-play').click(); }
    });
  }

  get open() { return !this.root.hidden; }
  get topic() { return this.run?.topic ?? ''; }

  // ---------- Create: the staged pipeline ----------
  async make(input: ShortInput) {
    if (this.busy) return;
    this.stop();
    this.run = { input, topic: input.topic, models: {}, ms: {}, wall: {}, started: new Date().toISOString() };
    this.beats = []; this.cut = []; this.selected = 0;
    this.root.hidden = false;
    document.body.classList.add('directing');
    this.deps.onOpen();
    $('dir-topic').textContent = input.topic;
    $('dir-title').textContent = input.topic;
    this.caption('');
    this.renderAll();
    ui.log(`making a Short: ${input.topic}`, 'sys');
    await this.resume();
  }

  /** Run every stage that has not finished yet. A failed stage can be retried from here. */
  private async resume() {
    const R = this.run;
    if (!R || this.busy) return;
    this.busy = true;
    R.failed = undefined;
    this.renderAll();
    try {
      if (!R.sources) await this.stageRun('research', async () => {
        const j = await post<{ topic: string; subject: { lat: number; lon: number }; sources: Source[]; live: boolean; ms: number }>({ step: 'research', ...R.input });
        R.topic = j.topic; R.subject = j.subject; R.sources = j.sources; R.live = j.live; R.ms.research = j.ms;
      });
      if (!R.draft) await this.stageRun('write', async () => {
        const j = await post<{ title: string; beats: Draft[]; model: string; ms: number }>({ step: 'write', topic: R.topic, subject: R.subject, sources: R.sources });
        R.title = j.title; R.draft = j.beats; R.models.writer = j.model; R.ms.write = j.ms;
      });
      if (!R.checks) await this.stageRun('check', async () => {
        const j = await post<{ checks: Check[]; model: string | null; ms: number }>({ step: 'check', sources: R.sources, beats: R.draft });
        R.checks = j.checks; R.models.checker = j.model ?? undefined; R.ms.check = j.ms;
      });
      this.assemble();
      if (this.beats.length < 3) throw Object.assign(new Error(`Only ${this.beats.length} beats survived the source check. That is too thin for a Short; try another event.`), { stage: 'check' });
      if (!R.shots) await this.stageRun('stage', async () => {
        const j = await post<{ shots: Shot[]; ms: number }>({ step: 'stage', subject: R.subject, beats: this.beats.map(({ say, shot, focus }) => ({ say, shot, focus })) });
        R.shots = j.shots; R.ms.stage = j.ms;
      });
      this.assemble();
      this.renderAll();
      const m = this.metrics();
      ui.log(`Short ready: ${this.beats.length} beats, ${m.supported} of ${m.surviving} remaining claims supported by their source`, 'tool');
      this.busy = false;
      this.play(0);
      return;
    } catch (err) {
      const stage = ((err as { stage?: StageId }).stage) || STAGES.find((s) => !this.stageDone(s.id))?.id || 'stage';
      R.failed = { stage, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
      ui.log(`Short stopped at ${stage}: ${R.failed.error.slice(0, 90)}`, 'hot');
    }
    this.busy = false;
    this.renderAll();
  }

  private async stageRun(id: StageId, fn: () => Promise<void>) {
    const R = this.run!;
    const t0 = performance.now();
    const tick = setInterval(() => { R.wall[id] = performance.now() - t0; this.renderStages(); }, 200);
    this.renderStages(id);
    try { await fn(); }
    catch (err) { throw Object.assign(err instanceof Error ? err : new Error(String(err)), { stage: id }); }
    finally { clearInterval(tick); R.wall[id] = performance.now() - t0; }
    this.renderAll();
  }

  private stageDone(id: StageId) {
    const R = this.run;
    if (!R) return false;
    return id === 'research' ? !!R.sources : id === 'write' ? !!R.draft : id === 'check' ? !!R.checks : !!R.shots;
  }

  /** Apply the source check: keep supported, partly supported and needs-review beats; cut the rest. */
  private assemble() {
    const R = this.run!;
    if (!R.draft || !R.checks) return;
    this.beats = []; this.cut = [];
    R.draft.forEach((d, i) => {
      const check = d.claim ? R.checks!.find((c) => c.beat === i) ?? { beat: i, verdict: 'needs_review' as Verdict, evidence: '', reason: 'No verdict returned.' } : null;
      if (check && !KEEP.includes(check.verdict)) { this.cut.push({ draft: d, check }); return; }
      this.beats.push({ ...d, check, focus: d.focus, lat: R.subject!.lat, lon: R.subject!.lon, range: 0, tilt: 0, heading: 0, seconds: 5 });
    });
    if (R.shots) this.beats = this.beats.map((b, k) => ({ ...b, ...(R.shots![k] ?? {}) }));
  }

  metrics() {
    const R = this.run;
    const before = R?.draft?.filter((d) => d.claim).length ?? 0;
    const kept = this.beats.filter((b) => b.claim);
    const by = (v: Verdict) => kept.filter((b) => b.check?.verdict === v).length;
    return {
      before, surviving: kept.length, supported: by('supported'), partly: by('partly'), review: by('needs_review'),
      cut: this.cut.length, seconds: Math.round(this.beats.reduce((s, b) => s + b.seconds, 0)),
      wall: Object.values(R?.wall ?? {}).reduce((s, x) => s + (x ?? 0), 0),
    };
  }

  // ---------- rendering ----------
  private renderAll() { this.renderStages(); this.renderStory(); this.renderEvidence(); this.renderDeliver(); this.renderTimeline(); }

  private renderStages(running?: StageId) {
    const R = this.run;
    const ol = $('dir-stages');
    ol.replaceChildren();
    for (const s of STAGES) {
      const li = el('li');
      const done = this.stageDone(s.id);
      const failed = R?.failed?.stage === s.id;
      const active = !done && !failed && (running === s.id || (this.busy && !STAGES.slice(0, STAGES.indexOf(s)).some((p) => !this.stageDone(p.id))));
      li.dataset.state = failed ? 'failed' : done ? 'done' : active ? 'running' : 'pending';
      li.append(el('span', 'st-name', s.label), el('span', 'st-state', failed ? 'Failed' : done ? 'Done' : active ? 'Running' : 'Waiting'), el('span', 'st-time', secs(R?.wall[s.id])));
      li.title = active ? s.doing : '';
      ol.appendChild(li);
    }
    const status = $('dir-status');
    const now = STAGES.find((s) => !this.stageDone(s.id));
    status.textContent = R?.failed ? `Stopped at ${STAGES.find((s) => s.id === R.failed!.stage)?.label}: ${R.failed.error}` : this.busy && now ? now.doing : '';
    $('dir-retry').hidden = !R?.failed;
    ($('dir-play') as HTMLButtonElement).disabled = !R?.shots;
    ($('dir-export') as HTMLButtonElement).disabled = !R?.shots;
    if (R?.title) $('dir-title').textContent = R.title;
  }

  private renderStory() {
    const ol = $('dir-beats');
    ol.replaceChildren();
    if (!this.beats.length) {
      const R = this.run;
      ol.appendChild(el('li', 'empty', R?.failed ? 'No script yet. Retry the failed stage.' : this.busy ? 'The script appears here when the source check is done.' : ''));
      return;
    }
    let t = 0;
    this.beats.forEach((b, i) => {
      const li = el('li');
      li.dataset.i = String(i);
      li.classList.toggle('on', i === this.selected);
      li.tabIndex = 0;
      const head = el('div', 'bh');
      head.append(el('span', 'n', String(i + 1).padStart(2, '0')), el('span', 'tc', `${fmt(t)} · ${b.seconds.toFixed(1)} s`), el('span', 'shot', `${b.shot}${b.focus !== 'subject' ? ` · ${b.focus}` : ''}`));
      li.append(head, el('p', 'cap', b.caption), el('p', 'say', b.say));
      if (b.check) li.append(pill(b.check.verdict));
      else li.append(el('span', 'pill none', 'No factual claim'));
      li.addEventListener('click', () => { this.select(i); if (!this.playing) this.play(i, true); });
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') li.click(); });
      ol.appendChild(li);
      t += b.seconds;
    });
  }

  /** Editor-style timeline: a ruler, the shots track and the claims track, with a live playhead. */
  private renderTimeline() {
    const box = $('dir-timeline');
    box.replaceChildren();
    if (!this.beats.length || !this.run?.shots) { box.hidden = true; return; }
    box.hidden = false;
    const total = this.beats.reduce((s, b) => s + b.seconds, 0);
    const ruler = el('div', 'tl-ruler');
    for (let t = 0; t <= total; t += 5) { const tick = el('span', t % 10 === 0 ? 'major' : '', t % 10 === 0 ? fmt(t) : ''); tick.style.left = `${(t / total) * 100}%`; ruler.appendChild(tick); }
    const track = (label: string, cls: string, cell: (b: Beat, i: number) => HTMLElement) => {
      const row = el('div', `tl-row ${cls}`);
      row.appendChild(el('span', 'tl-label', label));
      const lane = el('div', 'tl-lane');
      let t = 0;
      this.beats.forEach((b, i) => {
        const c = cell(b, i);
        c.style.left = `${(t / total) * 100}%`; c.style.width = `${(b.seconds / total) * 100}%`;
        c.addEventListener('click', () => { this.select(i); this.play(i, true); });
        lane.appendChild(c);
        t += b.seconds;
      });
      row.appendChild(lane);
      return row;
    };
    const shots = track('Shot', 'shots', (b, i) => { const c = el('button', `tl-clip shot-${b.shot}`); c.setAttribute('type', 'button'); c.title = `Beat ${i + 1}: ${b.shot}`; c.append(el('b', '', String(i + 1).padStart(2, '0')), el('span', '', b.caption)); return c; });
    const claims = track('Source', 'claims', (b, i) => { const v = b.check?.verdict ?? 'none'; const c = el('button', `tl-clip v-${v}`); c.setAttribute('type', 'button'); c.title = `Beat ${i + 1}: ${b.check ? LABEL[b.check.verdict] : 'no factual claim'}`; c.append(el('span', '', b.check ? LABEL[b.check.verdict] : '')); return c; });
    const head = el('div', 'tl-head');
    head.style.left = `${(this.beatStart(this.selected) / total) * 100}%`;
    const lanes = el('div', 'tl-lanes');
    lanes.append(ruler, shots, claims, head);
    box.append(el('p', 'tl-total', `${fmt(total)} total`), lanes);
  }

  private beatStart(i: number) { return this.beats.slice(0, i).reduce((s, b) => s + b.seconds, 0); }

  /** Move the playhead in real time while a beat plays. */
  private runHead(i: number, token: number) {
    const total = this.beats.reduce((s, b) => s + b.seconds, 0);
    const start = this.beatStart(i), len = this.beats[i].seconds, t0 = performance.now();
    const step = () => {
      const head = document.querySelector<HTMLElement>('#dir-timeline .tl-head');
      if (!head || token !== this.playing) return;
      const t = Math.min(len, (performance.now() - t0) / 1000);
      head.style.left = `${((start + t) / total) * 100}%`;
      if (t < len) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private select(i: number) {
    this.selected = i;
    [...$('dir-beats').children].forEach((r, k) => r.classList.toggle('on', k === i));
    document.querySelectorAll('#dir-timeline .tl-lane').forEach((lane) => [...lane.children].forEach((c, k) => c.classList.toggle('on', k === i)));
    const b = this.beats[i];
    if (b && this.run?.shots) $('dir-geo').textContent = `${Math.abs(b.lat).toFixed(3)}°${b.lat >= 0 ? 'N' : 'S'} ${Math.abs(b.lon).toFixed(3)}°${b.lon >= 0 ? 'E' : 'W'} · range ${b.range >= 1e6 ? `${Math.round(b.range / 1e3).toLocaleString()} km` : b.range >= 1e3 ? `${Math.round(b.range / 1e3)} km` : `${b.range} m`} · ${b.shot}`;
    this.renderEvidence();
  }

  private renderEvidence() {
    const box = $('dir-evidence');
    box.replaceChildren();
    const R = this.run;
    const b = this.beats[this.selected];
    if (!R?.sources) { box.appendChild(el('p', 'empty', this.busy ? 'Sources appear here as soon as research is done.' : 'No sources yet.')); return; }
    if (b?.check && b.source !== null && R.sources[b.source]) {
      const s = R.sources[b.source];
      const card = el('div', 'claim');
      card.append(el('p', 'k', `Beat ${String(this.selected + 1).padStart(2, '0')} claim`), el('p', 'c', b.claim || ''), pill(b.check.verdict));
      if (b.check.evidence) {
        const q = el('blockquote', b.check.quoteFound === false ? 'missing' : '');
        q.appendChild(el('mark', '', b.check.evidence));
        card.append(q, el('p', 'qnote', b.check.quoteFound === false ? 'This quote is not in the source text, so the verdict was downgraded.' : 'Exact words from the source.'));
      }
      card.append(el('p', 'why', b.check.reason));
      card.append(sourceRow(s, b.source));
      box.appendChild(card);
    } else if (b) {
      box.appendChild(el('p', 'empty', 'This beat makes no factual claim, so there is nothing to check.'));
    }
    if (this.cut.length) {
      const d = el('details', 'cuts');
      d.appendChild(el('summary', '', `Cut by the source check: ${this.cut.length}`));
      for (const c of this.cut) {
        const row = el('div', 'cut');
        row.append(pill(c.check.verdict), el('p', 'c', c.draft.claim || ''), el('p', 'why', c.check.reason));
        if (c.check.evidence) { const q = el('blockquote'); q.appendChild(el('mark', '', c.check.evidence)); row.append(q); }
        d.appendChild(row);
      }
      box.appendChild(d);
    }
    const all = el('details', 'srcs');
    all.appendChild(el('summary', '', `All sources: ${R.sources.length}${R.live ? ' · official record first' : ''}`));
    R.sources.forEach((s, i) => all.appendChild(sourceRow(s, i)));
    box.appendChild(all);
  }

  private renderDeliver() {
    const R = this.run;
    const m = this.metrics();
    const box = $('dir-metrics');
    box.replaceChildren();
    if (!R?.checks || !this.beats.length) return;
    const rows: [string, string][] = [
      ['Source-supported', `${m.supported} of ${m.surviving} remaining claims`],
      ['Partly / needs review', `${m.partly} / ${m.review}`],
      ['Claims kept', `${m.surviving} of ${m.before} written (${m.cut} cut)`],
      ['Length', `${m.seconds} s, ${this.beats.length} beats`],
      ['Pipeline time', secs(m.wall)],
      ['Writer', shortModel(R.models.writer)],
      ['Checker', shortModel(R.models.checker)],
      ['Provider', provider(R.models.writer) || 'unknown'],
    ];
    for (const [k, v] of rows) { const r = el('div', 'm'); r.append(el('span', 'mk', k), el('span', 'mv', v)); box.appendChild(r); }
  }

  private tab(t: string) {
    document.querySelectorAll<HTMLButtonElement>('.dir-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    this.root.dataset.tab = t;
  }

  // ---------- preview ----------
  async play(from = 0, single = false) {
    if (!this.run?.shots || !this.beats.length) return;
    const token = ++this.playing;
    $('dir-play').textContent = 'Stop';
    $('dir-frame').classList.add('rolling');
    const end = single ? from + 1 : this.beats.length;
    for (let i = from; i < end; i++) {
      if (token !== this.playing) return;
      const b = this.beats[i], prev = this.beats[i - 1];
      this.select(i);
      // Scroll the storyboard list only, never the page around it.
      const list = $('dir-beats'), row = list.children[i] as HTMLElement | undefined;
      if (row && (row.offsetTop < list.scrollTop || row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)) list.scrollTo({ top: row.offsetTop - 8, behavior: 'smooth' });
      $('dir-count').textContent = `${String(i + 1).padStart(2, '0')} / ${String(this.beats.length).padStart(2, '0')}`;
      this.caption(b.caption);
      this.deps.setOrbit(false);
      const samePlace = i > from && prev && Math.abs(prev.lat - b.lat) < 0.02 && Math.abs(prev.lon - b.lon) < 0.02;
      this.deps.speak(b.say);
      this.runHead(i, token);
      const t0 = performance.now();
      await (samePlace ? this.deps.zoomTo(b) : this.deps.flyTo(b));
      if (token !== this.playing) return;
      this.deps.setOrbit(true);
      await sleep(Math.max(1200, b.seconds * 1000 - (performance.now() - t0)));
    }
    if (token === this.playing) this.stop(false);
  }

  stop(silence = true) {
    this.playing = 0;
    $('dir-play').textContent = 'Play preview';
    $('dir-frame').classList.remove('rolling');
    this.deps.setOrbit(false);
    if (silence) this.deps.stopSpeaking();
  }

  private caption(t: string) {
    const c = $('dir-caption');
    c.classList.remove('in');
    void c.offsetWidth;
    c.textContent = t;
    if (t) c.classList.add('in');
  }

  close() {
    this.stop();
    this.root.hidden = true;
    document.body.classList.remove('directing');
    this.deps.onClose();
  }

  // ---------- Deliver ----------
  async exportKit() {
    const R = this.run;
    if (!R?.shots || !R.sources) return;
    const k: Kit = { title: R.title || R.topic, topic: R.topic, subject: R.subject!, beats: this.beats, cut: this.cut, sources: R.sources, metrics: this.metrics(), run: R };
    const zip = new JSZip();
    const slug = k.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'atlas-short';
    zip.file('tour.kml', kml(k));
    zip.file('script.md', script(k));
    zip.file('evidence.md', evidence(k));
    zip.file('captions.srt', srt(k));
    zip.file('voiceover.txt', k.beats.map((b) => b.say).join('\n\n') + '\n');
    zip.file('run.json', JSON.stringify(runInfo(k), null, 2));
    zip.file('README.txt', readme(k));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    ui.toast('Kit downloaded: Google Earth tour, script, evidence report, captions, voiceover');
  }
}

function pill(v: Verdict) {
  const p = el('span', `pill ${v}`);
  p.append(el('i', '', v === 'supported' ? '✓' : v === 'partly' ? '◐' : v === 'needs_review' ? '?' : '✕'), document.createTextNode(LABEL[v]));
  return p;
}
function sourceRow(s: Source, i: number) {
  const d = el('div', 'src');
  const a = el('a', '', s.title) as HTMLAnchorElement;
  if (s.url) { a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; }
  d.append(el('span', 'si', `[${i + 1}]`), a, el('span', 'sm', [s.kind === 'record' ? 'Official record' : s.publisher, s.published ? `dated ${day(s.published)}` : '', `retrieved ${s.retrieved.slice(0, 16).replace('T', ' ')} UTC`].filter(Boolean).join(' · ')));
  return d;
}
/** A survey-map contour texture for the workspace panels: a few lobed peaks, drawn once as SVG. */
function contours() {
  const W = 600, H = 600, paths: string[] = [];
  const peaks = [{ x: 140, y: 170, s: 0.9, a: 0.4 }, { x: 470, y: 380, s: 1.2, a: 2.1 }, { x: 260, y: 540, s: 0.7, a: 4.0 }];
  for (const p of peaks) for (let k = 1; k <= 9; k++) {
    const r = k * 26 * p.s, pts: string[] = [];
    for (let j = 0; j <= 72; j++) {
      const t = (j / 72) * Math.PI * 2;
      const rr = r * (1 + 0.16 * Math.sin(3 * t + p.a + k * 0.21) + 0.07 * Math.sin(5 * t - p.a));
      pts.push(`${(p.x + rr * Math.cos(t)).toFixed(1)},${(p.y + rr * Math.sin(t) * 0.82).toFixed(1)}`);
    }
    paths.push(`<polyline points='${pts.join(' ')}'/>`);
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'><g fill='none' stroke='%237A8574' stroke-opacity='.18' stroke-width='1'>${paths.join('')}</g></svg>`;
  return `data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}`;
}
function fmt(sec: number) { return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`; }

// ---------- export formats ----------
interface Kit { title: string; topic: string; subject: { lat: number; lon: number }; beats: Beat[]; cut: { draft: Draft; check: Check }[]; sources: Source[]; metrics: ReturnType<Director['metrics']>; run: Run }
const FLY = 2.5;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stamp = (sec: number) => {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3), s = Math.floor((ms % 60e3) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
};

function kml(k: Kit) {
  const steps = k.beats.map((b, i) => `      <gx:FlyTo>
        <gx:duration>${i === 0 ? 1 : FLY}</gx:duration>
        <gx:flyToMode>${i === 0 ? 'bounce' : 'smooth'}</gx:flyToMode>
        <LookAt>
          <longitude>${b.lon}</longitude><latitude>${b.lat}</latitude><altitude>0</altitude>
          <heading>${b.heading}</heading><tilt>${b.tilt}</tilt><range>${Math.round(b.range)}</range>
          <altitudeMode>relativeToGround</altitudeMode>
        </LookAt>
      </gx:FlyTo>
      <gx:Wait><gx:duration>${Math.max(1, b.seconds - (i === 0 ? 1 : FLY)).toFixed(1)}</gx:duration></gx:Wait>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${esc(k.title)}</name>
    <description>${esc(`Camera plan written by ATLAS Live. ${k.beats.length} beats, ${k.metrics.seconds} s.`)}</description>
    <Placemark>
      <name>${esc(k.topic)}</name>
      <Point><coordinates>${k.subject.lon},${k.subject.lat},0</coordinates></Point>
    </Placemark>
    <gx:Tour>
      <name>${esc(k.title)}</name>
      <gx:Playlist>
${steps}
      </gx:Playlist>
    </gx:Tour>
  </Document>
</kml>
`;
}

function srt(k: Kit) {
  let t = 0;
  return k.beats.map((b, i) => { const a = t; t += b.seconds; return `${i + 1}\n${stamp(a)} --> ${stamp(t - 0.05)}\n${b.say}\n`; }).join('\n');
}

function script(k: Kit) {
  let t = 0;
  const L = [`# ${k.title}`, '', `Topic: ${k.topic}  `, `Length: about ${k.metrics.seconds} s, ${k.beats.length} beats  `,
    `Source check: ${k.metrics.supported} of ${k.metrics.surviving} remaining claims supported by their cited source, ${k.metrics.partly} partly, ${k.metrics.review} need review, ${k.metrics.cut} cut. This checks that the source says it, not that it is true.  `,
    `Written by ${shortModel(k.run.models.writer)}, checked by ${shortModel(k.run.models.checker)}${provider(k.run.models.writer) ? `, on ${provider(k.run.models.writer)}` : ''}`, '', '## Beats', ''];
  k.beats.forEach((b, i) => {
    L.push(`**${i + 1}. [${fmt(t)}] ${b.caption}**  `, `${b.say}  `);
    if (b.claim && b.check) L.push(`Claim: ${b.claim} (source [${(b.source ?? -1) + 1}], ${LABEL[b.check.verdict]})  `);
    L.push(`Shot: ${b.shot} on ${b.focus === 'subject' ? k.topic : b.focus}`, '');
    t += b.seconds;
  });
  L.push('## Sources', '');
  k.sources.forEach((s, i) => L.push(`${i + 1}. [${s.title}](${s.url}) (${s.kind === 'record' ? 'official record' : s.publisher}${s.published ? `, dated ${day(s.published)}` : ''}, retrieved ${day(s.retrieved)})`));
  L.push('', '## Description for YouTube', '', k.title, '', 'Sources:', ...k.sources.map((s) => `${s.title}: ${s.url}`), '',
    `Map footage: Google Earth. Script researched and source-checked with ATLAS Live (NVIDIA Nemotron${provider(k.run.models.writer) ? ` on ${provider(k.run.models.writer)}` : ''}, Tavily).`, '');
  return L.join('\n');
}

function evidence(k: Kit) {
  const L = [`# Evidence report: ${k.title}`, '', 'Each factual claim was checked against the text of the single source it cites. "Supported" means that text states the claim. It is not an independent verification that the claim is true.', '',
    `Source-supported: ${k.metrics.supported} of ${k.metrics.surviving} remaining claims. Kept ${k.metrics.surviving} of ${k.metrics.before} claims written; ${k.metrics.cut} cut.`, '', '## Kept', ''];
  k.beats.forEach((b, i) => {
    if (!b.claim || !b.check) return;
    L.push(`### Beat ${i + 1}: ${LABEL[b.check.verdict]}`, '', `Claim: ${b.claim}`, '', `Source [${(b.source ?? -1) + 1}]: ${k.sources[b.source ?? -1]?.title ?? 'none'}`, '');
    if (b.check.evidence) L.push(`> ${b.check.evidence}${b.check.quoteFound === false ? ' (not found in the source text)' : ''}`, '');
    L.push(`Reason: ${b.check.reason}`, '');
  });
  L.push('## Cut', '');
  if (!k.cut.length) L.push('None.', '');
  for (const c of k.cut) {
    L.push(`### ${LABEL[c.check.verdict]}`, '', `Claim: ${c.draft.claim}`, '', `Original line: ${c.draft.say}`, '');
    if (c.check.evidence) L.push(`> ${c.check.evidence}`, '');
    L.push(`Reason: ${c.check.reason}`, '');
  }
  return L.join('\n');
}

function runInfo(k: Kit) {
  const R = k.run;
  return {
    topic: k.topic, live_event: !!R.live, started: R.started,
    provider: provider(R.models.writer) || null, writer_model: R.models.writer ?? null, checker_model: R.models.checker ?? null,
    stage_server_ms: R.ms, stage_wall_ms: Object.fromEntries(Object.entries(R.wall).map(([s, v]) => [s, Math.round(v ?? 0)])),
    claims: { written: k.metrics.before, kept: k.metrics.surviving, supported: k.metrics.supported, partly: k.metrics.partly, needs_review: k.metrics.review, cut: k.metrics.cut },
  };
}

function readme(k: Kit) {
  return `ATLAS Live export kit: ${k.title}

What ATLAS made: the script, the evidence report, the camera plan and the captions.
What you still do: render the footage in Google Earth and record the voice.

1. Open tour.kml in Google Earth Pro (File > Open). Double-click the tour to preview it.
2. Tools > Movie Maker: choose the tour, set a 1080 x 1920 custom size for a vertical Short, record.
   Keep the Google attribution visible and uncropped in the final video.
3. Record voiceover.txt in your voice or a text-to-speech tool. Each paragraph is one beat.
4. Import captions.srt into your editor, or upload it to YouTube as subtitles.
5. Read evidence.md before publishing: anything marked "Needs review" is yours to confirm.
6. Paste the sources from script.md into the description.

Timing: every beat is a ${FLY} s flight plus a hold, so the tour and the captions line up.
run.json records which provider and models produced this kit and how long each stage took.
`;
}
