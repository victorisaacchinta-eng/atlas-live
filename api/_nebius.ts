// Server-side helpers. Keys live in Vercel env vars and never reach the browser.
//
// Any OpenAI-compatible provider works. The first one with a key set wins:
//   Nebius Token Factory (required for the Nebius x NVIDIA submission) -> NVIDIA API catalog -> Gemini -> Groq.
// Model ids per provider can be overridden with ATLAS_VISION_MODEL / ATLAS_AGENT_MODEL / ATLAS_FAST_MODEL.

interface Provider { id: string; label: string; base: string; key?: string; vision: string; agent: string; fast: string; prefer?: Record<'vision' | 'agent' | 'fast', RegExp[]> }

// Providers retire model ids (Gemini 2.5 shut down on 16 Oct 2026). When the configured id is not
// in the provider's live model list, the first id matching these patterns, in order, is used.
const GEMINI_PREFER = [/^gemini-3(\.\d)?-flash$/, /^gemini-3(\.\d)?-flash-preview$/, /^gemini-3(\.\d)?-flash-lite$/, /^gemini-[\d.]+-flash$/];
const NEMOTRON_PREFER = {
  vision: [/nemotron.*vl/i, /vl/i],
  agent: [/nemotron.*super/i, /nemotron.*ultra/i, /nemotron/i],
  fast: [/nemotron.*nano/i, /nemotron/i],
};

const PROVIDERS: Provider[] = [
  { id: 'nebius', label: 'Nebius Token Factory', base: process.env.TOKEN_FACTORY_URL || 'https://api.tokenfactory.nebius.com/v1', key: process.env.NEBIUS_API_KEY,
    vision: 'nvidia/Nemotron-3.5-Super-VL', agent: 'nvidia/nemotron-3-super-120b-a12b', fast: 'nvidia/Nemotron-3-Nano-30B-A3B', prefer: NEMOTRON_PREFER },
  { id: 'nvidia', label: 'NVIDIA API catalog', base: 'https://integrate.api.nvidia.com/v1', key: process.env.NVIDIA_API_KEY,
    vision: 'nvidia/nemotron-3.5-super-vl', agent: 'nvidia/nemotron-3-super-120b-a12b', fast: 'nvidia/nemotron-3-nano-30b-a3b', prefer: NEMOTRON_PREFER },
  { id: 'gemini', label: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: process.env.GEMINI_API_KEY,
    vision: 'gemini-3-flash-preview', agent: 'gemini-3-flash-preview', fast: 'gemini-3-flash-preview', prefer: { vision: GEMINI_PREFER, agent: GEMINI_PREFER, fast: GEMINI_PREFER } },
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
const ALTS: Record<'vision' | 'agent' | 'fast', string[]> = { vision: [], agent: [], fast: [] };
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
      if (!ids.length) return;
      for (const role of ['vision', 'agent', 'fast'] as const) {
        const env = { vision: process.env.ATLAS_VISION_MODEL, agent: process.env.ATLAS_AGENT_MODEL, fast: process.env.ATLAS_FAST_MODEL }[role];
        const ranked: string[] = [];
        for (const re of PROVIDER.prefer![role]) for (const id of ids) if (re.test(id) && !ranked.includes(id)) ranked.push(id);
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

export async function chat(body: Record<string, unknown>) {
  if (!PROVIDER) throw new HttpError(503, 'No model key is set on the server (NEBIUS_API_KEY, NVIDIA_API_KEY, GEMINI_API_KEY or GROQ_API_KEY)');
  await ensureModels();
  // Callers pass the id they read earlier; map a retired id to its live replacement.
  for (const role of ['vision', 'agent', 'fast'] as const) if (body.model === configured[role]) body.model = MODELS[role];
  // Overloaded (503), rate-limited (429) or retired (404): try the next live model for the role.
  const role = (['agent', 'vision', 'fast'] as const).find((k) => body.model === MODELS[k]);
  const tries = [String(body.model), ...(role ? ALTS[role].filter((id) => id !== body.model) : [])].slice(0, 3);
  let last = '';
  for (let i = 0; i < tries.length; i++) {
    const r = await fetch(`${PROVIDER.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROVIDER.key}` },
      body: JSON.stringify({ ...body, model: tries[i] }),
    });
    if (r.ok) return r.json();
    last = `${PROVIDER.label} ${r.status}: ${(await r.text()).slice(0, 300)}`;
    if (![404, 429, 500, 503].includes(r.status)) throw new HttpError(r.status, last);
    if (i === 0) await new Promise((res) => setTimeout(res, 600));
  }
  throw new HttpError(503, last);
}

export async function tavily(query: string, maxResults = 4) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { results: [] as TavilyResult[], answer: null as string | null };
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: maxResults, search_depth: 'basic', include_answer: false }),
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
