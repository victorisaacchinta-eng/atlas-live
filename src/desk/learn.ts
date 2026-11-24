// Learn: IMD's colour codes and the three CAP fields, side by side but never merged.
import { desk, T, esc } from './desk';
import { CAP, IMD_COLOURS, IMD_SOURCE, ABBREV } from './explain';
import { NDMA_PAGE } from './ndma';

const CAP_SPEC = 'https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html';

export function renderLearn() {
  const L = desk.lang;
  const el = document.createElement('section');
  el.className = 'dk-view dk-learn';
  const capTable = (field: 'severity' | 'urgency' | 'certainty', title: string) => `
    <div class="dk-learn-block"><h4>${esc(title)}</h4><dl class="dk-terms">${Object.entries(CAP[L][field]).map(([k, [w, d]]) => `<div><dt><span class="dk-mono">${esc(k)}</span>${L === 'en' ? '' : ` · ${esc(w)}`}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl></div>`;
  el.innerHTML = `
    <header class="dk-head"><p class="dk-eyebrow">05 · ${esc(T('nav_learn'))}</p><h2 id="dk-h" tabindex="-1">${esc(T('l_title'))}</h2><p class="dk-lede">${esc(T('l_lede'))}</p></header>
    <h3 class="dk-h3">${esc(T('l_imd'))}</h3>
    <p class="dk-muted">${esc(T('l_imd_d'))}</p>
    <ul class="dk-colours">${IMD_COLOURS.map((c) => `<li><i style="background:${c.hex}" aria-hidden="true"></i><b>${esc(c[L][0])}</b><span>${esc(c[L][1])}</span></li>`).join('')}</ul>
    <p class="dk-src">${esc(T('l_src'))}: <a href="${IMD_SOURCE}" target="_blank" rel="noopener">IMD heat wave warning graphic, PIB, 27 Apr 2021</a></p>
    <h3 class="dk-h3">${esc(T('l_cap'))}</h3>
    <p class="dk-muted">${esc(T('l_cap_d'))}</p>
    ${capTable('severity', T('sev'))}${capTable('urgency', T('urg'))}${capTable('certainty', T('cert'))}
    <p class="dk-src">${esc(T('l_src'))}: <a href="${CAP_SPEC}" target="_blank" rel="noopener">OASIS Common Alerting Protocol 1.2</a></p>
    <h3 class="dk-h3">${esc(T('l_short'))}</h3>
    <dl class="dk-terms is-short">${ABBREV.map(([, full, short]) => `<div><dt class="dk-mono">${esc(short)}</dt><dd lang="en">${esc(full)}</dd></div>`).join('')}</dl>
    <p class="dk-src"><a href="${NDMA_PAGE}" target="_blank" rel="noopener">${esc(T('l_dd'))} ↗</a></p>`;
  return el;
}
