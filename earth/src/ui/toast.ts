import { $, h } from './dom';

const shown = new Map<string, number>();

export function toast(message: string, tone: 'info' | 'warn' | 'error' = 'info', ms = 4200): void {
  // Collapse repeats of the same message inside a few seconds.
  const last = shown.get(message);
  if (last && Date.now() - last < 6000) return;
  shown.set(message, Date.now());
  const box = $('#toasts');
  const el = h('div', { class: 'toast', 'data-tone': tone }, message);
  box.append(el);
  while (box.children.length > 3) box.firstElementChild?.remove();
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  }, ms);
}
