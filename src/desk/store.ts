// The supervisor's site and communication log. Both live in this browser only: Nayan has no
// accounts and no server copy. Wrapped in try/catch because private modes can refuse storage.
import { LGD } from '../../api/_lgd';
import type { DLang } from './strings';
import type { AlertChange } from '../signals';

export interface Site { name: string; code: number; district: string; state: string; lat: number; lon: number; langs: DLang[]; supervisor: string; crew: number | null }
export interface LogEntry {
  at: string; reviewedAt: string; alertId: string; url: string; event: string; sender: string; severity: string; expires: string;
  site: string; district: string; langs: DLang[]; channels: string[]; count: number | null; supervisor: string; note: string; practice: boolean;
  followUpChangeId?: string; followUpForAlertId?: string; followUpType?: 'Update' | 'Cancel';
}

const SITE = 'nayan-site', LOG = 'nayan-log', LANG = 'nayan-lang', CHANGES = 'nayan-changes';
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const getSite = () => read<Site | null>(SITE, null);
export const saveSite = (s: Site) => write(SITE, s);
export const getLog = () => read<LogEntry[]>(LOG, []);
export const addLog = (e: LogEntry) => write(LOG, [e, ...getLog()].slice(0, 500));
export const clearLog = () => write(LOG, []);
export const getChanges = () => read<AlertChange[]>(CHANGES, []);
export function rememberChanges(changes: AlertChange[]) {
  const merged = new Map(getChanges().map((c) => [c.id, c]));
  for (const c of changes) if (c.id && c.references?.length) merged.set(c.id, c);
  return write(CHANGES, [...merged.values()].sort((a, b) => Date.parse(b.sent) - Date.parse(a.sent)).slice(0, 500));
}

export function getLang(): DLang {
  const v = read<string>(LANG, '');
  if (v === 'en' || v === 'hi' || v === 'te') return v;
  const n = (navigator.language || 'en').slice(0, 2);
  return n === 'te' || n === 'hi' ? n : 'en';
}
export const saveLang = (l: DLang) => write(LANG, l);

export const DISTRICTS = Object.entries(LGD).map(([code, [name, state, lat, lon]]) => ({ code: Number(code), name, state, lat, lon }));
const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
/** Districts whose name starts with, then contains, what was typed. */
export function findDistricts(q: string, max = 8) {
  const k = norm(q);
  if (!k) return [];
  const starts = DISTRICTS.filter((d) => norm(d.name).startsWith(k));
  const has = DISTRICTS.filter((d) => !norm(d.name).startsWith(k) && (norm(d.name).includes(k) || norm(d.state).startsWith(k)));
  return [...starts, ...has].slice(0, max);
}
/** The pilot districts around the campus in Hyderabad, offered as quick picks. */
export const PILOT = [700, 507, 518, 691].map((c) => DISTRICTS.find((d) => d.code === c)!).filter(Boolean);

export function toCSV(rows: LogEntry[]) {
  const cols: (keyof LogEntry)[] = ['at', 'reviewedAt', 'site', 'district', 'supervisor', 'event', 'sender', 'severity', 'expires', 'alertId', 'url', 'langs', 'channels', 'count', 'note', 'practice', 'followUpType', 'followUpForAlertId', 'followUpChangeId'];
  const cell = (v: unknown) => { const s = Array.isArray(v) ? v.join(' ') : v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}
