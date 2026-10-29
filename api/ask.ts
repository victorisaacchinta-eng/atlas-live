import { chat, tavily, send, MODELS, HttpError, type ChatMessage, type TavilyResult } from './_nebius.js';
import { geocode } from './_places.js';
import { layer, weather, km, type LayerId, type Signal } from './_signals.js';

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

/** Camera tools for Places: the agent directs the shot like a drone operator. */
const EARTH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'fly_to',
      description: 'Fly the camera to a real place: a landmark, building, neighbourhood or city ("Golconda Fort, Hyderabad"), or to exact coordinates (for a signal found with find_signals, pass its lat, lon and a short name as place).',
      parameters: { type: 'object', properties: { place: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' } }, required: ['place'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'globe_view',
      description: 'Pull back out to the whole Earth, with the live signal layers.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_layer',
      description: 'Show or hide a live layer on the globe. quakes: USGS earthquakes M2.5+ from the past 7 days. events: NASA EONET open natural events (wildfires, severe storms, sea ice).',
      parameters: { type: 'object', properties: { layer: { type: 'string', enum: ['quakes', 'events'] }, on: { type: 'boolean' } }, required: ['layer', 'on'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_signals',
      description: 'Query a live layer. Returns real items with title, magnitude, time, coordinates and source link. Use it for any question about earthquakes, wildfires, storms or sea ice. Optionally only near a place.',
      parameters: { type: 'object', properties: {
        layer: { type: 'string', enum: ['quakes', 'events'] },
        near: { type: 'string', description: 'Place name to search around, e.g. "Japan" or "California".' },
        radius_km: { type: 'number', description: 'Search radius around near, default 800.' },
        kind: { type: 'string', enum: ['wildfire', 'storm', 'ice', 'volcano', 'any'], description: 'events only' },
        sort: { type: 'string', enum: ['biggest', 'latest'] },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      }, required: ['layer'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Current weather at a place (Open-Meteo): temperature, conditions, wind, humidity, precipitation.',
      parameters: { type: 'object', properties: { place: { type: 'string' } }, required: ['place'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'build_model',
      description: 'Hand a real structure to the ATLAS build team: Nemotron agents research it, model it from simple shapes, check it against a real photo, and the viewer can take it apart. Use when the viewer asks to build, reconstruct, model or take apart a structure.',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'The structure, e.g. "Charminar, Hyderabad"' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'make_short',
      description: 'Open the Short director: ATLAS writes a 60-second, cited, shot-by-shot explainer script about a live signal or a place, plays it in a 9:16 frame and exports it for Google Earth. Use when the viewer asks to make a Short, a Reel, a video, an explainer or a script. For a live signal, call find_signals first and pass its title, lat and lon.',
      parameters: { type: 'object', properties: { topic: { type: 'string', description: 'What the Short is about, e.g. "M 6.1 - 24 km SW of Hualien City, Taiwan" or "Charminar, Hyderabad"' }, lat: { type: 'number' }, lon: { type: 'number' } }, required: ['topic'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_lens',
      description: 'Re-render the world through a sensor lens. photo: real colours. hologram: ATLAS blueprint with height contours. thermal: ironbow heat map. night: night-vision green. riso: two-ink halftone print.',
      parameters: { type: 'object', properties: { lens: { type: 'string', enum: ['photo', 'hologram', 'thermal', 'night', 'riso'] } }, required: ['lens'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'orbit',
      description: 'Circle the camera around the current place. speed 0 stops, 1 is a slow cinematic turn, 3 is fast; negative turns the other way.',
      parameters: { type: 'object', properties: { speed: { type: 'number', minimum: -3, maximum: 3 } }, required: ['speed'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'isolate',
      description: 'Cut the landmark out of the surrounding city so it floats alone as a 3D object (on: true), or put the city back (on: false).',
      parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
    },
  },
  SCENE_TOOLS[2],
];

interface Body {
  mode?: 'object' | 'earth';
  layers?: string[];
  question: string;
  machine: string;
  parts: string[];
  focused?: number;
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export default async function handler(req: { method: string; body: Body }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const { question, machine, parts = [], focused, history = [], mode = 'object', layers = [] } = req.body || ({} as Body);
    if (!question || !machine) throw new HttpError(400, 'question and machine are required');
    const earth = mode === 'earth';
    const tools = earth ? EARTH_TOOLS : SCENE_TOOLS;

    const partList = parts.map((p, i) => `${i + 1}. ${p}`).join('\n');
    const system = earth ? `You are ATLAS, an intelligence guide flying a camera over the real Earth in photoreal 3D. The camera is over: ${machine}.
Live layers on screen: ${layers.length ? layers.join(', ') : 'none'}. Now (UTC): ${new Date().toISOString().slice(0, 16)}.
Rules:
- Places: fly_to a specific place name. globe_view pulls back to the whole Earth. set_lens re-renders the view, orbit circles, isolate cuts the landmark out.
- Live data: for earthquakes, wildfires, storms or sea ice, call find_signals (and show_layer so the viewer sees them). When your answer is about one specific item, also fly_to its lat and lon so the viewer sees it. For weather, call get_weather.
- find_signals items are real. NASA EONET marks events "open" until it closes them, so say "open in NASA EONET" and give each one's last_observed date and days_since_observed. Never say "burning now", "active right now" or "currently". Never say there are none when items came back.
- To make a Short, Reel or explainer video, call make_short.
- History, architecture and other facts: call web_search first. Only state what tool results support; say which source (USGS, NASA EONET, Open-Meteo, or the web) a fact came from.
- To build or take apart a structure, call build_model.
- Answer in at most 3 short sentences of plain spoken English, no markdown, no lists. It will be read aloud.
- Only say you did something if the tool result says it worked. If a tool failed or found nothing, say so plainly.` : `You are ATLAS, a guide inside a hologram of a real machine: ${machine}.
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
    const models = new Set<string>();
    let answer = '';
    let lastSignals: Signal[] = [];
    const addSource = (title: string, url: string) => { if (url && !sources.some((s) => s.url === url)) sources.push({ title, url }); };
    const brief = (x: Signal, from?: { lat: number; lon: number }) => ({
      title: x.title, kind: x.kind, magnitude: x.mag !== undefined ? `${x.mag}${x.magUnit ? ' ' + x.magUnit : ''}` : undefined,
      [x.layer === 'events' ? 'last_observed_utc' : 'time_utc']: x.time.slice(0, 16), status: x.layer === 'events' ? 'open in NASA EONET' : undefined,
      days_since_observed: x.layer === 'events' ? Math.floor((Date.now() - Date.parse(x.time)) / 864e5) : undefined,
      lat: +x.lat.toFixed(3), lon: +x.lon.toFixed(3), depth_km: x.depthKm, tsunami: x.tsunami || undefined,
      km_away: from ? Math.round(km(from, x)) : undefined, source: x.url,
    });

    for (let turn = 0; turn < 5; turn++) {
      const reply = await chat({ model: MODELS.agent, messages, tools, tool_choice: 'auto', temperature: 0.3, max_tokens: 700 });
      if (reply.servedBy) models.add(String(reply.servedBy));
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
        } else if (c.function.name === 'find_signals') {
          const id = (args.layer === 'events' ? 'events' : 'quakes') as LayerId;
          try {
            const data = await layer(id);
            let list = data.signals;
            let center: { lat: number; lon: number; name: string } | undefined;
            if (args.near) {
              center = await geocode(String(args.near));
              const r = Number(args.radius_km) > 0 ? Number(args.radius_km) : 800;
              list = list.filter((x) => km(center!, x) <= r);
            }
            if (id === 'events' && args.kind && args.kind !== 'any') list = list.filter((x) => x.kind === args.kind);
            // Prescribed burns are planned, not wildfires. Keep them out unless the viewer asks for them.
            const planned = id === 'events' ? list.filter((x) => /^prescribed/i.test(x.title)).length : 0;
            if (planned && !/prescribed/i.test(question)) list = list.filter((x) => !/^prescribed/i.test(x.title));
            // Quakes default to biggest first; events to most recently observed (old big fires should not hide current ones).
            const latest = args.sort ? args.sort === 'latest' : id === 'events';
            list = [...list].sort(latest ? (a, b) => b.time.localeCompare(a.time) : (a, b) => (b.mag ?? 0) - (a.mag ?? 0));
            const top = list.slice(0, Math.min(10, Math.max(1, Number(args.limit) || 5)));
            top.slice(0, 3).forEach((x) => addSource(`${data.source}: ${x.title}`, x.url));
            trace.push(`${id === 'quakes' ? 'usgs' : 'nasa eonet'} › ${list.length} ${id}${center ? ` within ${Number(args.radius_km) || 800} km of ${center.name}` : ''}`);
            lastSignals = top;
            result = JSON.stringify({ source: data.source, feed_updated_utc: data.updated.slice(0, 16), total_matching: list.length, prescribed_burns_excluded: planned || undefined, items: top.map((x) => brief(x, center)) });
          } catch (err) {
            trace.push(`${id} › failed`);
            result = `The ${id} feed failed: ${err instanceof Error ? err.message : 'error'}. Tell the viewer the data is unavailable right now.`;
          }
        } else if (c.function.name === 'get_weather') {
          try {
            const g = await geocode(String(args.place || ''));
            const w = await weather(g.lat, g.lon);
            addSource(`Open-Meteo: current weather, ${g.name}`, `https://open-meteo.com/en/docs#latitude=${g.lat.toFixed(3)}&longitude=${g.lon.toFixed(3)}`);
            trace.push(`open-meteo › ${g.name}`);
            result = JSON.stringify({ place: g.name, lat: g.lat, lon: g.lon, ...w });
          } catch (err) {
            trace.push('open-meteo › failed');
            result = `Weather lookup failed: ${err instanceof Error ? err.message : 'error'}.`;
          }
        } else if (c.function.name === 'fly_to') {
          // Find the place before claiming to go there, so the agent never describes a flight that cannot happen.
          let lat = Number(args.lat), lon = Number(args.lon);
          let name = String(args.place || '').trim();
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            try { const g = await geocode(name); lat = g.lat; lon = g.lon; name = name || g.name; }
            catch (err) { result = `Could not find "${name}" on the map (${err instanceof Error ? err.message : 'error'}). Nothing moved.`; lat = NaN; }
          }
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            actions.push({ name: 'fly_to', args: { place: name, lat, lon } });
            trace.push(`agent › fly_to(${name})`);
            result = `Flying to ${name} (${lat.toFixed(3)}, ${lon.toFixed(3)}).`;
          } else trace.push(`agent › fly_to failed: ${name}`);
        } else {
          actions.push({ name: c.function.name, args });
          trace.push(`agent › ${c.function.name}(${JSON.stringify(args)})`);
          // These run in the viewer after this reply. Say what will happen, not that it already has.
          const ok: Record<string, string> = {
            build_model: 'The build team has been asked to start in the viewer. It takes about two minutes; say it has started, not that it is finished.',
            make_short: 'The Short director is opening in the viewer and will write a cited script in about 20 seconds. Say it has started, not that it is finished.',
            show_layer: 'The layer will switch in the viewer.',
            globe_view: 'The camera will pull back to the whole Earth.',
          };
          result = ok[c.function.name] ?? 'Sent to the viewer.';
        }
        messages.push({ role: 'tool', tool_call_id: c.id, name: c.function.name, content: result });
      }
    }

    // The answer is about a live item but the model forgot to move the camera: show it the top match,
    // passing the signal's own title so the viewer frames a region, not a building.
    if (lastSignals.length && !actions.some((a) => ['fly_to', 'globe_view', 'make_short', 'build_model'].includes(a.name))) {
      const top = lastSignals[0];
      actions.push({ name: 'fly_to', args: { place: top.title, lat: top.lat, lon: top.lon, signal: true } });
      trace.push(`atlas › fly_to(${top.title})`);
    }

    res.status(200).json({ answer: answer || 'I could not finish that one. Try asking it a different way.', actions, sources: sources.slice(0, 5), trace, model: [...models].join(' + ') || MODELS.agent });
  } catch (err) {
    send(res, err);
  }
}
