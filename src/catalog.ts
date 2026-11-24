// The Library catalog: a shelf that shows one category at a time, and a full sheet of every model.
//
// Shelf:   [CATALOG 41]  ‹ CARS 2/13 ›  [model] [model] [model]
// Sheet:   every category as a section of tiles, each with a hologram thumbnail rendered from
//          the model itself (public/models/thumbs/<id>.webp).
import { CATEGORIES, LIBRARY, type LibraryEntry } from './library';

interface Opts { shelf: HTMLElement; onPick: (e: LibraryEntry) => void }

export function initCatalog({ shelf, onPick }: Opts) {
  const cats = CATEGORIES.filter((c) => LIBRARY.some((e) => e.cat === c.id));
  let catIndex = 0;
  let activeId = '';

  // ---------- shelf ----------
  shelf.classList.add('catalog-shelf');
  shelf.innerHTML = `
    <button type="button" class="cat-open" aria-haspopup="dialog" aria-controls="catalog">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z"/></svg>
      <span>Catalog</span><b>${LIBRARY.length}</b>
    </button>
    <div class="cat-step" role="group" aria-label="Category">
      <button type="button" class="cat-prev" aria-label="Previous category">‹</button>
      <span class="cat-name" aria-live="polite"></span>
      <button type="button" class="cat-next" aria-label="Next category">›</button>
    </div>
    <div class="cat-models" role="list"></div>`;
  const models = shelf.querySelector('.cat-models') as HTMLElement;
  const nameEl = shelf.querySelector('.cat-name') as HTMLElement;

  const paintShelf = () => {
    const c = cats[catIndex];
    nameEl.innerHTML = `${c.label}<i>${catIndex + 1}/${cats.length}</i>`;
    models.replaceChildren(...LIBRARY.filter((e) => e.cat === c.id).map((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = e.id;
      b.setAttribute('role', 'listitem');
      b.classList.toggle('is-on', e.id === activeId);
      b.innerHTML = `<span class="t"></span><span class="k"></span>`;
      b.querySelector('.t')!.textContent = e.title;
      b.querySelector('.k')!.textContent = e.kind;
      b.addEventListener('click', () => onPick(e));
      return b;
    }));
    models.scrollLeft = 0;
  };
  const step = (d: number) => { catIndex = (catIndex + d + cats.length) % cats.length; paintShelf(); };
  shelf.querySelector('.cat-prev')!.addEventListener('click', () => step(-1));
  shelf.querySelector('.cat-next')!.addEventListener('click', () => step(1));

  // ---------- sheet ----------
  const dlg = document.createElement('dialog');
  dlg.id = 'catalog';
  dlg.className = 'catalog';
  dlg.setAttribute('aria-label', 'Model catalog');
  dlg.innerHTML = `
    <header class="catalog-head">
      <span class="plate">ATLAS · LIBRARY CATALOG</span>
      <h2>${LIBRARY.length} models in ${cats.length} categories</h2>
      <p>Every model opens as a hologram you can turn, take apart and ask about.</p>
      <nav class="catalog-jump" aria-label="Jump to category"></nav>
      <button type="button" class="catalog-close" aria-label="Close catalog">Close <kbd>Esc</kbd></button>
    </header>
    <div class="catalog-body"></div>`;
  const body = dlg.querySelector('.catalog-body') as HTMLElement;
  const jump = dlg.querySelector('.catalog-jump') as HTMLElement;
  for (const c of cats) {
    const sec = document.createElement('section');
    sec.className = 'catalog-sec';
    sec.id = `cat-${c.id}`;
    const list = LIBRARY.filter((e) => e.cat === c.id);
    sec.innerHTML = `<h3>${c.label}<i>${list.length}</i></h3><div class="catalog-grid"></div>`;
    const grid = sec.querySelector('.catalog-grid')!;
    for (const e of list) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'tile';
      t.dataset.id = e.id;
      t.innerHTML = `<span class="thumb"><img alt="" loading="lazy" decoding="async"></span><span class="t"></span><span class="k"></span>`;
      const img = t.querySelector('img')!;
      img.src = `/models/thumbs/${e.id}.webp`;
      img.addEventListener('error', () => img.remove(), { once: true });
      t.querySelector('.t')!.textContent = e.title;
      t.querySelector('.k')!.textContent = e.kind;
      t.addEventListener('click', () => { dlg.close(); catIndex = cats.indexOf(c); paintShelf(); onPick(e); });
      grid.appendChild(t);
    }
    body.appendChild(sec);
    const a = document.createElement('button');
    a.type = 'button';
    a.textContent = c.short;
    a.addEventListener('click', () => sec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
    jump.appendChild(a);
  }
  dlg.querySelector('.catalog-close')!.addEventListener('click', () => dlg.close());
  // A click on the backdrop (outside the sheet) closes it.
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
  document.body.appendChild(dlg);

  const open = () => {
    dlg.querySelectorAll('.tile').forEach((t) => t.classList.toggle('is-on', (t as HTMLElement).dataset.id === activeId));
    dlg.showModal();
    const cur = dlg.querySelector<HTMLElement>(`.tile[data-id="${activeId}"]`) || dlg.querySelector<HTMLElement>('.tile');
    cur?.scrollIntoView({ block: 'center' });
    cur?.focus();
  };
  shelf.querySelector('.cat-open')!.addEventListener('click', open);

  paintShelf();
  return {
    open,
    /** Mark the loaded model and bring its category onto the shelf. */
    setActive(id: string) {
      activeId = id;
      const e = LIBRARY.find((x) => x.id === id);
      if (e) catIndex = Math.max(0, cats.findIndex((c) => c.id === e.cat));
      paintShelf();
    },
    clearActive() { activeId = ''; paintShelf(); },
  };
}
