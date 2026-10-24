/**
 * Every piece of data on screen carries one of these kinds, so the interface
 * can always say whether a value is live, a daily product, a fixed historical
 * dataset, a cached copy, an estimate, or general knowledge from a model.
 */
export type ProvenanceKind = 'live' | 'near-real-time' | 'daily' | 'static' | 'cached' | 'estimated' | 'model';

export interface Provenance {
  kind: ProvenanceKind;
  /** Human name of the organisation or dataset, e.g. "USGS Earthquake Hazards Program". */
  source: string;
  /** Link to the dataset or its documentation. */
  url?: string;
  /** When the provider says the data was produced or observed (ISO 8601). */
  observedAt?: string;
  /** When Mizpah fetched it (ISO 8601). */
  fetchedAt?: string;
  /** Licence or terms short name. */
  licence?: string;
  note?: string;
}

export const KIND_LABEL: Record<ProvenanceKind, string> = {
  live: 'Live',
  'near-real-time': 'Near real time',
  daily: 'Daily',
  static: 'Static',
  cached: 'Cached',
  estimated: 'Estimated',
  model: 'Model knowledge',
};

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;

/** "4 min ago", "2 days ago". Falls back to an ISO date when Intl is unavailable. */
export function relativeTime(iso: string | number | Date, now = Date.now()): string {
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'unknown time';
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  if (!rtf) return new Date(t).toISOString();
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 45) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 400) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}

/** "24 Oct 2026, 10:42 UTC" */
export function utcStamp(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${date}, ${time} UTC`;
}

export function provenanceLine(p: Provenance): string {
  const parts = [KIND_LABEL[p.kind], p.source];
  if (p.observedAt) parts.push(`observed ${relativeTime(p.observedAt)}`);
  else if (p.fetchedAt) parts.push(`fetched ${relativeTime(p.fetchedAt)}`);
  return parts.join(', ');
}
