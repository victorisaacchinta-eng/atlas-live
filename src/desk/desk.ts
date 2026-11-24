/**
 * Nayan site desk: the supervisor's view of India's official alerts.
 *
 *   Site    the one district this supervisor is responsible for, and the crew's languages
 *   Alerts  SACHET alerts in force, the site's district first, with the time Nayan last read SACHET
 *   Log     who was told what, when, in which language and how
 *   Check   a forwarded warning compared with the alerts in force (experimental)
 *   Learn   IMD colours and CAP fields, kept apart
 *
 * The globe stays behind the desk as an overview; everything here works without it.
 */
import '../console/nayan.css';
import './desk.css';
import type { Signal, LayerStatus } from '../signals';
import { tr, LANG_NAMES, type DLang, type SKey } from './strings';
import { getSite, saveSite, getLog, clearLog, toCSV, getLang, saveLang, findDistricts, PILOT, DISTRICTS, type Site } from './store';
import { at, timeLeft, capTerm, summarise, clock } from './explain';
import { mountCard, openCard, rerenderCard, cardSignal } from './card';
import { mountVerify, renderVerify } from './verify';
import { renderLearn } from './learn';

export type View = 'site' | 'alerts' | 'log' | 'verify' | 'learn';
export interface Feed { status: LayerStatus; alerts: Signal[]; fetchedAt?: string; stale?: boolean; error?: string; listed?: number }

export const desk = {
  lang: getLang() as DLang,
  view: 'alerts' as View,
  feed: { status: 'loading', alerts: [] } as Feed,
  practice: false,
  practiceAlerts: [] as Signal[],
  practiceSaved: '',
};
export const T = (k: SKey, v: Record<string, string | number> = {}) => tr(desk.lang, k, v);
export const esc = (x: unknown) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <E extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<E>(sel);
const root = document.documentElement;

const NAV: [View, SKey, string][] = [['site', 'nav_site', '01'], ['alerts', 'nav_alerts', '02'], ['log', 'nav_log', '03'], ['verify', 'nav_verify', '04'], ['learn', 'nav_learn', '05']];
export const EYE_SVG = `<svg class="nx-eye" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2.5 35.2 11.25v17.5L20 37.5 4.8 28.75v-17.5Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 20c3.2-5.4 7.1-8 11.5-8s8.3 2.6 11.5 8c-3.2 5.4-7.1 8-11.5 8s-8.3-2.6-11.5-8Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="20" cy="20" r="4.2" fill="currentColor"/></svg>`;

let panel: HTMLElement;

export function initDesk() {
  root.dataset.nayan = '';
  root.dataset.deskApp = '';
  root.lang = desk.lang;
  const field = document.createElement('div');
  field.className = 'nx-field';
  field.setAttribute('aria-hidden', 'true');
  document.body.prepend(field);
  buildHeader();
  panel = document.createElement('main');
  panel.id = 'desk';
  panel.className = 'dk-panel';
  panel.setAttribute('aria-live', 'polite');
  document.body.append(panel);
  mountCard();
  mountVerify();
  // The site comes first for a new supervisor; after that, the alerts.
  desk.view = getSite() ? 'alerts' : 'site';
  const q = new URLSearchParams(location.search).get('view') as View | null;
  if (q && NAV.some(([v]) => v === q)) desk.view = q;
  render();

  window.addEventListener('nayan:signals', (e) => {
    const d = (e as CustomEvent<{ india: { status: LayerStatus; error?: string; data?: { signals: Signal[]; fetchedAt: string; stale?: boolean; error?: string; listed?: number } } }>).detail.india;
    desk.feed = { status: d.status, alerts: d.data?.signals ?? [], fetchedAt: d.data?.fetchedAt, stale: d.data?.stale, error: d.data?.error || d.error, listed: d.data?.listed };
    paintLamp();
    if (desk.view === 'site' || desk.view === 'alerts') render();
  });
  // A click on an alert on the globe opens the same card.
  window.addEventListener('nayan:alert', (e) => openCard((e as CustomEvent<Signal>).detail, { practice: false }));
  // Read SACHET again every four minutes; the server answers from its cache within its own limits.
  setInterval(() => window.dispatchEvent(new CustomEvent('nayan:reload-india')), 4 * 60e3);
  // Times left and "checked at" age while the page stays open.
  setInterval(() => { paintLamp(); if (desk.view === 'alerts' || desk.view === 'site') render(); }, 60e3);
  startClock();
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape') { (document.querySelector('.dk-card [data-close]') as HTMLButtonElement | null)?.click(); return; }
    if ((e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); setFocus(!root.classList.contains('nx-focused')); }
  });
}

// ---------------------------------------------------------------------------------------------
// Header: mark, the five desk keys, language, SACHET lamp, IST clock, globe focus
// ---------------------------------------------------------------------------------------------

function buildHeader() {
  const bar = $('.bar')!;
  const mark = $('.mark', bar);
  if (mark && !mark.querySelector('.nx-eye')) mark.insertAdjacentHTML('afterbegin', EYE_SVG);
  const nav = document.createElement('nav');
  nav.className = 'dk-nav';
  nav.setAttribute('aria-label', 'Desk');
  nav.innerHTML = NAV.map(([v, , n]) => `<button type="button" class="dk-key" data-view="${v}"><span class="nx-n">${n}</span><span class="dk-key-t"></span><b class="dk-badge" hidden></b></button>`).join('');
  nav.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
    if (b) go(b.dataset.view as View);
  });
  const rail = document.createElement('div');
  rail.className = 'nx-rail dk-rail';
  rail.innerHTML = `
    <div class="dk-langs" role="group" aria-label="Language">${(['en', 'hi', 'te'] as DLang[]).map((l) => `<button type="button" data-lang="${l}" lang="${l}">${l === 'en' ? 'EN' : l === 'hi' ? 'हि' : 'తె'}</button>`).join('')}</div>
    <span class="nx-lamp dk-lamp" data-state="busy"><i></i><span class="dk-lamp-t"></span></span>
    <div class="nx-clock"><span class="nx-k">IST</span><b id="nx-ist">--:--</b></div>
    <button type="button" class="nx-key nx-focus" aria-pressed="false"><span class="dk-globe-t"></span><kbd>T</kbd></button>`;
  rail.querySelector('.dk-langs')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-lang]');
    if (b) setLang(b.dataset.lang as DLang);
  });
  rail.querySelector('.nx-focus')!.addEventListener('click', () => setFocus(!root.classList.contains('nx-focused')));
  bar.append(nav, rail);
}

function setFocus(on: boolean) {
  root.classList.toggle('nx-focused', on);
  $('.nx-focus')?.setAttribute('aria-pressed', String(on));
}

export function setLang(l: DLang) {
  desk.lang = l;
  saveLang(l);
  root.lang = l;
  render();
  rerenderCard();
}

export function go(v: View) {
  desk.view = v;
  if (root.classList.contains('nx-focused')) setFocus(false);
  render();
  panel.scrollTop = 0;
  (panel.querySelector('h2') as HTMLElement | null)?.focus({ preventScroll: true });
}

function paintHeader() {
  document.querySelectorAll<HTMLButtonElement>('.dk-key').forEach((b) => {
    const v = b.dataset.view as View;
    b.querySelector('.dk-key-t')!.textContent = T(NAV.find((x) => x[0] === v)![1]);
    b.classList.toggle('is-on', v === desk.view);
    b.setAttribute('aria-current', v === desk.view ? 'page' : 'false');
  });
  const badge = $('.dk-key[data-view="alerts"] .dk-badge')!;
  const mine = siteAlerts().length;
  badge.hidden = !mine;
  badge.textContent = String(mine);
  const logBadge = $('.dk-key[data-view="log"] .dk-badge')!;
  const n = getLog().length;
  logBadge.hidden = !n;
  logBadge.textContent = String(n);
  document.querySelectorAll<HTMLButtonElement>('.dk-langs [data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === desk.lang)));
  const g = $('.dk-globe-t');
  if (g) g.textContent = T('globe');
  paintLamp();
}

function paintLamp() {
  const l = $('.dk-lamp');
  if (!l) return;
  const f = desk.feed;
  const t = f.fetchedAt ? clock(f.fetchedAt, desk.lang) : '';
  const state = f.status === 'loading' ? 'busy' : f.status === 'failed' ? 'err' : f.stale ? 'warn' : f.status === 'ok' ? 'ok' : 'off';
  l.dataset.state = state;
  l.querySelector('.dk-lamp-t')!.textContent = state === 'busy' ? T('lamp_busy') : state === 'err' ? T('lamp_err') : state === 'warn' ? T('lamp_stale', { t }) : T('lamp_ok', { t });
}

function startClock() {
  const el = $('#nx-ist')!;
  const tick = () => {
    const d = new Date(Date.now() + 5.5 * 3600e3);
    el.textContent = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  tick();
  setInterval(tick, 10e3);
}

// ---------------------------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------------------------

export const liveAlerts = () => desk.feed.alerts.filter((a) => !a.expires || Date.parse(a.expires) > Date.now());
export const activeAlerts = () => (desk.practice ? desk.practiceAlerts : liveAlerts());
export function covers(a: Signal, site: Site | null) {
  if (!site) return false;
  if (a.districtCodes?.some((d) => d.code === site.code)) return true;
  return (a.districts ?? []).includes(site.district);
}
export const siteAlerts = () => { const s = getSite(); return s ? activeAlerts().filter((a) => covers(a, s)) : []; };
const sent = (a: Signal) => Date.parse(a.sent || a.time || '') || 0;

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

function render() {
  paintHeader();
  root.dataset.view = desk.view;
  const view = desk.view;
  if (view === 'verify') { panel.replaceChildren(renderVerify()); return; }
  if (view === 'learn') { panel.replaceChildren(renderLearn()); return; }
  // Keep a half-typed site form when the list refreshes underneath it.
  if (view === 'site' && panel.querySelector('#dk-site-form') && panel.contains(document.activeElement)) { paintSiteStatus(); return; }
  const html = view === 'site' ? siteView() : view === 'alerts' ? alertsView() : logView();
  panel.innerHTML = html;
  if (view === 'site') wireSite();
  if (view === 'alerts') wireAlerts();
  if (view === 'log') wireLog();
}

function feedLine() {
  const f = desk.feed;
  if (desk.practice) return `<p class="dk-feed dk-practice-note">${esc(T('practice_note'))}</p>`;
  if (f.status === 'loading' && !f.fetchedAt) return `<p class="dk-feed is-busy">${esc(T('loading'))}</p>`;
  if (f.status === 'failed') return `<p class="dk-feed is-err" role="alert">${esc(T('feed_down'))} <button type="button" class="dk-link" data-retry>${esc(T('retry'))}</button></p>`;
  const t = f.fetchedAt ? clock(f.fetchedAt, desk.lang) : '';
  if (f.stale) return `<p class="dk-feed is-warn" role="alert">${esc(T('feed_stale', { t }))} <button type="button" class="dk-link" data-retry>${esc(T('retry'))}</button></p>`;
  return `<p class="dk-feed">${esc(T('feed_ok', { n: liveAlerts().length, t }))}</p>`;
}

const waiting = () => !desk.practice && desk.feed.status !== 'failed' && !desk.feed.fetchedAt;

function siteStatusHtml(site: Site | null) {
  if (!site) return `<p class="dk-muted">${esc(T('no_site'))}</p>`;
  const f = desk.feed;
  if (!desk.practice && f.status === 'failed') return `<div class="dk-status is-err"><p>${esc(T('status_unknown', { d: site.district }))}</p></div>`;
  if (waiting()) return `<div class="dk-status"><p class="dk-muted">${esc(T('loading'))}</p></div>`;
  const mine = siteAlerts();
  const t = f.fetchedAt ? clock(f.fetchedAt, desk.lang) : '';
  const head = mine.length ? T(mine.length === 1 ? 'status_some' : 'status_some_n', { n: mine.length, d: site.district }) : T('status_none', { d: site.district });
  return `<div class="dk-status ${mine.length ? 'is-hot' : 'is-calm'}">
    <p class="dk-status-h">${esc(head)}</p>
    ${desk.practice ? `<p class="dk-muted">${esc(T('practice_tag'))}</p>` : t ? `<p class="dk-muted">${esc(T('as_of', { t }))}${f.stale ? ` ${esc(T('feed_stale', { t }))}` : ''}</p>` : ''}
    ${mine.length ? `<ul class="dk-rows">${mine.map((a) => row(a, site)).join('')}</ul>` : ''}
  </div>`;
}

function siteView() {
  const s = getSite();
  const langs = s?.langs ?? ['te', 'hi'];
  return `<section class="dk-view" aria-labelledby="dk-h">
    <header class="dk-head"><p class="dk-eyebrow">01 · ${esc(T('nav_site'))}</p><h2 id="dk-h" tabindex="-1">${esc(T('site_title'))}</h2><p class="dk-lede">${esc(T('site_lede'))}</p></header>
    <div id="dk-site-status">${siteStatusHtml(s)}</div>
    <form id="dk-site-form" class="dk-form" autocomplete="off">
      <label class="dk-field"><span>${esc(T('district'))}</span>
        <input id="dk-district" name="district" placeholder="${esc(T('district_ph'))}" value="${esc(s ? `${s.district}, ${s.state}` : '')}" data-code="${s?.code ?? ''}" role="combobox" aria-expanded="false" aria-controls="dk-dlist" required />
      </label>
      <ul id="dk-dlist" class="dk-dlist" role="listbox" hidden></ul>
      <div class="dk-picks">${PILOT.map((d) => `<button type="button" class="dk-chip" data-code="${d.code}">${esc(d.name)}</button>`).join('')}</div>
      <label class="dk-field"><span>${esc(T('site_name'))}</span><input name="name" placeholder="${esc(T('site_name_ph'))}" value="${esc(s?.name ?? '')}" /></label>
      <fieldset class="dk-field dk-checks"><legend>${esc(T('crew_langs'))}</legend>
        ${(['te', 'hi', 'en'] as DLang[]).map((l) => `<label><input type="checkbox" name="langs" value="${l}" ${langs.includes(l) ? 'checked' : ''}/> <span lang="${l}">${LANG_NAMES[l].native}</span></label>`).join('')}
      </fieldset>
      <div class="dk-two">
        <label class="dk-field"><span>${esc(T('supervisor'))}</span><input name="supervisor" value="${esc(s?.supervisor ?? '')}" /></label>
        <label class="dk-field"><span>${esc(T('crew_size'))}</span><input name="crew" type="number" min="1" max="5000" inputmode="numeric" value="${esc(s?.crew ?? '')}" /></label>
      </div>
      <div class="dk-actions"><button type="submit" class="dk-btn is-solid">${esc(T('save'))}</button>${s ? `<button type="button" class="dk-btn" data-fly>${esc(T('show_site'))}</button>` : ''}<span class="dk-saved" role="status"></span></div>
      <p class="dk-muted dk-privacy">${esc(T('privacy'))}</p>
    </form>
  </section>`;
}

function paintSiteStatus() {
  const box = $('#dk-site-status', panel);
  if (box) { box.innerHTML = siteStatusHtml(getSite()); wireRows(box); }
}

function wireSite() {
  const form = $<HTMLFormElement>('#dk-site-form', panel)!;
  const input = $<HTMLInputElement>('#dk-district', panel)!;
  const list = $<HTMLUListElement>('#dk-dlist', panel)!;
  const pick = (code: number) => {
    const d = DISTRICTS.find((x) => x.code === code);
    if (!d) return;
    input.value = `${d.name}, ${d.state}`;
    input.dataset.code = String(d.code);
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };
  input.addEventListener('input', () => {
    input.dataset.code = '';
    const hits = findDistricts(input.value);
    list.innerHTML = hits.map((d) => `<li role="option" tabindex="-1" data-code="${d.code}"><b>${esc(d.name)}</b> <span>${esc(d.state)}</span></li>`).join('');
    list.hidden = !hits.length;
    input.setAttribute('aria-expanded', String(!!hits.length));
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !list.hidden) { e.preventDefault(); (list.firstElementChild as HTMLElement | null)?.focus(); }
    if (e.key === 'Enter' && !list.hidden && list.firstElementChild) { e.preventDefault(); pick(Number((list.firstElementChild as HTMLElement).dataset.code)); }
  });
  list.addEventListener('click', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('[data-code]'); if (li) pick(Number(li.dataset.code)); });
  list.addEventListener('keydown', (e) => {
    const li = e.target as HTMLElement;
    if (e.key === 'ArrowDown') { e.preventDefault(); (li.nextElementSibling as HTMLElement | null)?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); ((li.previousElementSibling as HTMLElement | null) ?? input).focus(); }
    if (e.key === 'Enter') { e.preventDefault(); pick(Number(li.dataset.code)); input.focus(); }
  });
  panel.querySelectorAll<HTMLButtonElement>('.dk-picks [data-code]').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.code))));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const code = Number(input.dataset.code);
    const d = DISTRICTS.find((x) => x.code === code) ?? findDistricts(input.value.split(',')[0], 1)[0];
    if (!d) { input.setCustomValidity(T('district_ph')); input.reportValidity(); input.setCustomValidity(''); return; }
    const langs = fd.getAll('langs').map(String).filter((l): l is DLang => l === 'en' || l === 'hi' || l === 'te');
    const crew = Number(fd.get('crew'));
    saveSite({ name: String(fd.get('name') || '').trim(), code: d.code, district: d.name, state: d.state, lat: d.lat, lon: d.lon, langs: langs.length ? langs : ['en'], supervisor: String(fd.get('supervisor') || '').trim(), crew: crew > 0 ? crew : null });
    render();
    const saved = $('.dk-saved', panel);
    if (saved) saved.textContent = T('saved');
    window.dispatchEvent(new CustomEvent('nayan:site', { detail: getSite() }));
  });
  $('[data-fly]', panel)?.addEventListener('click', () => { const s = getSite(); if (s) window.dispatchEvent(new CustomEvent('nayan:fly-site', { detail: s })); });
  wireRows(panel);
}

function row(a: Signal, site: Site | null) {
  const L = desk.lang;
  const S = summarise(a, L, site?.district ?? '');
  const sev = capTerm(L, 'severity', a.severity)[0], urg = capTerm(L, 'urgency', a.urgency)[0], cert = capTerm(L, 'certainty', a.certainty)[0];
  const left = desk.practice ? T('practice_tag') : a.expires ? `${T('until', { t: at(a.expires, L) })} · ${timeLeft(a.expires, L)}` : '';
  const where = a.areaLevel === 'sub-district' ? (a.area ?? '') : (a.districts?.length ? `${a.districts.slice(0, 3).join(', ')}${a.districts.length > 3 ? ` +${a.districts.length - 3}` : ''}` : a.area ?? a.state ?? '');
  const id = esc(a.id);
  return `<li class="dk-row" data-sev="${esc(a.severity ?? 'Unknown')}"><button type="button" data-open="${id}">
    <i class="nx-sev" aria-hidden="true"></i>
    <span class="dk-row-main"><b>${esc(S.what)}</b><span class="dk-row-where">${esc(where)}${a.state && a.areaLevel !== 'sub-district' ? ` · ${esc(a.state)}` : ''}</span>
      <span class="dk-row-meta"><span>${esc((a.sender ?? '').replace(/[-_]/g, ' '))}</span><span title="${esc(T('sev'))}">${esc(sev)}</span><span title="${esc(T('urg'))}">${esc(urg)}</span><span title="${esc(T('cert'))}">${esc(cert)}</span>${a.msgType === 'Update' ? `<span class="dk-tag">${esc(T('update'))}</span>` : ''}${a.areaLevel === 'sub-district' ? `<span class="dk-tag">${esc(T('mandal_level'))}</span>` : ''}${covers(a, site) ? `<span class="dk-tag is-site">${esc(T('covers_site'))}</span>` : ''}</span>
    </span>
    <time>${esc(left)}</time></button></li>`;
}

function alertsView() {
  const site = getSite();
  const all = activeAlerts().slice().sort((x, y) => sent(y) - sent(x));
  const mine = site ? all.filter((a) => covers(a, site)) : [];
  const rest = all.filter((a) => !mine.includes(a));
  const f = desk.feed;
  const unknown = !desk.practice && f.status === 'failed';
  const head = `<header class="dk-head"><p class="dk-eyebrow">02 · NDMA SACHET</p><h2 id="dk-h" tabindex="-1">${esc(T('alerts_title'))}</h2>${feedLine()}
      <div class="dk-actions"><button type="button" class="dk-btn is-small" data-practice aria-pressed="${desk.practice}">${esc(desk.practice ? T('live_alerts') : T('practice'))}</button></div>
    </header>`;
  // Before the first answer from SACHET there is nothing to say about any district.
  if (waiting()) return `<section class="dk-view" aria-labelledby="dk-h">${head}</section>`;
  return `<section class="dk-view" aria-labelledby="dk-h">
    ${head}
    ${site ? `<h3 class="dk-h3">${esc(T('for_d', { d: site.district }))}</h3>${unknown ? `<p class="dk-status is-err">${esc(T('status_unknown', { d: site.district }))}</p>` : mine.length ? `<ul class="dk-rows">${mine.map((a) => row(a, site)).join('')}</ul>` : `<p class="dk-muted">${esc(T('none_here', { d: site.district }))}</p>`}` : `<p class="dk-muted"><button type="button" class="dk-link" data-go="site">${esc(T('no_site'))}</button></p>`}
    <h3 class="dk-h3">${esc(T('elsewhere'))}</h3>
    ${unknown ? '' : rest.length ? `<ul class="dk-rows">${rest.map((a) => row(a, site)).join('')}</ul>` : `<p class="dk-muted">${esc(desk.practice ? '' : T('none_india'))}</p>`}
  </section>`;
}

function wireRows(scope: ParentNode) {
  scope.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => {
    const a = activeAlerts().find((x) => x.id === b.dataset.open);
    if (!a) return;
    scope.querySelectorAll('.dk-row.is-on').forEach((x) => x.classList.remove('is-on'));
    b.closest('.dk-row')?.classList.add('is-on');
    openCard(a, { practice: desk.practice });
    if (!desk.practice) window.dispatchEvent(new CustomEvent('nayan:open-signal', { detail: a }));
  }));
}

function wireAlerts() {
  wireRows(panel);
  $('[data-retry]', panel)?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('nayan:reload-india')));
  $('[data-go]', panel)?.addEventListener('click', () => go('site'));
  $('[data-practice]', panel)?.addEventListener('click', async () => {
    if (!desk.practice && !desk.practiceAlerts.length) {
      try {
        const r = await fetch('/practice.json');
        const j = await r.json();
        desk.practiceAlerts = j.alerts as Signal[];
        desk.practiceSaved = j.saved;
      } catch { return; }
    }
    desk.practice = !desk.practice;
    root.classList.toggle('dk-practising', desk.practice);
    render();
  });
}

function logView() {
  const rows = getLog();
  const L = desk.lang;
  return `<section class="dk-view" aria-labelledby="dk-h">
    <header class="dk-head"><p class="dk-eyebrow">03 · ${esc(T('nav_log'))}</p><h2 id="dk-h" tabindex="-1">${esc(T('log_title'))}</h2><p class="dk-lede">${esc(T('log_lede'))}</p></header>
    ${rows.length ? `<ol class="dk-log">${rows.map((r) => `<li${r.practice ? ' class="is-practice"' : ''}>
      <p class="dk-log-t"><time>${esc(at(r.at, L))}</time>${r.practice ? ` <span class="dk-tag">${esc(T('log_practice'))}</span>` : ''}</p>
      <p><b>${esc(r.event)}</b> · ${esc(r.sender)} · ${esc(capTerm(L, 'severity', r.severity)[0])}</p>
      <p class="dk-muted">${esc([r.site, r.district].filter(Boolean).join(', '))} · ${esc(r.langs.map((l) => LANG_NAMES[l].native).join(', '))} · ${esc(r.channels.join(', '))}${r.count ? ` · ${r.count}` : ''}${r.supervisor ? ` · ${esc(r.supervisor)}` : ''}</p>
      ${r.note ? `<p class="dk-muted">${esc(r.note)}</p>` : ''}
      <p class="dk-muted dk-mono">${esc(r.alertId)}</p></li>`).join('')}</ol>
      <div class="dk-actions"><button type="button" class="dk-btn is-solid" data-export>${esc(T('export'))}</button><button type="button" class="dk-btn" data-clear>${esc(T('clear'))}</button></div>`
      : `<p class="dk-muted">${esc(T('log_empty'))}</p>`}
    <p class="dk-muted dk-privacy">${esc(T('privacy'))}</p>
  </section>`;
}

function wireLog() {
  $('[data-export]', panel)?.addEventListener('click', () => {
    const blob = new Blob([toCSV(getLog())], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nayan-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $('[data-clear]', panel)?.addEventListener('click', () => { if (confirm(T('clear_q'))) { clearLog(); render(); } });
}

/** Called by the card after a log entry is saved, so the Log key shows the new count. */
export const refreshHeader = () => paintHeader();
export const currentCard = () => cardSignal();
