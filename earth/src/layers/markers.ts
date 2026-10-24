/**
 * Marker images drawn once to canvas and reused by billboards. Shape encodes
 * the data source (circle = earthquake, diamond = natural event, square =
 * query result, cross = satellite), so sources stay distinguishable without
 * relying on colour alone.
 */
export type MarkerShape = 'circle' | 'ring' | 'diamond' | 'square' | 'cross';

const cache = new Map<string, HTMLCanvasElement>();

export function marker(shape: MarkerShape, size: number, fill: string, stroke = 'rgba(5,7,10,0.85)'): HTMLCanvasElement {
  const px = Math.max(6, Math.round(size));
  const key = `${shape}|${px}|${fill}|${stroke}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const ratio = 2;
  const c = document.createElement('canvas');
  c.width = c.height = (px + 4) * ratio;
  const g = c.getContext('2d')!;
  g.scale(ratio, ratio);
  const m = (px + 4) / 2;
  const r = px / 2;
  g.lineWidth = 1.5;
  g.strokeStyle = stroke;
  g.fillStyle = fill;

  g.beginPath();
  switch (shape) {
    case 'circle':
      g.arc(m, m, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      break;
    case 'ring':
      g.arc(m, m, r - 1, 0, Math.PI * 2);
      g.lineWidth = 2;
      g.strokeStyle = fill;
      g.stroke();
      g.beginPath();
      g.arc(m, m, r + 0.5, 0, Math.PI * 2);
      g.lineWidth = 1;
      g.strokeStyle = stroke;
      g.stroke();
      break;
    case 'diamond':
      g.moveTo(m, m - r);
      g.lineTo(m + r, m);
      g.lineTo(m, m + r);
      g.lineTo(m - r, m);
      g.closePath();
      g.fill();
      g.stroke();
      break;
    case 'square':
      g.rect(m - r * 0.8, m - r * 0.8, r * 1.6, r * 1.6);
      g.fill();
      g.stroke();
      break;
    case 'cross':
      g.lineWidth = 2;
      g.strokeStyle = fill;
      g.moveTo(m - r, m);
      g.lineTo(m + r, m);
      g.moveTo(m, m - r);
      g.lineTo(m, m + r);
      g.stroke();
      g.beginPath();
      g.arc(m, m, r * 0.35, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      break;
  }
  cache.set(key, c);
  return c;
}

/** Colours shared with the CSS tokens. Semantic, separate from the accent. */
export const SWATCH = {
  quake: '#e2553f',
  quakeOld: 'rgba(226,85,63,0.62)',
  fire: '#f0773a',
  storm: '#9fc2e8',
  volcano: '#d23f2f',
  flood: '#4f93e0',
  ice: '#d7ecf5',
  dust: '#c9b27c',
  other: '#b7bfc7',
  satellite: '#9aa6b0',
  station: '#eef0ea',
  result: '#f3a83b',
} as const;

export function eventSwatch(category: string): string {
  switch (category) {
    case 'wildfires':
      return SWATCH.fire;
    case 'severeStorms':
      return SWATCH.storm;
    case 'volcanoes':
      return SWATCH.volcano;
    case 'floods':
      return SWATCH.flood;
    case 'seaLakeIce':
    case 'snow':
      return SWATCH.ice;
    case 'dustHaze':
    case 'drought':
      return SWATCH.dust;
    default:
      return SWATCH.other;
  }
}
