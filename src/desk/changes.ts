import type { AlertChange } from '../signals';
import type { LogEntry } from './store';

/** Follow exact CAP references from a live alert already logged as shared. Practice logs never qualify. */
export function relatedChanges(changes: AlertChange[], log: LogEntry[]): AlertChange[] {
  const known = new Set(log.filter((x) => !x.practice).map((x) => x.alertId));
  const ordered = [...changes].sort((a, b) => Date.parse(a.sent) - Date.parse(b.sent));
  const related: AlertChange[] = [];
  for (const change of ordered) {
    if (!change.references.some((id) => known.has(id))) continue;
    related.push(change);
    known.add(change.id); // supports Update -> Update -> Cancel chains
  }
  const acknowledged = new Set(log.filter((x) => !x.practice && x.followUpChangeId).map((x) => x.followUpChangeId));
  // A later CAP message that names an earlier change supersedes that earlier follow-up. Keep
  // separate branches when two changes both refer to the original alert.
  const superseded = new Set(related.flatMap((c) => c.references));
  return related.filter((c) => !acknowledged.has(c.id) && !superseded.has(c.id)).sort((a, b) => Date.parse(b.sent) - Date.parse(a.sent));
}

/** Resolve an update chain back to the alert the supervisor first logged as shared. */
export function originalAlertId(change: AlertChange, changes: AlertChange[], log: LogEntry[]): string {
  const roots = new Map<string, string>();
  for (const row of log) if (!row.practice) roots.set(row.alertId, row.followUpForAlertId || row.alertId);
  const byId = new Map(changes.map((c) => [c.id, c]));
  const pending = [...change.references], seen = new Set<string>();
  while (pending.length) {
    const id = pending.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (roots.has(id)) return roots.get(id)!;
    const previous = byId.get(id);
    if (previous) pending.push(...previous.references);
  }
  return change.references[0] || change.id;
}
