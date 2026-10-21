// Server-side helpers. Keys live in Vercel env vars and never reach the browser.
export const TOKEN_FACTORY = process.env.TOKEN_FACTORY_URL || 'https://api.tokenfactory.nebius.com/v1';

export const MODELS = {
  // Overridable without a redeploy of code, because exact model ids on Token Factory
  // must be confirmed with GET /v1/models once the account is live.
  vision: process.env.ATLAS_VISION_MODEL || 'nvidia/Nemotron-3.5-Super-VL',
  agent: process.env.ATLAS_AGENT_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
  fast: process.env.ATLAS_FAST_MODEL || 'nvidia/Nemotron-3-Nano-30B-A3B',
};

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export async function chat(body: Record<string, unknown>) {
  const key = process.env.NEBIUS_API_KEY;
  if (!key) throw new HttpError(503, 'NEBIUS_API_KEY is not set on the server');
  const r = await fetch(`${TOKEN_FACTORY}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new HttpError(r.status, `Token Factory ${r.status}: ${(await r.text()).slice(0, 400)}`);
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
