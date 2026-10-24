import { KIND_LABEL, relativeTime } from '../core/provenance';
import type { LatLon } from '../core/geo';
import type { Step } from '../ai/executor';
import { $, clear, closeButton, h } from './dom';

const KIND_TEXT: Record<Step['kind'], string> = {
  action: 'Done',
  finding: 'From the data',
  note: 'Background, from the language model',
  limit: 'Limit',
  error: 'Problem',
};

/** The answer panel: each step says what was done or found, and where it came from. */
export function mountAnswer(onItem: (p: LatLon) => void, onToggle: (open: boolean) => void = () => undefined) {
  const root = $('#answer');
  let list: HTMLOListElement | null = null;
  let thinking: HTMLElement | null = null;

  const close = () => {
    if (root.hidden) return;
    root.hidden = true;
    clear(root);
    document.body.classList.remove('has-answer');
    onToggle(false);
  };

  function start(question: string) {
    clear(root);
    const wasHidden = root.hidden;
    root.hidden = false;
    document.body.classList.add('has-answer');
    if (wasHidden) onToggle(true);
    list = h('ol', { class: 'steps' });
    thinking = h('p', { class: 'thinking' }, 'Working out what to look up');
    root.append(
      h('div', { class: 'panel-head answer-head' }, h('div', null, h('p', { class: 'panel-title' }, 'Answer'), h('h2', { class: 'answer-q' }, question)), closeButton(close, 'Close answer')),
      h('div', { class: 'panel-scroll' }, h('div', { class: 'answer-planner', id: 'answer-planner' }), thinking, list),
    );
  }

  function planner(text: string) {
    const el = root.querySelector('#answer-planner');
    if (el) el.textContent = text;
  }

  function step(s: Step, fromModel = false) {
    if (!list) return;
    if (thinking) {
      thinking.textContent = 'Checking the sources';
    }
    const prov = s.provenance
      ? h(
          'div',
          { class: 'prov' },
          `${KIND_LABEL[s.provenance.kind]}, `,
          s.provenance.url ? h('a', { href: s.provenance.url, target: '_blank', rel: 'noopener' }, s.provenance.source) : s.provenance.source,
          s.provenance.observedAt ? `, observed ${relativeTime(s.provenance.observedAt)}` : s.provenance.fetchedAt ? `, fetched ${relativeTime(s.provenance.fetchedAt)}` : '',
        )
      : null;
    const items = s.items?.length
      ? h(
          'ul',
          { class: 'step-items' },
          ...s.items.map((it) =>
            h(
              'li',
              null,
              h(
                'button',
                { type: 'button', disabled: !it.position, onclick: () => it.position && onItem(it.position) },
                h('span', { class: 'i-name' }, it.name),
                it.detail ? h('span', { class: 'i-detail' }, it.detail) : null,
              ),
            ),
          ),
        )
      : null;
    list.append(h('li', { class: 'step', 'data-kind': s.kind }, h('span', { class: 'step-label' }, s.kind === 'note' && !fromModel ? 'Tip' : KIND_TEXT[s.kind]), h('p', null, s.text), prov, items));
  }

  function done(count: number) {
    if (thinking) {
      thinking.remove();
      thinking = null;
    }
    if (!count && list) list.append(h('li', { class: 'step', 'data-kind': 'limit' }, h('p', null, 'Nothing to do for that request.')));
  }

  return { start, step, done, close, planner, isOpen: () => !root.hidden };
}
