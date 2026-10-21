import { chat, tavily, extractJson, send, MODELS, HttpError, type ChatMessage, type TavilyResult } from './_nebius.js';

/**
 * CONSTRUCT: ATLAS builds a 3D model of a real structure that you can take apart.
 * A team of agents, in the spirit of an architect's office:
 *   plan     - a researcher reads the web (Tavily) for real dimensions and features, and a planner
 *              splits the structure into 3 to 5 zones, each with a bounding box and named parts.
 *   build    - one builder per zone, run in parallel by the browser, writes its parts in a small
 *              shape grammar (no free-form code), so every answer can be checked and rendered.
 *   critique - a critic looks at the browser's render beside a real reference photo (Wikimedia)
 *              and returns concrete fixes: parts to replace, add or remove.
 * Each step is its own request so a step never outlives a serverless timeout, and so the viewer
 * watches the build happen.
 */

const GRAMMAR = `SHAPE GRAMMAR (metres; y is up; ground is y = 0; the structure is centred on x = 0, z = 0; front faces -z).
A part is {"id": "snake_case", "name": "Readable name", "role": "one short sentence on what it is or does", "prims": [ ... ]}.
Every primitive has "type" and "at": [x, y, z] = the centre of its BOTTOM face. Optional "rot": [rx, ry, rz] in degrees.
Types and their sizes:
- "box": "size": [width_x, height_y, depth_z]
- "cylinder": "r" bottom radius, "r2" top radius (optional, defaults to r), "h" height, "sides" (optional: 4, 6, 8, 12, 16, defaults to 24)
- "cone": "r", "h", "sides" (optional)
- "dome": "r", "h" (optional, defaults to r) - a half sphere standing on its rim
- "onion": "r" (widest radius), "h" - a bulbous Indo-Islamic or Russian dome with a pointed tip
- "sphere": "r" (sits on its bottom)
- "arch": "size": [width, height, depth], "t" wall thickness around the opening - a portal frame with a round-topped opening
- "gable": "size": [width_x, height_y, depth_z] - a pitched roof, ridge along z
- "pyramid": "size": [width_x, height_y, depth_z]
- "spire": "r", "h" - a thin finial or pinnacle
- "torus": "r" ring radius, "tube" tube radius, lying flat
Repeats (optional, on any primitive, keep the JSON short):
- "ring": {"n": count, "r": radius} - n copies on a circle of that radius around the primitive's "at" point, each turned to face outward
- "row": {"n": count, "step": [dx, dy, dz]} - n copies, each shifted by step
- "mirror": "x" | "z" | "xz" - also place copies mirrored across x = 0 and/or z = 0
Use real proportions from the research. Use repeats for anything repeated (columns, minarets, windows, arches, tiers). Aim for 3 to 15 primitives per part; keep the JSON compact (no comments, no extra keys).`;

const MAX = { prims: 1500, count: 64, dim: 2000 };

interface Body {
  step: 'plan' | 'build' | 'critique';
  name: string;
  city?: string;
  plan?: Plan;
  zone?: Zone;
  blueprint?: { parts: Part[] };
  render?: string;
  reference?: string;
  combined?: boolean;
}
interface Zone { id: string; name: string; brief: string; box: { min: number[]; max: number[] }; parts: string[] }
interface Plan { name: string; summary: string; height_m: number; footprint_m: number[]; style: string; zones: Zone[]; facts: { text: string; source?: number }[] }
interface Prim { type: string; at: number[]; [k: string]: unknown }
interface Part { id: string; name: string; role: string; prims: Prim[]; zone?: string }

export default async function handler(req: { method: string; body: Body }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const b = req.body || ({} as Body);
    const name = String(b.name || '').trim().slice(0, 120);
    if (!name) throw new HttpError(400, 'Name a structure to build');
    if (b.step === 'plan') return res.status(200).json(await plan(name, String(b.city || '').slice(0, 120)));
    if (b.step === 'build') return res.status(200).json(await build(name, b.plan!, b.zone!));
    if (b.step === 'critique') return res.status(200).json(await critique(name, b));
    throw new HttpError(400, 'Unknown step');
  } catch (err) {
    send(res, err);
  }
}

// ---------- plan: research + zoning ----------
async function plan(name: string, city: string) {
  const t0 = Date.now();
  const subject = city ? `${name}, ${city}` : name;
  const [dims, form, ref] = await Promise.all([
    tavily(`${subject} architecture dimensions height width metres`, 4).catch(() => ({ results: [] as TavilyResult[] })),
    tavily(`${subject} architectural features floor plan structure description`, 4).catch(() => ({ results: [] as TavilyResult[] })),
    referencePhoto(subject),
  ]);
  const tResearch = Date.now() - t0;
  const results = dedupe([...dims.results, ...form.results]).slice(0, 6);
  const research = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.content.slice(0, 700)}`).join('\n\n');

  const system = `You are the lead architect in a team that builds a faithful, explodable 3D model of a real structure out of simple shapes.
From the research, plan the build. Split the structure into 3 to 5 zones that builders can work on in parallel without overlapping (for example: base and plinth, main body, roof and domes, towers, gateways). Give each zone an axis-aligned bounding box in metres and the named parts it must contain (2 to 7 parts per zone, 10 to 24 parts in total). Parts should be the pieces a curious person would want to pull apart and ask about.
Coordinates: y up, ground y = 0, centred on x = 0, z = 0, main front facing -z.
Only use dimensions the research supports; when it does not give one, estimate from proportions and say "est." in the summary.
Reply with JSON only:
{"name": "...", "summary": "two sentences on the form", "height_m": number, "footprint_m": [x_width, z_depth], "style": "short phrase", "facts": [{"text": "a dimension or fact used", "source": research_number}], "zones": [{"id": "snake_case", "name": "...", "brief": "what to build here, with sizes", "box": {"min": [x, y, z], "max": [x, y, z]}, "parts": ["part name", "..."]}]}`;
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: `Structure: ${subject}\n\nResearch:\n${research || '(no results; rely on well-known proportions and mark estimates)'}` },
  ];
  const p = await jsonChat<Plan>(MODELS.agent, messages, 3000);
  if (!Array.isArray(p.zones) || !p.zones.length) throw new HttpError(502, 'The planner returned no zones');
  p.zones = p.zones.slice(0, 5).map((z, i) => ({ ...z, id: slug(z.id || z.name || `zone_${i + 1}`), parts: (z.parts || []).slice(0, 8) }));
  return {
    plan: p,
    sources: results.map((r) => ({ title: r.title, url: r.url })),
    reference: ref,
    model: MODELS.agent,
    ms: { research: tResearch, plan: Date.now() - t0 - tResearch },
  };
}

// ---------- build: one zone ----------
async function build(name: string, p: Plan, zone: Zone) {
  if (!p || !zone) throw new HttpError(400, 'plan and zone are required');
  const others = p.zones.filter((z) => z.id !== zone.id).map((z) => `- ${z.name}: box ${JSON.stringify(z.box)}`).join('\n');
  const system = `You are a specialist builder on a team modelling ${p.name || name} (${p.style || ''}). Overall: ${p.summary || ''} Height ${p.height_m} m, footprint ${JSON.stringify(p.footprint_m)} m.
You build ONLY your zone, inside its bounding box. Other builders handle:
${others}
${GRAMMAR}
Reply with JSON only: {"parts": [ ...parts for your zone... ]}`;
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: `Your zone: ${zone.name}\nBrief: ${zone.brief}\nBounding box: ${JSON.stringify(zone.box)}\nParts to build: ${zone.parts.join(', ')}` },
  ];
  const out = await jsonChat<{ parts: Part[] }>(MODELS.agent, messages, 4000, 0.3);
  return { zone: zone.id, parts: clean(out.parts, zone.id), model: MODELS.agent };
}

// ---------- critique: render vs reference photo ----------
async function critique(name: string, b: Body) {
  if (!b.render || !b.blueprint) throw new HttpError(400, 'render and blueprint are required');
  if (b.render.length > 3_000_000) throw new HttpError(413, 'Render too large');
  const content: ChatMessage['content'] = [
    { type: 'text', text: `Structure: ${name}.\n${b.combined ? 'The image has two halves. LEFT: the team\'s 3D build (flat blue-white hologram, 3/4 view from the front-left, no textures). RIGHT: a real photo for reference (camera angle may differ).' : 'The image is the team\'s 3D build (flat blue-white hologram, 3/4 view from the front-left, no textures). Judge it against what you know of the real structure.'}\nCurrent parts (ids and primitive counts): ${b.blueprint.parts.map((p) => `${p.id}(${p.prims.length})`).join(', ')}\nFull blueprint: ${JSON.stringify(b.blueprint).slice(0, 14000)}` },
    { type: 'image_url', image_url: { url: b.render } },
  ];
  // One image per request: some vision endpoints (Nemotron VL on NIM) reject a second image, so the
  // browser sends the build and the reference photo side by side in a single picture.
  const system = `You are the adversarial critic on a modelling team. Compare the build to the real structure. Look hard at silhouette, proportions (height to width), counts of repeated elements (minarets, arches, tiers, columns), dome shapes and placement. Be concrete.
Return at most 6 fixes, the ones that most improve the likeness. Fix by replacing whole parts (same id), adding new parts, or removing parts.
${GRAMMAR}
Reply with JSON only: {"score": 0-10 likeness now, "issues": ["short, specific"], "replace": [part, ...], "add": [part, ...], "remove": ["part_id", ...]}`;
  const c = await jsonChat<{ score?: number; issues?: string[]; replace?: Part[]; add?: Part[]; remove?: string[] }>(MODELS.vision, [{ role: 'system', content: system }, { role: 'user', content }], 6000);
  return {
    score: Math.max(0, Math.min(10, Number(c.score) || 0)),
    issues: (c.issues || []).slice(0, 6).map((s) => String(s).slice(0, 200)),
    replace: clean(c.replace || []),
    add: clean(c.add || []),
    remove: (c.remove || []).map(String).slice(0, 10),
    model: MODELS.vision,
  };
}

// ---------- helpers ----------
/**
 * Ask for JSON and get JSON. Uses the provider's JSON mode when it has one, repairs the usual
 * slips (comments, trailing commas, a reply cut off mid-object) and retries once.
 */
async function jsonChat<T>(model: string, messages: ChatMessage[], max_tokens: number, temperature = 0.2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply;
    try {
      reply = await chat({ model, messages, temperature, max_tokens, response_format: { type: 'json_object' } });
    } catch (err) {
      // Some providers reject response_format; ask again without it.
      if (err instanceof HttpError && err.status === 400) reply = await chat({ model, messages, temperature, max_tokens });
      else throw err;
    }
    const text = String(reply.choices?.[0]?.message?.content || '');
    try { return extractJson<T>(text); } catch (err) {
      lastErr = err;
      try { return JSON.parse(repairJson(text)) as T; } catch (err2) { lastErr = err2; }
    }
  }
  throw new HttpError(502, `The model's JSON could not be read (${lastErr instanceof Error ? lastErr.message.slice(0, 80) : 'parse error'})`);
}

function repairJson(text: string) {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(json)?/g, '');
  const start = t.indexOf('{');
  if (start < 0) throw new Error('no JSON object');
  t = t.slice(start);
  // Drop comments outside strings, and trailing commas.
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; continue; }
    out += c;
  }
  out = out.replace(/,\s*([}\]])/g, '$1');
  // Insert a missing comma between a value and the next key or element ("} {", "] [", "\"a\" \"b\"", number then quote).
  out = out.replace(/([}\]"\d])(\s*\n\s*)(["{\[])/g, (m, a, ws, b) => `${a},${ws}${b}`);
  // Close whatever a cut-off reply left open.
  const stack: string[] = [];
  inStr = false; esc = false;
  let lastSafe = 0;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { stack.pop(); if (!stack.length) return out.slice(0, i + 1); lastSafe = i + 1; }
    else if (c === ',') lastSafe = i;
  }
  let cut = out.slice(0, lastSafe).replace(/,\s*$/, '');
  const open: string[] = [];
  inStr = false; esc = false;
  for (const c of cut) {
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') open.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') open.pop();
  }
  cut += open.reverse().join('');
  return cut;
}

const TYPES = new Set(['box', 'cylinder', 'cone', 'dome', 'onion', 'sphere', 'arch', 'gable', 'pyramid', 'spire', 'torus']);
const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const vec = (v: unknown, d: number[]) => (Array.isArray(v) && v.length >= 3 ? v.slice(0, 3).map((x, i) => num(x, -MAX.dim, MAX.dim, d[i])) : d);

/** Keep only what the browser can render safely: known shapes, sane sizes, bounded repeats. */
function clean(parts: Part[], zone?: string): Part[] {
  if (!Array.isArray(parts)) return [];
  let budget = MAX.prims;
  return parts.slice(0, 16).map((p, i) => {
    const prims: Prim[] = [];
    for (const raw of Array.isArray(p.prims) ? p.prims : []) {
      if (!raw || !TYPES.has(String(raw.type))) continue;
      const q: Prim = { type: String(raw.type), at: vec(raw.at, [0, 0, 0]) };
      if (raw.rot) q.rot = vec(raw.rot, [0, 0, 0]);
      if (raw.size) q.size = vec(raw.size, [1, 1, 1]).map((x) => Math.max(0.05, Math.abs(x)));
      for (const k of ['r', 'r2', 'h', 'tube', 't']) if (raw[k] !== undefined) q[k] = num(raw[k], 0.01, MAX.dim, 1);
      if (raw.sides !== undefined) q.sides = Math.round(num(raw.sides, 3, 64, 24));
      let copies = 1;
      const ring = raw.ring as { n?: number; r?: number } | undefined;
      if (ring) { q.ring = { n: Math.round(num(ring.n, 1, MAX.count, 1)), r: num(ring.r, 0, MAX.dim, 0) }; copies *= (q.ring as { n: number }).n; }
      const row = raw.row as { n?: number; step?: number[] } | undefined;
      if (row) { q.row = { n: Math.round(num(row.n, 1, MAX.count, 1)), step: vec(row.step, [0, 0, 0]) }; copies *= (q.row as { n: number }).n; }
      if (['x', 'z', 'xz'].includes(String(raw.mirror))) { q.mirror = raw.mirror; copies *= raw.mirror === 'xz' ? 4 : 2; }
      if (copies > budget) continue;
      budget -= copies;
      prims.push(q);
    }
    return { id: slug(p.id || p.name || `part_${i + 1}`), name: String(p.name || p.id || `Part ${i + 1}`).slice(0, 60), role: String(p.role || '').slice(0, 200), prims, zone };
  }).filter((p) => p.prims.length);
}

function slug(s: string) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'part'; }
const SOCIAL = /(instagram|facebook|tiktok|pinterest|twitter|x)\.com|youtube\.com|reddit\.com/i;
function dedupe(rs: TavilyResult[]) { const seen = new Set<string>(); return rs.filter((r) => !SOCIAL.test(new URL(r.url).hostname) && !seen.has(r.url) && seen.add(r.url)); }

const UA = { 'User-Agent': 'ATLAS-Live/1.0 (https://atlas-live-xi.vercel.app; hackathon demo)' };

/** A real photo of the structure from Wikipedia's lead image (Wikimedia Commons), for the critic and the viewer. */
async function referencePhoto(subject: string) {
  try {
    const s = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(subject)}`, { headers: UA, signal: AbortSignal.timeout(5000) }).then((r) => r.json());
    const title = s?.query?.search?.[0]?.title;
    if (!title) return null;
    const sum = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { headers: UA, signal: AbortSignal.timeout(5000) }).then((r) => r.json());
    const thumb: string | undefined = sum?.thumbnail?.source;
    if (!thumb) return null;
    // Wikimedia serves fixed thumbnail widths (and never upscales): use the original if it is modest.
    const orig = sum?.originalimage as { source?: string; width?: number } | undefined;
    const image = orig?.source && (orig.width ?? 9999) <= 1600 ? orig.source : thumb.replace(/\/\d+px-/, '/960px-');
    return { image, page: sum?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, title };
  } catch { return null; }
}

