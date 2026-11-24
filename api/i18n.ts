import { chat, extractJson, send, HttpError, indicModel, indicFallbacks } from './_nebius.js';
import { LANG_BY_CODE } from './_langs.js';
import { UI_STRINGS, type UiKey } from './_ui-strings.js';

/**
 * GET /api/i18n?lang=te -> { lang, strings, machine: true, model }
 *   Translates the interface strings once per language. The CDN keeps the answer for a week, so
 *   the model runs once per language per deployment, not per visitor. Hindi and Telugu ship
 *   pre-translated in the app and never reach this.
 * POST /api/i18n { lang, texts: { key: text } } -> { lang, strings, model }
 *   Translates one alert's message pack (plain summary, guidance, labels) for languages that do
 *   not ship with the app. Numbers, phone numbers and times must come back unchanged, or that
 *   line falls back to English.
 */
const cache = new Map<string, { strings: Record<string, string>; model: string }>();
const packCache = new Map<string, { strings: Record<string, string>; model: string }>();

type Req = { method: string; query: Record<string, string | string[]>; body?: { lang?: string; texts?: Record<string, unknown> } };

/** Every run of digits in the source must survive the translation (112, 1077, 11:00, 24). */
const digitsOf = (t: string) => (t.match(/\d+/g) ?? []).sort().join(',');

async function translatePack(code: string, texts: Record<string, string>) {
  const L = LANG_BY_CODE[code];
  const key = `${code}:${JSON.stringify(texts)}`;
  const hit = packCache.get(key);
  if (hit) return hit;
  const r = await chat({
    op: 'pack.translate', model: await indicModel(), fallbacks: await indicFallbacks(), temperature: 0.1, max_tokens: 3000, timeout_ms: 20_000,
    messages: [
      { role: 'system', content: `You translate an official disaster alert message into ${L.name} (${L.native}), written in the ${L.script} script, for ordinary people. Use the plain words a ${L.name} speaker hears on local news. Translate the meaning exactly: add nothing, drop nothing, do not soften or strengthen any warning. Keep every number, phone number, date and time exactly as written in Western digits. Write place names in the ${L.script} script the way locals spell them.` },
      { role: 'user', content: `Translate every value. Return JSON only, with exactly the same keys:\n${JSON.stringify(texts, null, 1)}` },
    ],
  });
  const got = extractJson<Record<string, unknown>>(r.choices?.[0]?.message?.content || '{}');
  const strings: Record<string, string> = {};
  for (const [k, src] of Object.entries(texts)) {
    const v = got[k];
    // A line whose numbers changed (a wrong time, a wrong helpline) is not shown: English instead.
    strings[k] = typeof v === 'string' && v.trim() && v.length < 1200 && digitsOf(v) === digitsOf(src) ? v.trim() : src;
  }
  const out = { strings, model: String(r.servedBy || '') };
  packCache.set(key, out);
  return out;
}

export default async function handler(req: Req, res: { status: (n: number) => { json: (b: unknown) => void }; setHeader?: (k: string, v: string) => void }) {
  try {
    if (req.method === 'POST') {
      const code = String(req.body?.lang || '');
      if (!LANG_BY_CODE[code] || code === 'en') throw new HttpError(400, 'Unknown language');
      const raw = req.body?.texts && typeof req.body.texts === 'object' ? req.body.texts : {};
      const texts: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw).slice(0, 40)) if (typeof v === 'string' && v.trim()) texts[k.slice(0, 40)] = v.slice(0, 900);
      if (!Object.keys(texts).length) throw new HttpError(400, 'texts is required');
      const out = await translatePack(code, texts);
      res.status(200).json({ lang: code, strings: out.strings, model: out.model, machine: true });
      return;
    }
    if (req.method !== 'GET') throw new HttpError(405, 'GET or POST');
    const code = String(req.query.lang || '');
    const L = LANG_BY_CODE[code];
    if (!L) throw new HttpError(400, 'Unknown language');
    if (code === 'en') { res.status(200).json({ lang: 'en', strings: UI_STRINGS, machine: false }); return; }
    let hit = cache.get(code);
    if (!hit) {
      const r = await chat({
        op: 'ui.translate', model: await indicModel(), fallbacks: await indicFallbacks(), temperature: 0.2, max_tokens: 2400, timeout_ms: 25_000,
        messages: [
          { role: 'system', content: `You translate a web app's interface into ${L.name} (${L.native}), written in the ${L.script} script. Use the words a ${L.name} speaker sees on government and news apps: clear, short, everyday. Keep "Nayan" and place names as they are. Keep the meaning exact.` },
          { role: 'user', content: `Translate every value. Return JSON only, with exactly the same keys:\n${JSON.stringify(UI_STRINGS, null, 1)}` },
        ],
      });
      const got = extractJson<Record<string, unknown>>(r.choices?.[0]?.message?.content || '{}');
      const strings: Record<string, string> = {};
      // Any key the model dropped or mangled falls back to English rather than showing a blank.
      for (const k of Object.keys(UI_STRINGS) as UiKey[]) {
        const v = got[k];
        strings[k] = typeof v === 'string' && v.trim() && v.length < 600 ? v.trim() : UI_STRINGS[k];
      }
      hit = { strings, model: String(r.servedBy || '') };
      cache.set(code, hit);
    }
    res.setHeader?.('Cache-Control', 's-maxage=604800, stale-while-revalidate=86400');
    res.status(200).json({ lang: code, strings: hit.strings, machine: true, model: hit.model });
  } catch (err) { send(res, err); }
}
