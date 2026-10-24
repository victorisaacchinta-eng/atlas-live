/**
 * The assistant never touches the globe directly. A planner (rules or a
 * language model) turns a request into a list of these operations; the
 * executor validates each one and runs it against real data providers.
 * Anything the planner says that is not an operation is shown as model
 * knowledge, never as an observation.
 */

export const LAYER_IDS = [
  'labels',
  'borders',
  'night-lights',
  'precipitation',
  'quakes',
  'events',
  'satellites',
  'terrain',
  'buildings',
  'buildings-ion',
  'photoreal-3d',
] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export const BASE_IDS = ['sentinel', 'daily', 'bluemarble', 'streets', 'aerial'] as const;
export type BaseId = (typeof BASE_IDS)[number];

export const FEATURE_KINDS = ['rivers', 'transit', 'peaks', 'airports', 'hospitals', 'universities', 'parks'] as const;

export const SCALES = ['planet', 'continent', 'country', 'region', 'city', 'street'] as const;

export type Op =
  | { op: 'fly_to'; place: string; scale?: (typeof SCALES)[number] }
  | { op: 'fly_to_coords'; lat: number; lon: number; scale?: (typeof SCALES)[number] }
  | { op: 'fly_to_satellite'; name: string }
  | { op: 'set_scale'; scale: (typeof SCALES)[number] }
  | { op: 'tilt'; degrees: number }
  | { op: 'set_layer'; layer: LayerId; on: boolean }
  | { op: 'set_base'; base: BaseId }
  | { op: 'set_date'; date: string }
  | { op: 'set_exaggeration'; factor: number }
  | { op: 'conditions'; place?: string }
  | { op: 'find_quakes'; near?: string; radius_km?: number; min_magnitude?: number }
  | { op: 'find_events'; category?: string; near?: string; radius_km?: number }
  | { op: 'find_features'; kind: (typeof FEATURE_KINDS)[number]; place?: string }
  | { op: 'compare'; kind: 'years' | 'days'; a: string; b: string }
  | { op: 'stop_compare' }
  | { op: 'reset' }
  | { op: 'back' }
  | { op: 'orbit' }
  | { op: 'note'; text: string }
  | { op: 'unsupported'; reason: string; suggestion?: string };

export interface Plan {
  ops: Op[];
  /** Which planner produced this plan, shown to the user. */
  planner: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
}

function num(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | null {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;
}

/** Validates untrusted planner output. Invalid operations are dropped, never guessed at. */
export function validateOps(raw: unknown): { ops: Op[]; rejected: number } {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { ops?: unknown })?.ops) ? (raw as { ops: unknown[] }).ops : [];
  const ops: Op[] = [];
  let rejected = 0;
  for (const item of list.slice(0, 8)) {
    const o = item as Record<string, unknown>;
    const op = validateOne(o);
    if (op) ops.push(op);
    else rejected++;
  }
  return { ops, rejected };
}

function validateOne(o: Record<string, unknown>): Op | null {
  switch (o?.op) {
    case 'fly_to': {
      const place = str(o.place, 160);
      if (!place) return null;
      const scale = oneOf(o.scale, SCALES) ?? undefined;
      return { op: 'fly_to', place, scale };
    }
    case 'fly_to_coords': {
      const lat = num(o.lat, -90, 90);
      const lon = num(o.lon, -180, 180);
      if (lat == null || lon == null) return null;
      return { op: 'fly_to_coords', lat, lon, scale: oneOf(o.scale, SCALES) ?? undefined };
    }
    case 'fly_to_satellite': {
      const name = str(o.name, 60);
      return name ? { op: 'fly_to_satellite', name } : null;
    }
    case 'set_scale': {
      const scale = oneOf(o.scale, SCALES);
      return scale ? { op: 'set_scale', scale } : null;
    }
    case 'tilt': {
      const degrees = num(o.degrees, -80, 80);
      return degrees == null ? null : { op: 'tilt', degrees };
    }
    case 'set_layer': {
      const layer = oneOf(o.layer, LAYER_IDS);
      if (!layer || typeof o.on !== 'boolean') return null;
      return { op: 'set_layer', layer, on: o.on };
    }
    case 'set_base': {
      const base = oneOf(o.base, BASE_IDS);
      return base ? { op: 'set_base', base } : null;
    }
    case 'set_date': {
      const date = str(o.date, 10);
      return date && DATE_RE.test(date) ? { op: 'set_date', date } : null;
    }
    case 'set_exaggeration': {
      const factor = num(o.factor, 1, 5);
      return factor == null ? null : { op: 'set_exaggeration', factor };
    }
    case 'conditions':
      return { op: 'conditions', place: str(o.place, 160) ?? undefined };
    case 'find_quakes':
      return {
        op: 'find_quakes',
        near: str(o.near, 160) ?? undefined,
        radius_km: num(o.radius_km, 1, 20_000) ?? undefined,
        min_magnitude: num(o.min_magnitude, 0, 10) ?? undefined,
      };
    case 'find_events':
      return {
        op: 'find_events',
        category: str(o.category, 40) ?? undefined,
        near: str(o.near, 160) ?? undefined,
        radius_km: num(o.radius_km, 1, 20_000) ?? undefined,
      };
    case 'find_features': {
      const kind = oneOf(o.kind, FEATURE_KINDS);
      return kind ? { op: 'find_features', kind, place: str(o.place, 160) ?? undefined } : null;
    }
    case 'compare': {
      const kind = oneOf(o.kind, ['years', 'days'] as const);
      const a = str(o.a, 10);
      const b = str(o.b, 10);
      if (!kind || !a || !b) return null;
      if (kind === 'years' && !(/^\d{4}$/.test(a) && /^\d{4}$/.test(b))) return null;
      if (kind === 'days' && !(DATE_RE.test(a) && DATE_RE.test(b))) return null;
      return { op: 'compare', kind, a, b };
    }
    case 'stop_compare':
      return { op: 'stop_compare' };
    case 'reset':
      return { op: 'reset' };
    case 'back':
      return { op: 'back' };
    case 'orbit':
      return { op: 'orbit' };
    case 'note': {
      const text = str(o.text, 1200);
      return text ? { op: 'note', text } : null;
    }
    case 'unsupported': {
      const reason = str(o.reason, 400);
      return reason ? { op: 'unsupported', reason, suggestion: str(o.suggestion, 300) ?? undefined } : null;
    }
    default:
      return null;
  }
}

/** What the assistant can see about the current view. Sent to the model planner; no personal data. */
export interface PlannerContext {
  today: string;
  imageryDate: string;
  view: { lat: number; lon: number; altitude_m: number; scale: string } | null;
  selected: { title: string; lat: number; lon: number; kind: string } | null;
  layersOn: string[];
  base: string | null;
  ionAvailable: boolean;
}
