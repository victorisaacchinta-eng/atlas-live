// Camera navigation: held keys and a small on-screen NAV pad, both feeding stage.nav.
// W/S or ↑/↓ move forward and back, A/D slide sideways, Q/← and → turn, + and − zoom,
// Shift goes three times faster. On a hologram, forward closes in and sideways walks round it.
import type { Stage } from './stage';

type Axis = 'fwd' | 'side' | 'turn' | 'zoom';
type Bind = { axis: Axis; dir: 1 | -1 };

const KEYS: Record<string, Bind> = {
  w: { axis: 'fwd', dir: 1 }, arrowup: { axis: 'fwd', dir: 1 },
  s: { axis: 'fwd', dir: -1 }, arrowdown: { axis: 'fwd', dir: -1 },
  a: { axis: 'side', dir: -1 }, d: { axis: 'side', dir: 1 },
  q: { axis: 'turn', dir: -1 }, arrowleft: { axis: 'turn', dir: -1 }, arrowright: { axis: 'turn', dir: 1 },
  '=': { axis: 'zoom', dir: 1 }, '+': { axis: 'zoom', dir: 1 },
  '-': { axis: 'zoom', dir: -1 }, _: { axis: 'zoom', dir: -1 },
};

// Glyphs drawn on a 16 px grid, stroked in the key's ink colour.
const ICON: Record<string, string> = {
  fwd: '<path d="M8 3v10M4 7l4-4 4 4"/>',
  back: '<path d="M8 13V3M4 9l4 4 4-4"/>',
  left: '<path d="M3 8h10M7 4L3 8l4 4"/>',
  right: '<path d="M13 8H3M9 4l4 4-4 4"/>',
  tl: '<path d="M4.5 6.5A5 5 0 1 1 3.6 10"/><path d="M2.5 4v3.2h3.2"/>',
  tr: '<path d="M11.5 6.5A5 5 0 1 0 12.4 10"/><path d="M13.5 4v3.2h-3.2"/>',
  in: '<path d="M8 3.5v9M3.5 8h9"/>',
  out: '<path d="M3.5 8h9"/>',
};

const PAD: { id: string; label: string; cap: string; bind: Bind }[] = [
  { id: 'tl', label: 'Turn left', cap: '←', bind: { axis: 'turn', dir: -1 } },
  { id: 'fwd', label: 'Forward', cap: 'W', bind: { axis: 'fwd', dir: 1 } },
  { id: 'tr', label: 'Turn right', cap: '→', bind: { axis: 'turn', dir: 1 } },
  { id: 'in', label: 'Zoom in', cap: '+', bind: { axis: 'zoom', dir: 1 } },
  { id: 'left', label: 'Slide left', cap: 'A', bind: { axis: 'side', dir: -1 } },
  { id: 'back', label: 'Back', cap: 'S', bind: { axis: 'fwd', dir: -1 } },
  { id: 'right', label: 'Slide right', cap: 'D', bind: { axis: 'side', dir: 1 } },
  { id: 'out', label: 'Zoom out', cap: '−', bind: { axis: 'zoom', dir: -1 } },
];

/** The guided briefing uses the arrow keys for Back and Next. */
const tourOpen = () => { const el = document.querySelector('.c-tour'); return !!el && !el.hasAttribute('hidden'); };

/** Focus inside these means the arrows and letters belong to that control, not the camera. */
const OWNS_KEYS = 'input, textarea, select, [contenteditable], [role="slider"], [role="spinbutton"], [role="listbox"], .knob-body, dialog[open]';

export function initNav(stage: Stage, active: () => boolean) {
  // Each source (a key or a pad button) holds one binding; the axes are the sum, clamped.
  const held = new Map<string, Bind>();
  const sync = () => {
    const n = stage.nav;
    n.fwd = n.side = n.turn = n.zoom = 0;
    for (const b of held.values()) n[b.axis] = Math.max(-1, Math.min(1, n[b.axis] + b.dir));
    pad.classList.toggle('is-moving', held.size > 0);
  };
  const release = () => { held.clear(); stage.nav.fast = false; sync(); padKeys.forEach((k) => k.classList.remove('is-down')); };

  window.addEventListener('keydown', (e) => {
    stage.nav.fast = e.shiftKey;
    if (e.metaKey || e.ctrlKey || e.altKey || !active()) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(OWNS_KEYS) || tourOpen()) return;
    const b = KEYS[e.key.toLowerCase()];
    if (!b) return;
    e.preventDefault();
    held.set(`key:${e.key.toLowerCase()}`, b);
    sync();
  });
  window.addEventListener('keyup', (e) => {
    stage.nav.fast = e.shiftKey;
    if (held.delete(`key:${e.key.toLowerCase()}`)) sync();
  });
  // A key released while the window was in the background never sends keyup.
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });

  // ---------- the pad ----------
  const pad = document.createElement('div');
  pad.id = 'nav-pad';
  pad.className = 'nav-pad';
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Camera navigation. Keys: W A S D to move, Q and arrow keys to turn, plus and minus to zoom, Shift for speed');
  pad.innerHTML = '<span class="nav-plate">NAV</span><div class="nav-keys"></div><span class="nav-hint">Hold to move · Shift ×3</span>';
  const grid = pad.querySelector('.nav-keys')!;
  const padKeys = PAD.map((k) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-key';
    btn.dataset.nav = k.id;
    btn.setAttribute('aria-label', k.label);
    btn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${ICON[k.id]}</svg><kbd>${k.cap}</kbd>`;
    const src = `pad:${k.id}`;
    const up = () => { if (held.delete(src)) sync(); btn.classList.remove('is-down'); };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('is-down');
      held.set(src, k.bind);
      sync();
    });
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    // Enter or Space on a focused key: a short nudge, so the pad works without a mouse too.
    btn.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      held.set(src, k.bind); sync();
      btn.classList.add('is-down');
      setTimeout(up, 280);
    });
    grid.appendChild(btn);
    return btn;
  });
  document.body.appendChild(pad);
  return { pad, release };
}
