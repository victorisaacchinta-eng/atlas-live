import { LANGS, LANG_BY_CODE, type Lang } from '../api/_langs';
import { UI_STRINGS, type UiKey } from '../api/_ui-strings';

/**
 * The viewer's language: interface strings and the default language of a Short.
 * Elements opt in with data-i18n="key" (text) or data-i18n-ph="key" (placeholder). Each translated
 * element gets its own lang and dir, so screen readers switch voice for it and the rest of the page
 * keeps its English tagging.
 */
const KEY = 'atlas-lang';
let current = 'en';
let strings: Record<string, string> = { ...UI_STRINGS };
let machine = false;
const listeners = new Set<() => void>();

export function savedLang(): string {
  try { const v = localStorage.getItem(KEY); return v && LANG_BY_CODE[v] ? v : 'en'; } catch { return 'en'; }
}
export const lang = () => current;
export const langInfo = (c = current): Lang => LANG_BY_CODE[c] ?? LANG_BY_CODE.en;
export const isMachine = () => machine;
export function t(key: UiKey) { return strings[key] ?? UI_STRINGS[key]; }
export function onLangChange(fn: () => void) { listeners.add(fn); }

/** Tag an element that shows a translated string. */
export function tag(el: HTMLElement) {
  const L = langInfo();
  el.lang = L.code;
  el.dir = L.rtl ? 'rtl' : 'ltr';
  return el;
}

function apply() {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n as UiKey); tag(el); });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh as UiKey); tag(el); });
  listeners.forEach((fn) => fn());
}

export async function setLang(code: string, remember = true) {
  if (!LANG_BY_CODE[code]) code = 'en';
  current = code;
  if (remember) { try { localStorage.setItem(KEY, code); } catch { /* per-viewer only */ } }
  if (code === 'en') { strings = { ...UI_STRINGS }; machine = false; apply(); return; }
  try {
    const r = await fetch(`/api/i18n?lang=${encodeURIComponent(code)}`);
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    if (current !== code) return; // the viewer picked another language meanwhile
    strings = { ...UI_STRINGS, ...j.strings };
    machine = !!j.machine;
  } catch {
    // Interface stays English; Shorts can still be written in the chosen language.
    strings = { ...UI_STRINGS };
    machine = false;
  }
  apply();
}

/** The corner language menu: every scheduled language in its own script, with its English name. */
export function mountMenu(host: HTMLElement) {
  const wrap = document.createElement('label');
  wrap.className = 'lang-menu';
  const sr = document.createElement('span');
  sr.className = 'visually-hidden';
  sr.dataset.i18n = 'language';
  sr.textContent = t('language');
  const globe = document.createElement('span');
  globe.className = 'lang-glyph';
  globe.setAttribute('aria-hidden', 'true');
  globe.textContent = 'अ/A';
  const sel = document.createElement('select');
  sel.id = 'lang-select';
  for (const L of LANGS) {
    const o = document.createElement('option');
    o.value = L.code;
    o.lang = L.code;
    o.textContent = L.code === 'en' ? 'English' : `${L.native} · ${L.name}${L.beta ? ' (beta)' : ''}`;
    sel.append(o);
  }
  sel.value = current;
  sel.addEventListener('change', () => { void setLang(sel.value); });
  onLangChange(() => { sel.value = current; wrap.title = machine ? t('machine_translated') : ''; });
  wrap.append(sr, globe, sel);
  host.prepend(wrap);
}
