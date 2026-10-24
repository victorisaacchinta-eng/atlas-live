import { haversineKm, toDecimal, type LatLon } from '../core/geo';
import { isAbort } from '../core/http';
import { solarElevation, sunPhrase } from '../core/sun';
import { reverseGeocode } from '../services/geocode';
import { aqiBand, describeWeather, getAirQuality, getConditions, type Conditions } from '../services/weather';
import { $, clear, h } from './dom';

/**
 * The always-on readout in the top right: where the view is centred, the
 * local time there, the temperature and sky, air quality, the sun, and the
 * live counts from the hazard feeds. Refreshes when the view settles
 * somewhere new, and every ten minutes.
 */

type Glyph = 'sun' | 'moon' | 'cloud' | 'partly' | 'rain' | 'snow' | 'storm' | 'fog';

function glyphFor(code: number, isDay: boolean): Glyph {
  if (code === 0 || code === 1) return isDay ? 'sun' : 'moon';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  if (code >= 51) return 'rain';
  return 'cloud';
}

function weatherGlyph(kind: Glyph): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'wx-glyph');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  const cloud = (dy = 0, op = '1') => add('path', { d: `M14 ${34 + dy}h20a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0 1 13Z`, fill: 'url(#cloudFill)', 'fill-opacity': op });
  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML =
    '<radialGradient id="sunFill" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff4c7"/><stop offset=".55" stop-color="#ffc54d"/><stop offset="1" stop-color="#ff8a2a"/></radialGradient>' +
    '<linearGradient id="cloudFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c7dc"/></linearGradient>' +
    '<radialGradient id="moonFill" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#aebcd4"/></radialGradient>';
  svg.append(defs);
  switch (kind) {
    case 'sun':
      add('circle', { cx: '24', cy: '24', r: '10', fill: 'url(#sunFill)' });
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        add('line', { x1: String(24 + Math.cos(a) * 14.5), y1: String(24 + Math.sin(a) * 14.5), x2: String(24 + Math.cos(a) * 19), y2: String(24 + Math.sin(a) * 19), stroke: '#ffc54d', 'stroke-width': '2.6', 'stroke-linecap': 'round' });
      }
      break;
    case 'moon':
      add('path', { d: 'M30 9a15 15 0 1 0 9 26 12 12 0 0 1-9-26Z', fill: 'url(#moonFill)' });
      break;
    case 'partly':
      add('circle', { cx: '30', cy: '17', r: '8.5', fill: 'url(#sunFill)' });
      cloud(2);
      break;
    case 'cloud':
      cloud(-2);
      break;
    case 'fog':
      cloud(-6, '0.85');
      for (const y of [34, 39]) add('line', { x1: '10', y1: String(y), x2: '38', y2: String(y), stroke: '#c9d4e4', 'stroke-width': '2.4', 'stroke-linecap': 'round' });
      break;
    case 'rain':
      cloud(-6);
      for (const x of [17, 24, 31]) add('line', { x1: String(x), y1: '33', x2: String(x - 3), y2: '41', stroke: '#7cc4ff', 'stroke-width': '2.6', 'stroke-linecap': 'round' });
      break;
    case 'snow':
      cloud(-6);
      for (const x of [17, 24, 31]) add('circle', { cx: String(x), cy: '38', r: '2.2', fill: '#e8f3ff' });
      break;
    case 'storm':
      cloud(-6);
      add('path', { d: 'M25 30l-5 8h5l-3 7 8-10h-5l3-5Z', fill: '#ffd34d' });
      break;
  }
  return svg;
}

/** How far the view must move before the readout is fetched again: a street's width up close, a region from orbit. */
export function refreshKm(altitude: number): number {
  return Math.min(25, Math.max(1, (altitude / 1000) * 0.4));
}

export interface HudCounts {
  quakes24h(): number | null;
  events(): number | null;
}

export function mountHud(counts: HudCounts) {
  const root = $('#hud');
  const place = h('p', { class: 'hud-place' }, 'Finding the view');
  const region = h('p', { class: 'hud-region' });
  const glyphBox = h('div', { class: 'hud-glyph' });
  const temp = h('span', { class: 'hud-temp' }, '--°');
  const sky = h('p', { class: 'hud-sky' }, 'Loading conditions');
  const localTime = h('span', { class: 'hud-time' }, '--:--');
  const localDate = h('span', { class: 'hud-date' });
  const utc = h('span', { class: 'hud-utc' });
  const chips = h('div', { class: 'hud-chips' });

  root.append(
    h('div', { class: 'hud-top' }, h('div', { class: 'hud-where' }, place, region), glyphBox),
    h('div', { class: 'hud-mid' }, temp, h('div', { class: 'hud-clock' }, localTime, localDate, utc)),
    sky,
    chips,
  );

  let center: LatLon | null = null;
  let loadedAt: LatLon | null = null;
  let loadedTime = 0;
  let offset: number | null = null;
  let tz = '';
  let controller: AbortController | null = null;
  let aqi: number | null = null;
  let timer: number | undefined;
  let altitude = 0;
  let lastPlace: { name: string; context: string; kind: string } | null = null;

  /** Name the view at the scale it is seen: a street up close, a city from the air, a state or country from orbit. */
  function paintPlace() {
    if (!lastPlace) return;
    const parts = lastPlace.context.split(', ').filter(Boolean);
    if (altitude > 1_500_000 && parts.length >= 2) {
      place.textContent = parts[parts.length - 2];
      region.textContent = parts[parts.length - 1];
    } else if (altitude > 120_000 && parts.length >= 2) {
      place.textContent = parts[0];
      region.textContent = parts.slice(1).join(', ');
    } else {
      place.textContent = lastPlace.name;
      region.textContent = lastPlace.context || lastPlace.kind;
    }
  }

  function paintClock() {
    const now = new Date();
    utc.textContent = `${now.toISOString().slice(11, 16)} UTC`;
    if (offset == null) {
      localTime.textContent = now.toISOString().slice(11, 16);
      localDate.textContent = 'UTC';
      return;
    }
    const local = new Date(now.getTime() + offset * 1000);
    localTime.textContent = local.toISOString().slice(11, 16);
    localDate.textContent = `${local.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}${tz ? `, ${tz.split('/').pop()?.replace(/_/g, ' ')}` : ''}`;
  }

  function paintChips() {
    clear(chips);
    const chip = (label: string, value: string, tone?: string) => h('div', { class: 'hud-chip', 'data-tone': tone ?? '' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, value));
    if (aqi != null) chips.append(chip('Air', `${Math.round(aqi)} ${aqiBand(aqi).split(' ')[0].toLowerCase()}`, aqi > 150 ? 'bad' : aqi > 100 ? 'warn' : 'ok'));
    if (center) chips.append(chip('Sun', sunPhrase(solarElevation(center.lat, center.lon)).replace('Sun ', '')));
    const q = counts.quakes24h();
    if (q != null) chips.append(chip('Quakes 24 h', String(q)));
    const e = counts.events();
    if (e != null) chips.append(chip('Open events', String(e)));
  }

  function paintWeather(w: Conditions) {
    clear(glyphBox);
    glyphBox.append(weatherGlyph(glyphFor(w.weatherCode, w.isDay)));
    temp.textContent = `${Math.round(w.temperature)}°`;
    sky.textContent = `${describeWeather(w.weatherCode)}, feels like ${Math.round(w.feelsLike)}°. Wind ${Math.round(w.windSpeed)} km/h.`;
    offset = w.utcOffsetSeconds;
    tz = w.timezone;
    paintClock();
  }

  async function refresh(p: LatLon) {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    loadedAt = p;
    loadedTime = Date.now();
    root.classList.add('loading');
    const [wx, aq, rev] = await Promise.allSettled([getConditions(p, signal), getAirQuality(p, signal), reverseGeocode(p, signal)]);
    if (signal.aborted) return;
    root.classList.remove('loading');
    if (wx.status === 'fulfilled') paintWeather(wx.value);
    else if (!isAbort(wx.reason)) sky.textContent = 'Weather unavailable right now';
    aqi = aq.status === 'fulfilled' ? aq.value.usAqi : null;
    if (rev.status === 'fulfilled' && rev.value && haversineKm(rev.value.position, p) < 60) {
      lastPlace = rev.value;
      paintPlace();
    } else {
      lastPlace = null;
      place.textContent = 'Open water or wilderness';
      region.textContent = toDecimal(p, 2);
    }
    paintChips();
  }

  setInterval(paintClock, 1000);
  setInterval(() => {
    paintChips();
    if (center && Date.now() - loadedTime > 10 * 60_000) void refresh(center);
  }, 30_000);
  paintClock();

  return {
    /** Call when the camera comes to rest. */
    settle(p: LatLon | null, alt = 0) {
      if (!p) return;
      center = p;
      altitude = alt;
      paintPlace();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!loadedAt || haversineKm(loadedAt, p) > refreshKm(altitude)) void refresh(p);
        else paintChips();
      }, 500);
    },
    counts: paintChips,
  };
}
