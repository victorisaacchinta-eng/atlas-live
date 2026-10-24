import { CONFIG, hostStatus } from './config';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import '@fontsource/michroma/400.css';
import '@fontsource-variable/instrument-sans/wdth.css';
import '@fontsource/fragment-mono/400.css';
import './styles/app.css';

import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  EllipsoidalOccluder,
  EllipsoidTerrainProvider,
  Ion,
  Math as CesiumMath,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type CesiumWidget,
} from 'cesium';

import { createGlobe } from './engine/globe';
import { Navigator } from './engine/navigator';
import { createTerrariumSource, heightAt } from './engine/terrarium';
import { groundHeights } from './engine/ground';
import { LayerManager } from './layers/manager';
import type { InspectTarget, LayerContext } from './layers/types';
import {
  aerialBase,
  blueMarbleBase,
  bordersOverlay,
  Comparison,
  dailyBase,
  labelsOverlay,
  nightLightsOverlay,
  osmBuildings3dLayer,
  precipitationOverlay,
  sentinelBase,
  streetsBase,
  terrainLayer,
  utcDate,
} from './layers/imagery';
import { eventLayer, quakeLayer } from './layers/live';
import { satelliteLayer } from './layers/satellites';
import { buildingLayer } from './layers/buildings';
import { photorealLayer } from './layers/photoreal';
import { LANDMARKS, type Landmark } from './data/landmarks';
import { googleForwardGeocoder } from './services/googleGeocoder';
import { ResultMarks } from './layers/results';
import { Executor, altitudeForPlace, type AppApi } from './ai/executor';
import { plan } from './ai/remotePlanner';
import type { PlannerContext } from './ai/ops';
import { local } from './core/http';
import { SCALE_BANDS, toDecimal, type LatLon } from './core/geo';
import { GEOCODER_SOURCE, searchPlaces, useForwardGeocoder } from './services/geocode';
import { $ } from './ui/dom';
import { toast } from './ui/toast';
import { mountSearch } from './ui/search';
import { controlsFor, mountLayersPanel } from './ui/layersPanel';
import { mountInspector } from './ui/inspector';
import { mountLadder } from './ui/ladder';
import { mountStatus } from './ui/status';
import { mountNavpad } from './ui/navpad';
import { mountCompare } from './ui/compareView';
import { mountSourcesDialog } from './ui/sourcesDialog';
import { mountAnswer } from './ui/answer';
import { mountHud } from './ui/hud';

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => reducedMotionQuery.matches;

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function bootFail(message: string) {
  const boot = $('#boot');
  boot.classList.add('failed');
  $('#boot-line').textContent = message;
}

/** Longitude where it is mid-afternoon now, so the opening view shows day, dusk and city lights together. */
function openingLongitude(now = new Date()): number {
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const subsolar = (12 - utcHours) * 15;
  return ((((subsolar + 55 + 180) % 360) + 360) % 360) - 180;
}

/** "#17.3850,78.4867,12.5" -> view at that point from 12.5 km. */
function parseHash(): { p: LatLon; altKm: number } | null {
  const m = /^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(location.hash);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  const altKm = Number(m[3]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || altKm <= 0) return null;
  return { p: { lat, lon }, altKm };
}

async function start() {
  if (!webglAvailable()) {
    bootFail('This browser could not start WebGL, which the 3D globe needs. Try a recent Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.');
    return;
  }

  // Inside a host app, its status endpoint can supply the live model's name and
  // a Cesium ion token it has restricted to its own site. A token saved in this
  // browser always wins.
  const host = await hostStatus();
  const fallbackToken = (import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined) || host.ionToken || null;
  const ionToken = local.get<string | null>('ion-token', null) || fallbackToken;
  if (ionToken) Ion.defaultAccessToken = ionToken;

  const terrainSource = createTerrariumSource();
  let widget: CesiumWidget;
  try {
    widget = createGlobe({
      container: $('#globe'),
      creditContainer: $('#credits'),
      terrain: null,
      reducedMotion: reducedMotion(),
      lowQuality: new URLSearchParams(location.search).get('quality') === 'low',
      onFatal: () => toast('The globe stopped drawing after repeated graphics errors. Reload the page to continue.', 'error', 15_000),
    });
  } catch (err) {
    console.error(err);
    bootFail('The globe could not start on this device. The graphics driver may not support the features Cesium needs.');
    return;
  }
  const scene = widget.scene;

  const ctx: LayerContext = {
    widget,
    terrainSource,
    ionToken,
    googleKey: host.googleKey,
    suspend3d: false,
    imageryDate: utcDate(-1),
    notify: (m, tone) => toast(m, tone),
    requestRender: () => scene.requestRender(),
  };
  const layers = new LayerManager(ctx);

  const sentinel = sentinelBase();
  const daily = dailyBase();
  const terrain = terrainLayer();
  const quakes = quakeLayer();
  const events = eventLayer();
  const sats = satelliteLayer();
  const precip = precipitationOverlay();
  const photoreal = photorealLayer();
  for (const d of [
    sentinel,
    daily,
    blueMarbleBase(),
    streetsBase(),
    aerialBase(),
    labelsOverlay(),
    bordersOverlay(),
    nightLightsOverlay(),
    quakes,
    events,
    precip,
    sats,
    terrain,
    buildingLayer(),
    osmBuildings3dLayer(),
    photoreal,
  ])
    layers.register(d);

  // Framing needs the real ground even while the globe is drawn as a smooth ellipsoid from orbit.
  const nav = new Navigator(widget, reducedMotion, async (p) =>
    scene.terrainProvider instanceof EllipsoidTerrainProvider ? heightAt(terrainSource, p.lat, p.lon, 13) : ((await groundHeights(widget, terrainSource, [p]))[0] ?? 0),
  );
  const results = new ResultMarks(widget);
  const comparison = new Comparison(ctx);

  /* ---------------------------------------------------------- opening view */
  const fromHash = parseHash();
  const saved = local.get<{ lat: number; lon: number; altKm: number } | null>('last-view', null);
  const opening = fromHash ?? (saved ? { p: { lat: saved.lat, lon: saved.lon }, altKm: saved.altKm } : null);
  widget.camera.setView({
    destination: opening ? Cartesian3.fromDegrees(opening.p.lon, opening.p.lat, opening.altKm * 1000) : Cartesian3.fromDegrees(openingLongitude(), 14, 19_000_000),
  });

  /* ------------------------------------------------------------- UI wiring */
  let selected: InspectTarget | null = null;
  const reticle = document.createElement('div');
  reticle.className = 'reticle';
  reticle.hidden = true;
  $('#app').append(reticle);

  const inspector = mountInspector({
    flyTo: (p) => void nav.lookAt(p, Math.min(nav.altitude(), 40_000)),
    save: (t) => {
      navpad.saveNamed(t.title);
      toast(`Saved "${t.title}" in this browser.`);
    },
    ask: (text) => void ask(text),
    orbit: () => {
      if (nav.isOrbiting()) nav.stopOrbit();
      else orbitSelection();
    },
    closed: () => {
      selected = null;
      reticle.hidden = true;
      photoreal.clearHighlight(ctx);
    },
  });
  nav.onOrbit((on) => inspector.setOrbiting(on));

  const inspect = (t: InspectTarget) => {
    selected = t;
    inspector.show(t);
  };

  const inspectPoint = (p: LatLon, title?: string, subtitle?: string) =>
    inspect({
      kind: 'place',
      title: title ?? 'Point on the ground',
      subtitle,
      position: p,
      facts: [],
      provenance: title ? [{ ...GEOCODER_SOURCE, fetchedAt: new Date().toISOString() }] : [],
      enrich: true,
    });

  /** Circles the selected thing, or the centre of the view when nothing is selected. */
  function orbitSelection(): boolean {
    if (nav.isOrbiting()) return true;
    if (selected) {
      void nav.focus(selected.position, { range: Math.min(Math.max(nav.altitude() * 1.2, 300), 4000), lift: selected.kind === 'building' ? 25 : 0, pitch: -26 });
      return true;
    }
    return nav.orbitCenter();
  }

  /** Flies to a landmark, frames it, circles it, and names what is mapped there. */
  async function showLandmark(l: Landmark): Promise<void> {
    inspector.close();
    const placeholder: InspectTarget = { kind: 'place', title: l.name, subtitle: l.city, position: l.position, facts: [], provenance: [], enrich: false };
    inspect(placeholder);
    const arrived = await nav.focus(l.position, { range: l.range, lift: l.height * 0.45, pitch: -20 });
    if (!arrived || selected !== placeholder) return;
    if (photoreal.active() || layers.isOn('photoreal-3d')) {
      // The flight leaves the landmark in the middle of the screen.
      const t = await photoreal.inspectAt(ctx, l.position, new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2));
      if (selected !== placeholder) return;
      // Only keep the picked building if it is the landmark itself, never a neighbour under its name.
      const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z]/g, '').includes(b.toLowerCase().replace(/[^a-z]/g, ''));
      if (t.kind === 'building' && same(t.title, l.name)) inspect(t);
      else {
        photoreal.clearHighlight(ctx);
        inspectPoint(l.position, l.name, l.city);
      }
    } else {
      inspectPoint(l.position, l.name, l.city);
    }
  }

  const status = mountStatus(() => sources.open());
  const ladder = mountLadder((id) => void nav.toBand(id));

  const compareView = mountCompare(comparison, () => toast('Comparison closed.'));

  let layersWereOpen = true;
  const answer = mountAnswer(
    (p) => {
      void nav.lookAt(p, Math.min(Math.max(nav.altitude() * 0.4, 20_000), 400_000));
      inspectPoint(p);
    },
    // The answer takes the left column; layers fold to their header until it closes.
    (open) => {
      if (open) {
        layersWereOpen = !$('#layers').classList.contains('collapsed');
        panel.toggleCollapsed(true);
      } else if (layersWereOpen && window.innerWidth > 760) panel.toggleCollapsed(false);
    },
  );

  const setBase = (id: string) => layers.enable(id);
  const setDate = async (d: string) => {
    layers.setDate(d);
    await layers.dateChanged();
    panel.refresh();
    updateImagery();
  };

  const app: AppApi = {
    widget,
    nav,
    layers,
    layerCtx: ctx,
    quakes,
    events,
    satellites: sats,
    results,
    comparison,
    setBase,
    setDate,
    setExaggeration: (f) => {
      void layers.enable('terrain');
      terrain.setExaggeration(ctx, f);
      panel.refresh();
    },
    inspect,
    inspectPoint,
    closeInspector: () => inspector.close(),
    selected: () => selected,
    today: () => utcDate(0),
    showLandmark,
    orbit: () => orbitSelection(),
  };
  const executor = new Executor(app);

  let askController: AbortController | null = null;
  async function ask(text: string) {
    askController?.abort();
    askController = new AbortController();
    const signal = askController.signal;
    answer.start(text);
    const v = nav.view();
    const pctx: PlannerContext = {
      today: utcDate(0),
      imageryDate: ctx.imageryDate,
      view: v.center ? { lat: +v.center.lat.toFixed(4), lon: +v.center.lon.toFixed(4), altitude_m: Math.round(v.altitude), scale: v.band.id } : null,
      selected: selected ? { title: selected.title, lat: +selected.position.lat.toFixed(4), lon: +selected.position.lon.toFixed(4), kind: selected.kind } : null,
      layersOn: layers.active().map((d) => d.id),
      base: layers.activeBase()?.id ?? null,
      ionAvailable: !!ctx.ionToken,
    };
    try {
      const p = await plan(text, pctx, signal);
      if (signal.aborted) return;
      answer.planner(`Planned by ${p.planner}${p.fallbackReason ? `. ${p.fallbackReason}` : ''}`);
      const fromModel = !/rules/i.test(p.planner);
      const steps = await executor.run(p.ops, signal, (s) => answer.step(s, fromModel));
      if (signal.aborted) return;
      answer.done(steps.length);
      compareView.render();
      panel.refresh();
      updateImagery();
    } catch (err) {
      if (signal.aborted) return;
      answer.step({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' });
      answer.done(1);
    }
  }

  const search = mountSearch({
    onPlace: (p) => {
      answer.close();
      void nav.lookAt(p.position, altitudeForPlace(p));
      inspectPoint(p.position, p.name, [p.kind, p.context].filter(Boolean).join(', '));
    },
    onAsk: (t) => void ask(t),
    onLandmark: (l) => {
      answer.close();
      void showLandmark(l);
    },
    landmarks: LANDMARKS,
    near: () => (nav.altitude() < 2_000_000 ? nav.centerPoint() : null),
  });

  const panel = mountLayersPanel(layers, {
    openKeys: () => sources.open(),
    extraControls: (def) =>
      controlsFor(def, {
        date: () => ctx.imageryDate,
        today: () => utcDate(0),
        setDate: (d) => void setDate(d),
        year: () => sentinel.year,
        setYear: (y) => {
          sentinel.setYear(ctx, y);
          panel.refresh();
          updateImagery();
        },
        exaggeration: () => terrain.exaggeration,
        setExaggeration: (v) => {
          terrain.setExaggeration(ctx, v);
          panel.refresh();
        },
        hiddenCategories: () => events.hidden,
        toggleCategory: (c) => {
          events.setHidden(ctx, c, !events.hidden.has(c));
          panel.refresh();
        },
      }),
  });

  const navpad = mountNavpad(nav, {
    toggleLayers: () => {
      document.body.classList.remove('clean');
      navpad.setClean(false);
      panel.toggleCollapsed();
    },
    toggleClean: () => document.body.classList.toggle('clean'),
    currentName: () => selected?.title ?? (nav.centerPoint() ? `View at ${toDecimal(nav.centerPoint()!, 2)}` : 'Saved view'),
  });

  const sources = mountSourcesDialog({
    token: () => local.get<string | null>('ion-token', null),
    hostToken: !!host.ionToken,
    setToken: (saved) => {
      local.set('ion-token', saved);
      const t = saved || fallbackToken;
      ctx.ionToken = t;
      Ion.defaultAccessToken = t ?? '';
      layers.setIonToken(t);
      if (layers.isOn('terrain')) {
        layers.disable('terrain');
        void layers.enable('terrain');
      }
      panel.refresh();
      toast(t ? 'Cesium ion token saved in this browser. Ion layers are unlocked.' : 'Cesium ion token removed.');
    },
    modelStatus: () =>
      host.model
        ? `The assistant plans with ${host.model}, called from ${CONFIG.name}'s server so no key reaches the browser. If the model cannot be reached it falls back to built-in rules that cover navigation, weather, hazards, features, layers and comparisons. Either way, every fact comes from the data sources above, and model background notes are labelled as such.`
        : 'The assistant plans with a language model when the server has a key (ANTHROPIC_API_KEY, or an OpenAI-compatible LLM_API_KEY and LLM_BASE_URL). Without one it uses built-in rules that cover navigation, weather, hazards, features, layers and comparisons. Either way, every fact comes from the data sources above, and model background notes are labelled as such.',
  });

  if (window.innerWidth <= 760) panel.toggleCollapsed(true);

  /* ------------------------------------------------------- imagery status */
  let pending3d = 0;
  function updateImagery() {
    const base = layers.activeBase();
    const alt = nav.altitude();
    let text = '';
    let warn = '';
    switch (base?.id) {
      case 'base-sentinel':
        text = `Sentinel-2 cloudless ${sentinel.year}, 10 m`;
        if (alt < 1_800) warn = 'Closer than this imagery resolves';
        break;
      case 'base-daily':
        text = `NOAA-20 VIIRS, ${ctx.imageryDate} UTC, about 375 m`;
        if (alt < 60_000) warn = 'Closer than this imagery resolves';
        break;
      case 'base-bluemarble':
        text = 'Blue Marble 2004 composite, 500 m';
        if (alt < 120_000) warn = 'Closer than this imagery resolves';
        break;
      case 'base-streets':
        text = 'OpenStreetMap';
        break;
      case 'base-aerial':
        text = 'Bing aerial via Cesium ion';
        break;
      default:
        text = 'No ground imagery';
    }
    if (photoreal.active()) {
      text = 'Google Photorealistic 3D Tiles';
      warn = pending3d > 0 ? `Streaming 3D tiles, ${pending3d} to go` : '';
    }
    if (comparison.active) text = `Comparing ${comparison.active.a} with ${comparison.active.b}`;
    status.imagery(text, warn);
  }

  /* ------------------------------------------------------------ view events */
  nav.onView((v) => {
    ladder(v);
    status.view(v);
  });
  let lastSaved = 0;
  const hud = mountHud({
    quakes24h: () => (quakes.quakes.length ? quakes.quakes.filter((q) => Date.now() - q.time < 86_400_000).length : null),
    events: () => (events.events.length ? events.events.filter((e) => !events.hidden.has(e.category)).length : null),
  });
  // Panels on the right sit under the HUD, whatever height it ends up.
  const hudEl = $('#hud');
  new ResizeObserver(() => document.documentElement.style.setProperty('--hud-h', `${Math.round(hudEl.getBoundingClientRect().height)}px`)).observe(hudEl);
  layers.onChange(() => hud.counts());

  nav.onSettle((v) => {
    hud.settle(v.center, v.altitude);
    layers.viewChanged(v);
    updateImagery();
    if (v.center && Date.now() - lastSaved > 1000) {
      lastSaved = Date.now();
      const altKm = +(v.altitude / 1000).toFixed(v.altitude < 10_000 ? 2 : 0);
      local.set('last-view', { lat: v.center.lat, lon: v.center.lon, altKm });
      history.replaceState(null, '', `#${v.center.lat.toFixed(4)},${v.center.lon.toFixed(4)},${altKm}`);
    }
  });
  layers.onChange(() => updateImagery());

  /* ----------------------------------------------------------------- picking */
  const handler = new ScreenSpaceEventHandler(scene.canvas);
  const globePoint = (pos: Cartesian2): (LatLon & { height: number }) | null => {
    const hit = nav.surfaceAt(pos);
    if (!hit) return null;
    const c = Cartographic.fromCartesian(hit);
    const onGlobe = scene.globe.show;
    return { lat: CesiumMath.toDegrees(c.latitude), lon: CesiumMath.toDegrees(c.longitude), height: onGlobe ? c.height / (scene.verticalExaggeration || 1) : c.height };
  };

  handler.setInputAction(async (e: { position: Cartesian2 }) => {
    const picked = scene.pick(e.position);
    if (picked && !photoreal.owns(picked)) {
      const t = layers.pick(picked) ?? results.pick(picked);
      if (t) return inspect(t);
    }
    const p = globePoint(e.position);
    if (!p) return;
    if (picked && photoreal.owns(picked)) {
      // Google's mesh is one surface, so the building comes from OpenStreetMap at the clicked point.
      const placeholder: InspectTarget = { kind: 'place', title: 'Looking up this building', subtitle: 'Asking OpenStreetMap what is mapped here', position: p, facts: [], provenance: [], enrich: false };
      inspect(placeholder);
      const t = await photoreal.inspectAt(ctx, p, e.position);
      if (selected === placeholder) inspect(t);
      return;
    }
    photoreal.clearHighlight(ctx);
    inspectPoint(p);
  }, ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction((e: { position: Cartesian2 }) => {
    const p = globePoint(e.position);
    if (p) void nav.lookAt(p, Math.max(600, nav.altitude() * 0.3));
  }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  let moveQueued = false;
  let lastMove: Cartesian2 | null = null;
  handler.setInputAction((e: { endPosition: Cartesian2 }) => {
    lastMove = e.endPosition;
    if (moveQueued) return;
    moveQueued = true;
    requestAnimationFrame(() => {
      moveQueued = false;
      if (!lastMove) return;
      status.cursor(globePoint(lastMove));
      const picked = scene.pick(lastMove);
      scene.canvas.style.cursor = picked && ((picked as { id?: { layer?: string } }).id?.layer || photoreal.owns(picked)) ? 'pointer' : '';
    });
  }, ScreenSpaceEventType.MOUSE_MOVE);

  /* --------------------------------------------------------------- reticle */
  const scratch = new Cartesian2();
  scene.postRender.addEventListener(() => {
    if (!selected || !inspector.isOpen()) {
      reticle.hidden = true;
      return;
    }
    const world = Cartesian3.fromDegrees(selected.position.lon, selected.position.lat, selected.kind === 'satellite' ? 0 : 10);
    const occluder = new EllipsoidalOccluder(scene.globe.ellipsoid, widget.camera.positionWC);
    const screen = SceneTransforms.worldToWindowCoordinates(scene, world, scratch);
    const visible = selected.kind !== 'satellite' && !!screen && occluder.isPointVisible(world);
    reticle.hidden = !visible;
    if (visible && screen) {
      reticle.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
    }
  });

  /* -------------------------------------------------------------- keyboard */
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select, dialog');
    if (e.key === 'Escape') {
      if (navpad.isOpen()) return navpad.close();
      if (inspector.isOpen()) return inspector.close();
      if (answer.isOpen()) return answer.close();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === '/') {
      e.preventDefault();
      search.focus();
    } else if (k === 'h' || k === 'H') void nav.home();
    else if (k === 'b' || k === 'B') void nav.back();
    else if (k === 'l' || k === 'L') panel.toggleCollapsed();
    else if (k === 'u' || k === 'U') navpad.setClean(document.body.classList.toggle('clean'));
    else if (k >= '1' && k <= '6') void nav.toBand(SCALE_BANDS[Number(k) - 1].id);
    else if (k === '[') nav.tilt(-12);
    else if (k === ']') nav.tilt(12);
    else if (target.closest('button, a, [role="slider"]')) return;
    else if (k === 'ArrowLeft') nav.nudge('left');
    else if (k === 'ArrowRight') nav.nudge('right');
    else if (k === 'ArrowUp') nav.nudge('up');
    else if (k === 'ArrowDown') nav.nudge('down');
    else if (k === '+' || k === '=') nav.nudge('in');
    else if (k === '-' || k === '_') nav.nudge('out');
    else return;
    if (k.startsWith('Arrow')) e.preventDefault();
  });

  document.querySelector('.wordmark')?.addEventListener('click', (e) => {
    e.preventDefault();
    answer.close();
    inspector.close();
    void nav.home();
  });

  window.addEventListener('hashchange', () => {
    const h = parseHash();
    if (h) void nav.lookAt(h.p, h.altKm * 1000);
  });

  /* ----------------------------------------------------- default layers */
  // Google's terms pair its 3D tiles with Google's geocoder, so place search follows the layer.
  const google = googleForwardGeocoder(scene, ctx.googleKey);
  const syncGeocoder = () =>
    useForwardGeocoder(
      layers.isOn('photoreal-3d')
        ? {
            label: 'Google',
            search: async (q, n) => {
              try {
                return await google.search(q, n);
              } catch (err) {
                console.warn('Google geocoder failed, using OpenStreetMap', err);
                useForwardGeocoder(null);
                toast('Google place search is not enabled for this key, so search uses OpenStreetMap.', 'warn');
                return searchPlaces(q, { limit: n });
              }
            },
          }
        : null,
    );
  layers.onChange(syncGeocoder);
  photoreal.onProgress((n) => {
    const changed = (n > 0) !== (pending3d > 0) || Math.abs(n - pending3d) >= 10 || n === 0;
    pending3d = n;
    if (changed) updateImagery();
  });
  photoreal.onActive((on) => {
    document.body.classList.toggle('has-3d', on);
    updateImagery();
    panel.refresh();
  });

  // The best representation each place has: Google's 3D mesh where a key allows it,
  // otherwise OpenStreetMap buildings raised from their footprints.
  const defaults = ['base-sentinel', 'terrain', 'labels', 'night-lights', 'quakes', layers.usable(photoreal) ? 'photoreal-3d' : 'buildings'];
  await Promise.all(defaults.map((id) => layers.enable(id)));
  updateImagery();
  ladder(nav.view());
  status.view(nav.view());
  hud.settle(nav.centerPoint() ?? { lat: 17.385, lon: 78.4867 }, nav.altitude());

  /* ------------------------------------------------------------- boot */
  const boot = $('#boot');
  let booted = false;
  const finishBoot = () => {
    if (booted) return;
    booted = true;
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 700);
  };
  const removeProgress = scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
    if (queued === 0 && scene.globe.tilesLoaded) {
      removeProgress();
      finishBoot();
    }
  });
  setTimeout(finishBoot, 7000);

  // Exposed for the smoke test and for debugging in the console.
  (window as unknown as { mizpah: unknown }).mizpah = { widget, layers, nav, ask, executor };
}

void start();
