// Nayan desk: the saffron honeycomb skin over the existing app.
// It adds a hexagon field behind the globe, numbers the station keys, puts an IST clock and the
// feed lamps in the header, groups the alert panel into numbered cells, and adds the alert
// board. Every lamp and number reports something real on this page; nothing is decoration.
import './nayan.css';
import type { Signal, LayerStatus } from '../signals';

const root = document.documentElement;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};

type Layer = { status: LayerStatus; error?: string; data?: { signals: Signal[]; updated: string } };
const SEV_ORDER: Record<string, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };
const STATIONS: Record<string, { n: string; name: string }> = {
  places: { n: '01', name: 'Alerts' },
  build: { n: '02', name: 'Build' },
  library: { n: '03', name: 'Library' },
  scan: { n: '04', name: 'Scan' },
};

/** The mark: an eye (nayan) drawn inside a hexagon. */
export const EYE_SVG = `<svg class="nx-eye" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 2.5 35.2 11.25v17.5L20 37.5 4.8 28.75v-17.5Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 20c3.2-5.4 7.1-8 11.5-8s8.3 2.6 11.5 8c-3.2 5.4-7.1 8-11.5 8s-8.3-2.6-11.5-8Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="20" cy="20" r="4.2" fill="currentColor"/></svg>`;

let board: HTMLOListElement;
let boardNote: HTMLElement;
let boardCount: HTMLElement;
const lamps: Record<string, HTMLElement> = {};

export function initNayanConsole() {
  root.dataset.nayan = '';
  buildField();
  buildHeader();
  buildPanel();
  buildBoard();
  watchMode();
  watchSignals();
  watchAi();
  startClock();
}

// A hexagon lattice behind the globe, brightest toward the edges of the screen.
function buildField() {
  const f = h('div', 'nx-field');
  f.setAttribute('aria-hidden', 'true');
  document.body.prepend(f);
}

function buildHeader() {
  const bar = document.querySelector<HTMLElement>('.bar')!;
  const mark = bar.querySelector<HTMLElement>('.mark');
  mark?.insertAdjacentHTML('afterbegin', EYE_SVG);
  bar.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) => {
    const s = STATIONS[b.dataset.mode!];
    if (!s) return;
    b.innerHTML = `<span class="nx-n">${s.n}</span><span>${s.name}</span>`;
  });

  const rail = h('div', 'nx-rail');
  const clock = h('div', 'nx-clock');
  clock.innerHTML = '<span class="nx-k">IST</span><b id="nx-ist">--:--:--</b>';
  const feeds = h('div', 'nx-feeds');
  feeds.setAttribute('role', 'group');
  feeds.setAttribute('aria-label', 'Feeds');
  for (const [k, label, tip] of [['sachet', 'SACHET', 'NDMA SACHET alert feed'], ['usgs', 'USGS', 'USGS earthquake feed'], ['ai', 'AI', 'A model is live on the server']] as const) {
    const l = h('span', 'nx-lamp');
    l.dataset.state = 'off';
    l.dataset.tip = tip;
    l.title = `${tip}: off`;
    l.innerHTML = `<i></i>${label}`;
    lamps[k] = l;
    feeds.append(l);
  }
  const focus = h('button', 'nx-key nx-focus') as HTMLButtonElement;
  focus.type = 'button';
  focus.innerHTML = '<span>Focus</span><kbd>T</kbd>';
  focus.title = 'Hide the panels and give the screen to the globe (key T)';
  focus.setAttribute('aria-pressed', 'false');
  focus.addEventListener('click', () => setFocus(!root.classList.contains('nx-focused')));
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 't' && e.key !== 'T') || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable], dialog[open]')) return;
    e.preventDefault();
    setFocus(!root.classList.contains('nx-focused'));
  });
  rail.append(feeds, clock, focus);
  bar.append(rail);
}

function setFocus(on: boolean) {
  root.classList.toggle('nx-focused', on);
  document.querySelector('.nx-focus')?.setAttribute('aria-pressed', String(on));
  const label = document.querySelector('.nx-focus span');
  if (label) label.textContent = on ? 'Panels' : 'Focus';
  if (on) (document.getElementById('card-close') as HTMLButtonElement | null)?.click();
}

// The alert panel, grouped into numbered cells. Nodes move, so their listeners come with them.
function buildPanel() {
  const panel = $('place-panel');
  if (!panel) return;
  panel.classList.add('nx-panel');
  const take = (sel: string) => panel.querySelector<HTMLElement>(sel);
  const head = h('header', 'nx-head');
  for (const sel of ['.eyebrow', '.lede-head', '.lede']) { const el = take(sel); if (el) head.append(el); }

  const cell = (n: string, title: string, ...els: (HTMLElement | null)[]) => {
    const c = h('section', 'nx-cell');
    const t = h('h3', 'nx-h');
    t.innerHTML = `<i class="nx-hx" aria-hidden="true"></i><span class="nx-n">${n}</span>`;
    t.append(title);
    c.append(t, ...els.filter((x): x is HTMLElement => !!x));
    return c;
  };
  const sigHead = take('.sig-head');
  sigHead?.querySelector('.eyebrow')?.remove();
  const sys = h('div', 'nx-sys');
  for (const sel of ['.theme-switch', '#sound-btn', '#hands-btn', '#agent-chip']) { const el = document.querySelector<HTMLElement>(sel); if (el) sys.append(el); }
  const nodes = {
    signals: [sigHead, take('#signals')],
    place: [take('#place-form')],
    lens: [take('#lenses')],
    actions: [take('.place-actions'), take('#landmarks'), take('#place-status')],
  };
  panel.replaceChildren(
    head,
    cell('01', 'Live signals', ...nodes.signals),
    cell('02', 'Go to a place', ...nodes.place),
    cell('03', 'Lens', ...nodes.lens),
    cell('04', 'Actions', ...nodes.actions),
    cell('05', 'System', sys),
  );
}

// ---------------------------------------------------------------------------
// Alert board: every NDMA SACHET alert in force, most severe first
// ---------------------------------------------------------------------------
let items: Signal[] = [];
let last: Layer | null = null;
function buildBoard() {
  const b = h('section', 'nx-board');
  b.id = 'nx-board';
  b.setAttribute('aria-label', 'Alerts in force');
  b.innerHTML = '<header><div><span class="nx-k">NDMA SACHET · in force now</span><h2>Alert board</h2></div><b class="nx-count" id="nx-count">--</b></header>';
  board = h('ol', 'nx-rows') as HTMLOListElement;
  boardNote = h('p', 'nx-note', 'Loading the official alerts…');
  b.append(board, boardNote);
  document.body.append(b);
  boardCount = $('nx-count')!;
  board.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]');
    const s = li ? items[Number(li.dataset.i)] : null;
    if (!li || !s) return;
    board.querySelectorAll('.is-on').forEach((x) => x.classList.remove('is-on'));
    li.classList.add('is-on');
    window.dispatchEvent(new CustomEvent('nayan:open-signal', { detail: s }));
  });
  board.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).matches('li[data-i]')) { e.preventDefault(); (e.target as HTMLElement).click(); }
  });
  // Alerts expire: repaint the time left once a minute.
  setInterval(() => { if (last) paintBoard(last); }, 60e3);
}

function timeLeft(iso?: string) {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'expired';
  const hrs = Math.floor(ms / 36e5);
  return hrs >= 1 ? `${hrs} h left` : `${Math.max(1, Math.round(ms / 6e4))} min left`;
}

function paintBoard(india: Layer) {
  last = india;
  if (india.status === 'failed') {
    boardCount.textContent = '!';
    boardNote.hidden = false;
    boardNote.textContent = `The SACHET feed did not answer (${india.error ?? 'error'}). Switch India alerts off and on to retry.`;
    board.replaceChildren();
    return;
  }
  if (!india.data) { boardNote.hidden = false; boardNote.textContent = india.status === 'loading' ? 'Loading the official alerts…' : 'Switch India alerts on in 01.'; return; }
  items = india.data.signals.slice().sort((a, b) => (SEV_ORDER[a.severity ?? ''] ?? 4) - (SEV_ORDER[b.severity ?? ''] ?? 4) || Date.parse(a.expires ?? a.time) - Date.parse(b.expires ?? b.time));
  boardCount.textContent = String(items.length).padStart(2, '0');
  boardNote.hidden = items.length > 0;
  if (!items.length) boardNote.textContent = 'No alert is in force right now.';
  board.replaceChildren(...items.map((s, i) => {
    const li = h('li', 'nx-row');
    li.dataset.i = String(i);
    li.dataset.sev = s.severity ?? 'Unknown';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    const where = s.area || s.districts?.slice(0, 3).join(', ') || '';
    li.innerHTML = '<i class="nx-sev" aria-hidden="true"></i><span class="nx-what"><b></b><small></small></span><time></time>';
    li.querySelector('b')!.textContent = where || s.title;
    li.querySelector('small')!.textContent = `${s.severity ?? 'Unrated'} · ${s.sender ?? 'issuing authority'}`;
    li.querySelector('time')!.textContent = timeLeft(s.expires);
    li.title = s.title;
    return li;
  }));
}

// ---------------------------------------------------------------------------
// State binding
// ---------------------------------------------------------------------------
function watchMode() {
  const paint = (m: string) => { root.dataset.desk = m; };
  window.addEventListener('nayan:mode', (e) => paint((e as CustomEvent<string>).detail));
  paint('places');
}

function setLamp(k: string, state: 'off' | 'busy' | 'ok' | 'err') {
  const l = lamps[k];
  if (!l) return;
  l.dataset.state = state;
  l.title = `${l.dataset.tip}: ${state === 'ok' ? 'live' : state === 'busy' ? 'loading' : state === 'err' ? 'failed' : 'off'}`;
}

function watchSignals() {
  const st = (l: Layer) => (l.status === 'ok' ? 'ok' : l.status === 'loading' ? 'busy' : l.status === 'failed' ? 'err' : 'off');
  window.addEventListener('nayan:signals', (e) => {
    const d = (e as CustomEvent<{ india: Layer; quakes: Layer }>).detail;
    setLamp('sachet', st(d.india));
    setLamp('usgs', st(d.quakes));
    paintBoard(d.india);
  });
}

function watchAi() {
  const chip = $('agent-chip');
  if (!chip) return;
  const paint = () => setLamp('ai', chip.classList.contains('ok') ? 'ok' : 'off');
  new MutationObserver(paint).observe(chip, { attributes: true, attributeFilter: ['class'] });
  paint();
}

function startClock() {
  const el = $('nx-ist')!;
  const two = (n: number) => String(n).padStart(2, '0');
  const tick = () => {
    const t = new Date(Date.now() + 5.5 * 3600e3);
    el.textContent = `${two(t.getUTCHours())}:${two(t.getUTCMinutes())}:${two(t.getUTCSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}
