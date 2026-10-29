import { HttpError, send } from './_nebius.js';
import { LANG_BY_CODE } from './_langs.js';

/**
 * POST /api/voice { text, lang } -> audio/wav
 * The Short's narration, spoken by Gemini TTS, for languages Gemini TTS lists (see api/_langs.ts).
 * Gemini returns 24 kHz, 16-bit mono PCM; this wraps it in a WAV header so any editor can open it.
 * Voices are AI-generated and the kit says so.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
let ttsModel: Promise<string | null> | null = null;

function pickModel(key: string) {
  ttsModel ??= (async () => {
    if (process.env.ATLAS_TTS_MODEL) return process.env.ATLAS_TTS_MODEL;
    try {
      const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(6000) });
      const ids = ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name.replace(/^models\//, '')) ?? [];
      // Stable before preview, Flash before Lite.
      const tts = ids.filter((id) => /tts/i.test(id) && /flash/i.test(id));
      return tts.find((id) => !/preview|lite/i.test(id)) || tts.find((id) => !/lite/i.test(id)) || tts[0] || null;
    } catch { return null; }
  })();
  return ttsModel;
}

function wav(pcm: Buffer, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

type Res = { status: (n: number) => { json: (b: unknown) => void; send: (b: unknown) => void }; setHeader: (k: string, v: string) => void };

export default async function handler(req: { method: string; body: { text?: string; lang?: string } }, res: Res) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new HttpError(503, 'Voice is not set up on this server (no Gemini key).');
    const L = LANG_BY_CODE[String(req.body?.lang || 'en')];
    if (!L) throw new HttpError(400, 'Unknown language');
    if (!L.voice) throw new HttpError(422, `No AI voice for ${L.name} yet. The script and captions are ready; record the voice yourself.`);
    const text = String(req.body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 3200);
    if (!text) throw new HttpError(400, 'text is required');
    const model = await pickModel(key);
    if (!model) throw new HttpError(503, 'No Gemini TTS model is available to this key.');
    const r = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Read this aloud in ${L.name}, in a calm, clear news-reader voice, at an even pace, with a short pause between sentences:\n\n${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    console.log(JSON.stringify({ evt: 'model_call', op: 'voice', provider: 'gemini', model, status: r.status, lang: L.code }));
    if (!r.ok) throw new HttpError(r.status === 429 ? 429 : 502, `Gemini TTS answered ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 200)}`);
    const j = (await r.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!part?.data) throw new HttpError(502, 'Gemini TTS returned no audio.');
    const rate = Number(/rate=(\d+)/.exec(part.mimeType || '')?.[1]) || 24000;
    const body = wav(Buffer.from(part.data, 'base64'), rate);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-Voice-Model', model);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(body);
  } catch (err) { send(res as never, err); }
}
