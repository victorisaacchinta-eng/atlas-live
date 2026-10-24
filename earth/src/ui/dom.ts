type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

/** Tiny element builder. Text is always set as text, never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
}

/** Inline SVG icons drawn on a 16 px grid. */
export type IconName = 'home' | 'back' | 'save' | 'list' | 'layers' | 'up' | 'down' | 'tilt' | 'close' | 'search' | 'eye' | 'eyeOff';

export function icon(name: IconName): SVGSVGElement {
  const paths: Record<string, string> = {
    home: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-6.5 6.5h13M8 1.5c1.9 1.8 2.8 4 2.8 6.5S9.9 12.7 8 14.5M8 1.5C6.1 3.3 5.2 5.5 5.2 8s.9 4.7 2.8 6.5',
    back: 'M6.5 3.5 2 8l4.5 4.5M2.5 8H14',
    save: 'M3.5 1.5h9v13L8 11l-4.5 3.5z',
    list: 'M2 4h12M2 8h12M2 12h8',
    layers: 'M8 1.5 14.5 5 8 8.5 1.5 5zM1.5 8 8 11.5 14.5 8M1.5 11 8 14.5 14.5 11',
    up: 'M3 10l5-5 5 5',
    down: 'M3 6l5 5 5-5',
    tilt: 'M2 13h12M3.5 13 9 3.5M9 3.5l3 2',
    close: 'M4 4l8 8M12 4l-8 8',
    search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM10.4 10.4 14 14',
    eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    eyeOff: 'M2 2l12 12M6.2 3.8A6.7 6.7 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a12 12 0 0 1-2 2.6M9.4 12.3a6.4 6.4 0 0 1-1.4.2C4 12.5 1.5 8 1.5 8a12.3 12.3 0 0 1 2.7-3.2',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', paths[name]);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.5');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export async function copyText(text: string, button?: HTMLElement): Promise<void> {
  const done = (label: string) => {
    if (!button) return;
    const prev = button.textContent;
    button.textContent = label;
    setTimeout(() => (button.textContent = prev), 1400);
  };
  try {
    await navigator.clipboard.writeText(text);
    done('Copied');
  } catch {
    done('Select and copy');
  }
}

/** The round glass close button every panel carries. */
export function closeButton(onClick: () => void, label = 'Close'): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'x-btn', 'aria-label': label, title: label }, icon('close')) as HTMLButtonElement;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
