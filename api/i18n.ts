import { chat, extractJson, send, HttpError, indicModel, indicFallbacks } from './_nebius.js';
import { LANG_BY_CODE } from './_langs.js';
import { UI_STRINGS, type UiKey } from './_ui-strings.js';

/**
 * GET /api/i18n?lang=te -> { lang, strings, machine: true, model }
 * Translates the interface strings once per language. The CDN keeps the answer for a week, so the
 * model runs once per language per deployment, not per visitor.
 */
const cache = new Map<string, { strings: Record<string, string>; model: string }>();

export default async function handler(req: { method: string; query: Record<string, string | string[]> }, res: { status: (n: number) => { json: (b: unknown) => void }; setHeader?: (k: string, v: string) => void }) {
  try {
    if (req.method !== 'GET') throw new HttpError(405, 'GET only');
    const code = String(req.query.lang || '');
    const L = LANG_BY_CODE[code];
    if (!L) throw new HttpError(400, 'Unknown language');
    if (code === 'en') { res.status(200).json({ lang: 'en', strings: UI_STRINGS, machine: false }); return; }
    let hit = cache.get(code);
    if (!hit) {
      const r = await chat({
        op: 'ui.translate', model: await indicModel(), fallbacks: await indicFallbacks(), temperature: 0.2, max_tokens: 2400, timeout_ms: 25_000,
        messages: [
          { role: 'system', content: `You translate a web app's interface into ${L.name} (${L.native}), written in the ${L.script} script. Use the words a ${L.name} speaker sees on government and news apps: clear, short, everyday. Keep "ATLAS" and place names as they are. Keep the meaning exact.` },
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
