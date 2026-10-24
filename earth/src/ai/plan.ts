import { validateOps, LAYER_IDS, BASE_IDS, FEATURE_KINDS, SCALES, type PlannerContext } from './ops.js';

/**
 * The model planner, independent of any provider. A host passes in a
 * function that sends a system prompt and a user message to its model and
 * returns the reply text; this module builds the prompt, limits abuse, and
 * turns the reply into validated operations. Runs on the server only.
 * Imports carry .js extensions so the file also runs as plain Node ESM.
 */

export type Complete = (system: string, user: string) => Promise<string>;

export interface PlanResult {
  status: number;
  body: unknown;
}

const MAX_INPUT = 500;

export function systemPrompt(ctx: PlannerContext): string {
  return `You plan actions for a 3D Earth explorer (globe from orbit, Google photorealistic 3D cities up close). Reply with JSON only: {"ops":[...]} with at most 6 operations.

Operations:
- {"op":"fly_to","place":"<place name as a person would type it>","scale"?:one of ${JSON.stringify(SCALES)}}
- {"op":"fly_to_coords","lat":number,"lon":number,"scale"?:...}
- {"op":"fly_to_satellite","name":"iss"|"tiangong"|"<satellite name>"}
- {"op":"set_scale","scale":...}
- {"op":"tilt","degrees":number between -80 and 80, positive looks towards the horizon}
- {"op":"set_layer","layer":one of ${JSON.stringify(LAYER_IDS)},"on":true|false}
- {"op":"set_base","base":one of ${JSON.stringify(BASE_IDS)}}  (daily = satellite image of one UTC day, sentinel = yearly cloud-free mosaic)
- {"op":"set_date","date":"YYYY-MM-DD"}  (daily imagery date; must not be after ${ctx.today})
- {"op":"set_exaggeration","factor":1 to 5}  (terrain height multiplier)
- {"op":"conditions","place"?:"<place>"}  (weather, air quality and elevation; omit place for the current view)
- {"op":"find_quakes","near"?:"<place>","radius_km"?:number,"min_magnitude"?:number}  (USGS, last 7 days, M2.5+)
- {"op":"find_events","category"?:"wildfires"|"severeStorms"|"volcanoes"|"floods"|"seaLakeIce"|"dustHaze","near"?:"<place>","radius_km"?:number}  (NASA EONET open events)
- {"op":"find_features","kind":one of ${JSON.stringify(FEATURE_KINDS)},"place"?:"<place>"}  (OpenStreetMap query in the current view or around a place)
- {"op":"compare","kind":"years","a":"2018","b":"2025"}  (Sentinel-2 yearly mosaics, 2018 to 2025) or {"op":"compare","kind":"days","a":"YYYY-MM-DD","b":"YYYY-MM-DD"} (daily imagery)
- {"op":"stop_compare"}, {"op":"reset"} (whole planet), {"op":"back"}
- {"op":"orbit"}  (circle the camera around the selected building or the centre of the view; use after fly_to for "show me X in 3D" or "go around X")
- {"op":"note","text":"..."}  (general background knowledge in at most 3 sentences)
- {"op":"unsupported","reason":"...","suggestion":"..."}

Rules:
1. Facts about current conditions, hazards, satellites, buildings or features must come from operations, never from notes. Do not state temperatures, counts, magnitudes or dates in a note.
2. Notes are for stable background knowledge only (how a mountain range formed, what a river is known for). Keep them short and only include what is widely documented.
3. "Here", "this area", "this city" mean the current view or the selected object. If a place is needed and none is given or visible, use unsupported.
4. Refuse requests to locate, identify or track private individuals, vehicles, homes, or to infer anyone's behaviour from imagery: reply with unsupported.
5. If the data needed is not covered by these operations, say so with unsupported and suggest the closest supported request.

Current state: ${JSON.stringify(ctx)}`;
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Best-effort per-instance limiter: serverless instances are short lived, so
// this only blunts bursts. Put a real limiter (KV, edge config) in front for production.
const recent = new Map<string, number[]>();
function limited(key: string): boolean {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  recent.set(key, hits);
  return hits.length > 20;
}

/**
 * Handles one planning request. `raw` is the request body as text or as an
 * already parsed object; `label` names the model for the answer panel.
 */
export async function planRequest(raw: unknown, complete: Complete, label: string, clientKey = 'local'): Promise<PlanResult> {
  if (limited(clientKey)) return { status: 429, body: { error: 'rate_limited' } };

  let parsed: { text?: unknown; context?: unknown };
  try {
    parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as typeof parsed;
  } catch {
    return { status: 400, body: { error: 'bad_json' } };
  }
  const text = typeof parsed.text === 'string' ? parsed.text.trim().slice(0, MAX_INPUT) : '';
  if (!text) return { status: 400, body: { error: 'empty' } };
  const ctx = (parsed.context ?? {}) as PlannerContext;

  try {
    const reply = await complete(systemPrompt(ctx), text);
    const { ops, rejected } = validateOps(extractJson(reply));
    return { status: 200, body: { ops, rejected, planner: label } };
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError' ? 'model timed out' : err instanceof Error ? err.message : 'model call failed';
    return { status: 502, body: { error: 'upstream', message } };
  }
}
