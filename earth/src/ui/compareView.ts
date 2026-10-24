import type { Comparison } from '../layers/imagery';
import { $, clear, h } from './dom';

/** The draggable divider for split-screen comparisons, with labels for each side. */
export function mountCompare(cmp: Comparison, onClose: () => void) {
  const root = $('#compare');
  let fraction = 0.5;

  function render() {
    clear(root);
    if (!cmp.active) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const label = (v: string) => (cmp.active!.kind === 'years' ? `${v} mosaic` : `${v} UTC`);
    const grip = h('div', { class: 'compare-grip', 'aria-hidden': 'true' }, '‹›');
    const handle = h(
      'div',
      {
        class: 'compare-handle',
        role: 'slider',
        tabindex: 0,
        'aria-label': 'Comparison divider',
        'aria-valuemin': 2,
        'aria-valuemax': 98,
        'aria-valuenow': Math.round(fraction * 100),
        style: `left:${fraction * 100}%`,
      },
      grip,
      h('span', { class: 'compare-label l' }, label(cmp.active.a)),
      h('span', { class: 'compare-label r' }, label(cmp.active.b)),
      h('button', { type: 'button', class: 'compare-close', onclick: () => (cmp.stop(), render(), onClose()) }, 'End comparison'),
    );
    const move = (clientX: number) => {
      const r = root.getBoundingClientRect();
      fraction = Math.max(0.02, Math.min(0.98, (clientX - r.left) / r.width));
      handle.style.left = `${fraction * 100}%`;
      handle.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      cmp.setPosition(fraction);
    };
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      handle.setPointerCapture(e.pointerId);
      move(e.clientX);
    });
    handle.addEventListener('pointermove', (e) => {
      if (handle.hasPointerCapture(e.pointerId)) move(e.clientX);
    });
    handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const r = root.getBoundingClientRect();
      move(r.left + (fraction + (e.key === 'ArrowLeft' ? -0.03 : 0.03)) * r.width);
    });
    root.append(handle);
    cmp.setPosition(fraction);
  }

  return { render };
}
