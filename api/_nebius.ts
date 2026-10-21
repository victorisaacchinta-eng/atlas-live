// Server-side helpers. Keys live in Vercel env vars and never reach the browser.
//
// Any OpenAI-compatible provider works. The first one with a key set wins:
//   Nebius Token Factory (required for the Nebius x NVIDIA submission) -> NVIDIA API catalog -> Gemini -> Groq.
// Model ids per provider can be overridden with ATLAS_VISION_MODEL / ATLAS_AGENT_MODEL / ATLAS_FAST_MODEL.

interface Provider { id: string; label: string; base: string; key?: string; vision: string; agent: string; fast: string }

const PROVIDERS: Provider[] = [
  { id: 'nebius', label: 'Nebius Token Factory', base: process.env.TOKEN_FACTORY_URL || 'https://api.tokenfactory.nebius.com/v1', key: process.env.NEBIUS_API_KEY,
    vision: 'nvidia/Nemotron-3.5-Super-VL', agent: 'nvidia/nemotron-3-super-120b-a12b', fast: 'nvidia/Nemotron-3-Nano-30B-A3B' },
  { id: 'nvidia', label: 'NVIDIA API catalog', base: 'https://integrate.api.nvidia.com/v1', key: process.env.NVIDIA_API_KEY,
    vision: 'nvidia/nemotron-3.5-super-vl', agent: 'nvidia/nemotron-3-super-120b-a12b', fast: 'nvidia/nemotron-3-nano-30b-a3b' },
  { id: 'gemini', label: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: process.env.GEMINI_API_KEY,
    vision: 'gemini-2.5-flash', agent: 'gemini-2.5-flash', fast: 'gemini-2.5-flash' },
  { id: 'groq', label: 'Groq', base: 'https://api.groq.com/openai/v1', key: process.env.GROQ_API_KEY,
    vision: 'meta-llama/llama-4-scout-17b-16e-instruct', agent: 'openai/gpt-oss-120b', fast: 'openai/gpt-oss-20b' },
];

export const PROVIDER: Provider | undefined = PROVIDERS.find((p) => p.key);

export const MODELS = {
  vision: process.env.ATLAS_VISION_MODEL || PROVIDER?.vision || 'unset',
  agent: process.env.ATLAS_AGENT_MODEL || PROVIDER?.agent || 'unset',
  fast: process.env.ATLAS_FAST_MODEL || PROVIDER?.fast || 'unset',
};

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
  const r = await fetch(`${PROVIDER.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROVIDER.key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new HttpError(r.status, `${PROVIDER.label} ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
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
