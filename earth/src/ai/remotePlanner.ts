import { CONFIG } from '../config';
import { validateOps, type Plan, type PlannerContext } from './ops';
import { planLocally } from './localPlanner';

let remoteAvailable: boolean | null = null;

/**
 * Tries the server-side model planner first and falls back to the built-in
 * rules when no model is configured, the server is unreachable, or the model
 * returns nothing usable.
 */
export async function plan(text: string, ctx: PlannerContext, signal?: AbortSignal): Promise<Plan & { fallbackReason?: string }> {
  if (remoteAvailable !== false) {
    try {
      const res = await fetch(CONFIG.assistUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, context: ctx }),
        signal,
      });
      const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
      // 501: no model key on the server. 404 or HTML: a static host with no API at all.
      if (res.status === 501 || res.status === 404 || (res.ok && !isJson)) {
        remoteAvailable = false;
      } else if (res.ok) {
        remoteAvailable = true;
        const data = (await res.json()) as { ops?: unknown; planner?: string };
        const { ops } = validateOps(data.ops);
        if (ops.length) return { ops, planner: data.planner ?? 'Language model' };
        return { ...planLocally(text, ctx), fallbackReason: 'The model returned no usable steps, so the built-in rules answered.' };
      } else {
        const reason = res.status === 429 ? 'The model planner is rate limited.' : 'The model planner had an error.';
        return { ...planLocally(text, ctx), fallbackReason: `${reason} The built-in rules answered instead.` };
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      return { ...planLocally(text, ctx), fallbackReason: 'The model planner could not be reached. The built-in rules answered instead.' };
    }
  }
  return planLocally(text, ctx);
}

export function modelPlannerAvailable(): boolean | null {
  return remoteAvailable;
}
