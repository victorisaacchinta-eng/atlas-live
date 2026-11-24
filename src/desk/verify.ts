// Check a forward (experimental). A model reads what the forward claims; code finds the official
// alerts in force that cover the same place and hazard; the server re-reads the matched alert from
// SACHET; a model labels each claim against it; code decides one of four results. Never "fake".
import { desk, T, esc, liveAlerts } from './desk';
import { at } from './explain';

let el: HTMLElement;
let builtFor = '';
let image = '';
let imageName = '';
let text = '';
let last: Record<string, unknown> | null = null;
let busy = false;

export function mountVerify() { el = document.createElement('section'); el.className = 'dk-view dk-verify'; }

export function renderVerify() {
  if (builtFor !== desk.lang) build();
  return el;
}

const VERDICT: Record<string, { k: 'v_match' | 'v_partial' | 'v_no_match' | 'v_unable'; d: 'v_match_d' | 'v_partial_d' | 'v_no_match_d' | 'v_unable_d'; cls: string }> = {
  match: { k: 'v_match', d: 'v_match_d', cls: 'ok' },
  partial: { k: 'v_partial', d: 'v_partial_d', cls: 'warn' },
  no_match: { k: 'v_no_match', d: 'v_no_match_d', cls: 'none' },
  unable: { k: 'v_unable', d: 'v_unable_d', cls: 'none' },
};
const REASON: Record<string, 'v_r_feed' | 'v_r_not_alert' | 'v_r_no_place' | 'v_r_no_claims'> = { feed: 'v_r_feed', not_alert: 'v_r_not_alert', no_place: 'v_r_no_place', no_claims: 'v_r_no_claims' };
const STATUS: Record<string, 'v_supported' | 'v_contra' | 'v_not_in'> = { supported: 'v_supported', contradicted: 'v_contra', not_in_alert: 'v_not_in' };

function build() {
  builtFor = desk.lang;
  el.innerHTML = `
    <header class="dk-head"><p class="dk-eyebrow">04 · ${esc(T('nav_verify'))} <span class="dk-tag is-exp">${esc(T('v_tag'))}</span></p>
      <h2 id="dk-h" tabindex="-1">${esc(T('v_title'))}</h2><p class="dk-lede">${esc(T('v_lede'))}</p></header>
    <label class="dk-field"><span class="visually-hidden">${esc(T('v_ph'))}</span><textarea class="dk-ta" rows="6" placeholder="${esc(T('v_ph'))}"></textarea></label>
    <div class="dk-actions">
      <label class="dk-btn"><span>${esc(T('v_shot'))}</span><input type="file" accept="image/*" hidden></label>
      <span class="dk-muted dk-fname"></span>
      <button type="button" class="dk-btn is-solid" data-check>${esc(T('v_go'))}</button>
    </div>
    <p class="dk-try"><span>${esc(T('v_try'))}:</span><button type="button" class="dk-link" data-try="real">${esc(T('v_try_real'))}</button><button type="button" class="dk-link" data-try="fake">${esc(T('v_try_fake'))}</button></p>
    <div class="dk-result" aria-live="polite"></div>
    <p class="dk-muted">${esc(T('v_never'))}</p>`;
  const ta = el.querySelector<HTMLTextAreaElement>('.dk-ta')!;
  ta.value = text;
  ta.addEventListener('input', () => { text = ta.value; });
  const file = el.querySelector<HTMLInputElement>('input[type=file]')!;
  const fname = el.querySelector<HTMLElement>('.dk-fname')!;
  fname.textContent = imageName;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    image = await downscale(f);
    imageName = f.name;
    fname.textContent = f.name;
  });
  el.querySelector('[data-check]')!.addEventListener('click', () => void check());
  el.querySelector('.dk-try')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-try]');
    if (!b) return;
    image = ''; imageName = ''; fname.textContent = ''; file.value = '';
    if (b.dataset.try === 'real') {
      const a = liveAlerts()[0];
      const en = a?.texts?.find((x) => /^en/i.test(x.lang)) ?? a?.texts?.[0];
      ta.value = a ? `${en?.headline ?? a.title}\n- ${(a.sender ?? 'IMD').replace(/[-_]/g, ' ')}. Please share with everyone.` : '';
    } else {
      ta.value = 'URGENT!! IMD has issued a RED ALERT for Hyderabad. Very heavy rain and a cyclone tonight with 150 km/h winds. All construction sites must stop work for 3 days. Forward to everyone!!';
    }
    text = ta.value;
    ta.focus();
  });
  if (last) paintResult(last);
}

async function downscale(f: File, max = 1400): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.86);
  } finally { URL.revokeObjectURL(url); }
}

async function check() {
  const out = el.querySelector<HTMLElement>('.dk-result')!;
  const go = el.querySelector<HTMLButtonElement>('[data-check]')!;
  if ((!text.trim() && !image) || busy) return;
  busy = true;
  go.disabled = true;
  go.textContent = T('v_busy');
  out.innerHTML = '';
  const t0 = performance.now();
  try {
    const f = desk.feed;
    const alerts = f.status === 'failed' ? undefined : liveAlerts().map((a) => ({ id: a.id, url: a.url, event: a.event, kind: a.kind, sender: a.sender, severity: a.severity, expires: a.expires, state: a.state, districts: a.districts, title: a.title, texts: a.texts?.map((x) => ({ lang: x.lang, headline: x.headline, description: x.description })) }));
    const r = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, image: image || undefined, alerts, feed: { fetchedAt: f.fetchedAt, stale: f.stale } }) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    const res = { ...j, secs: ((performance.now() - t0) / 1000).toFixed(1) };
    last = res;
    paintResult(res);
  } catch (err) {
    last = null;
    out.innerHTML = `<div class="dk-verdict" data-kind="none"><b>${esc(T('v_unable'))}</b><p>${esc(T('v_err', { e: err instanceof Error ? err.message.slice(0, 140) : 'error' }))}</p></div>`;
  } finally {
    busy = false;
    go.disabled = false;
    go.textContent = T('v_go');
  }
}

function paintResult(j: Record<string, unknown>) {
  const out = el.querySelector<HTMLElement>('.dk-result')!;
  const V = VERDICT[String(j.verdict)] ?? VERDICT.unable;
  const reason = REASON[String(j.reason || '')];
  const claims = (j.claims as { claim: string; status: string; reason: string }[] | undefined) ?? [];
  const match = j.match as { id: string; url: string; sender: string; event: string; severity: string; expires?: string; reread: boolean } | undefined;
  const sources = (j.sources as { name: string; url: string; checkedAt: string; alerts: number; stale: boolean }[] | undefined) ?? [];
  const L = desk.lang;
  out.innerHTML = `
    <div class="dk-verdict" data-kind="${V.cls}"><b>${esc(T(V.k))}</b><p>${esc(reason ? T(reason) : T(V.d))}</p></div>
    ${claims.length ? `<ol class="dk-claims">${claims.map((c) => `<li data-status="${esc(c.status)}"><span>${esc(T(STATUS[c.status] ?? 'v_not_in'))}</span><b>${esc(c.claim)}</b><small>${esc(c.reason)}</small></li>`).join('')}</ol>` : ''}
    ${match ? `<div class="dk-matchbox"><b>${esc(match.event)} · ${esc((match.sender ?? '').replace(/[-_]/g, ' '))}</b><small>${esc(match.severity)}${match.expires ? ` · ${esc(T('until', { t: at(match.expires, L) }))} IST` : ''}</small>
      <div class="dk-actions"><button type="button" class="dk-btn is-small" data-open="${esc(match.id)}">${esc(T('v_open'))}</button><a class="dk-btn is-small" href="${esc(match.url)}" target="_blank" rel="noopener">CAP XML ↗</a></div></div>` : ''}
    ${sources.length ? `<div class="dk-sources"><p class="dk-h4">${esc(T('v_sources'))}</p><ul>${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> · ${esc(String(s.alerts))}${s.checkedAt ? ` · ${esc(at(s.checkedAt, L))} IST` : ''}${s.stale ? ' · stale' : ''}</li>`).join('')}</ul>${j.coverage ? `<p class="dk-muted">${esc(String(j.coverage))}</p>` : ''}</div>` : ''}
    <p class="dk-muted">${j.secs ? `${esc(String(j.secs))} s · ` : ''}${j.model ? `AI: ${esc(String(j.model))} · ` : ''}verdict by code</p>`;
  out.querySelector<HTMLButtonElement>('[data-open]')?.addEventListener('click', (e) => {
    const id = (e.currentTarget as HTMLElement).dataset.open;
    const s = liveAlerts().find((a) => a.id === id);
    if (s) window.dispatchEvent(new CustomEvent('nayan:alert', { detail: s }));
  });
}
