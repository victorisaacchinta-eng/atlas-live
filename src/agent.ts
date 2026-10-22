import { ui } from './ui';

export interface AgentContext {
  machine: () => string;
  parts: () => string[];
  focused: () => number;
  focusPart: (i: number) => void;
  setExplode: (v: number) => void;
  mode?: () => 'object' | 'earth';
  flyTo?: (place: string, lat?: number, lon?: number) => void;
  layers?: () => string[];
  globeView?: () => void;
  showLayer?: (layer: string, on: boolean) => void;
  buildModel?: (name: string) => void;
  setLens?: (lens: string) => void;
  orbit?: (speed: number) => void;
  isolate?: (on: boolean) => void;
}

interface AskReply {
  answer: string;
  actions: { name: string; args: Record<string, unknown> }[];
  sources: { title: string; url: string }[];
  trace: string[];
  model?: string;
  error?: string;
}

const history: { role: 'user' | 'assistant'; content: string }[] = [];

export async function ask(question: string, ctx: AgentContext) {
  ui.log(question, 'you');
  const thinking = ui.log('ATLAS is thinking', 'sys');
  setAgent('busy');
  try {
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, mode: ctx.mode?.() ?? 'object', machine: ctx.machine(), parts: ctx.parts(), focused: ctx.focused() + 1, layers: ctx.layers?.() ?? [], history }),
    });
    const j = (await r.json()) as AskReply;
    thinking.remove();
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    for (const t of j.trace) ui.log(t.replace(/^(nemotron|agent) › /, ''), t.startsWith('agent') ? 'tool' : 'sys');
    for (const a of j.actions) {
      if (a.name === 'focus_part') ctx.focusPart(Number(a.args.index) - 1);
      if (a.name === 'set_explode') ctx.setExplode(Number(a.args.amount));
      if (a.name === 'fly_to' && a.args.place) ctx.flyTo?.(String(a.args.place), a.args.lat as number | undefined, a.args.lon as number | undefined);
      if (a.name === 'globe_view') ctx.globeView?.();
      if (a.name === 'show_layer') ctx.showLayer?.(String(a.args.layer), a.args.on !== false);
      if (a.name === 'build_model' && a.args.name) ctx.buildModel?.(String(a.args.name));
      if (a.name === 'set_lens' && a.args.lens) ctx.setLens?.(String(a.args.lens));
      if (a.name === 'orbit') ctx.orbit?.(Number(a.args.speed) || 0);
      if (a.name === 'isolate') ctx.isolate?.(a.args.on !== false);
    }
    ui.log(j.answer, 'answer');
    // Which model answered (the provider can fail over), so the viewer always knows who is talking.
    if (j.model) ui.log(`answered by ${j.model.split(' + ').map((m) => m.split('·').pop()!.trim().split('/').pop()).join(' + ')}`, 'model');
    if (ctx.focused() >= 0) { ui.setCardBody(j.answer); ui.setSources(j.sources); }
    history.push({ role: 'user', content: question }, { role: 'assistant', content: j.answer });
    speak(j.answer);
    setAgent('ok');
  } catch (err) {
    thinking.remove();
    const msg = err instanceof Error ? err.message : String(err);
    ui.log(msg.includes('No model key') ? 'agent offline: no model key on the server yet' : `agent error: ${msg.slice(0, 120)}`, 'hot');
    setAgent('off');
  }
}

function setAgent(state: 'busy' | 'ok' | 'off') {
  const chip = document.getElementById('agent-chip')!;
  chip.classList.toggle('on', state === 'busy');
  chip.classList.toggle('ok', state === 'ok');
}

// ---------- voice: browser speech in and out ----------
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export function listen(onText: (t: string) => void, onEnd: () => void): (() => void) | null {
  const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!Ctor) { ui.toast('Voice input needs Chrome or Edge. Type your question instead.'); return null; }
  const rec = new Ctor();
  rec.lang = 'en-IN';
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    const res = e.results[e.results.length - 1];
    onText(res[0].transcript);
  };
  rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') ui.toast(`Microphone: ${e.error}`); };
  rec.onend = onEnd;
  rec.start();
  return () => rec.stop();
}

let voice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => /en-GB/.test(v.lang) && /Daniel|Arthur|Google UK English Male/i.test(v.name))
    || vs.find((v) => /en-GB/.test(v.lang))
    || vs.find((v) => /^en/.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

export function speak(text: string) {
  if (!('speechSynthesis' in window) || muted) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = 1.02;
  u.pitch = 0.95;
  speechSynthesis.speak(u);
}
let muted = false;
export function setMuted(m: boolean) { muted = m; if (m && 'speechSynthesis' in window) speechSynthesis.cancel(); }

/** Ask the server which model is live and show it honestly in the header. */
export async function refreshStatus() {
  const label = document.getElementById('agent-label')!;
  const chip = document.getElementById('agent-chip')!;
  try {
    const r = await fetch('/api/status');
    const j = await r.json();
    if (!j.provider) { label.textContent = 'Model offline'; chip.title = 'No model key on the server yet'; return; }
    const short = String(j.agent).split('/').pop() || j.agent;
    label.textContent = short.length > 22 ? `${short.slice(0, 21)}…` : short;
    chip.title = `${j.label}: ${j.agent} (vision ${j.vision})${j.search ? ', Tavily search on' : ''}`;
    chip.classList.add('ok');
  } catch {
    label.textContent = 'Model offline';
  }
}
