import { chat, tavily, extractJson, MODELS, HttpError, hasModel, type TavilyResult } from './_nebius.js';

const UA = 'ATLAS-Live/0.1 (hackathon project; github.com/victorisaacchinta-eng)';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

interface Feature { n: string; h: number | null; l: number | null; t: string; p: [number, number][] }

export async function geocode(q: string) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new HttpError(502, `Place search failed (${r.status})`);
  const j = (await r.json()) as { lat: string; lon: string; display_name: string; type: string }[];
  if (!j.length) throw new HttpError(404, `Could not find "${q}" on the map`);
  return { lat: Number(j[0].lat), lon: Number(j[0].lon), name: j[0].display_name.split(',').slice(0, 2).join(',').trim() };
}

export async function buildings(lat: number, lon: number, radius: number): Promise<Feature[]> {
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

export async function facts(place: string, names: string[]) {
  if (!hasModel()) return { facts: [], model: undefined as string | undefined };
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

