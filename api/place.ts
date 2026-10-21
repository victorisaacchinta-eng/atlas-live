import { chat, tavily, extractJson, send, MODELS, HttpError, type TavilyResult } from './_nebius.js';

/**
 * PLACES: name a real place, get its buildings as a hologram plus a few cited facts.
 * 1. Nominatim (OpenStreetMap) finds the place.
 * 2. Overpass returns building footprints and heights around it.
 * 3. Tavily searches the place; Nemotron writes one fact per named landmark, citing a result.
 * Responses are cached at the edge for a day, so a demo place loads instantly the second time.
 */

const UA = 'ATLAS-Live/0.1 (hackathon project; github.com/victorisaacchinta-eng)';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

interface Feature { n: string; h: number | null; l: number | null; t: string; p: [number, number][] }

async function geocode(q: string) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!r.ok) throw new HttpError(502, `Place search failed (${r.status})`);
  const j = (await r.json()) as { lat: string; lon: string; display_name: string; type: string }[];
  if (!j.length) throw new HttpError(404, `Could not find "${q}" on the map`);
  return { lat: Number(j[0].lat), lon: Number(j[0].lon), name: j[0].display_name.split(',').slice(0, 2).join(',').trim() };
}

async function buildings(lat: number, lon: number, radius: number): Promise<Feature[]> {
  const q = `[out:json][timeout:22];(way["building"](around:${radius},${lat},${lon});way["historic"]["area"!="no"](around:${radius},${lat},${lon}););out tags geom qt;`;
  let lastErr = '';
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(24000) });
      if (!r.ok) { lastErr = `${url} ${r.status}`; continue; }
      const j = (await r.json()) as { elements: { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] };
      const k = 111320, kx = 111320 * Math.cos((lat * Math.PI) / 180);
      return j.elements
        .filter((w) => w.geometry && w.geometry.length > 2)
        .slice(0, 900)
        .map((w) => ({
          n: w.tags?.name || '',
          h: parseFloat(w.tags?.height || '') || null,
          l: parseFloat(w.tags?.['building:levels'] || '') || null,
          t: w.tags?.historic || w.tags?.building || w.tags?.amenity || '',
          p: w.geometry!.map((g) => [Math.round((g.lon - lon) * kx * 10) / 10, Math.round(-(g.lat - lat) * k * 10) / 10] as [number, number]),
        }));
    } catch (e) {
      lastErr = `${url} ${e instanceof Error ? e.message : e}`;
    }
  }
  throw new HttpError(504, `Map data is slow right now (${lastErr}). Try again in a minute.`);
}

async function facts(place: string, names: string[]) {
  if (!process.env.NEBIUS_API_KEY) return { facts: [], model: undefined as string | undefined };
  const found = await tavily(`${place} history architecture ${names.slice(0, 4).join(' ')}`, 6).catch(() => ({ results: [] as TavilyResult[] }));
  if (!found.results.length) return { facts: [], model: MODELS.fast };
  const sources = found.results.map((r, i) => `[${i}] ${r.title} (${r.url})\n${r.content.slice(0, 600)}`).join('\n\n');
  const reply = await chat({
    model: MODELS.agent,
    temperature: 0.2,
    max_tokens: 900,
    messages: [
      { role: 'system', content: 'You write short, accurate captions for a 3D map. Use only the sources given. Never invent numbers, dates or names.' },
      { role: 'user', content: `Place: ${place}\nNamed landmarks on the map: ${names.join('; ') || '(none)'}\n\nSources:\n${sources}\n\nReturn JSON only: {"facts":[{"name":"<exactly one landmark name from the list, or the place name>","fact":"<one sentence, under 30 words, supported by a source>","source":<source index>}]}. 3 to 6 facts. Skip any landmark the sources do not cover.` },
    ],
  });
  const j = extractJson<{ facts: { name: string; fact: string; source: number }[] }>(reply.choices?.[0]?.message?.content || '{}');
  return {
    facts: (j.facts || []).slice(0, 6).map((f) => ({ name: String(f.name), fact: String(f.fact).slice(0, 220), source: found.results[f.source] ? { title: found.results[f.source].title, url: found.results[f.source].url } : undefined })),
    model: MODELS.agent,
  };
}

export default async function handler(req: { method: string; body: { query?: string; radius?: number } }, res: { status: (n: number) => { json: (b: unknown) => void }; setHeader?: (k: string, v: string) => void }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const query = String(req.body?.query || '').trim().slice(0, 120);
    if (!query) throw new HttpError(400, 'Name a place');
    const radius = Math.min(400, Math.max(120, Number(req.body?.radius) || 220));
    const g = await geocode(query);
    const features = await buildings(g.lat, g.lon, radius);
    if (!features.length) throw new HttpError(404, `OpenStreetMap has no buildings mapped around ${g.name}`);
    const named = [...new Set(features.filter((f) => f.n).map((f) => f.n))].slice(0, 12);
    const f = await facts(g.name, named).catch(() => ({ facts: [], model: undefined }));
    res.setHeader?.('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ query, name: g.name, lat: g.lat, lon: g.lon, radius, features, facts: f.facts, model: f.model, attribution: 'Map data © OpenStreetMap contributors, ODbL' });
  } catch (err) {
    send(res, err);
  }
}
