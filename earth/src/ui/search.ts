import { geocoderLabel, searchPlaces, type Place } from '../services/geocode';
import type { Landmark } from '../data/landmarks';
import { isAbort } from '../core/http';
import type { LatLon } from '../core/geo';
import { $, clear, h } from './dom';

type Item = { type: 'place'; place: Place } | { type: 'ask'; text: string } | { type: 'landmark'; landmark: Landmark };

const QUESTION =
  /\?|^(what|where|which|how|why|who|is|are|show|find|take|go|fly|compare|weather|list|explain|describe|summari[sz]e|zoom|tilt|reset|back|turn|hide|switch|any|tell)\b|\b(here|this area|near me|in this|earthquakes?|fires?|storms?|rivers?|stations?|weather|satellites?|iss)\b/i;

export interface SearchCallbacks {
  onPlace(p: Place): void;
  onAsk(text: string): void;
  onLandmark(l: Landmark): void;
  /** Offered when the field is empty and focused. */
  landmarks: Landmark[];
  near(): LatLon | null;
}

/**
 * One field for finding places and asking questions. Places come from
 * Photon as you type; the last row always offers to ask the question
 * instead, and comes first when the text reads like a question.
 */
export function mountSearch(cb: SearchCallbacks): { focus(): void; set(text: string): void } {
  const form = $('#search') as HTMLFormElement;
  const input = $('#q') as HTMLInputElement;
  const list = $('#suggestions') as HTMLUListElement;
  let items: Item[] = [];
  let active = -1;
  let timer: number | undefined;
  let controller: AbortController | null = null;
  let state: 'idle' | 'loading' | 'error' | 'done' = 'idle';

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const render = () => {
    clear(list);
    const text = input.value.trim();
    const landmarks = !text && items.length > 0 && items.every((it) => it.type === 'landmark');
    if (!text && !landmarks) return close();
    if (landmarks) list.append(h('li', { class: 's-head', role: 'presentation' }, 'Landmarks in 3D'));
    items.forEach((it, i) => {
      const id = `sg-${i}`;
      const li =
        it.type === 'place'
          ? h('li', { id, role: 'option', 'aria-selected': String(i === active) }, h('span', { class: 's-name' }, it.place.name), h('span', { class: 's-kind' }, it.place.kind), it.place.context ? h('span', { class: 's-context' }, it.place.context) : null)
          : it.type === 'landmark'
            ? h('li', { id, role: 'option', 'aria-selected': String(i === active) }, h('span', { class: 's-name' }, it.landmark.name), h('span', { class: 's-kind' }, 'Circle in 3D'), h('span', { class: 's-context' }, it.landmark.city))
            : h('li', { id, role: 'option', class: 's-ask', 'aria-selected': String(i === active) }, h('span', { class: 's-name' }, `"${it.text}"`), h('span', { class: 's-kind' }, 'Enter'));
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(i);
      });
      list.append(li);
    });
    if (state === 'loading' && !items.some((i) => i.type === 'place')) list.append(h('li', { class: 's-state', role: 'presentation' }, `Searching ${geocoderLabel()}`));
    if (items.some((i) => i.type === 'place') && geocoderLabel() !== 'OpenStreetMap') list.append(h('li', { class: 's-state', role: 'presentation' }, `Places from ${geocoderLabel()}`));
    if (state === 'error') list.append(h('li', { class: 's-state', role: 'presentation' }, 'Place search is unavailable right now. Press Enter to ask instead.'));
    if (state === 'done' && !items.some((i) => i.type === 'place')) list.append(h('li', { class: 's-state', role: 'presentation' }, 'No places match. Press Enter to ask instead.'));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `sg-${active}`);
  };

  const build = (places: Place[]) => {
    const text = input.value.trim();
    const ask: Item = { type: 'ask', text };
    const questiony = QUESTION.test(text);
    const placeItems: Item[] = places.slice(0, questiony ? 3 : 6).map((p) => ({ type: 'place', place: p }));
    items = questiony ? [ask, ...placeItems] : [...placeItems, ask];
    active = 0;
    render();
  };

  const cancelPending = () => {
    window.clearTimeout(timer);
    controller?.abort();
  };

  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    cancelPending();
    close();
    if (it.type === 'place') {
      input.value = it.place.name;
      cb.onPlace(it.place);
    } else if (it.type === 'landmark') {
      input.value = it.landmark.name;
      cb.onLandmark(it.landmark);
    } else {
      cb.onAsk(it.text);
    }
    input.blur();
  };

  input.addEventListener('input', () => {
    const text = input.value.trim();
    window.clearTimeout(timer);
    controller?.abort();
    const paid = geocoderLabel() !== 'OpenStreetMap';
    if (!text) {
      showLandmarks();
      return;
    }
    if (text.length < (paid ? 3 : 2)) {
      items = [{ type: 'ask', text }];
      state = 'idle';
      active = 0;
      render();
      return;
    }
    state = 'loading';
    build([]);
    timer = window.setTimeout(async () => {
      controller = new AbortController();
      try {
        const places = await searchPlaces(text, { signal: controller.signal, near: cb.near() });
        if (input.value.trim() !== text || document.activeElement !== input) return;
        state = 'done';
        build(places);
      } catch (err) {
        if (isAbort(err) || document.activeElement !== input) return;
        state = 'error';
        build([]);
      }
    }, paid ? 520 : 280);
  });

  function showLandmarks() {
    items = cb.landmarks.map((landmark) => ({ type: 'landmark' as const, landmark }));
    state = 'idle';
    active = -1;
    render();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === 'Escape') {
      if (!list.hidden) close();
      else input.blur();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (items.length && active >= 0) choose(active);
    else {
      cancelPending();
      close();
      cb.onAsk(text);
      input.blur();
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('focus', () => {
    if (!input.value.trim()) showLandmarks();
    else if (items.length) render();
  });

  return {
    focus: () => {
      input.focus();
      input.select();
    },
    set: (text: string) => {
      input.value = text;
    },
  };
}
