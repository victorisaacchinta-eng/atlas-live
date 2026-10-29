import JSZip from 'jszip';
import { ui } from './ui';

/**
 * The Short director. ATLAS writes a 60-second explainer (server: api/short.ts), then this module
 * plays it on the globe inside a 9:16 frame and packs an export kit a creator can finish anywhere:
 *   tour.kml       Google Earth tour (gx:Tour), one flight and hold per beat
 *   script.md      the script, each claim with its source and the verifier's verdict
 *   captions.srt   captions timed to the tour
 *   voiceover.txt  narration only, ready for a text-to-speech tool
 * Google Earth is licensed for online video with attribution, so the footage is rendered there.
 * ATLAS never records or exports Google's 3D tiles.
 */

export interface Beat {
  say: string; caption: string; claim: string | null; source: number | null;
  verdict: 'supported' | 'partly' | 'unsupported' | null; evidence: string | null;
  shot: 'orbit' | 'region' | 'area' | 'close'; focus: string;
  lat: number; lon: number; range: number; tilt: number; heading: number; seconds: number;
}
export interface Short {
  topic: string; title: string; subject: { lat: number; lon: number };
  beats: Beat[]; sources: { title: string; url: string; kind: 'record' | 'web' }[];
  stats: { claims: number; supported: number; partly: number; removed: number; seconds: number };
  models: { writer: string; verifier: string };
  ms: { research: number; write: number; verify: number; total: number };
}
export interface ShortInput {
  topic: string; lat?: number; lon?: number;
  signal?: { id?: string; layer?: string; kind?: string; title: string; lat: number; lon: number; time?: string; mag?: number; magUnit?: string; depthKm?: number; alert?: string | null; tsunami?: boolean; url?: string };
}
export interface DirectorDeps {
  /** Fly to a new place and resolve when the camera has landed. */
  flyTo: (b: Beat) => Promise<void>;
  /** Glide in or out over the current place and resolve when done. */
  zoomTo: (b: Beat) => Promise<void>;
  setOrbit: (on: boolean) => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  onOpen: () => void;
  onClose: () => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const short = (m: string) => m.split('·').pop()!.trim().split('/').pop()!;
/** "Nebius Token Factory · nvidia/..." -> "Nebius Token Factory" */
const provider = (m: string) => (m.includes('·') ? m.split('·')[0].trim() : '');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Director {
  private root = $('director');
  private short: Short | null = null;
  private playing = 0; // play token: a new play or stop invalidates the old loop
  private busy = false;

  private deps: DirectorDeps;

  constructor(deps: DirectorDeps) {
    this.deps = deps;
    $('dir-close').addEventListener('click', () => this.close());
    $('dir-play').addEventListener('click', () => (this.playing ? this.stop() : this.play()));
    $('dir-export').addEventListener('click', () => this.exportKit());
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      if (e.key === 'Escape') this.close();
      if (e.key === ' ') { e.preventDefault(); $('dir-play').click(); }
    });
  }

  get open() { return !this.root.hidden; }
  get topic() { return this.short?.topic ?? this.pending; }
  private pending = '';

  async make(input: ShortInput) {
    if (this.busy) return;
    this.busy = true;
    this.stop();
    this.short = null;
    this.pending = input.topic;
    this.root.hidden = false;
    document.body.classList.add('directing');
    this.deps.onOpen();
    $('dir-topic').textContent = input.topic;
    $('dir-title').textContent = 'Writing the Short';
    $('dir-caption').textContent = '';
    $('dir-meta').textContent = '';
    ($('dir-play') as HTMLButtonElement).disabled = true;
    ($('dir-export') as HTMLButtonElement).disabled = true;
    const rail = $('dir-beats');
    rail.replaceChildren();
    const steps = [
      'Reading the official record and the web',
      'Nemotron is writing six beats',
      'A second Nemotron model is checking every claim',
      'Resolving camera shots',
    ];
    let si = 0;
    const status = $('dir-status');
    status.textContent = steps[0];
    const tick = setInterval(() => { si = Math.min(si + 1, steps.length - 1); status.textContent = steps[si]; }, 7000);
    ui.log(`writing a Short: ${input.topic}`, 'sys');
    try {
      const r = await fetch('/api/short', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      this.short = j as Short;
      this.render();
      ui.log(`${this.short.beats.length} beats, ${this.short.stats.supported + this.short.stats.partly} of ${this.short.stats.claims} claims backed by their sources`, 'tool');
      this.play();
    } catch (err) {
      $('dir-title').textContent = 'Could not write this Short';
      status.textContent = err instanceof Error ? err.message.slice(0, 160) : String(err);
    } finally {
      clearInterval(tick);
      this.busy = false;
    }
  }

  private render() {
    const s = this.short!;
    $('dir-title').textContent = s.title;
    $('dir-status').textContent = '';
    const checked = s.stats.supported + s.stats.partly;
    $('dir-meta').innerHTML = '';
    const meta = $('dir-meta');
    const line = (t: string) => { const p = document.createElement('p'); p.textContent = t; meta.appendChild(p); };
    line(`${s.beats.length} beats · ${s.stats.seconds} s · ${checked} of ${s.stats.claims} claims backed by their sources${s.stats.removed ? ` · ${s.stats.removed} cut` : ''}`);
    line(`Written by ${short(s.models.writer)} · checked by ${short(s.models.verifier)} · ${Math.round(s.ms.total / 1000)} s`);
    const rail = $('dir-beats');
    rail.replaceChildren();
    s.beats.forEach((b, i) => {
      const li = document.createElement('li');
      li.dataset.i = String(i);
      li.innerHTML = '<span class="n"></span><div><p class="say"></p><p class="src"></p></div>';
      li.querySelector('.n')!.textContent = String(i + 1).padStart(2, '0');
      li.querySelector('.say')!.textContent = b.say;
      const src = li.querySelector('.src')!;
      if (b.claim && b.source !== null && s.sources[b.source]) {
        const badge = document.createElement('span');
        badge.className = `v ${b.verdict}`;
        badge.textContent = b.verdict === 'supported' ? 'checked' : 'partly';
        if (b.evidence) badge.title = `Source says: ${b.evidence}`;
        const a = document.createElement('a');
        a.href = s.sources[b.source].url; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = s.sources[b.source].title;
        src.append(badge, a);
      } else src.textContent = `${b.shot} shot · no factual claim`;
      li.addEventListener('click', () => this.play(i));
      rail.appendChild(li);
    });
    ($('dir-play') as HTMLButtonElement).disabled = false;
    ($('dir-export') as HTMLButtonElement).disabled = false;
  }

  async play(from = 0) {
    const s = this.short;
    if (!s) return;
    const token = ++this.playing;
    $('dir-play').textContent = 'Stop';
    $('dir-frame').classList.add('rolling');
    const rows = [...$('dir-beats').children] as HTMLElement[];
    for (let i = from; i < s.beats.length; i++) {
      if (token !== this.playing) return;
      const b = s.beats[i], prev = s.beats[i - 1];
      rows.forEach((r, k) => r.classList.toggle('on', k === i));
      rows[i]?.scrollIntoView({ block: 'nearest' });
      $('dir-count').textContent = `${String(i + 1).padStart(2, '0')} / ${String(s.beats.length).padStart(2, '0')}`;
      this.caption(b.caption);
      this.deps.setOrbit(false);
      const samePlace = i > from && prev && Math.abs(prev.lat - b.lat) < 0.02 && Math.abs(prev.lon - b.lon) < 0.02;
      this.deps.speak(b.say);
      const t0 = performance.now();
      await (samePlace ? this.deps.zoomTo(b) : this.deps.flyTo(b));
      if (token !== this.playing) return;
      this.deps.setOrbit(true);
      // Hold for the rest of the line (the flight counts toward it).
      await sleep(Math.max(1200, b.seconds * 1000 - (performance.now() - t0)));
    }
    if (token === this.playing) this.stop(false);
  }

  stop(silence = true) {
    this.playing = 0;
    $('dir-play').textContent = 'Play';
    $('dir-frame').classList.remove('rolling');
    this.deps.setOrbit(false);
    if (silence) this.deps.stopSpeaking();
  }

  private caption(t: string) {
    const el = $('dir-caption');
    el.classList.remove('in');
    void el.offsetWidth;
    el.textContent = t;
    el.classList.add('in');
  }

  close() {
    this.stop();
    this.root.hidden = true;
    document.body.classList.remove('directing');
    this.deps.onClose();
  }

  async exportKit() {
    const s = this.short;
    if (!s) return;
    const zip = new JSZip();
    const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'atlas-short';
    zip.file('tour.kml', kml(s));
    zip.file('script.md', script(s));
    zip.file('captions.srt', srt(s));
    zip.file('voiceover.txt', s.beats.map((b) => b.say).join('\n\n') + '\n');
    zip.file('README.txt', readme(s));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    ui.toast('Export kit downloaded: Google Earth tour, script with sources, captions');
  }
}

// ---------- export formats ----------
const FLY = 2.5;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stamp = (sec: number) => {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3), s = Math.floor((ms % 60e3) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
};
const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function kml(s: Short) {
  const steps = s.beats.map((b, i) => `      <gx:FlyTo>
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
    <name>${esc(s.title)}</name>
    <description>${esc(`Written by ATLAS Live. ${s.beats.length} beats, ${s.stats.seconds} s.`)}</description>
    <Placemark>
      <name>${esc(s.topic)}</name>
      <Point><coordinates>${s.subject.lon},${s.subject.lat},0</coordinates></Point>
    </Placemark>
    <gx:Tour>
      <name>${esc(s.title)}</name>
      <gx:Playlist>
${steps}
      </gx:Playlist>
    </gx:Tour>
  </Document>
</kml>
`;
}

function srt(s: Short) {
  let t = 0;
  return s.beats.map((b, i) => {
    const a = t; t += b.seconds;
    return `${i + 1}\n${stamp(a)} --> ${stamp(t - 0.05)}\n${b.say}\n`;
  }).join('\n');
}

function script(s: Short) {
  let t = 0;
  const lines = [`# ${s.title}`, '', `Topic: ${s.topic}  `, `Length: about ${s.stats.seconds} s, ${s.beats.length} beats  `,
    `Claims backed by their sources: ${s.stats.supported + s.stats.partly} of ${s.stats.claims}${s.stats.removed ? ` (${s.stats.removed} unsupported claim${s.stats.removed > 1 ? 's' : ''} cut)` : ''}  `,
    `Written by ${short(s.models.writer)}, checked by ${short(s.models.verifier)}${provider(s.models.writer) ? `, on ${provider(s.models.writer)}` : ''}`, '', '## Beats', ''];
  s.beats.forEach((b, i) => {
    lines.push(`**${i + 1}. [${mmss(t)}] ${b.caption}**  `, b.say + '  ');
    if (b.claim && b.source !== null && s.sources[b.source]) lines.push(`Claim: ${b.claim} (source [${b.source + 1}], ${b.verdict})${b.evidence ? `. Source says: "${b.evidence}"` : ''}  `);
    lines.push(`Shot: ${b.shot} on ${b.focus === 'subject' ? s.topic : b.focus}`, '');
    t += b.seconds;
  });
  lines.push('## Sources', '');
  s.sources.forEach((x, i) => lines.push(`${i + 1}. [${x.title}](${x.url})${x.kind === 'record' ? ' (official record)' : ''}`));
  lines.push('', '## Description for YouTube', '', `${s.title}`, '', 'Sources:', ...s.sources.map((x) => `${x.title}: ${x.url}`), '', `Map footage: Google Earth. Script researched and fact-checked with ATLAS Live (NVIDIA Nemotron${provider(s.models.writer) ? ` on ${provider(s.models.writer)}` : ''}, Tavily).`, '');
  return lines.join('\n');
}

function readme(s: Short) {
  return `ATLAS Live export kit: ${s.title}

1. Open tour.kml in Google Earth Pro (File > Open). Double-click the tour to preview it.
2. Tools > Movie Maker: choose the tour, 1080 x 1920 for a vertical Short, record.
   Keep the Google attribution visible and uncropped in the final video.
3. Record voiceover.txt in your voice or a text-to-speech tool. Each paragraph is one beat.
4. Drop captions.srt into your editor or upload it to YouTube as subtitles.
5. Paste the sources from script.md into the description.

The camera times in the tour match the captions: every beat is a ${FLY} s flight plus a hold.
`;
}
