/**
 * The alert card. Left: the alert in plain words, every change Nayan made, and every doubt about
 * the record. Right: the alert exactly as issued. Below: NDMA's own safety lines, then the crew
 * message, which stays locked until the supervisor has read it against the official alert.
 */
import type { Signal } from '../signals';
import { desk, T, esc, covers, refreshHeader } from './desk';
import { getSite, addLog } from './store';
import { LANG_NAMES, type DLang } from './strings';
import { plainHeadline, placesOutside, summarise, guidanceFor, buildMessage, smsParts, capTerm, at, timeLeft, clock } from './explain';
import { NDMA_PAGE, ndmaFile, NDMA_RETRIEVED, type GItem } from './ndma';

let host: HTMLElement;
let current: Signal | null = null;
let practice = false;
let msgLang: DLang = 'te';
let fmt: 'whatsapp' | 'sms' | 'read' = 'whatsapp';
let reviewed = false;
let voiceUrl = '';

export const cardSignal = () => current;

export function mountCard() {
  host = document.createElement('section');
  host.className = 'dk-card';
  host.id = 'dk-card';
  host.hidden = true;
  host.setAttribute('aria-label', 'Alert');
  document.body.append(host);
}

export function openCard(s: Signal, opts: { practice: boolean }) {
  const site = getSite();
  const same = current?.id === s.id;
  current = s;
  practice = opts.practice;
  if (!same) {
    reviewed = false;
    fmt = 'whatsapp';
    const langs = site?.langs?.length ? site.langs : [desk.lang];
    msgLang = langs.includes(desk.lang) && desk.lang !== 'en' ? desk.lang : langs[0];
  }
  host.hidden = false;
  document.documentElement.classList.add('dk-card-open');
  render();
  host.scrollTop = 0;
  (host.querySelector('h2') as HTMLElement | null)?.focus({ preventScroll: true });
}

export function closeCard() {
  host.hidden = true;
  current = null;
  document.documentElement.classList.remove('dk-card-open');
  document.querySelectorAll('.dk-row.is-on').forEach((x) => x.classList.remove('is-on'));
  if (voiceUrl) { URL.revokeObjectURL(voiceUrl); voiceUrl = ''; }
}

export function rerenderCard() { if (current && !host.hidden) render(); }

const field = (k: string, v: string | undefined, raw = false) => `<div class="dk-f"><dt>${esc(k)}</dt><dd>${v ? (raw ? v : esc(v)) : `<i class="dk-ns">${esc(T('not_specified'))}</i>`}</dd></div>`;
const both = (iso?: string) => (iso ? `${at(iso, desk.lang)} IST <span class="dk-raw">${esc(iso)}</span>` : '');

function render() {
  const s = current!;
  const L = desk.lang;
  const site = getSite();
  const inSite = covers(s, site);
  const ph = plainHeadline(s);
  const outside = placesOutside(s, ph.text);
  const S = summarise(s, L, site?.district ?? '');
  const sevT = capTerm(L, 'severity', s.severity), urgT = capTerm(L, 'urgency', s.urgency), certT = capTerm(L, 'certainty', s.certainty);
  const en = (s.texts ?? []).find((x) => /^en/i.test(x.lang)) ?? s.texts?.[0];
  const regional = (s.texts ?? []).filter((x) => x !== en && x.headline);
  const guides = guidanceFor(s);
  const expired = !!s.expires && Date.parse(s.expires) <= Date.now();
  const flags = [
    outside.length ? T('fl_outside', { p: outside.length > 6 ? `${outside.slice(0, 6).join(', ')} +${outside.length - 6}` : outside.join(', ') }) : '',
    s.areaLevel === 'sub-district' ? T('fl_sub') : '',
    s.districtSource === 'text' ? T('fl_text') : '',
    s.unknownCodes?.length ? T('fl_unknown', { c: s.unknownCodes.join(', ') }) : '',
  ].filter(Boolean);
  const codes = (s.geocodes ?? []).map((g) => {
    const d = s.districtCodes?.find((x) => String(x.code) === g.value);
    return `<li><span class="dk-mono">${esc(g.name)} ${esc(g.value)}</span>${d ? ` ${esc(d.name)}` : ''}</li>`;
  }).join('');

  host.dataset.sev = s.severity ?? 'Unknown';
  host.innerHTML = `
  <header class="dk-card-head">
    <i class="nx-sev" aria-hidden="true"></i>
    <div class="dk-card-title">
      <p class="dk-eyebrow">${esc((s.sender ?? '').replace(/[-_]/g, ' '))} · NDMA SACHET${s.msgType === 'Update' ? ` · ${esc(T('update'))}` : ''}</p>
      <h2 tabindex="-1">${esc(S.what)}</h2>
      <p class="dk-card-when ${expired ? 'is-expired' : ''}">${practice ? `<span class="dk-tag is-practice">${esc(T('practice_tag'))}</span> ` : ''}${s.expires ? `${esc(T('until', { t: at(s.expires, L) }))} IST · <b>${esc(timeLeft(s.expires, L))}</b>` : ''}</p>
      ${site ? `<p class="dk-site-line ${inSite ? 'is-in' : ''}">${esc(inSite ? T('in_site', { d: site.district }) : T('not_site', { d: site.district }))}</p>` : ''}
    </div>
    <button type="button" class="dk-x" data-close aria-label="${esc(T('close'))}">×</button>
  </header>

  <div class="dk-split">
    <section class="dk-pane" aria-labelledby="dk-plain-h">
      <h3 id="dk-plain-h" class="dk-h3">${esc(T('plain'))}</h3>
      <dl class="dk-wwh">
        <div><dt>${esc(T('what'))}</dt><dd>${esc(S.what)}</dd></div>
        <div><dt>${esc(T('where'))}</dt><dd>${esc(S.where)}</dd></div>
        <div><dt>${esc(T('when'))}</dt><dd>${esc(S.when || T('not_specified'))}</dd></div>
      </dl>
      <dl class="dk-cap">
        <div><dt>${esc(T('sev'))}</dt><dd><b>${esc(sevT[0])}</b> <span>${esc(sevT[1])}</span></dd></div>
        <div><dt>${esc(T('urg'))}</dt><dd><b>${esc(urgT[0])}</b> <span>${esc(urgT[1])}</span></dd></div>
        <div><dt>${esc(T('cert'))}</dt><dd><b>${esc(certT[0])}</b> <span>${esc(certT[1])}</span></dd></div>
      </dl>
      <p class="dk-plain-text" lang="en">${esc(ph.text)}</p>
      ${flags.length ? `<ul class="dk-flags">${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      <details class="dk-changes" ${ph.changes.length ? '' : ''}>
        <summary>${esc(T('provenance'))} (${ph.changes.length})</summary>
        ${ph.changes.length ? `<ul>${ph.changes.map((c) => `<li>${esc(c.kind === 'abbrev' ? T('ch_abbrev', { a: c.from, b: c.to }) : T('ch_district', { a: c.from, b: c.to }))}</li>`).join('')}</ul>` : `<p class="dk-muted">${esc(T('ch_none'))}</p>`}
      </details>
    </section>

    <section class="dk-pane dk-official" aria-labelledby="dk-off-h">
      <h3 id="dk-off-h" class="dk-h3">${esc(T('official'))}</h3>
      <dl class="dk-fields">
        ${field(T('f_headline'), en?.headline ? `<q lang="en">${esc(en.headline)}</q>` : '', true)}
        ${regional.map((r) => field(T('f_regional', { l: r.language }), `<q lang="${esc(r.lang)}">${esc(r.headline)}</q>`, true)).join('')}
        ${field(T('f_area'), s.area)}
        ${codes ? field(T('f_codes'), `<ul class="dk-codes">${codes}</ul>`, true) : field(T('f_codes'), '')}
        ${field(T('f_sender'), (s.sender ?? '').replace(/[-_]/g, ' '))}
        ${field(T('f_sent'), both(s.sent), true)}
        ${field(T('f_effective'), both(s.effective), true)}
        ${field(T('f_onset'), both(s.onset), true)}
        ${field(T('f_expires'), both(s.expires), true)}
        ${field(T('f_instruction'), en?.instruction)}
        ${field(T('f_description'), en?.description && en.description !== en.headline ? en.description : '')}
        ${field(T('f_type'), s.msgType)}
        ${field(T('f_id'), s.id)}
      </dl>
      <p class="dk-src"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(T('record'))}</a>${desk.feed.fetchedAt && !practice ? ` · ${esc(T('read_at', { t: clock(desk.feed.fetchedAt, L) }))}` : ''}</p>
    </section>
  </div>

  <section class="dk-guide" aria-labelledby="dk-g-h">
    <h3 id="dk-g-h" class="dk-h3">${esc(T('g_title'))}</h3>
    ${guides.length ? guides.map((g, gi) => `
      <div class="dk-gblock">
        <p class="dk-glabel">${esc(T('g_label', { h: g.hazard.title[L] }))}</p>
        ${g.related ? `<p class="dk-flag-inline">${esc(T('g_related', { h: g.hazard.title[L] }))}</p>` : ''}
        ${gi === 0 ? `<h4>${esc(T('for_crew'))}</h4><ul class="dk-steps">${g.hazard.crew.map((it) => step(it, L)).join('')}</ul>` : ''}
        <details ${gi === 0 ? '' : ''}><summary>${esc(gi === 0 ? T('for_lead') : g.hazard.title[L])}</summary><ul class="dk-steps is-lead">${(gi === 0 ? g.hazard.lead : [...g.hazard.crew, ...g.hazard.lead]).map((it) => step(it, L)).join('')}</ul></details>
        <p class="dk-src">${esc(T('g_source'))}: <a href="${NDMA_PAGE}" target="_blank" rel="noopener">NDMA · SACHET Do’s &amp; Don’ts</a> · <a href="${ndmaFile(L, g.key)}" target="_blank" rel="noopener">${esc(LANG_NAMES[L].native)}</a> · ${esc(NDMA_RETRIEVED)}</p>
      </div>`).join('') : `<p class="dk-muted">${esc(T('g_none'))}</p>`}
  </section>

  <section class="dk-msg" aria-labelledby="dk-m-h">
    <h3 id="dk-m-h" class="dk-h3">${esc(T('m_title'))}</h3>
    <div class="dk-tabs" role="group" aria-label="${esc(T('m_lang'))}">${(['te', 'hi', 'en'] as DLang[]).map((l) => `<button type="button" data-mlang="${l}" aria-pressed="${l === msgLang}" lang="${l}">${LANG_NAMES[l].native}</button>`).join('')}</div>
    <div class="dk-tabs is-fmt" role="group">${(['whatsapp', 'sms', 'read'] as const).map((f) => `<button type="button" data-fmt="${f}" aria-pressed="${f === fmt}">${esc(T(f === 'whatsapp' ? 'f_whatsapp' : f === 'sms' ? 'f_sms' : 'f_read'))}</button>`).join('')}</div>
    <pre class="dk-out" lang="${msgLang}" tabindex="0"></pre>
    <p class="dk-muted dk-count"></p>
    <label class="dk-review"><input type="checkbox" data-review ${reviewed ? 'checked' : ''}/> <span>${esc(T('m_review'))}</span></label>
    <p class="dk-muted dk-lock" ${reviewed ? 'hidden' : ''}>${esc(T('m_locked'))}</p>
    <div class="dk-actions dk-share">
      <button type="button" class="dk-btn is-solid" data-copy ${reviewed ? '' : 'disabled'}>${esc(T('copy'))}</button>
      <a class="dk-btn" data-wa target="_blank" rel="noopener" ${reviewed ? '' : 'aria-disabled="true" tabindex="-1"'}>${esc(T('share_wa'))}</a>
      <button type="button" class="dk-btn" data-voice ${reviewed ? '' : 'disabled'}>${esc(T('voice'))}</button>
    </div>
    <div class="dk-voice" hidden></div>
    <details class="dk-told" ${reviewed ? '' : ''}>
      <summary class="dk-btn ${reviewed ? '' : 'is-off'}">${esc(T('told'))}</summary>
      <form class="dk-form" data-told>
        <fieldset class="dk-checks"><legend>${esc(T('told_how'))}</legend>
          <label><input type="checkbox" name="ch" value="in person" checked/> ${esc(T('ch_person'))}</label>
          <label><input type="checkbox" name="ch" value="WhatsApp"/> ${esc(T('ch_wa'))}</label>
          <label><input type="checkbox" name="ch" value="SMS"/> ${esc(T('ch_sms'))}</label>
        </fieldset>
        <div class="dk-two">
          <label class="dk-field"><span>${esc(T('told_count'))}</span><input name="count" type="number" min="1" inputmode="numeric" value="${esc(site?.crew ?? '')}"/></label>
          <label class="dk-field"><span>${esc(T('told_note'))}</span><input name="note"/></label>
        </div>
        <div class="dk-actions"><button type="submit" class="dk-btn is-solid" ${reviewed ? '' : 'disabled'}>${esc(T('save_log'))}</button><span class="dk-saved" role="status"></span></div>
      </form>
    </details>
  </section>

  <footer class="dk-card-foot"><button type="button" class="dk-btn" data-globe>${esc(T('show_globe'))}</button></footer>`;
  wire();
  paintMessage();
}

function step(it: GItem, L: DLang) {
  const note = it.flag?.[L];
  return `<li lang="${L}">${esc(it.text[L])}${note ? `<span class="dk-tnote"><b>${esc(T('g_note'))}:</b> ${esc(note)} <q lang="en">${esc(it.text.en)}</q></span>` : ''}</li>`;
}

function paintMessage() {
  const s = current!;
  const site = getSite();
  const m = buildMessage(s, msgLang, site?.district ?? '');
  let text = fmt === 'whatsapp' ? m.whatsapp : fmt === 'sms' ? m.sms : m.read;
  if (practice) text = `[${T('practice_tag').toUpperCase()}]\n${text}`;
  const out = host.querySelector<HTMLElement>('.dk-out')!;
  out.textContent = text;
  out.lang = msgLang;
  const count = host.querySelector<HTMLElement>('.dk-count')!;
  if (fmt === 'sms') { const p = smsParts(text); count.textContent = T('sms_count', { c: p.chars, n: p.parts, e: p.enc }); count.hidden = false; } else count.hidden = true;
  const wa = host.querySelector<HTMLAnchorElement>('[data-wa]')!;
  wa.href = reviewed ? `https://wa.me/?text=${encodeURIComponent(text)}` : '#';
  host.dataset.text = text;
}

function setReviewed(on: boolean) {
  reviewed = on;
  host.querySelector<HTMLInputElement>('[data-review]')!.checked = on;
  host.querySelector<HTMLElement>('.dk-lock')!.hidden = on;
  host.querySelectorAll<HTMLButtonElement>('[data-copy], [data-voice], [data-told] button[type="submit"]').forEach((b) => { b.disabled = !on; });
  const wa = host.querySelector<HTMLAnchorElement>('[data-wa]')!;
  if (on) { wa.removeAttribute('aria-disabled'); wa.removeAttribute('tabindex'); } else { wa.setAttribute('aria-disabled', 'true'); wa.tabIndex = -1; }
  host.querySelector('.dk-told summary')?.classList.toggle('is-off', !on);
  paintMessage();
}

function wire() {
  host.querySelector('[data-close]')!.addEventListener('click', closeCard);
  host.querySelectorAll<HTMLButtonElement>('[data-mlang]').forEach((b) => b.addEventListener('click', () => {
    msgLang = b.dataset.mlang as DLang;
    host.querySelectorAll('[data-mlang]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    setReviewed(false); // a new text needs its own read-through
    clearVoice();
  }));
  host.querySelectorAll<HTMLButtonElement>('[data-fmt]').forEach((b) => b.addEventListener('click', () => {
    fmt = b.dataset.fmt as typeof fmt;
    host.querySelectorAll('[data-fmt]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    setReviewed(false);
    clearVoice();
  }));
  host.querySelector<HTMLInputElement>('[data-review]')!.addEventListener('change', (e) => setReviewed((e.target as HTMLInputElement).checked));
  host.querySelector('[data-wa]')!.addEventListener('click', (e) => { if (!reviewed) e.preventDefault(); });
  host.querySelector<HTMLButtonElement>('[data-copy]')!.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try { await navigator.clipboard.writeText(host.dataset.text ?? ''); b.textContent = T('copied'); setTimeout(() => { b.textContent = T('copy'); }, 1600); } catch { /* clipboard refused: the text is still selectable */ }
  });
  host.querySelector<HTMLButtonElement>('[data-voice]')!.addEventListener('click', () => void makeVoice());
  host.querySelector<HTMLFormElement>('[data-told]')!.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!reviewed || !current) return;
    const fd = new FormData(e.target as HTMLFormElement);
    const site = getSite();
    const n = Number(fd.get('count'));
    addLog({
      at: new Date().toISOString(), reviewedAt: new Date().toISOString(), alertId: current.id, url: current.url, event: current.event ?? current.title,
      sender: (current.sender ?? '').replace(/[-_]/g, ' '), severity: current.severity ?? 'Unknown', expires: current.expires ?? '',
      site: site?.name ?? '', district: site?.district ?? '', langs: [msgLang], channels: fd.getAll('ch').map(String), count: n > 0 ? n : null,
      supervisor: site?.supervisor ?? '', note: String(fd.get('note') || '').trim(), practice,
    });
    const saved = host.querySelector<HTMLElement>('[data-told] .dk-saved');
    if (saved) saved.textContent = T('logged');
    refreshHeader();
  });
  host.querySelector('[data-globe]')!.addEventListener('click', () => { if (current) window.dispatchEvent(new CustomEvent('nayan:fly', { detail: current })); });
}

function clearVoice() {
  const box = host.querySelector<HTMLElement>('.dk-voice')!;
  box.hidden = true;
  box.replaceChildren();
  if (voiceUrl) { URL.revokeObjectURL(voiceUrl); voiceUrl = ''; }
}

async function makeVoice() {
  if (!current || !reviewed) return;
  const box = host.querySelector<HTMLElement>('.dk-voice')!;
  box.hidden = false;
  box.textContent = T('voice_wait');
  const m = buildMessage(current, msgLang, getSite()?.district ?? '');
  try {
    const r = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: m.read, lang: msgLang }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
    const blob = await r.blob();
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    voiceUrl = URL.createObjectURL(blob);
    box.innerHTML = `<audio controls src="${voiceUrl}"></audio><p class="dk-muted">${esc(T('voice_note'))}</p><a class="dk-btn is-small" href="${voiceUrl}" download="nayan-${msgLang}-${(current.id || 'alert').replace(/[^\w-]/g, '')}.wav">↓ WAV</a>`;
  } catch (err) {
    box.textContent = T('voice_fail', { e: err instanceof Error ? err.message : String(err) });
  }
}
