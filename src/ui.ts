const $ = (id: string) => document.getElementById(id)!;

export type LogKind = 'you' | 'sys' | 'tool' | 'answer' | 'hot';

export interface CardData {
  index: number;
  total: number;
  title: string;
  body: string;
  sources?: { title: string; url: string }[];
}

export const ui = {
  log(text: string, kind: LogKind = 'sys') {
    const list = $('log');
    const li = document.createElement('li');
    li.className = kind;
    const prefix = kind === 'you' ? 'you › ' : kind === 'tool' ? 'nemotron › ' : kind === 'answer' ? '' : '· ';
    li.textContent = prefix + text;
    list.appendChild(li);
    while (list.children.length > 7) list.firstElementChild?.remove();
    return li;
  },

  openCard(d: CardData) {
    $('card-index').textContent = `PART ${String(d.index).padStart(2, '0')} / ${String(d.total).padStart(2, '0')}`;
    $('card-title').textContent = d.title;
    $('card-body').textContent = d.body;
    ui.setSources(d.sources || []);
    ($('card') as HTMLElement).hidden = false;
  },

  setCardBody(text: string) { $('card-body').textContent = text; },

  setSources(sources: { title: string; url: string }[]) {
    const ol = $('card-sources');
    ol.replaceChildren();
    for (const s of sources.slice(0, 4)) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = s.title;
      li.appendChild(a);
      ol.appendChild(li);
    }
  },

  closeCard() { ($('card') as HTMLElement).hidden = true; },

  toast(text: string, ms = 2600) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  },
};
