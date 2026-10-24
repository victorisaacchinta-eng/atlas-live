import { CONFIG } from '../config';
import { toDecimal, toDms, type LatLon } from '../core/geo';
import { isAbort } from '../core/http';
import { KIND_LABEL, relativeTime, utcStamp, type Provenance } from '../core/provenance';
import type { InspectTarget } from '../layers/types';
import { reverseGeocode, GEOCODER_SOURCE } from '../services/geocode';
import { aqiBand, compass, describeWeather, getAirQuality, getConditions, getElevation, type Conditions } from '../services/weather';
import { $, clear, closeButton, copyText, h } from './dom';

export interface InspectorHooks {
  flyTo(p: LatLon): void;
  save(t: InspectTarget): void;
  ask(text: string): void;
  /** Starts or stops circling the selection. */
  orbit(): void;
  closed(): void;
}

const KIND_NAME: Record<InspectTarget['kind'], string> = {
  place: 'Place',
  quake: 'Earthquake',
  event: 'Natural event',
  satellite: 'Satellite',
  building: 'Building',
  feature: 'Map feature',
};

export function mountInspector(hooks: InspectorHooks) {
  let orbiting = false;
  let orbitBtn: HTMLButtonElement | null = null;
  const root = $('#inspector');
  let controller: AbortController | null = null;
  let current: InspectTarget | null = null;

  const close = () => {
    controller?.abort();
    current = null;
    root.hidden = true;
    document.body.classList.remove('inspecting');
    hooks.closed();
  };

  function sourceItem(p: Provenance): HTMLElement {
    const when = p.observedAt ? `observed ${relativeTime(p.observedAt)}` : p.fetchedAt ? `fetched ${relativeTime(p.fetchedAt)}` : '';
    return h(
      'li',
      null,
      h('span', { class: 'kind-tag', 'data-kind': p.kind }, KIND_LABEL[p.kind]),
      p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener' }, h('strong', null, p.source)) : h('strong', null, p.source),
      when ? h('div', null, when, p.observedAt ? ` (${utcStamp(p.observedAt)})` : '') : null,
      p.licence ? h('div', null, p.licence) : null,
      p.note ? h('div', null, p.note) : null,
    );
  }

  function factsList(facts: InspectTarget['facts']): HTMLElement {
    const dl = h('dl', { class: 'facts' });
    for (const f of facts) dl.append(h('dt', null, f.label), h('dd', { class: f.estimated ? 'est' : '' }, f.value));
    return dl;
  }

  function sparkline(w: Conditions): HTMLElement {
    const W = 340;
    const H = 46;
    const temps = w.next24.map((p) => p.temperature);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = Math.max(1, max - min);
    const x = (i: number) => (i / Math.max(1, temps.length - 1)) * (W - 4) + 2;
    const y = (t: number) => H - 6 - ((t - min) / span) * (H - 14);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'spark');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Temperature over the next 24 hours, from ${Math.round(min)} to ${Math.round(max)} degrees, with chance of rain as bars`);
    w.next24.forEach((p, i) => {
      if (!p.precipProbability) return;
      const r = document.createElementNS(ns, 'rect');
      const bh = (p.precipProbability / 100) * (H - 8);
      r.setAttribute('x', String(x(i) - 2.5));
      r.setAttribute('y', String(H - bh));
      r.setAttribute('width', '5');
      r.setAttribute('height', String(bh));
      r.setAttribute('fill', '#4f93e0');
      r.setAttribute('fill-opacity', '0.45');
      svg.append(r);
    });
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', temps.map((t, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(t).toFixed(1)}`).join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#e7e9e4');
    path.setAttribute('stroke-width', '1.5');
    svg.append(path);
    const last = temps.length - 1;
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', String(x(0)));
    dot.setAttribute('cy', String(y(temps[0])));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#f3a83b');
    svg.append(dot);
    const hh = (s: string) => s.slice(11, 16);
    return h(
      'div',
      null,
      svg,
      h(
        'div',
        { class: 'spark-scale' },
        h('span', { class: 'num' }, `${hh(w.next24[0].time)} local`),
        h('span', null, `${Math.round(min)} to ${Math.round(max)}°C, bars show chance of rain`),
        h('span', { class: 'num' }, hh(w.next24[last].time)),
      ),
    );
  }

  async function enrich(t: InspectTarget, body: HTMLElement, sources: HTMLElement, signal: AbortSignal) {
    const wxSec = h('section', { class: 'ins-section' }, h('h3', null, 'Conditions now'), h('div', { class: 'skeleton', style: 'width:60%' }), h('div', { class: 'skeleton', style: 'width:85%' }));
    const groundSec = h('section', { class: 'ins-section' }, h('h3', null, 'Ground and place'), h('div', { class: 'skeleton', style: 'width:70%' }));
    body.append(wxSec, groundSec);

    const [wx, aq, el, place] = await Promise.allSettled([
      getConditions(t.position, signal),
      getAirQuality(t.position, signal),
      getElevation(t.position, signal),
      t.kind === 'place' && !t.subtitle ? reverseGeocode(t.position, signal) : Promise.resolve(null),
    ]);
    if (signal.aborted) return;

    clear(wxSec);
    wxSec.append(h('h3', null, 'Conditions now'));
    if (wx.status === 'fulfilled') {
      const w = wx.value;
      wxSec.append(
        h('div', { class: 'big-reading' }, h('span', { class: 't num' }, `${Math.round(w.temperature)}°C`), h('span', { class: 'w' }, `${describeWeather(w.weatherCode)}, feels like ${Math.round(w.feelsLike)}°C`)),
        factsList([
          { label: 'Wind', value: `${Math.round(w.windSpeed)} km/h from ${compass(w.windDirection)}, gusts ${Math.round(w.windGusts)}` },
          { label: 'Humidity', value: `${Math.round(w.humidity)}%` },
          { label: 'Cloud cover', value: `${Math.round(w.cloudCover)}%` },
          { label: 'Rain, last 15 min', value: `${w.precipitation.toFixed(1)} mm` },
          { label: 'Local time', value: `${w.time.replace('T', ' ')} (${w.timezone})` },
        ]),
        sparkline(w),
      );
      sources.append(sourceItem(w.provenance));
    } else if (!isAbort(wx.reason)) {
      wxSec.append(h('p', { class: 'muted' }, 'Weather is unavailable right now. Open-Meteo did not answer.'));
    }
    if (aq.status === 'fulfilled' && aq.value.usAqi != null) {
      wxSec.append(
        h(
          'dl',
          { class: 'facts', style: 'margin-top:10px' },
          h('dt', null, 'Air quality'),
          h('dd', null, `US AQI ${Math.round(aq.value.usAqi)}, ${aqiBand(aq.value.usAqi).toLowerCase()}`),
          h('dt', null, 'PM2.5'),
          h('dd', null, aq.value.pm25 != null ? `${aq.value.pm25.toFixed(1)} µg/m³` : 'No data'),
        ),
      );
      sources.append(sourceItem(aq.value.provenance));
    }

    clear(groundSec);
    groundSec.append(h('h3', null, 'Ground and place'));
    const facts: InspectTarget['facts'] = [];
    if (el.status === 'fulfilled') {
      facts.push({ label: 'Elevation', value: `${Math.round(el.value.metres).toLocaleString('en-US')} m above sea level` });
      sources.append(sourceItem(el.value.provenance));
    }
    if (place.status === 'fulfilled' && place.value) {
      const p = place.value;
      facts.push({ label: 'Nearest named place', value: [p.name, p.context].filter(Boolean).join(', ') });
      sources.append(sourceItem({ ...GEOCODER_SOURCE, fetchedAt: new Date().toISOString() }));
    }
    if (facts.length) groundSec.append(factsList(facts));
    else groundSec.append(h('p', { class: 'muted' }, 'No ground data for this point.'));
  }

  function show(t: InspectTarget): void {
    controller?.abort();
    controller = new AbortController();
    current = t;
    clear(root);
    root.hidden = false;
    document.body.classList.add('inspecting');

    const coords = h(
      'div',
      { class: 'ins-coords' },
      h('div', { class: 'data' }, h('div', null, toDms(t.position)), h('div', { class: 'decimal' }, toDecimal(t.position, 5))),
      h('button', { type: 'button', class: 'copy', onclick: (e: Event) => copyText(toDecimal(t.position, 6), e.currentTarget as HTMLElement) }, 'Copy'),
    );

    const body = h('div', null);
    if (t.facts.length) body.append(h('section', { class: 'ins-section' }, h('h3', null, 'Details'), factsList(t.facts)));

    const sources = h('ul', { class: 'sources-list' });
    for (const p of t.provenance) sources.append(sourceItem(p));

    const links = t.links?.length ? h('section', { class: 'ins-section' }, h('h3', null, 'Links'), h('ul', { class: 'sources-list' }, ...t.links.map((l) => h('li', null, h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label))))) : null;

    orbitBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(orbiting), onclick: () => hooks.orbit() }, orbiting ? 'Stop circling' : 'Circle it') as HTMLButtonElement;
    const quick = h(
      'div',
      { class: 'ins-actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => hooks.flyTo(t.position) }, 'Fly here'),
      orbitBtn,
      h('button', { class: 'btn', type: 'button', onclick: () => hooks.save(t) }, 'Save place'),
      h('button', { class: 'btn', type: 'button', onclick: () => hooks.ask('earthquakes and natural events near here') }, 'Hazards nearby'),
      h('button', { class: 'btn', type: 'button', onclick: () => hooks.ask('rivers in this area') }, 'Rivers here'),
      CONFIG.host?.place
        ? h('a', { class: 'btn', href: CONFIG.host.place.href(+t.position.lat.toFixed(5), +t.position.lon.toFixed(5), t.title) }, CONFIG.host.place.label)
        : null,
    );

    const parts: HTMLElement[] = [
      h(
        'header',
        { class: 'ins-head' },
        h('p', { class: 'panel-title' }, KIND_NAME[t.kind]),
        h('h2', { class: 'ins-title', id: 'ins-title' }, t.title),
        t.subtitle ? h('p', { class: 'ins-sub' }, t.subtitle) : null,
        closeButton(close, 'Close inspector'),
      ),
      coords,
      body,
    ];
    if (links) parts.push(links);
    parts.push(h('section', { class: 'ins-section' }, h('h3', null, 'Sources'), sources), quick);
    const [head, ...rest] = parts;
    root.append(head, h('div', { class: 'panel-scroll' }, ...rest));
    root.setAttribute('aria-labelledby', 'ins-title');

    if (t.enrich) {
      // Weather and ground first, so sources follow details.
      const anchor = h('div', null);
      body.after(anchor);
      void enrich(t, anchor, sources, controller.signal);
    }
  }

  return {
    show,
    close,
    current: () => current,
    isOpen: () => !root.hidden,
    setOrbiting(on: boolean) {
      orbiting = on;
      if (!orbitBtn) return;
      orbitBtn.textContent = on ? 'Stop circling' : 'Circle it';
      orbitBtn.setAttribute('aria-pressed', String(on));
    },
  };
}
