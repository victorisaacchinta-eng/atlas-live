import { Cartesian3 } from 'cesium';
import { local } from '../core/http';
import type { CameraState, Navigator } from '../engine/navigator';
import { $, clear, h, icon } from './dom';

interface SavedView {
  id: string;
  name: string;
  at: number;
  state: { x: number; y: number; z: number; heading: number; pitch: number; roll: number };
}

export function mountNavpad(nav: Navigator, hooks: { toggleLayers(): void; toggleClean(): boolean; currentName(): string }) {
  const root = $('#navpad');
  let saved = local.get<SavedView[]>('saved-views', []);
  let pop: HTMLElement | null = null;

  const home = h('button', { type: 'button', 'aria-label': 'Whole planet (H)', title: 'Whole planet (H)', onclick: () => void nav.home() }, icon('home'), h('span', { class: 'label' }, 'Planet'));
  const back = h('button', { type: 'button', 'aria-label': 'Previous view (B)', title: 'Previous view (B)', disabled: true, onclick: () => void nav.back().then(sync) }, icon('back'), h('span', { class: 'label' }, 'Back')) as HTMLButtonElement;
  const views = h('button', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Saved views', onclick: () => toggle() }, icon('save'), h('span', { class: 'label' }, 'Saved'));
  const layers = h('button', { type: 'button', 'aria-label': 'Layers (L)', title: 'Layers (L)', 'aria-pressed': 'true', onclick: () => hooks.toggleLayers() }, icon('layers'), h('span', { class: 'label' }, 'Layers'));
  const clean = h('button', { type: 'button', 'aria-label': 'Hide all panels (U)', title: 'Hide all panels (U)', 'aria-pressed': 'false' }, icon('eyeOff'), h('span', { class: 'label' }, 'Clean'));
  clean.addEventListener('click', () => setClean(hooks.toggleClean()));
  function setClean(on: boolean) {
    clean.setAttribute('aria-pressed', String(on));
    clean.replaceChildren(icon(on ? 'eye' : 'eyeOff'), h('span', { class: 'label' }, on ? 'Show' : 'Clean'));
    clean.setAttribute('aria-label', on ? 'Show panels (U)' : 'Hide all panels (U)');
  }
  document.addEventListener('mizpah:layers', (e) => layers.setAttribute('aria-pressed', String((e as CustomEvent<{ open: boolean }>).detail.open)));

  root.append(home, back, views, layers, clean);

  function sync() {
    back.disabled = !nav.canGoBack();
  }
  nav.onView(sync);

  function persist() {
    local.set('saved-views', saved);
  }

  function saveCurrent(name: string) {
    const s = nav.snapshot();
    saved = [
      { id: String(Date.now()), name: name || hooks.currentName(), at: Date.now(), state: { x: s.position.x, y: s.position.y, z: s.position.z, heading: s.heading, pitch: s.pitch, roll: s.roll } },
      ...saved,
    ].slice(0, 40);
    persist();
  }

  function restore(v: SavedView) {
    const st: CameraState = { position: new Cartesian3(v.state.x, v.state.y, v.state.z), heading: v.state.heading, pitch: v.state.pitch, roll: v.state.roll };
    void nav.restore(st);
  }

  function renderPop() {
    if (!pop) return;
    clear(pop);
    const input = h('input', { id: 'save-name', type: 'text', placeholder: hooks.currentName(), 'aria-label': 'Name for this view', maxlength: 60 }) as HTMLInputElement;
    const form = h('form', null, input, h('button', { class: 'btn primary', type: 'submit' }, 'Save view'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveCurrent(input.value.trim());
      renderPop();
    });
    pop.append(h('h3', null, 'Saved views, in this browser'));
    if (!saved.length) pop.append(h('p', { class: 'empty' }, 'Nothing saved yet. Name the current view and save it.'));
    else {
      const ul = h('ul', null);
      for (const v of saved) {
        ul.append(
          h(
            'li',
            null,
            h('button', { type: 'button', class: 'go', onclick: () => (restore(v), toggle(false)) }, v.name),
            h(
              'button',
              {
                type: 'button',
                class: 'del',
                'aria-label': `Remove ${v.name}`,
                onclick: () => {
                  saved = saved.filter((s) => s.id !== v.id);
                  persist();
                  renderPop();
                },
              },
              'Remove',
            ),
          ),
        );
      }
      pop.append(ul);
    }
    pop.append(form);
  }

  function toggle(force?: boolean) {
    const open = force ?? !pop;
    if (!open && pop) {
      pop.remove();
      pop = null;
    } else if (open && !pop) {
      pop = h('div', { class: 'popover glass', role: 'dialog', 'aria-label': 'Saved views' });
      root.append(pop);
      renderPop();
      (pop.querySelector('input') as HTMLInputElement | null)?.focus();
    }
    views.setAttribute('aria-expanded', String(!!pop));
  }

  document.addEventListener('pointerdown', (e) => {
    if (pop && !root.contains(e.target as Node)) toggle(false);
  });

  return {
    setClean,
    saveNamed(name: string) {
      saveCurrent(name);
    },
    close: () => toggle(false),
    isOpen: () => !!pop,
  };
}
