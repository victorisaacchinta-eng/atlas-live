import type { LatLon } from '../core/geo';
import type { InspectTarget, LayerContext, LayerDef, LayerState } from './types';

type Listener = (id: string, state: LayerState) => void;

/**
 * Owns layer lifecycle independently of the UI, so panels, keyboard
 * shortcuts and the assistant all toggle layers through the same path and
 * the scene is never rebuilt to change one layer.
 */
export class LayerManager {
  private readonly defs = new Map<string, LayerDef>();
  private readonly states = new Map<string, LayerState>();
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<string, Promise<void>>();
  private ticker: number | undefined;

  constructor(private readonly ctx: LayerContext) {
    this.ticker = window.setInterval(() => {
      const now = new Date();
      for (const def of this.active()) def.tick?.(this.ctx, now);
    }, 1000);
  }

  register(def: LayerDef): void {
    this.defs.set(def.id, def);
    this.states.set(def.id, { status: this.usable(def) ? 'off' : 'locked' });
  }

  /** Whether a layer has the keys it needs. */
  usable(def: LayerDef): boolean {
    if (def.available) return def.available(this.ctx);
    return !def.needsIon || !!this.ctx.ionToken;
  }

  list(): LayerDef[] {
    return [...this.defs.values()];
  }

  get(id: string): LayerDef | undefined {
    return this.defs.get(id);
  }

  state(id: string): LayerState {
    return this.states.get(id) ?? { status: 'off' };
  }

  isOn(id: string): boolean {
    const s = this.state(id).status;
    return s === 'on' || s === 'loading';
  }

  active(): LayerDef[] {
    return this.list().filter((d) => this.state(d.id).status === 'on');
  }

  activeBase(): LayerDef | undefined {
    return this.list().find((d) => d.exclusive && this.isOn(d.id));
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(id: string, state: LayerState): void {
    this.states.set(id, state);
    for (const fn of this.listeners) fn(id, state);
  }

  /** Re-evaluates locked layers after an ion token is added or removed. */
  refreshLocks(): void {
    for (const def of this.defs.values()) {
      if (!def.needsIon && !def.available) continue;
      const s = this.state(def.id).status;
      const ok = this.usable(def);
      if (!ok && s !== 'locked') {
        if (s === 'on') def.disable(this.ctx);
        this.set(def.id, { status: 'locked' });
      } else if (ok && s === 'locked') {
        this.set(def.id, { status: 'off' });
      }
    }
  }

  async enable(id: string): Promise<boolean> {
    const def = this.defs.get(id);
    if (!def) return false;
    const current = this.state(id).status;
    if (current === 'locked') {
      this.ctx.notify(`${def.title} needs a Cesium ion token. Add one under Sources and keys.`, 'warn');
      return false;
    }
    if (current === 'on') return true;
    const inflight = this.pending.get(id);
    if (inflight) {
      await inflight;
      return this.state(id).status === 'on';
    }

    if (def.exclusive) {
      for (const other of this.defs.values()) {
        if (other !== def && other.exclusive && this.isOn(other.id)) this.disable(other.id);
      }
    }

    this.set(id, { status: 'loading' });
    const job = def
      .enable(this.ctx)
      .then(() => {
        // The user may have switched it off again while it loaded.
        if (this.state(id).status === 'loading') this.set(id, { status: 'on' });
      })
      .catch((err: unknown) => {
        try {
          def.disable(this.ctx);
        } catch {
          /* layer was only partly created */
        }
        const message = err instanceof Error ? err.message : 'The layer could not load.';
        this.set(id, { status: 'error', message });
        this.ctx.notify(`${def.title}: ${message}`, 'error');
      })
      .finally(() => {
        this.pending.delete(id);
        this.ctx.requestRender();
      });
    this.pending.set(id, job);
    await job;
    return this.state(id).status === 'on';
  }

  disable(id: string): void {
    const def = this.defs.get(id);
    if (!def) return;
    const s = this.state(id).status;
    if (s === 'off' || s === 'locked') return;
    def.disable(this.ctx);
    this.set(id, { status: 'off' });
    this.ctx.requestRender();
  }

  async toggle(id: string): Promise<void> {
    if (this.isOn(id)) {
      const def = this.defs.get(id);
      // A base layer is switched by choosing another one.
      if (def?.exclusive) return;
      this.disable(id);
    } else {
      await this.enable(id);
    }
  }

  async dateChanged(): Promise<void> {
    await Promise.all(this.active().map((d) => d.onDateChange?.(this.ctx)));
    this.ctx.requestRender();
  }

  pick(picked: unknown): InspectTarget | null {
    for (const def of this.active()) {
      const t = def.pick?.(picked);
      if (t) return t;
    }
    return null;
  }

  viewChanged(view: { center: LatLon | null; altitude: number }): void {
    for (const def of this.active()) def.onViewChange?.(this.ctx, view);
  }

  setDate(date: string): void {
    this.ctx.imageryDate = date;
  }

  setIonToken(token: string | null): void {
    this.ctx.ionToken = token;
    this.refreshLocks();
  }

  destroy(): void {
    window.clearInterval(this.ticker);
  }
}
