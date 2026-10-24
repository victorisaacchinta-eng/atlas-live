import { CONFIG } from '../config';
import { formatAltitude, toDms, type LatLon } from '../core/geo';
import type { ViewInfo } from '../engine/navigator';
import { $, h } from './dom';

export interface StatusApi {
  view(v: ViewInfo): void;
  cursor(p: (LatLon & { height?: number }) | null): void;
  imagery(text: string, warn?: string): void;
}

export function mountStatus(openSources: () => void): StatusApi {
  const root = $('#status');
  const cursor = h('span', { class: 'data' }, 'Point at the globe');
  const ground = h('span', { class: 'data hide-sm' });
  const alt = h('span', { class: 'data' });
  const band = h('span', { class: 'hide-sm' });
  const heading = h('span', { class: 'data hide-md' });
  const imagery = h('span', { class: 'imagery' });
  const warn = h('span', { class: 'warn hide-sm' });
  const clock = h('time', { class: 'data hide-md' });

  root.append(
    h('div', { class: 'cell' }, h('span', { class: 'k hide-sm' }, 'Cursor'), cursor, ground),
    h('div', { class: 'cell' }, h('span', { class: 'k hide-sm' }, 'Eye'), alt, band, heading),
    h('div', { class: 'cell grow' }, imagery, warn),
    h('div', { class: 'cell hide-md' }, clock),
    ...(CONFIG.host ? [h('div', { class: 'cell hide-sm' }, h('a', { class: 'host-link', href: CONFIG.host.href }, CONFIG.host.label))] : []),
    h('div', { class: 'cell' }, h('button', { type: 'button', onclick: openSources }, 'Sources and keys')),
  );

  const tickClock = () => {
    const d = new Date();
    clock.dateTime = d.toISOString();
    clock.textContent = `${d.toISOString().slice(11, 16)} UTC`;
  };
  tickClock();
  setInterval(tickClock, 10_000);

  return {
    view(v) {
      alt.textContent = formatAltitude(v.altitude);
      band.textContent = v.band.label;
      const hd = ((v.heading % 360) + 360) % 360;
      heading.textContent = `heading ${Math.round(hd)}°`;
    },
    cursor(p) {
      if (!p) {
        cursor.textContent = 'Point at the globe';
        ground.textContent = '';
        return;
      }
      cursor.textContent = toDms(p);
      ground.textContent = p.height != null && Number.isFinite(p.height) ? `${Math.round(p.height)} m` : '';
    },
    imagery(text, w) {
      imagery.textContent = text;
      warn.textContent = w ?? '';
    },
  };
}
