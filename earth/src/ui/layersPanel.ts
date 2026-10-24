import { KIND_LABEL, relativeTime } from '../core/provenance';
import type { LayerManager } from '../layers/manager';
import type { LayerDef, LayerGroup } from '../layers/types';
import { S2_YEARS } from '../layers/imagery';
import { $, clear, closeButton, h } from './dom';

const GROUPS: Array<{ id: LayerGroup; title: string }> = [
  { id: 'base', title: 'Ground imagery' },
  { id: 'overlay', title: 'Reference' },
  { id: 'live', title: 'Live and recent' },
  { id: 'detail', title: 'Terrain and 3D' },
];

export interface LayerPanelHooks {
  extraControls(def: LayerDef): HTMLElement | null;
  openKeys(): void;
}

export function mountLayersPanel(mgr: LayerManager, hooks: LayerPanelHooks): { refresh(): void; toggleCollapsed(force?: boolean): void } {
  const root = $('#layers');
  const rows = new Map<string, { el: HTMLElement; summary: HTMLElement; controls: HTMLElement }>();

  const head = h('div', { class: 'panel-head' }, h('h2', { id: 'layers-title', class: 'panel-title' }, 'Layers'));
  const groups = h('div', { class: 'layer-groups panel-scroll', id: 'layer-groups' });
  root.append(head, groups);
  root.setAttribute('aria-labelledby', 'layers-title');

  for (const g of GROUPS) {
    const defs = mgr.list().filter((d) => d.group === g.id);
    if (!defs.length) continue;
    const section = h('section', { class: 'layer-group' }, h('h3', null, g.title));
    for (const def of defs) section.append(row(def));
    groups.append(section);
  }

  function row(def: LayerDef): HTMLElement {
    const radio = !!def.exclusive;
    const tick = h('span', { class: `tick${radio ? ' radio' : ''}`, 'aria-hidden': 'true' });
    const button = h(
      'button',
      {
        class: 'layer-row',
        type: 'button',
        role: radio ? 'radio' : 'switch',
        'aria-checked': 'false',
        onclick: () => {
          if (mgr.state(def.id).status === 'locked') return hooks.openKeys();
          void mgr.toggle(def.id);
        },
      },
      tick,
      h('span', { class: 'layer-title' }, def.title),
      h('span', { class: 'layer-kind' }, def.needsIon ? 'Cesium ion' : KIND_LABEL[def.provenance.kind]),
    );
    const about = h('button', { type: 'button', class: 'layer-about', 'aria-expanded': 'false', 'aria-label': `About ${def.title}` }, 'About');
    const summary = h('div', { class: 'layer-summary', 'aria-live': 'polite' });
    const controls = h('div', { class: 'layer-controls' });
    controls.hidden = true;

    const legend = def.legend
      ? h(
          'div',
          null,
          def.legend.items
            ? h(
                'ul',
                { class: 'legend' },
                ...def.legend.items.map((it) => h('li', null, h('i', { class: it.shape ?? 'square', style: `background:${it.swatch}` }), it.label)),
              )
            : null,
          def.legend.imageUrl ? h('img', { class: 'legend-img', src: def.legend.imageUrl, alt: def.legend.note ?? 'Legend', loading: 'lazy' }) : null,
          def.legend.note ? h('p', { class: 'src' }, def.legend.note) : null,
        )
      : null;

    const details = h(
      'div',
      { class: 'layer-details', hidden: true },
      h(
        'div',
        { class: 'layer-more' },
        h('p', null, def.purpose),
        legend,
        h(
          'p',
          { class: 'src' },
          def.provenance.url ? h('a', { href: def.provenance.url, target: '_blank', rel: 'noopener' }, def.provenance.source) : def.provenance.source,
          def.provenance.licence ? `. ${def.provenance.licence}.` : '.',
        ),
        def.provenance.note ? h('p', { class: 'src' }, def.provenance.note) : null,
        def.needsIon ? h('p', null, h('button', { type: 'button', class: 'chip-btn', onclick: () => hooks.openKeys() }, 'Add a Cesium ion token')) : null,
      ),
    );

    about.addEventListener('click', () => {
      details.hidden = !details.hidden;
      about.setAttribute('aria-expanded', String(!details.hidden));
    });
    const el = h('div', { class: 'layer', 'data-id': def.id, 'data-kind': def.provenance.kind, 'data-status': 'off' }, h('div', { class: 'layer-line' }, button, about), summary, controls, details);
    rows.set(def.id, { el, summary, controls });
    return el;
  }

  function paint(id: string) {
    const r = rows.get(id);
    const def = mgr.get(id);
    if (!r || !def) return;
    const st = mgr.state(id);
    r.el.dataset.status = st.status;
    const btn = r.el.querySelector('.layer-row')!;
    btn.setAttribute('aria-checked', String(st.status === 'on' || st.status === 'loading'));
    let text = '';
    if (st.status === 'loading') text = 'Loading';
    else if (st.status === 'error') text = st.message ?? 'Could not load';
    else if (st.status === 'locked') text = 'Needs a Cesium ion token';
    else if (st.status === 'on') {
      text = def.summary?.() ?? '';
      if (!text && def.provenance.fetchedAt) text = `Fetched ${relativeTime(def.provenance.fetchedAt)}`;
    }
    r.summary.textContent = text;
    const on = st.status === 'on';
    clear(r.controls);
    const extra = on ? hooks.extraControls(def) : null;
    if (extra) r.controls.append(extra);
    r.controls.hidden = !extra;
  }

  mgr.onChange((id) => paint(id));
  for (const d of mgr.list()) paint(d.id);
  // Summaries carry relative times ("3 min ago"), so refresh them quietly.
  setInterval(() => {
    for (const d of mgr.active()) {
      const r = rows.get(d.id);
      if (r && d.summary) r.summary.textContent = d.summary();
    }
  }, 15_000);

  const toggleCollapsed = (force?: boolean) => {
    const collapsed = force ?? !root.classList.contains('collapsed');
    root.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('layers-closed', collapsed);
    document.dispatchEvent(new CustomEvent('mizpah:layers', { detail: { open: !collapsed } }));
  };
  head.append(closeButton(() => toggleCollapsed(true), 'Close layers'));

  return {
    refresh: () => {
      for (const d of mgr.list()) paint(d.id);
    },
    toggleCollapsed,
  };
}

/** Builds the small control strips some layers carry when on. */
export function controlsFor(
  def: LayerDef,
  api: {
    date(): string;
    today(): string;
    setDate(d: string): void;
    year(): number;
    setYear(y: number): void;
    exaggeration(): number;
    setExaggeration(v: number): void;
    hiddenCategories(): Set<string>;
    toggleCategory(c: string): void;
  },
): HTMLElement | null {
  if (def.id === 'base-daily') {
    const shift = (days: number) => {
      const d = new Date(`${api.date()}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      const iso = d.toISOString().slice(0, 10);
      if (iso <= api.today() && iso >= '2018-01-05') api.setDate(iso);
    };
    const input = h('input', { type: 'date', id: 'daily-date', value: api.date(), max: api.today(), min: '2018-01-05', 'aria-label': 'Imagery date (UTC)' }) as HTMLInputElement;
    input.addEventListener('change', () => input.value && api.setDate(input.value));
    const prev = h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Previous day' }, 'Earlier');
    prev.addEventListener('click', () => shift(-1));
    const next = h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Next day', disabled: api.date() >= api.today() }, 'Later');
    next.addEventListener('click', () => shift(1));
    return h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, prev, input, next);
  }
  if (def.id === 'base-sentinel') {
    const select = h('select', { id: 'sentinel-year', 'aria-label': 'Mosaic year' }, ...S2_YEARS.map((y) => h('option', { value: y, selected: y === api.year() }, String(y)))) as HTMLSelectElement;
    select.addEventListener('change', () => api.setYear(Number(select.value)));
    return h('div', { style: 'display:flex;gap:8px;align-items:center' }, h('label', { for: 'sentinel-year', class: 'muted' }, 'Year'), select);
  }
  if (def.id === 'terrain') {
    const wrap = h('div', { style: 'display:flex;gap:4px;align-items:center', role: 'group', 'aria-label': 'Terrain height' }, h('span', { class: 'muted', style: 'margin-right:4px' }, 'Height'));
    for (const v of [1, 2, 3]) {
      wrap.append(h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(api.exaggeration() === v), onclick: () => api.setExaggeration(v) }, v === 1 ? 'True' : `${v}x`));
    }
    return wrap;
  }
  if (def.id === 'events') {
    const cats: Array<[string, string]> = [
      ['wildfires', 'Fires'],
      ['severeStorms', 'Storms'],
      ['volcanoes', 'Volcanoes'],
      ['seaLakeIce', 'Ice'],
    ];
    const hidden = api.hiddenCategories();
    return h(
      'div',
      { style: 'display:flex;gap:4px;flex-wrap:wrap', role: 'group', 'aria-label': 'Event types' },
      ...cats.map(([id, label]) => h('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(!hidden.has(id)), onclick: () => api.toggleCategory(id) }, label)),
    );
  }
  return null;
}
