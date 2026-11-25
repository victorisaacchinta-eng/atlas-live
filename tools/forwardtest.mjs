// Runs the forwards in tools/fixtures/forwards.json through Check a forward and
// counts the fake ones the checker calls "match". The alerts are the recorded
// practice alerts, so the run stays repeatable after they expire.
//
//   npx vercel dev
//   node tools/forwardtest.mjs
//   node tools/forwardtest.mjs --url https://atlas-ace-azael.vercel.app/api/verify

import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const urlAt = args.indexOf('--url');
if (urlAt >= 0 && !args[urlAt + 1]) {
  console.error('--url needs a value');
  process.exit(1);
}
const url = urlAt >= 0 ? args[urlAt + 1] : process.env.VERIFY_URL || 'http://localhost:3000/api/verify';

const fixture = JSON.parse(await readFile(new URL('fixtures/forwards.json', import.meta.url), 'utf8'));
const practice = JSON.parse(await readFile(new URL('../public/practice.json', import.meta.url), 'utf8'));

const alerts = fixture.alertIds.map((id) => {
  const a = practice.alerts.find((x) => x.id === id);
  if (!a) throw new Error(`Alert ${id} is not in public/practice.json`);
  return a;
});

console.log(`Check a forward: ${fixture.cases.length} forwards`);
console.log(`Feed: ${alerts.length} alerts from public/practice.json (${practice.saved})`);
console.log(`POST ${url}\n`);

const rows = [];
for (const c of fixture.cases) {
  const started = Date.now();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: c.text, alerts, feed: { fetchedAt: practice.saved, stale: false } }),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await r.text();
    let j;
    try {
      j = JSON.parse(body);
    } catch {
      throw new Error(`HTTP ${r.status}: ${body.slice(0, 120)}`);
    }
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const fake = c.kind === 'fake';
    const falseMatch = fake && j.verdict === 'match';
    const missed = !fake && j.verdict !== 'match';
    const result = falseMatch ? 'FALSE MATCH' : missed ? 'MISS' : 'ok';
    const matched = j.match?.id ? `  ${j.match.id}` : '';
    console.log(`${c.kind.padEnd(4)}  ${c.id.padEnd(30)}  ${String(j.verdict).padEnd(9)}  ${result.padEnd(11)}  ${secs}s${matched}`);

    if (falseMatch || missed) {
      const claims = Array.isArray(j.claims) ? j.claims : [];
      const count = (s) => claims.filter((x) => x.status === s).length;
      if (claims.length) console.log(`      claims: ${count('supported')} supported, ${count('contradicted')} contradicted, ${count('not_in_alert')} not in alert`);
      if (j.reason) console.log(`      reason: ${j.reason}`);
    }
    rows.push({ kind: c.kind, id: c.id, verdict: String(j.verdict), falseMatch, missed, model: j.model });
  } catch (err) {
    rows.push({ kind: c.kind, id: c.id, verdict: 'error', error: true });
    console.log(`${c.kind.padEnd(4)}  ${c.id.padEnd(30)}  error      ${err instanceof Error ? err.message : String(err)}`);
  }
}

const fake = rows.filter((r) => r.kind === 'fake');
const real = rows.filter((r) => r.kind === 'real');
const falseMatches = fake.filter((r) => r.falseMatch).length;
const realMatches = real.filter((r) => r.verdict === 'match').length;
const errors = rows.filter((r) => r.error).length;

console.log(`\nreal forwards matched:         ${realMatches}/${real.length}`);
console.log(`fake forwards called "match": ${falseMatches}/${fake.length}${fake.length ? ` (${Math.round((100 * falseMatches) / fake.length)}%)` : ''}`);
for (const [label, list] of [['real', real], ['fake', fake]]) {
  const count = (v) => list.filter((r) => r.verdict === v).length;
  const error = list.filter((r) => r.error).length;
  console.log(`${label} verdicts: match ${count('match')}, partial ${count('partial')}, no_match ${count('no_match')}, unable ${count('unable')}${error ? `, error ${error}` : ''}`);
}
const models = [...new Set(rows.map((r) => r.model).filter(Boolean))];
if (models.length) console.log(`models: ${models.join(', ')}`);

if (errors) {
  console.error(`\n${errors} case(s) could not be checked. Is the app running at ${url}?`);
  process.exitCode = 1;
}
