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
import { LENSES, type Lens } from './lens';
import { toHologram, applyFixes, type BuiltPart } from './construct';
import { loadSplat, disposeSplat } from './splat';

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
  // A place link opens straight into Places: the library model loads quietly behind it.
  if (!/[?&](place|at)=/.test(location.search) || state.entry) ui.log(`loading ${e.title.toLowerCase()}`, 'sys');
  try {
    const m = await HoloModel.load(e.url);
    // Opened straight into another mode (a ?place= link, say): don't let a late library model take over.
    // Library loads it again on entry.
    if (mode !== 'library') { shelf.querySelectorAll('button').forEach((b) => b.classList.remove('is-on')); return; }
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
  machine: () => (mode === 'build' && built) ? `${built.name} (a 3D model ATLAS built from research; parts are the model's sections)` : (earthActive && currentLandmark) ? `${currentLandmark.name}, ${currentLandmark.city} (a real place, shown in 3D)` : state.entry ? `${state.entry.title} (${state.entry.kind})` : 'machine',
  parts: () => earthActive ? [] : stage.model?.parts.map((p) => p.name) || [],
  focused: () => stage.model?.focused ?? -1,
  focusPart,
  setExplode,
  mode: () => (earthActive ? 'earth' : 'object') as 'earth' | 'object',
  flyTo: (place: string) => {
    const q = place.toLowerCase();
    const head = q.split(',')[0].trim();
    const preset = LANDMARKS.find((l) => q.includes(l.name.toLowerCase()) || (head.length >= 5 && l.name.toLowerCase().includes(head)));
    if (preset) selectLandmark(preset); else searchPlace(place);
  },
  setLens: (l: string) => { if (LENSES.some((x) => x.id === l)) setLens(l as Lens); },
  isolate: (on: boolean) => setIsolate(on),
  orbit: (speed: number) => {
    stage.controls.autoRotate = speed !== 0;
    stage.orbitSpeed = THREE.MathUtils.clamp(speed, -3, 3) * 0.35;
  },
};
const askForm = document.getElementById('ask') as HTMLFormElement;
const askInput = document.getElementById('ask-input') as HTMLInputElement;
const askHint = () => (earthActive ? 'Ask ATLAS: "take me to Big Ben, thermal"' : 'Ask about this machine');
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
      askInput.placeholder = askHint();
      stopListening = null;
      const q = askInput.value.trim();
      if (q) { askInput.value = ''; ask(q, agentCtx); }
    },
  );
  if (!stopListening) mic.setAttribute('aria-pressed', 'false');
});


// ---------- modes ----------
type Mode = 'library' | 'scan' | 'places' | 'build';
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
  intro.hidden = (m === 'scan' && !scanned) || (m === 'build' && !built);
  buildPanel.hidden = m !== 'build';
  if (m === 'build' && built && stage.model !== built.model) showBuilt();
  if (m === 'library' && state.entry === null) loadEntry(LIBRARY[0]);
  if (m === 'library' && (scanned || built) && state.entry) { const e = state.entry; state.entry = null; loadEntry(e); }
  if (m !== 'places' && sunLine) { stage.pivot.remove(sunLine); sunLine.geometry.dispose(); sunLine = null; }
  if (m !== 'places') { leaveReconstruction(); exitEarth(); }
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
    step('identifying the object');
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
  if (mode === 'build' && built) {
    const id = (stage.model?.parts[i] as { id?: string } | undefined)?.id;
    return built.parts.find((p) => p.id === id)?.role.replace(/\.$/, '') || '';
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

const GROUP_LABEL: Record<string, string> = { Wonders: 'Wonders of the world', Icons: 'Icons in sharp 3D', India: 'India · coarse Google 3D, rebuilt by ATLAS' };
let lastGroup = '';
for (const l of LANDMARKS) {
  if (l.group && l.group !== lastGroup) {
    lastGroup = l.group;
    const h = document.createElement('li');
    h.className = 'group-head';
    h.textContent = GROUP_LABEL[l.group] || l.group;
    landmarkList.appendChild(h);
  }
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.id = l.id;
  b.innerHTML = `<span class="t"></span><span class="k"></span>`;
  b.querySelector('.t')!.textContent = l.name;
  b.querySelector('.k')!.textContent = l.city;
  if (l.lowDetail) { b.classList.add('low'); b.title = 'Google’s 3D is coarse here'; }
  b.addEventListener('click', () => selectLandmark(l));
  li.appendChild(b);
  landmarkList.appendChild(li);
}

// Lenses: the same world through a different sensor. Keys 1 to 5 while in Places.
let lens: Lens = 'photo';
const lensBox = document.getElementById('lenses')!;
for (const l of LENSES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'look-btn';
  b.dataset.lens = l.id;
  b.title = `${l.label} (key ${l.key})`;
  b.innerHTML = `<span class="lk"></span>`;
  b.firstElementChild!.textContent = l.key;
  b.append(l.label);
  b.addEventListener('click', () => setLens(l.id));
  lensBox.appendChild(b);
}
function setLens(l: Lens) {
  lens = l;
  lensBox.querySelectorAll<HTMLButtonElement>('.look-btn').forEach((x) => { const on = x.dataset.lens === l; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
  document.body.dataset.lens = l;
  stage.earth.setLook(l === 'hologram' ? 'hologram' : 'photo');
  stage.lens.set(earthActive ? l : 'photo');
  if (earthActive) shareState(currentLandmark);
}

/** The URL carries the place and lens, so a shared link lands on exactly this view. */
function shareState(l: Landmark | null) {
  const u = new URL(location.href);
  for (const k of ['place', 'at', 'lens']) u.searchParams.delete(k);
  if (l) {
    if (LANDMARKS.includes(l)) u.searchParams.set('place', l.id);
    else u.searchParams.set('at', `${l.lat.toFixed(5)},${l.lon.toFixed(5)},${l.name}`);
    if (lens !== 'photo') u.searchParams.set('lens', lens);
  }
  history.replaceState(null, '', u);
}
setLens('photo');

// Isolate: cut the landmark out of the city so it floats on the stage as an object.
let isolate = false;
const isoBtn = document.getElementById('iso-btn')!;
function applyIsolate() {
  const l = currentLandmark;
  const on = isolate && earthActive && !!l && !stage.flying && stage.earth.ground !== null;
  stage.setIsolate(on ? (l!.iso ?? l!.view * 0.45) : 0, stage.earth.ground ?? 0);
}
function setIsolate(on: boolean) {
  isolate = on;
  isoBtn.setAttribute('aria-pressed', String(on));
  applyIsolate();
  const l = currentLandmark;
  if (earthActive && l && stage.earth.ground !== null && !stage.flying) {
    const g = stage.earth.ground;
    if (on) stage.frameBlock(l.iso ?? l.view * 0.45, g + l.lift);
    else stage.frameBlock(l.view / 3.1, g + l.lift);
  }
  if (on && earthActive) ui.log('isolated: drag to turn it, scroll to zoom', 'sys');
}
isoBtn.addEventListener('click', () => setIsolate(!isolate));
window.addEventListener('keydown', (e) => {
  if (!earthActive || e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target as HTMLElement | null;
  if (el?.closest?.('input, textarea, [contenteditable]')) return;
  const hit = LENSES.find((x) => x.key === e.key);
  if (hit) { setLens(hit.id); e.preventDefault(); }
  if (e.key === 'i' || e.key === 'I') { setIsolate(!isolate); e.preventDefault(); }
});

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
  if (!earthStarted) selectLandmark(currentLandmark ?? LANDMARKS[0]);
  else earthOn();
}

function earthOn() {
  if (earthActive) return;
  earthActive = true;
  document.body.classList.add('earth');
  stage.setEarth(true);
  stage.lens.set(lens);
  askInput.placeholder = askHint();
  ($('labels') as HTMLElement).hidden = true;
  sunBox.hidden = true;
}

function exitEarth() {
  if (!earthActive) return;
  earthActive = false;
  earthStarted = false;
  originLL = null;
  document.body.classList.remove('earth');
  stage.setEarth(false);
  stage.lens.set('photo');
  askInput.placeholder = askHint();
  shareState(null);
  ($('labels') as HTMLElement).hidden = false;
  placeTag.hidden = true;
  if (state.entry) { setTitle(state.entry.title); $('model-kind').textContent = state.entry.kind; $('credit').textContent = `Model: ${state.entry.credit} · ${state.entry.licence}`; }
  else if (!scanned && mode !== 'build' && !recon) loadEntry(LIBRARY[0]);
}

// ---------- photo reconstructions (Gaussian splats) ----------
let recon: { l: Landmark; root: THREE.Group | null } | null = null;
const reconBtn = document.getElementById('recon-btn') as HTMLButtonElement;
const splatOverride = new URLSearchParams(location.search).get('splat');
function splatFor(l: Landmark | null) {
  if (!l) return null;
  if (splatOverride) return { url: splatOverride, credit: 'preview', photos: 0, rot: undefined as [number, number, number] | undefined };
  return l.splat ?? null;
}
function updateReconBtn() {
  const sp = splatFor(currentLandmark);
  reconBtn.hidden = !sp;
  if (sp) reconBtn.lastChild!.textContent = recon ? 'Back to Google 3D' : `Photo reconstruction${sp.photos ? ` · ${sp.photos} photos` : ''}`;
}
async function showReconstruction(l: Landmark) {
  const sp = splatFor(l);
  if (!sp) return;
  recon = { l, root: null };
  exitEarth();
  document.body.classList.add('recon');
  stage.setModel(null);
  stage.frame('object');
  intro.hidden = false;
  setTitle(l.name);
  $('model-kind').textContent = sp.photos ? `Reconstructed from ${sp.photos} public photos` : 'Photo reconstruction';
  $('parts-n').textContent = '1';
  const credit = $('credit');
  credit.textContent = sp.credit === 'preview' ? 'Preview splat' : `Gaussian splat trained by ATLAS from ${sp.credit} · `;
  if (sp.credit !== 'preview') {
    const a = document.createElement('a');
    a.href = sp.url.replace(/\.splat$/, '.credits.json'); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'photo credits';
    credit.appendChild(a);
  }
  placeStatus.textContent = 'loading the reconstruction';
  ui.log(`loading the photo reconstruction of ${l.name}`, 'sys');
  updateReconBtn();
  try {
    const root = await loadSplat(stage.scene, stage.renderer, { url: sp.url, rot: sp.rot });
    if (recon?.l !== l) { disposeSplat(root); return; }
    recon.root = root;
    stage.pivot.add(root);
    placeStatus.textContent = 'Drag to turn it, scroll to zoom. Press R to go back to Google 3D.';
  } catch (err) {
    placeStatus.textContent = `Could not load the reconstruction (${err instanceof Error ? err.message.slice(0, 80) : 'error'})`;
  }
}
function leaveReconstruction() {
  if (!recon) return;
  disposeSplat(recon.root);
  recon = null;
  document.body.classList.remove('recon');
  updateReconBtn();
}
reconBtn.addEventListener('click', () => {
  if (!currentLandmark) return;
  if (recon) { const l = recon.l; leaveReconstruction(); earthStarted = false; originLL = null; selectLandmark(l); }
  else showReconstruction(currentLandmark);
});
window.addEventListener('keydown', (e) => {
  if (mode !== 'places' || e.metaKey || e.ctrlKey || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
  if ((e.key === 'r' || e.key === 'R') && splatFor(currentLandmark)) reconBtn.click();
});

async function selectLandmark(l: Landmark) {
  if (recon) { leaveReconstruction(); earthStarted = false; originLL = null; }
  landmarkList.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', (b as HTMLElement).dataset.id === l.id));
  const auth = await getEarthAuth();
  if (!auth) { loadPlace(`${l.name}, ${l.city}`); return; }
  currentLandmark = l;
  updateReconBtn();
  earthOn();
  ui.closeCard();
  intro.hidden = false;
  setTitle(l.name);
  $('model-kind').textContent = `${l.city} · ${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}`;
  placeStatus.textContent = `streaming ${l.name} in 3D`;
  ui.log(`flying to ${l.name}`, 'sys');
  placeTag.hidden = true;
  stage.setIsolate(0, 0);
  const look = lens === 'hologram' ? 'hologram' : 'photo';
  // Where the camera lands. Ground readings move it (the dive reads it every frame).
  const land = new THREE.Vector3(0, l.lift, 0);
  // Ground readings only count once the globe is turned to this landmark.
  let arrived = false;
  let landed: number | null = null;
  // Predict the ground before the tiles arrive (elevation above sea level + geoid).
  let predicted: number | null = null;
  const prediction = fetch(`/api/elevation?lat=${l.lat}&lon=${l.lon}`).then((r) => r.json()).then((j) => { if (Number.isFinite(j.ellipsoid)) predicted = j.ellipsoid; }).catch(() => {});
  const whenPredicted = (go: () => void) => Promise.race([prediction, new Promise((r) => setTimeout(r, 2500))]).then(() => { if (currentLandmark === l) go(); });
  const dive = (from: number) => {
    stage.earth.goTo(l.lat, l.lon);
    landed = predicted;
    land.set(0, (predicted ?? 0) + l.lift, 0);
    if (predicted !== null) stage.earth.predictGround(predicted);
    arrived = true;
    stage.dive(land, l.view, from, from > 1e6 ? 8 : 5.5, () => {
      applyIsolate();
      if (l.lowDetail && splatFor(l)) {
        // Google's mesh is flat here: show the site for a beat, then hand over to the reconstruction.
        placeStatus.textContent = `Google’s 3D is coarse at ${l.name}. Switching to ATLAS’s reconstruction from ${l.splat?.photos || 'public'} photos…`;
        setTimeout(() => { if (currentLandmark === l && !recon && mode === 'places') showReconstruction(l); }, 2200);
        return;
      }
      placeStatus.textContent = l.lowDetail ? `Google’s 3D is coarse at ${l.name}. Press B and ATLAS agents will build a model you can take apart.` : '';
    });
  };
  stage.earth.onGround = (y) => {
    if (currentLandmark !== l || !arrived) return;
    stage.shiftGround(y - (landed ?? 0));
    landed = y;
  };
  stage.earth.onAttribution = (html) => { $('credit').innerHTML = html; };

  if (!earthStarted || !originLL) {
    // First arrival: start on the whole planet, then fall in.
    stage.earth.start(auth, l.lat, l.lon);
    stage.earth.setLook(look);
    earthStarted = true;
    stage.holdTopDown(ORBIT);
    originLL = { lat: l.lat, lon: l.lon };
    // Show the whole planet for a beat while the globe streams in, then fall.
    stage.holdUntil(ORBIT, () => stage.earth.visibleTiles > 4, 1.4, 6, () => whenPredicted(() => dive(ORBIT)));
  } else {
    // A satellite pass: climb, turn the globe under the camera along the great circle, dive.
    const from = originLL, to = { lat: l.lat, lon: l.lon };
    const a = llToVec(from.lat, from.lon), b = llToVec(to.lat, to.lon);
    const angle = a.angleTo(b);
    const height = THREE.MathUtils.clamp(angle * 6.371e6 * 1.3, 40000, ORBIT);
    stage.rise(height, angle < 0.002 ? 0.6 : 2.2, () => {
      const v = new THREE.Vector3();
      stage.run(THREE.MathUtils.clamp(1 + angle * 1.6, 1, 4), (k) => {
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        slerpUnit(a, b, angle, e, v);
        const ll = vecToLl(v);
        stage.earth.setOrigin(ll.lat, ll.lon);
        stage.holdTopDown(height);
      }, () => { originLL = to; whenPredicted(() => dive(height)); });
    });
  }
  shareState(l);
  loadFacts(l);
}

const ORBIT = 1.25e7;
let originLL: { lat: number; lon: number } | null = null;
function llToVec(lat: number, lon: number) {
  const la = lat * THREE.MathUtils.DEG2RAD, lo = lon * THREE.MathUtils.DEG2RAD;
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo));
}
function vecToLl(v: THREE.Vector3) {
  return { lat: Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * THREE.MathUtils.RAD2DEG, lon: Math.atan2(v.z, v.x) * THREE.MathUtils.RAD2DEG };
}
function slerpUnit(a: THREE.Vector3, b: THREE.Vector3, angle: number, t: number, out: THREE.Vector3) {
  if (angle < 1e-6) return out.copy(b);
  const s = Math.sin(angle);
  return out.copy(a).multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(b, Math.sin(t * angle) / s).normalize();
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
  // The label floats above the landmark; its stem runs down to the ground point.
  const g = stage.earth.ground;
  const base = stage.project(new THREE.Vector3(0, g, 0));
  const top = stage.project(new THREE.Vector3(0, g + Math.max(currentLandmark.lift * 2.2, 40), 0));
  if (!base || !top) { placeTag.hidden = true; return; }
  placeTag.hidden = false;
  if (placeTag.textContent !== currentLandmark.name) placeTag.textContent = currentLandmark.name;
  const stem = THREE.MathUtils.clamp(base.y - top.y, 24, 220);
  placeTag.style.setProperty('--stem', `${stem}px`);
  placeTag.style.left = `${base.x}px`;
  placeTag.style.top = `${base.y}px`;
};

// ---------- build: agents construct a model you can take apart ----------
const buildPanel = document.getElementById('build-panel') as HTMLElement;
const buildSteps = document.getElementById('build-steps') as HTMLOListElement;
const buildRef = document.getElementById('build-ref') as HTMLElement;
let built: { name: string; parts: BuiltPart[]; model: Hologram; sources: { title: string; url: string }[]; summary: string } | null = null;
let building = false;

for (const n of ['Charminar', 'Taj Mahal', 'Eiffel Tower', 'Big Ben', 'Colosseum', 'Golden Gate Bridge']) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = n;
  b.addEventListener('click', () => { const l = LANDMARKS.find((x) => x.name === n); runConstruct(n, l?.city || ''); });
  document.getElementById('build-picks')!.appendChild(b);
}
document.getElementById('build-form')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = (document.getElementById('build-input') as HTMLInputElement).value.trim();
  if (v) runConstruct(v, '');
});
document.getElementById('build-this')!.addEventListener('click', () => { if (currentLandmark) runConstruct(currentLandmark.name, currentLandmark.city); });
window.addEventListener('keydown', (e) => {
  if (!earthActive || !currentLandmark || e.metaKey || e.ctrlKey || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
  if (e.key === 'b' || e.key === 'B') runConstruct(currentLandmark.name, currentLandmark.city);
});

function stepRow(who: string, text: string, cls = 'run') {
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = '<span class="who"></span><span class="what"></span>';
  li.querySelector('.who')!.textContent = who;
  li.querySelector('.what')!.textContent = text;
  buildSteps.appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
  return {
    done(t?: string) { li.className = 'done'; if (t) li.querySelector('.what')!.textContent = t; },
    fail(t: string) { li.className = 'bad'; li.querySelector('.what')!.textContent = t; },
  };
}

/** Build render on the left, the real photo on the right, as one picture (one image per request). */
async function sideBySide(render: string, refUrl?: string): Promise<{ image: string; combined: boolean }> {
  if (!refUrl) return { image: render, combined: false };
  try {
    const load = (src: string, cors: boolean) => new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); if (cors) i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = bad; i.src = src; });
    const [a, b] = await Promise.all([load(render, false), load(refUrl, true)]);
    const c = document.createElement('canvas');
    c.width = a.width * 2; c.height = a.height;
    const g = c.getContext('2d')!;
    g.drawImage(a, 0, 0);
    g.fillStyle = '#000'; g.fillRect(a.width, 0, a.width, a.height);
    const s = Math.min(a.width / b.width, a.height / b.height);
    g.drawImage(b, a.width + (a.width - b.width * s) / 2, (a.height - b.height * s) / 2, b.width * s, b.height * s);
    return { image: c.toDataURL('image/jpeg', 0.85), combined: true };
  } catch {
    return { image: render, combined: false };
  }
}

async function post<T>(body: Record<string, unknown>, tries = 2): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch('/api/construct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (r.ok && !j.error) return j as T;
    // The free model endpoints drop the odd request under parallel load: one quiet retry after a pause.
    if (attempt >= tries || r.status === 400) throw new Error(j.error || `HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 1500 + Math.random() * 1500));
  }
}

function showBuilt() {
  if (!built) return;
  const m = toHologram(built.parts);
  built.model = m;
  stage.setModel(m);
  stage.frame('object');
  state.entry = null;
  labels.rebuild(m);
  intro.hidden = false;
  setTitle(built.name);
  $('model-kind').textContent = 'Built by ATLAS agents';
  $('parts-n').textContent = String(m.parts.length);
  $('credit').textContent = `Model built live from cited research · ${built.sources.length} sources`;
}

async function runConstruct(name: string, city: string) {
  if (building) return;
  building = true;
  if (mode !== 'build') setMode('build');
  (document.getElementById('build-input') as HTMLInputElement).value = city ? `${name}, ${city}` : name;
  buildSteps.replaceChildren();
  buildRef.hidden = true;
  ui.closeCard();
  ui.log(`building ${name}`, 'sys');
  try {
    // 1. Research and plan.
    const s1 = stepRow('Research', `Reading up on ${name}: dimensions, plan, features`);
    type Zone = { id: string; name: string; brief: string; box: unknown; parts: string[] };
    type PlanRes = { plan: { name: string; summary: string; height_m: number; footprint_m: number[]; zones: Zone[]; facts: { text: string }[] }; sources: { title: string; url: string }[]; reference: { image: string; page: string; title: string } | null };
    const planned = await post<PlanRes>({ step: 'plan', name, city });
    const P = planned.plan;
    s1.done(`${planned.sources.length} sources. ${P.height_m ? `About ${Math.round(P.height_m)} m tall` : ''}${P.footprint_m?.length ? `, ${Math.round(P.footprint_m[0])} × ${Math.round(P.footprint_m[1])} m footprint` : ''}.`);
    stepRow('Architect', `${P.zones.length} zones: ${P.zones.map((z) => z.name).join(', ')}`, 'done');
    if (planned.reference) {
      (document.getElementById('build-ref-img') as HTMLImageElement).src = planned.reference.image;
      (document.getElementById('build-ref-img') as HTMLImageElement).alt = `Photo of ${planned.reference.title}`;
      const a = document.getElementById('build-ref-link') as HTMLAnchorElement;
      a.href = planned.reference.page; a.textContent = 'Wikipedia';
      buildRef.hidden = false;
    }
    built = { name: P.name || name, parts: [], model: stage.model!, sources: planned.sources, summary: P.summary };

    // 2. Builders, one per zone, two at a time (free-tier rate limits). Each zone appears as soon as it lands.
    const rows = P.zones.map((z, i) => ({ z, i }));
    const pool = async () => { for (let next = rows.shift(); next; next = rows.shift()) await buildZone(next.z, next.i); };
    const buildZone = async (z: Zone, i: number) => {
      const row = stepRow(`Builder ${i + 1}`, `${z.name}: ${z.parts.slice(0, 4).join(', ')}${z.parts.length > 4 ? '…' : ''}`);
      try {
        const r = await post<{ parts: BuiltPart[] }>({ step: 'build', name, plan: P, zone: z });
        if (!built) return;
        built.parts.push(...r.parts);
        row.done(`${z.name}: ${r.parts.length} parts`);
        showBuilt();
      } catch (err) {
        row.fail(`${z.name}: failed (${err instanceof Error ? err.message.slice(0, 80) : 'error'})`);
      }
    };
    await Promise.all([pool(), pool(), pool()]);
    if (!built.parts.length) throw new Error('no zone came back');

    // 3. Critic: compare the build with a real photo and fix what is off. Up to two rounds.
    for (let round = 1; round <= 2; round++) {
      setExplode(0);
      await new Promise((r) => setTimeout(r, 700));
      const { image: shot, combined } = await sideBySide(stage.snapshot(), planned.reference?.image);
      const c = stepRow('Critic', round === 1 ? 'Comparing the build with the reference photo' : 'Checking the fixes');
      try {
        const fix = await post<{ score: number; issues: string[]; replace: BuiltPart[]; add: BuiltPart[]; remove: string[] }>({ step: 'critique', name, blueprint: { parts: built.parts.map(({ id, name: n, role, prims }) => ({ id, name: n, role, prims })) }, render: shot, combined });
        const changes = fix.replace.length + fix.add.length + fix.remove.length;
        c.done(`Likeness ${fix.score}/10. ${fix.issues.slice(0, 2).join(' ')}${changes ? ` Fixing ${changes} part${changes > 1 ? 's' : ''}.` : ''}`);
        // The score is unreliable; the issues are not. Always apply the first round's fixes.
        if (!changes || (round > 1 && fix.score >= 7)) break;
        built.parts = applyFixes(built.parts, fix);
        showBuilt();
      } catch (err) {
        c.fail(`Critic unavailable (${err instanceof Error ? err.message.slice(0, 60) : 'error'})`);
        break;
      }
    }

    stepRow('Done', `${built.parts.length} parts. Pull it apart with the slider, an open palm, or ask about any part.`, 'done');
    ui.log(`${built.name}: ${built.parts.length} parts built`, 'sys');
    ui.openCard({ index: 1, total: 1, title: built.name, body: built.summary || '', sources: built.sources.slice(0, 4) });
    $('card-index').textContent = 'BUILT BY ATLAS';
    setTimeout(() => setExplode(0.55), 900);
  } catch (err) {
    stepRow('Stopped', err instanceof Error ? err.message.slice(0, 160) : String(err), 'bad');
    ui.log(`build failed: ${err instanceof Error ? err.message.slice(0, 100) : err}`, 'hot');
  } finally {
    building = false;
  }
}

// Open straight into a shared view: ?place=taj&lens=thermal or ?at=lat,lon,Name
{
  const q = new URLSearchParams(location.search);
  const id = q.get('place'), at = q.get('at'), l0 = q.get('lens');
  if (l0 && LENSES.some((x) => x.id === l0)) setLens(l0 as Lens);
  const preset = id ? LANDMARKS.find((l) => l.id === id) : undefined;
  let target: Landmark | undefined = preset;
  if (!target && at) {
    const [la, lo, ...name] = at.split(',');
    if (Number.isFinite(+la) && Number.isFinite(+lo)) target = { id: 'shared', name: name.join(',') || 'Shared place', city: `${(+la).toFixed(3)}, ${(+lo).toFixed(3)}`, lat: +la, lon: +lo, view: 450, lift: 20 };
  }
  if (target) { currentLandmark = target; setMode('places'); }
}
