import '@fontsource-variable/science-gothic/full.css';
import '@fontsource-variable/mona-sans/wdth.css';
import '@fontsource/monaspace-krypton/400.css';
import '@fontsource/monaspace-krypton/600.css';
import './style.css';
import * as THREE from 'three';
import { Stage } from './stage';
import { HoloModel, type Hologram } from './model';
import { LIBRARY, type LibraryEntry } from './library';
import { ui } from './ui';
import { applyCss, theme } from './theme';
import { GestureControl } from './gestures';
import { ask, listen, refreshStatus } from './agent';
import { ScanModel, identify } from './scan';
import { buildPlace, fetchPlace, sunDirection, type PlaceData } from './places';
import { LANDMARKS, type Landmark } from './landmarks';
import type { EarthAuth } from './earth';

applyCss(theme);

const stage = new Stage(document.getElementById('stage')!);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  entry: null as LibraryEntry | null,
  explodeTarget: 0,
  loading: false,
};

const explodeInput = $('explode') as HTMLInputElement;

// ---------- library shelf ----------
const shelf = $('shelf');
for (const e of LIBRARY) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.id = e.id;
  b.innerHTML = `<span class="t">${e.title}</span><span class="k">${e.kind}</span>`;
  b.addEventListener('click', () => loadEntry(e));
  shelf.appendChild(b);
}

async function loadEntry(e: LibraryEntry) {
  if (state.loading || state.entry?.id === e.id) return;
  state.loading = true;
  shelf.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', (b as HTMLElement).dataset.id === e.id));
  ui.log(`loading ${e.title.toLowerCase()}`, 'sys');
  try {
    const m = await HoloModel.load(e.url);
    state.entry = e;
    stage.setModel(m);
    stage.frame('object');
    setExplode(0);
    ui.closeCard();
    setTitle(e.title);
    $('model-kind').textContent = e.kind;
    $('parts-n').textContent = String(m.parts.length);
    $('credit').textContent = `Model: ${e.credit} · ${e.licence}`;
    labels.rebuild(m);
    ui.log(`${m.parts.length} parts ready`, 'sys');
  } catch (err) {
    console.error(err);
    ui.log(`could not load ${e.title}`, 'hot');
  } finally {
    state.loading = false;
  }
}

// ---------- explode ----------
function setExplode(v: number) {
  state.explodeTarget = Math.max(0, Math.min(1, v));
  explodeInput.value = String(state.explodeTarget);
}
explodeInput.addEventListener('input', () => { state.explodeTarget = Number(explodeInput.value); });

// ---------- picking with mouse / touch ----------
const canvas = stage.renderer.domElement;
let downAt = { x: 0, y: 0, t: 0 };
canvas.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (ev) => {
  const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
  if (moved > 6 || performance.now() - downAt.t > 400) return;
  const i = pickAt(ev.clientX, ev.clientY);
  if (i >= 0) focusPart(i); else unfocus();
});
canvas.addEventListener('pointermove', (ev) => {
  if (ev.buttons) return;
  stage.model?.setHot(pickAt(ev.clientX, ev.clientY));
});

function pickAt(x: number, y: number): number {
  const m = stage.model;
  if (!m) return -1;
  const r = canvas.getBoundingClientRect();
  return m.pick(stage.rayFrom(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1));
}

export function focusPart(i: number) {
  const m = stage.model;
  if (!m || i < 0 || i >= m.parts.length) return;
  m.setFocus(i);
  if (state.explodeTarget < 0.6) setExplode(0.8);
  const p = m.parts[i];
  const role = partRole(i);
  const src = mode === 'places' && place ? place.facts.find((x) => x.name.toLowerCase() === p.name.toLowerCase())?.source : undefined;
  ui.openCard({ index: i + 1, total: m.parts.length, title: p.name, body: role ? `${role}. Ask anything about it.` : 'Ask what this part does, or what happens if it fails.', sources: src ? [src] : [] });
}

function unfocus() {
  stage.model?.setFocus(-1);
  ui.closeCard();
}
document.getElementById('card-close')!.addEventListener('click', unfocus);
window.addEventListener('keydown', (ev) => {
  if ((ev.target as HTMLElement).tagName === 'INPUT') return;
  if (ev.key === 'Escape') unfocus();
  if (ev.key.toLowerCase() === 'e') setExplode(state.explodeTarget > 0.5 ? 0 : 1);
});

// ---------- part labels ----------
const labels = (() => {
  const host = $('labels');
  let tags: HTMLElement[] = [];
  const v = new THREE.Vector3();
  return {
    rebuild(m: Hologram) {
      host.replaceChildren();
      tags = m.parts.map((p, i) => {
        const el = document.createElement('div');
        el.className = 'tag';
        el.innerHTML = `<i>${String(i + 1).padStart(2, '0')}</i><span></span>`;
        el.querySelector('span')!.textContent = p.name;
        host.appendChild(el);
        return el;
      });
    },
    update(explode: number) {
      const m = stage.model;
      if (!m) return;
      const showAll = explode > 0.35;
      const named = m.parts.length <= 14;
      m.parts.forEach((_, i) => {
        const el = tags[i];
        if (!el) return;
        const focused = m.focused === i;
        const visible = showAll || focused;
        if (!visible) { el.style.opacity = '0'; return; }
        const s = stage.project(m.anchor(i, v));
        if (!s) { el.style.opacity = '0'; return; }
        el.style.opacity = m.focused >= 0 && !focused ? '0.25' : String(Math.min(1, (explode - 0.35) * 4 + (focused ? 1 : 0)));
        el.style.left = `${s.x}px`;
        el.style.top = `${s.y}px`;
        el.classList.toggle('hot', focused);
        el.classList.toggle('named', named && explode > 0.7);
      });
    },
  };
})();

// ---------- frame loop ----------
stage.onFrame = (dt) => {
  const m = stage.model;
  if (!m) return;
  m.explode += (state.explodeTarget - m.explode) * Math.min(1, dt * 5);
  stage.framing = m.explode;
  labels.update(m.explode);
};

// ---------- boot ----------
ui.log('ATLAS online', 'sys');
refreshStatus();
loadEntry(LIBRARY[0]);

// Expose a small handle for the hand controller and agent modules.
export const app = { stage, setExplode, focusPart, unfocus, get explode() { return state.explodeTarget; }, get entry() { return state.entry; } };
(window as unknown as { atlas: typeof app }).atlas = app;

// ---------- hands ----------
const gestures = new GestureControl(app);
const handsBtn = document.getElementById('hands-btn')!;
handsBtn.addEventListener('click', async () => {
  const on = await gestures.toggle();
  handsBtn.classList.toggle('on', on);
  handsBtn.setAttribute('aria-pressed', String(on));
  document.getElementById('hands-label')!.textContent = on ? 'Hands on' : 'Use hands';
});
export { gestures };

// ---------- ask (text + voice) ----------
const agentCtx = {
  machine: () => (earthActive && currentLandmark) ? `${currentLandmark.name}, ${currentLandmark.city} (a real place, shown in 3D)` : state.entry ? `${state.entry.title} (${state.entry.kind})` : 'machine',
  parts: () => earthActive ? [] : stage.model?.parts.map((p) => p.name) || [],
  focused: () => stage.model?.focused ?? -1,
  focusPart,
  setExplode,
};
const askForm = document.getElementById('ask') as HTMLFormElement;
const askInput = document.getElementById('ask-input') as HTMLInputElement;
askForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = askInput.value.trim();
  if (!q) return;
  askInput.value = '';
  ask(q, agentCtx);
});
const mic = document.getElementById('mic')!;
let stopListening: (() => void) | null = null;
mic.addEventListener('click', () => {
  if (stopListening) { stopListening(); return; }
  mic.setAttribute('aria-pressed', 'true');
  askInput.placeholder = 'Listening';
  stopListening = listen(
    (t) => { askInput.value = t; },
    () => {
      mic.setAttribute('aria-pressed', 'false');
      askInput.placeholder = 'Ask about this machine';
      stopListening = null;
      const q = askInput.value.trim();
      if (q) { askInput.value = ''; ask(q, agentCtx); }
    },
  );
  if (!stopListening) mic.setAttribute('aria-pressed', 'false');
});


// ---------- modes ----------
type Mode = 'library' | 'scan' | 'places';
let mode: Mode = 'library';
export const currentMode = () => mode;
const scanPanel = document.getElementById('scan-panel') as HTMLElement;
const intro = document.getElementById('intro') as HTMLElement;
document.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as Mode)));

function setMode(m: Mode) {
  mode = m;
  document.body.className = `mode-${m}`;
  document.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) => {
    const on = b.dataset.mode === m;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  shelf.hidden = m !== 'library';
  scanPanel.hidden = m !== 'scan' || scanned;
  intro.hidden = m === 'scan' && !scanned;
  if (m === 'library' && state.entry === null) loadEntry(LIBRARY[0]);
  if (m === 'library' && scanned && state.entry) { const e = state.entry; state.entry = null; loadEntry(e); }
  if (m !== 'places' && sunLine) { stage.pivot.remove(sunLine); sunLine.geometry.dispose(); sunLine = null; }
  if (m !== 'places') exitEarth();
  placePanel.hidden = m !== 'places';
  sunBox.hidden = m !== 'places' || !place || earthActive;
  if (m === 'places') enterPlaces();
}

// ---------- scan ----------
let scanned = false;
const scanStatus = document.getElementById('scan-status')!;
const captureBtn = document.getElementById('scan-capture') as HTMLButtonElement;
captureBtn.addEventListener('click', async () => {
  if (!gestures.enabled) {
    const on = await gestures.toggle();
    if (!on) return;
    handsBtn.classList.add('on');
    document.getElementById('hands-label')!.textContent = 'Hands on';
    scanStatus.textContent = 'Camera on. Hold the object up, then press capture again.';
    return;
  }
  const frame = gestures.camera.snapshot();
  if (frame) runScan(frame);
});
(document.getElementById('scan-file') as HTMLInputElement).addEventListener('change', (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => downscale(String(r.result)).then(runScan);
  r.readAsDataURL(f);
});

async function downscale(dataUrl: string, maxSide = 1024): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

async function runScan(image: string) {
  captureBtn.disabled = true;
  const step = (t: string) => { scanStatus.textContent = t; };
  try {
    step('nemotron is identifying the object');
    ui.log('scan captured', 'sys');
    const [scan] = await Promise.all([identify(image)]);
    if (scan) {
      ui.log(`identified: ${scan.object}`, 'tool');
      ui.log(`${scan.parts.length} parts located`, 'tool');
    } else {
      ui.log('could not identify the object, building the shape anyway', 'hot');
    }
    const m = await ScanModel.build(image, scan, step);
    stage.setModel(m);
    stage.frame('scan');
    stage.userZoomed = false;
    scanned = true;
    state.entry = null;
    setExplode(0);
    ui.closeCard();
    intro.hidden = false;
    scanPanel.hidden = true;
    setTitle(scan?.object || 'Scanned object');
    $('model-kind').textContent = scan ? `Scanned · ${scan.category}` : 'Scanned · unidentified';
    $('parts-n').textContent = String(m.parts.length);
    $('credit').textContent = `Scanned live · depth: Depth Anything V2 · identified by ${scan?.model || 'nobody (offline)'}`;
    labels.rebuild(m);
    scanRoles = m.roles;
    step(scan?.summary || 'Done. Open your palm or drag the slider to pull it apart.');
    setTimeout(() => setExplode(0.75), 900);
  } catch (err) {
    console.error(err);
    step('Scan failed. Try again with the object closer and better lit.');
  } finally {
    captureBtn.disabled = false;
  }
}
let scanRoles: string[] = [];
export function partRole(i: number) {
  if (mode === 'places' && place) {
    const name = stage.model?.parts[i]?.name || '';
    const f = place.facts.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return f ? f.fact.replace(/\.$/, '') : '';
  }
  return scanned ? scanRoles[i] || '' : '';
}

function setTitle(t: string) {
  const h = $('model-title');
  h.textContent = t;
  h.classList.toggle('long', t.length > 22);
}
document.getElementById('rescan')!.addEventListener('click', () => {
  scanPanel.hidden = false;
  intro.hidden = true;
  scanStatus.textContent = '';
});

// ---------- places ----------
let place: PlaceData | null = null;
const placePanel = document.getElementById('place-panel') as HTMLElement;
const placeStatus = document.getElementById('place-status')!;
const sunBox = document.getElementById('sun') as HTMLElement;
const sunInput = document.getElementById('sun-time') as HTMLInputElement;
let sunLine: THREE.Line | null = null;

(document.getElementById('place-form') as HTMLFormElement).addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = (document.getElementById('place-input') as HTMLInputElement).value.trim();
  if (q) searchPlace(q);
});

async function loadPlace(q: string) {
  placeStatus.textContent = `finding ${q} on OpenStreetMap`;
  ui.log(`place: ${q}`, 'you');
  const slow = setTimeout(() => { placeStatus.textContent = 'pulling building footprints, this can take 20 to 30 seconds the first time'; }, 4000);
  try {
    const d = await fetchPlace(q);
    clearTimeout(slow);
    showPlace(d);
  } catch (err) {
    clearTimeout(slow);
    placeStatus.textContent = err instanceof Error ? err.message : String(err);
  }
}

export function showPlace(d: PlaceData) {
  place = d;
  const { model, exaggeration } = buildPlace(d);
  stage.setModel(model);
  stage.frame('place');
  stage.userZoomed = false;
  state.entry = null;
  setExplode(0);
  ui.closeCard();
  setTitle(d.name);
  $('model-kind').textContent = `Place · ${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}`;
  $('parts-n').textContent = String(model.parts.length);
  $('credit').textContent = `${d.attribution} · heights x${exaggeration}${d.model ? ` · facts by ${d.model} with Tavily` : ''}`;
  labels.rebuild(model);
  ui.log(`${d.features.length} buildings, ${d.facts.length} cited facts`, 'tool');
  for (const f of d.facts.slice(0, 2)) ui.log(`${f.name}: ${f.fact}`, 'answer');
  intro.hidden = false;
  sunBox.hidden = false;
  updateSun();
}

function updateSun() {
  if (!place) return;
  const hours = Number(sunInput.value);
  const now = new Date();
  // Local solar-ish clock: the slider is the place's local time, estimated from longitude.
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + (hours - place.lon / 15) * 3600e3;
  const s = sunDirection(place.lat, place.lon, new Date(utc));
  const hh = Math.floor(hours), mm = Math.round((hours - hh) * 60);
  $('sun-read').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  $('sun-meta').textContent = s.altitudeDeg > 0 ? `Azimuth ${s.azimuthDeg.toFixed(0)}°, altitude ${s.altitudeDeg.toFixed(0)}°` : 'Sun below the horizon';
  if (sunLine) { stage.pivot.remove(sunLine); sunLine.geometry.dispose(); }
  const end = s.dir.clone().multiplyScalar(2.6);
  end.y = Math.max(end.y, 0.02);
  sunLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), end]), new THREE.LineDashedMaterial({ color: getComputedStyle(document.documentElement).getPropertyValue('--signal').trim() || '#ff4fa3', dashSize: 0.06, gapSize: 0.04 }));
  sunLine.computeLineDistances();
  stage.pivot.add(sunLine);
}
sunInput.addEventListener('input', updateSun);
(window as unknown as { atlasPlace: typeof showPlace }).atlasPlace = showPlace;

// ---------- earth: real places in photoreal 3D ----------
let earthAuth: EarthAuth | null | undefined;
let earthActive = false;
let currentLandmark: Landmark | null = null;
let earthStarted = false;
const landmarkList = document.getElementById('landmarks')!;
const placeTag = document.createElement('div');
placeTag.className = 'place-tag';
placeTag.hidden = true;
document.body.appendChild(placeTag);

for (const l of LANDMARKS) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.id = l.id;
  b.innerHTML = `<span class="t"></span><span class="k"></span>`;
  b.querySelector('.t')!.textContent = l.name;
  b.querySelector('.k')!.textContent = l.city;
  b.addEventListener('click', () => selectLandmark(l));
  li.appendChild(b);
  landmarkList.appendChild(li);
}

document.querySelectorAll<HTMLButtonElement>('.look-btn').forEach((b) => b.addEventListener('click', () => {
  const look = b.dataset.look as 'photo' | 'hologram';
  document.querySelectorAll<HTMLButtonElement>('.look-btn').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  stage.earth.setLook(look);
}));

async function getEarthAuth(): Promise<EarthAuth | null> {
  if (earthAuth !== undefined) return earthAuth;
  const debug = new URLSearchParams(location.search).get('tileset');
  if (debug) return (earthAuth = { kind: 'url', url: debug });
  try {
    const j = await (await fetch('/api/status')).json();
    earthAuth = j.earth || null;
  } catch { earthAuth = null; }
  return earthAuth ?? null;
}

async function enterPlaces() {
  const auth = await getEarthAuth();
  if (mode !== 'places') return;
  if (!auth) {
    placeStatus.textContent = 'Photoreal 3D needs the map token on the server. Showing OpenStreetMap builds until then.';
    if (!place) intro.hidden = true;
    return;
  }
  if (!currentLandmark) selectLandmark(LANDMARKS[0]);
  else { earthOn(); }
}

function earthOn() {
  if (earthActive) return;
  earthActive = true;
  document.body.classList.add('earth');
  stage.setEarth(true);
  ($('labels') as HTMLElement).hidden = true;
  sunBox.hidden = true;
}

function exitEarth() {
  if (!earthActive) return;
  earthActive = false;
  earthStarted = false;
  document.body.classList.remove('earth');
  stage.setEarth(false);
  ($('labels') as HTMLElement).hidden = false;
  placeTag.hidden = true;
  if (state.entry) { setTitle(state.entry.title); $('model-kind').textContent = state.entry.kind; $('credit').textContent = `Model: ${state.entry.credit} · ${state.entry.licence}`; }
  else if (!scanned) loadEntry(LIBRARY[0]);
}

async function selectLandmark(l: Landmark) {
  landmarkList.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', (b as HTMLElement).dataset.id === l.id));
  const auth = await getEarthAuth();
  if (!auth) { loadPlace(`${l.name}, ${l.city}`); return; }
  currentLandmark = l;
  earthOn();
  ui.closeCard();
  intro.hidden = false;
  setTitle(l.name);
  $('model-kind').textContent = `${l.city} · ${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}`;
  placeStatus.textContent = `streaming ${l.name} in 3D`;
  ui.log(`flying to ${l.name}`, 'sys');
  placeTag.hidden = true;
  if (!earthStarted) { stage.earth.start(auth, l.lat, l.lon); earthStarted = true; }
  else stage.earth.goTo(l.lat, l.lon);
  stage.earth.setLook((document.querySelector('.look-btn.is-on') as HTMLElement)?.dataset.look as 'photo' | 'hologram' || 'photo');
  // Hold high above until the ground is known, then drop in.
  stage.camera.position.set(l.view * 0.5, 2600 + l.view * 3, l.view * 0.5);
  stage.controls.target.set(0, 0, 0);
  let landed: number | null = null;
  stage.earth.onGround = (y, first) => {
    if (currentLandmark !== l) return;
    placeStatus.textContent = '';
    if (first || landed === null) stage.flyTo(new THREE.Vector3(0, y + l.lift, 0), l.view, true);
    else stage.shiftGround(y - landed);
    landed = y;
  };
  stage.earth.onAttribution = (html) => { $('credit').innerHTML = html; };
  loadFacts(l);
}

async function loadFacts(l: Landmark) {
  try {
    const r = await fetch('/api/facts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: l.name, city: l.city }) });
    const j = await r.json();
    if (currentLandmark !== l || !j.facts?.length) return;
    ui.openCard({ index: 1, total: 1, title: l.name, body: j.facts.map((f: { fact: string }) => f.fact).join(' '), sources: j.facts.map((f: { source?: { title: string; url: string } }) => f.source).filter(Boolean) });
    $('card-index').textContent = l.city.toUpperCase();
  } catch { /* facts are a bonus; the place still shows */ }
}

async function searchPlace(q: string) {
  const auth = await getEarthAuth();
  if (!auth) { loadPlace(q); return; }
  placeStatus.textContent = `finding ${q}`;
  try {
    const r = await fetch('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
    const g = await r.json();
    if (!r.ok || g.error) throw new Error(g.error || 'not found');
    const parts = String(g.name).split(',');
    selectLandmark({ id: `q-${Date.now()}`, name: parts[0].trim(), city: parts.slice(1).join(',').trim() || q, lat: g.lat, lon: g.lon, view: 450, lift: 20 });
  } catch (err) {
    placeStatus.textContent = err instanceof Error ? err.message : String(err);
  }
}

// Keep the place marker pinned over the landmark.
const prevFrame = stage.onFrame;
stage.onFrame = (dt, t) => {
  prevFrame?.(dt, t);
  if (!earthActive || !currentLandmark || stage.earth.ground === null) { placeTag.hidden = true; return; }
  const s = stage.project(new THREE.Vector3(0, stage.earth.ground + currentLandmark.lift * 1.7, 0));
  if (!s) { placeTag.hidden = true; return; }
  placeTag.hidden = false;
  placeTag.textContent = currentLandmark.name;
  placeTag.style.left = `${s.x}px`;
  placeTag.style.top = `${s.y}px`;
};
