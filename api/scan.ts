import { chat, extractJson, send, MODELS, HttpError } from './_nebius.js';

/**
 * SCAN: Nemotron vision looks at one camera frame and says what the object is and where its
 * visible parts are. The browser turns the same frame into depth and splits the 3D points by
 * these boxes, so every part the model names becomes a piece you can pull out.
 */

export interface ScanResult {
  object: string;
  category: string;
  summary: string;
  object_box: [number, number, number, number];
  parts: { name: string; role: string; box: [number, number, number, number] }[];
}

const PROMPT = `You are looking at one photo from a webcam. Identify the single main physical object held up or placed in front of the camera (ignore the person, the room and the background).
Return ONLY a JSON object, no prose, with this exact shape:
{"object": "<specific name, e.g. 'Logitech-style wireless mouse' or 'stainless steel French press'>",
 "category": "<one or two words>",
 "summary": "<one plain sentence on what it does>",
 "object_box": [x0, y0, x1, y1],
 "parts": [{"name": "<part name>", "role": "<what this part does, under 12 words>", "box": [x0, y0, x1, y1]}]}
Rules: coordinates are fractions of image width and height from 0 to 1, origin top-left. List 4 to 9 parts that are actually visible, each with a tight box inside object_box. Use real engineering names for parts. If you are unsure what the object is, say so in "object" rather than guessing a brand.`;

export default async function handler(req: { method: string; body: { image?: string } }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'POST only');
    const image = req.body?.image;
    if (!image || !image.startsWith('data:image/')) throw new HttpError(400, 'image must be a data URL');
    if (image.length > 3_500_000) throw new HttpError(413, 'image too large, send under 2.5 MB');

    const reply = await chat({
      model: MODELS.vision,
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        { role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: PROMPT }] },
      ],
    });
    const text: string = reply.choices?.[0]?.message?.content || '';
    const data = sanitize(extractJson<ScanResult>(text));
    res.status(200).json({ ...data, model: MODELS.vision });
  } catch (err) {
    send(res, err);
  }
}

function clampBox(b: unknown): [number, number, number, number] | null {
  if (!Array.isArray(b) || b.length !== 4) return null;
  let [x0, y0, x1, y1] = b.map((v) => Math.min(1, Math.max(0, Number(v) || 0)));
  // Some models answer in pixels of a 1000 grid; normalise if every value looks like that.
  if (b.every((v) => Number(v) > 1.5)) [x0, y0, x1, y1] = b.map((v) => Math.min(1, Math.max(0, Number(v) / 1000)));
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return null;
  return [x0, y0, x1, y1];
}

function sanitize(d: ScanResult): ScanResult {
  const ob = clampBox(d.object_box) || [0.15, 0.1, 0.85, 0.9];
  const parts = (Array.isArray(d.parts) ? d.parts : [])
    .map((p) => ({ name: String(p?.name || '').slice(0, 48), role: String(p?.role || '').slice(0, 120), box: clampBox(p?.box) }))
    .filter((p): p is { name: string; role: string; box: [number, number, number, number] } => !!p.name && !!p.box)
    .slice(0, 9);
  return {
    object: String(d.object || 'Unknown object').slice(0, 80),
    category: String(d.category || 'Object').slice(0, 40),
    summary: String(d.summary || '').slice(0, 240),
    object_box: ob,
    parts,
  };
}
