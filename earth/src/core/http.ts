/**
 * Small fetch layer shared by every provider: timeouts, cancellation,
 * per-host rate limiting (some free APIs ask for one request per second),
 * and a memory + sessionStorage cache so repeated views don't hammer
 * volunteer-run services.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Cache lifetime in ms. 0 disables caching. */
  cacheMs?: number;
  /** Minimum gap between requests to the same host, in ms. */
  minIntervalMs?: number;
  init?: RequestInit;
}

interface CacheEntry {
  at: number;
  value: unknown;
}

const memory = new Map<string, CacheEntry>();
const lastHit = new Map<string, number>();
const MAX_MEMORY_ENTRIES = 300;

function storageGet(key: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(`mz:${key}`);
    return raw ? (JSON.parse(raw) as CacheEntry) : null;
  } catch {
    return null;
  }
}

function storageSet(key: string, entry: CacheEntry): void {
  try {
    const raw = JSON.stringify(entry);
    if (raw.length < 400_000) sessionStorage.setItem(`mz:${key}`, raw);
  } catch {
    /* quota or privacy mode: memory cache still works */
  }
}

function abortError(): DOMException {
  return new DOMException('The request was cancelled.', 'AbortError');
}

async function waitForSlot(host: string, gap: number, signal?: AbortSignal): Promise<void> {
  if (!gap) return;
  const now = Date.now();
  const next = Math.max(now, (lastHit.get(host) ?? 0) + gap);
  lastHit.set(host, next);
  const wait = next - now;
  if (wait <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, wait);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true },
    );
  });
}

/** Returns the cached value and its age when present and fresh, else null. */
export function peekCache<T>(key: string, maxAgeMs: number): { value: T; at: number } | null {
  const hit = memory.get(key) ?? storageGet(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return { value: hit.value as T, at: hit.at };
  return null;
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<{ data: T; fromCache: boolean; fetchedAt: number }> {
  const key = url + (opts.init?.body ? `#${String(opts.init.body)}` : '');
  if (opts.cacheMs) {
    const hit = peekCache<T>(key, opts.cacheMs);
    if (hit) return { data: hit.value, fromCache: true, fetchedAt: hit.at };
  }

  const host = new URL(url, location.href).host;
  await waitForSlot(host, opts.minIntervalMs ?? 0, opts.signal);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(url, { ...opts.init, signal: controller.signal });
    if (!res.ok) {
      const msg =
        res.status === 429
          ? 'The data provider is rate limiting requests. Try again in a minute.'
          : `The data provider answered ${res.status}.`;
      throw new HttpError(msg, res.status, url);
    }
    const data = (await res.json()) as T;
    const fetchedAt = Date.now();
    if (opts.cacheMs) {
      const entry = { at: fetchedAt, value: data };
      if (memory.size > MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value as string);
      memory.set(key, entry);
      storageSet(key, entry);
    }
    return { data, fromCache: false, fetchedAt };
  } catch (err) {
    if (opts.signal?.aborted) throw abortError();
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new HttpError('The data provider did not answer in time.', 0, url);
    }
    if (err instanceof HttpError) throw err;
    throw new HttpError('Could not reach the data provider. Check your connection.', 0, url);
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const res = await fetch(url, { ...opts.init, signal: controller.signal });
    if (!res.ok) throw new HttpError(`The data provider answered ${res.status}.`, res.status, url);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** Persistent per-browser storage for bookmarks and settings. Never throws. */
export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`mizpah:${key}`);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`mizpah:${key}`, JSON.stringify(value));
    } catch {
      /* storage blocked: the feature simply won't persist */
    }
  },
};
