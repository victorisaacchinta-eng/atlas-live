import { chat, hasModel, MODELS, send, HttpError } from './_nebius.js';
import { planRequest } from '../earth/src/ai/plan.js';

/**
 * The ATLAS Earth assistant. Nemotron turns a question about the globe into a short list of
 * operations (fly somewhere, switch a layer, look up quakes, weather or map features). The
 * browser checks each operation against a whitelist and runs it against the live data sources,
 * so every fact in an answer comes from USGS, NASA, Open-Meteo or OpenStreetMap, not the model.
 * With no model key the page falls back to its built-in rules (it reads the 501).
 */

type Req = { method: string; body: unknown; headers: Record<string, string | string[] | undefined> };
type Res = { status: (n: number) => { json: (b: unknown) => void } };

export default async function handler(req: Req, res: Res) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    if (!hasModel()) return res.status(501).json({ error: 'not_configured' });
    let label = MODELS.agent;
    const complete = async (system: string, user: string) => {
      const reply = await chat({
        model: MODELS.agent,
        temperature: 0.1,
        max_tokens: 700,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      if (reply.servedBy) label = String(reply.servedBy);
      return String(reply.choices?.[0]?.message?.content ?? '');
    };
    const forwarded = req.headers['x-forwarded-for'];
    const client = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || 'unknown';
    const result = await planRequest(req.body, complete, MODELS.agent, client);
    if (result.status === 200) (result.body as { planner: string }).planner = label;
    res.status(result.status).json(result.body);
  } catch (err) {
    send(res, err);
  }
}
