import { PROVIDER, MODELS } from './_nebius.js';

/** Tells the UI which model provider is live, so the header never claims a model that isn't running. */
export default function handler(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  res.status(200).json({
    provider: PROVIDER?.id || null,
    label: PROVIDER?.label || null,
    agent: PROVIDER ? MODELS.agent : null,
    vision: PROVIDER ? MODELS.vision : null,
    search: !!process.env.TAVILY_API_KEY,
  });
}
