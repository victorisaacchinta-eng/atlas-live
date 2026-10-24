import { formatAltitude, ladderPosition, SCALE_BANDS, type ScaleBand } from '../core/geo';
import type { ViewInfo } from '../engine/navigator';
import { $, h } from './dom';

/**
 * The scale ladder: the zoom hierarchy from orbit to street drawn as a real
 * log-scale altitude track. The marker is the camera; the names jump the
 * camera to that scale over the current centre.
 */
export function mountLadder(onBand: (id: ScaleBand['id']) => void): (v: ViewInfo) => void {
  const root = $('#ladder');
  const track = h('div', { class: 'ladder-track', 'aria-hidden': 'true' });
  root.append(track);

  for (const alt of [10_000_000, 1_000_000, 100_000, 10_000, 1_000]) {
    track.append(h('div', { class: 'ladder-tick', style: `top:${ladderPosition(alt) * 100}%`, title: formatAltitude(alt) }));
  }

  const buttons = new Map<string, HTMLButtonElement>();
  SCALE_BANDS.forEach((b) => {
    const pos = ladderPosition(b.target);
    const btn = h('button', { type: 'button', class: 'ladder-band', style: `top:${pos * 100}%`, 'aria-label': `${b.label} scale, ${formatAltitude(b.target)} up` }, b.label) as HTMLButtonElement;
    btn.addEventListener('click', () => onBand(b.id));
    root.append(btn);
    buttons.set(b.id, btn);
  });

  const mark = h('div', { class: 'ladder-mark', 'aria-hidden': 'true' });
  root.append(mark);

  return (v) => {
    const top = `${ladderPosition(v.altitude) * 100}%`;
    mark.style.top = top;
    mark.title = formatAltitude(v.altitude);
    for (const [id, b] of buttons) b.setAttribute('aria-current', String(id === v.band.id));
  };
}
