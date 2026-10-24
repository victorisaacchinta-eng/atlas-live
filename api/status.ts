import { PROVIDER, MODELS, ALTS, LIVE_IDS, ensureModels } from './_nebius.js';

/** Tells the UI which model provider is live, so the header never claims a model that isn't running. */
export default async function handler(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  await ensureModels();
  res.status(200).json({
    provider: PROVIDER?.id || null,
    label: PROVIDER?.label || null,
    agent: PROVIDER ? MODELS.agent : null,
    vision: PROVIDER ? MODELS.vision : null,
    fast: PROVIDER ? MODELS.fast : null,
    fallbacks: PROVIDER ? ALTS.agent.slice(0, 6) : [],
    listed: LIVE_IDS,
    search: !!process.env.TAVILY_API_KEY,
    // Map tokens are browser-side by design (the tiles stream straight to the viewer).
    // Restrict them to the site's URL in the Cesium ion / Google Cloud console.
    earth: process.env.CESIUM_ION_TOKEN ? { kind: 'ion', token: process.env.CESIUM_ION_TOKEN }
      : process.env.GOOGLE_MAPS_KEY ? { kind: 'google', key: process.env.GOOGLE_MAPS_KEY } : null,
  });
}
