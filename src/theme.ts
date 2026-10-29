import * as THREE from 'three';

/**
 * ATLAS themes. Semantic tokens, two modes (dark and light) plus "system".
 * Brand reference: NVIDIA Green #76B900 (from NVIDIA's published brand guide). Every other value is
 * an ATLAS project token, not an official NVIDIA palette.
 */
export interface Theme {
  id: 'dark' | 'light';
  ground: string;        // app background, also the 3D scene background
  surface: string;
  surfaceRaised: string;
  surfaceSubtle: string;
  ink: string;           // hologram line colour
  text: string;
  text2: string;
  muted: string;
  line: string;
  lineStrong: string;
  selection: string;
  focus: string;
  accent: string;        // brand green: primary actions, selected states, meaningful highlights
  accentText: string;    // the accent when used as text on the ground (passes AA)
  accentInk: string;     // text on a green fill
  ok: string; warn: string; bad: string; info: string; agent: string;
  glow: boolean;
}

export const THEMES: Record<Theme['id'], Theme> = {
  dark: {
    id: 'dark', ground: '#0B0D0B', surface: '#111411', surfaceRaised: '#191D18', surfaceSubtle: '#20251E',
    ink: '#E8F5D0', text: '#F7F8F5', text2: '#B7BDB2', muted: '#939B8D', line: '#30372B', lineStrong: '#41483D',
    selection: '#25331A', focus: '#A3E635', accent: '#76B900', accentText: '#8BCB22', accentInk: '#0B0D0B',
    ok: '#22C55E', warn: '#F59E0B', bad: '#EF4444', info: '#38BDF8', agent: '#A78BFA', glow: true,
  },
  light: {
    id: 'light', ground: '#F5F6F3', surface: '#FFFFFF', surfaceRaised: '#FFFFFF', surfaceSubtle: '#ECEFE9',
    ink: '#2F4A06', text: '#181B17', text2: '#525A50', muted: '#6C7468', line: '#D8DDD4', lineStrong: '#B8C0B3',
    selection: '#E7F2D6', focus: '#4D7C0F', accent: '#76B900', accentText: '#3B6100', accentInk: '#0B0D0B',
    ok: '#15803D', warn: '#B45309', bad: '#B91C1C', info: '#0369A1', agent: '#6D28D9', glow: false,
  },
};

export type ThemeMode = 'light' | 'dark' | 'system';
const KEY = 'atlas-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function savedMode(): ThemeMode {
  const q = new URLSearchParams(location.search).get('theme');
  if (q === 'light' || q === 'dark') return q;
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* storage blocked */ }
  return 'system';
}
export function resolve(mode: ThemeMode): Theme { return THEMES[mode === 'system' ? (media.matches ? 'dark' : 'light') : mode]; }
export function saveMode(mode: ThemeMode) { try { localStorage.setItem(KEY, mode); } catch { /* storage blocked */ } }
export function onSystemChange(fn: () => void) { media.addEventListener('change', fn); }

export function applyCss(t: Theme) {
  const r = document.documentElement.style;
  const set: Record<string, string> = {
    '--ground': t.ground, '--surface': t.surface, '--surface-raised': t.surfaceRaised, '--surface-subtle': t.surfaceSubtle,
    '--bone': t.text, '--bone-2': t.text2, '--muted': t.muted, '--line': t.line, '--line-strong': t.lineStrong,
    '--selection': t.selection, '--focus': t.focus,
    '--signal': t.accent, '--signal-text': t.accentText, '--action': t.accent, '--action-ink': t.accentInk,
    '--panel': t.surfaceRaised, '--panel-text': t.text,
    '--ok': t.ok, '--warn': t.warn, '--bad': t.bad, '--info': t.info, '--review': t.info, '--agent': t.agent, '--ok-ink': '#0B0D0B',
  };
  for (const [k, v] of Object.entries(set)) r.setProperty(k, v);
  document.documentElement.dataset.theme = t.id;
  document.documentElement.style.colorScheme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.ground);
}

export function isDark(hex: string) {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 < 0.35;
}

/** The theme at load. Live switches update CSS and the scene background; the hologram keeps its ink. */
export const theme: Theme = resolve(savedMode());
