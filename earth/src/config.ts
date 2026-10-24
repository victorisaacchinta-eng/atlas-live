/**
 * What changes when Mizpah runs inside another app. The standalone build uses
 * these defaults. This copy is the one ATLAS Live serves at /earth/ as God's
 * Eye View, and it differs from the standalone Mizpah only here and in index.html.
 */
export interface HostLink {
  /** Shown in the status bar, links back to the host app. */
  label: string;
  href: string;
  /** Opens a place in the host, for example in photoreal 3D. */
  place?: { label: string; href: (lat: number, lon: number, name: string) => string };
}

export const CONFIG: {
  name: string;
  /** Endpoint for the model planner. */
  assistUrl: string;
  /** Optional host endpoint that reports the live model and a browser-safe Cesium ion token. */
  statusUrl: string | null;
  host: HostLink | null;
} = {
  name: 'ATLAS',
  assistUrl: '/api/earth',
  statusUrl: '/api/status',
  host: {
    label: 'ATLAS Live',
    href: '/',
    // ATLAS Places opens ?at=lat,lon,Name in its hologram and photo looks.
    place: { label: 'Open in ATLAS Places', href: (lat, lon, name) => `/?at=${lat},${lon},${encodeURIComponent(name.replace(/,/g, ' '))}` },
  },
};

export interface HostStatus {
  /** Model label for the sources dialog, for example "Nebius Token Factory, nvidia/nemotron-3-super-120b-a12b". */
  model: string | null;
  /** A Cesium ion token the host has restricted to its own site. */
  ionToken: string | null;
  /** A Google Maps Platform key (Map Tiles API) the host has restricted to its own site. */
  googleKey: string | null;
}

/** Reads the host's status endpoint. Never throws; a slow or missing host just means no extras. */
export async function hostStatus(): Promise<HostStatus> {
  const none = { model: null, ionToken: null, googleKey: null };
  if (!CONFIG.statusUrl) return none;
  try {
    const res = await fetch(CONFIG.statusUrl, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return none;
    const j = (await res.json()) as { label?: string | null; agent?: string | null; earth?: { kind?: string; token?: string; key?: string } | null };
    return {
      model: j.label && j.agent ? `${j.agent} on ${j.label}` : null,
      ionToken: j.earth?.kind === 'ion' && typeof j.earth.token === 'string' ? j.earth.token : null,
      googleKey: j.earth?.kind === 'google' && typeof j.earth.key === 'string' ? j.earth.key : null,
    };
  } catch {
    return none;
  }
}
