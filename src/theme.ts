import * as THREE from 'three';

/**
 * A theme is a whole printed world: the ground the hologram sits on, the ink its lines are
 * drawn in, and one accent for "this part". Light grounds turn the glow off and read like a
 * technical poster; dark grounds glow.
 */
export interface Theme {
  id: string;
  name: string;
  ground: string;
  ink: string;
  accent: string;
  /** The accent when it is used as text: lighter, so it passes WCAG AA on the ground. */
  accentText?: string;
  /** Text on the ground. */
  text: string;
  muted: string;
  line: string;
  /** Card / chip fill and its text. */
  panel: string;
  panelText: string;
  glow: boolean;
}

export const THEMES: Record<string, Theme> = {
  floatation: {
    id: 'floatation', name: 'Floatation',
    ground: '#E4572E', ink: '#FFF3EA', accent: '#14204D',
    text: '#FFF3EA', muted: '#FFD3BF', line: '#F59877', panel: '#FFF3EA', panelText: '#14204D', glow: false,
  },
  riso: {
    id: 'riso', name: 'Riso',
    ground: '#2B44B8', ink: '#F4EFE4', accent: '#FF4FA3', accentText: '#FFC2DF',
    text: '#F4EFE4', muted: '#B9C3F2', line: '#5468CC', panel: '#F4EFE4', panelText: '#1D2E80', glow: false,
  },
  bench: {
    id: 'bench', name: 'Bench',
    ground: '#E3E1DA', ink: '#1E2BFF', accent: '#FF3B14',
    text: '#14161F', muted: '#5E6070', line: '#C6C3B9', panel: '#14161F', panelText: '#E3E1DA', glow: false,
  },
  midnight: {
    id: 'midnight', name: 'Midnight riso',
    ground: '#0D0E27', ink: '#E7E3FF', accent: '#FF4FA3',
    text: '#E7E3FF', muted: '#9A97C8', line: '#2B2C5A', panel: '#E7E3FF', panelText: '#0D0E27', glow: true,
  },
};

export function pickTheme(): Theme {
  const q = new URLSearchParams(location.search).get('theme');
  return THEMES[q || ''] || THEMES.riso;
}

export function applyCss(t: Theme) {
  const r = document.documentElement.style;
  r.setProperty('--ground', t.ground);
  r.setProperty('--bone', t.text);
  r.setProperty('--bone-2', t.text);
  r.setProperty('--muted', t.muted);
  r.setProperty('--line', t.line);
  r.setProperty('--signal', t.accent);
  r.setProperty('--signal-text', t.accentText ?? t.accent);
  r.setProperty('--panel', t.panel);
  r.setProperty('--panel-text', t.panelText);
  document.documentElement.style.colorScheme = isDark(t.ground) ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.ground);
}

export function isDark(hex: string) {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 < 0.35;
}

export const theme = pickTheme();
