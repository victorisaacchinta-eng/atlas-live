import { chat, tavily, send, MODELS, HttpError, type ChatMessage, type TavilyResult } from './_nebius.js';

/**
 * The ATLAS agent. Nemotron reads the question, the machine and its parts, and answers by
 * calling tools: web_search runs here (Tavily), scene tools are handed back to the browser,
 * which runs them on the hologram. Every fact in the answer must come from a search result.
 */

const SCENE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'focus_part',
      description: 'Highlight one part of the machine on screen and pull it out of the assembly. Use when the answer is about a specific part.',
      parameters: { type: 'object', properties: { index: { type: 'integer', description: 'Part index from the parts list (1-based).' } }, required: ['index'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_explode',
      description: 'Pull the machine apart (1) or put it back together (0). Values in between are allowed.',
      parameters: { type: 'object', properties: { amount: { type: 'number', minimum: 0, maximum: 1 } }, required: ['amount'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for facts about the machine or part. Call this before stating any fact, number, or date.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
];

interface Body {
  question: string;
  machine: string;
  parts: string[];
  focused?: number;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export default async function handler(req: { method: string; body: Body }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const { question, machine, parts, focused, history = [] } = req.body || ({} as Body);
    if (!question || !machine) throw new HttpError(400, 'question and machine are required');

    const partList = parts.map((p, i) => `${i + 1}. ${p}`).join('\n');
    const system = `You are ATLAS, a guide inside a hologram of a real machine: ${machine}.
Parts on screen (index. name):
${partList}
${focused && focused > 0 ? `The viewer has part ${focused} selected.` : ''}
Rules:
- Before stating any fact, number or date, call web_search. Only state what the results support.
- When the answer concerns a part, call focus_part with its index. Use set_explode when it helps the viewer see.
- Answer in at most 3 short sentences of plain spoken English, no markdown, no lists. It will be read aloud.
- If the search does not support an answer, say you could not confirm it.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...history.slice(-6),
      { role: 'user', content: question },
    ];

    const actions: { name: string; args: Record<string, unknown> }[] = [];
    const sources: { title: string; url: string }[] = [];
    const trace: string[] = [];
    let answer = '';

    for (let turn = 0; turn < 5; turn++) {
      const reply = await chat({ model: MODELS.agent, messages, tools: SCENE_TOOLS, tool_choice: 'auto', temperature: 0.3, max_tokens: 700 });
      const msg = reply.choices?.[0]?.message;
      if (!msg) throw new HttpError(502, 'Empty reply from the model');
      const calls = (msg.tool_calls || []) as { id: string; function: { name: string; arguments: string } }[];
      if (!calls.length) { answer = (msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); break; }

      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
      for (const c of calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* keep empty */ }
        let result = 'done';
        if (c.function.name === 'web_search') {
          const q = String(args.query || `${machine} ${question}`);
          trace.push(`tavily › ${q}`);
          const found = await tavily(q, 4);
          found.results.forEach((r: TavilyResult) => { if (!sources.some((s) => s.url === r.url)) sources.push({ title: r.title, url: r.url }); });
          result = JSON.stringify(found.results.map((r: TavilyResult) => ({ title: r.title, url: r.url, content: r.content.slice(0, 700) })));
          if (!found.results.length) result = 'No results.';
        } else {
          actions.push({ name: c.function.name, args });
          trace.push(`nemotron › ${c.function.name}(${JSON.stringify(args)})`);
        }
        messages.push({ role: 'tool', tool_call_id: c.id, name: c.function.name, content: result });
      }
    }

    res.status(200).json({ answer: answer || 'I could not finish that one. Try asking it a different way.', actions, sources: sources.slice(0, 4), trace, model: MODELS.agent });
  } catch (err) {
    send(res, err);
  }
}
