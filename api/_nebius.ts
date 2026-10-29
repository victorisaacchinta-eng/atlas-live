// Server-side helpers. Keys live in Vercel env vars and never reach the browser.
//
// Any OpenAI-compatible provider works. The first one with a key set wins:
//   Nebius Token Factory (required for the Nebius x NVIDIA submission) -> NVIDIA API catalog -> Gemini -> Groq.
// Model ids per provider can be overridden with ATLAS_VISION_MODEL / ATLAS_AGENT_MODEL / ATLAS_FAST_MODEL.

interface Provider { id: string; label: string; base: string; key?: string; vision: string; agent: string; fast: string; prefer?: Record<'vision' | 'agent' | 'fast', RegExp[]> }

// Providers retire model ids (Gemini 2.5 shut down on 16 Oct 2026). When the configured id is not
// in the provider's live model list, the first id matching these patterns, in order, is used.
const GEMINI_PREFER = [/^gemini-3(\.\d)?-flash$/, /^gemini-flash-latest$/, /^gemini-3(\.\d)?-flash-preview$/, /^gemini-flash-lite-latest$/, /^gemini-3(\.\d)?-flash-lite$/, /^gemini-[\d.]+-flash$/];
const NEMOTRON_PREFER = {
  vision: [/nemotron.*vl/i, /vl/i],
  agent: [/nemotron.*super/i, /nemotron.*ultra/i, /nemotron/i],
  fast: [/nemotron.*lightning/i, /nemotron.*nano/i, /nemotron/i],
};

const PROVIDERS: Provider[] = [
  { id: 'nebius', label: 'Nebius Token Factory', base: process.env.TOKEN_FACTORY_URL || 'https://api.tokenfactory.nebius.com/v1', key: process.env.NEBIUS_API_KEY,
    vision: 'nvidia/Nemotron-3.5-Super-VL', agent: 'nvidia/nemotron-3-super-120b-a12b', fast: 'nvidia/Nemotron-3-Nano-30B-A3B', prefer: NEMOTRON_PREFER },
  { id: 'nvidia', label: 'NVIDIA API catalog', base: 'https://integrate.api.nvidia.com/v1', key: process.env.NVIDIA_API_KEY,
    vision: 'nvidia/nemotron-3.5-super-vl-120b-a12b', agent: 'nvidia/nemotron-3.5-super-vl-120b-a12b', fast: 'nvidia/nemotron-3.5-lightning-30b-a3b', prefer: NEMOTRON_PREFER },
  { id: 'gemini', label: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: process.env.GEMINI_API_KEY,
    vision: 'gemini-flash-latest', agent: 'gemini-flash-latest', fast: 'gemini-flash-lite-latest', prefer: { vision: GEMINI_PREFER, agent: GEMINI_PREFER, fast: GEMINI_PREFER } },
  { id: 'groq', label: 'Groq', base: 'https://api.groq.com/openai/v1', key: process.env.GROQ_API_KEY,
    vision: 'meta-llama/llama-4-scout-17b-16e-instruct', agent: 'openai/gpt-oss-120b', fast: 'openai/gpt-oss-20b' },
];

export const PROVIDER: Provider | undefined = PROVIDERS.find((p) => p.key);

export const MODELS = {
  vision: process.env.ATLAS_VISION_MODEL || PROVIDER?.vision || 'unset',
  agent: process.env.ATLAS_AGENT_MODEL || PROVIDER?.agent || 'unset',
  fast: process.env.ATLAS_FAST_MODEL || PROVIDER?.fast || 'unset',
};

const configured = { ...MODELS };
/** Live ids that match each role's preferences, best first: fallbacks when one is overloaded. */
/** Model ids the provider lists right now (Nemotron / Gemini only), for /api/status. */
export const LIVE_IDS: string[] = [];
export const ALTS: Record<'vision' | 'agent' | 'fast', string[]> = { vision: [], agent: [], fast: [] };
let checked: Promise<void> | null = null;

/**
 * Check the configured ids against the provider's live model list once per instance and swap any
 * retired id for the best available match. Explicit ATLAS_*_MODEL overrides are never replaced.
 */
export function ensureModels() {
  if (!PROVIDER?.prefer) return Promise.resolve();
  checked ??= (async () => {
    try {
      const r = await fetch(`${PROVIDER.base}/models`, { headers: { Authorization: `Bearer ${PROVIDER.key}` }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) return;
      const j = (await r.json()) as { data?: { id: string }[] };
      const ids = (j.data || []).map((m) => m.id.replace(/^models\//, ''));
      LIVE_IDS.splice(0, LIVE_IDS.length, ...ids.filter((id) => /nemotron|gemini/i.test(id)).slice(0, 60));
      if (!ids.length) return;
      for (const role of ['vision', 'agent', 'fast'] as const) {
        const env = { vision: process.env.ATLAS_VISION_MODEL, agent: process.env.ATLAS_AGENT_MODEL, fast: process.env.ATLAS_FAST_MODEL }[role];
        const ranked: string[] = [];
        const usable = ids.filter((id) => !/parse|embed|rerank|reward|safety|guard|retriev|tts|asr|ocr/i.test(id));
        const newest = [...usable].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        for (const re of PROVIDER.prefer![role]) for (const id of newest) if (re.test(id) && !ranked.includes(id)) ranked.push(id);
        ALTS[role] = ranked;
        if (env || ids.includes(MODELS[role])) continue;
        if (ranked[0]) MODELS[role] = ranked[0];
      }
    } catch { /* keep the configured ids */ }
  })();
  return checked;
}

/** Back-compat for the old name. */
export const TOKEN_FACTORY = PROVIDERS[0].base;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export function hasModel() { return !!PROVIDER; }

const EXHAUSTED = new Map<string, number>();

/** One safe diagnostic line per model call: provider, model, operation, status, duration. Never keys or prompts. */
function trace(op: string, p: Provider, model: string, status: number | string, ms: number) {
  console.log(JSON.stringify({ evt: 'model_call', op, provider: p.id, base: new URL(p.base).host, model, status, ms }));
}

export async function chat(body: Record<string, unknown>) {
  const op = String(body.op || 'chat');
  delete body.op;
  if (!PROVIDER) throw new HttpError(503, 'No model key is set on the server (NEBIUS_API_KEY, NVIDIA_API_KEY, GEMINI_API_KEY or GROQ_API_KEY)');
  await ensureModels();
  // Callers pass the id they read earlier; map a retired id to its live replacement.
  for (const role of ['vision', 'agent', 'fast'] as const) if (body.model === configured[role]) body.model = MODELS[role];
  // Overloaded (503), rate-limited (429) or retired (404): try the next live model for the role.
  // Gemini 3.x thinks at length by default; structured work here needs speed more than depth.
  if (PROVIDER.id === 'gemini' && body.reasoning_effort === undefined) body.reasoning_effort = 'low';
  const role = (['agent', 'vision', 'fast'] as const).find((k) => body.model === MODELS[k]) ?? 'agent';
  // Overloaded (503), rate-limited or out of quota (429), retired (404): try the next live model,
  // then any other provider that has a key. Each model has its own quota on free tiers.
  const plan: { p: Provider; model: string }[] = [String(body.model), ...ALTS[role].filter((id) => id !== body.model)].slice(0, 6).map((model) => ({ p: PROVIDER!, model }));
  for (const other of PROVIDERS) if (other.key && other !== PROVIDER) plan.push({ p: other, model: other[role] });
  let last = '';
  // Models that just said "quota used up" are skipped for a while (per warm instance).
  const live = plan.filter((x) => (EXHAUSTED.get(`${x.p.id}:${x.model}`) ?? 0) < Date.now());
  if (live.length) plan.splice(0, plan.length, ...live);
  for (let i = 0; i < plan.length; i++) {
    const { p, model } = plan[i];
    const payload: Record<string, unknown> = { ...body, model };
    if (p.id !== 'gemini') delete payload.reasoning_effort;
    // Nemotron 3.x reasons at length by default (minutes on long JSON); ATLAS needs fast, structured
    // answers, so thinking is off unless a caller asks for it. NIM / vLLM read chat_template_kwargs.
    if ((p.id === 'nvidia' || p.id === 'nebius') && payload.chat_template_kwargs === undefined) payload.chat_template_kwargs = { enable_thinking: false };
    // Free endpoints occasionally stall a request for minutes: give up on that model and try the next.
    const limit = Number(body.max_tokens ?? 1000) <= 1200 ? 22_000 : 120_000;
    let r: Response;
    const t0 = Date.now();
    try {
      r = await fetch(`${p.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(limit),
      });
    } catch (err) {
      last = `${p.label} ${model}: no reply in ${limit / 1000} s (${err instanceof Error ? err.name : 'error'})`;
      trace(op, p, model, 'timeout', Date.now() - t0);
      continue;
    }
    trace(op, p, model, r.status, Date.now() - t0);
    if (r.ok) { const j = await r.json(); j.servedBy = `${p.label} · ${model}`; j.servedMs = Date.now() - t0; j.servedProvider = p.id; return j; }
    last = `${p.label} ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 300)}`;
    if (r.status === 429) EXHAUSTED.set(`${p.id}:${model}`, Date.now() + 15 * 60 * 1000);
    if (![404, 429, 500, 503].includes(r.status)) throw new HttpError(r.status, last);
    if (r.status !== 429 && i === 0) await new Promise((res) => setTimeout(res, 600));
  }
  throw new HttpError(503, /\b429\b/.test(last) ? `The model quota is used up for today (${last.slice(0, 120)})` : last);
}

export async function tavily(query: string, maxResults = 4) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { results: [] as TavilyResult[], answer: null as string | null };
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: maxResults, search_depth: 'basic', include_answer: false }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new HttpError(r.status, `Tavily ${r.status}`);
  const j = await r.json();
  return { results: (j.results || []) as TavilyResult[], answer: (j.answer as string) || null };
}

export interface TavilyResult { title: string; url: string; content: string; score?: number }

export class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

/** Pull the first JSON object out of a model reply, tolerating code fences and thinking text. */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(json)?/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new HttpError(502, 'Model did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

export function send(res: { status: (n: number) => { json: (b: unknown) => void } }, err: unknown) {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
}
