import type { CesiumWidget } from 'cesium';
import type { LatLon } from '../core/geo';
import type { Provenance } from '../core/provenance';
import type { TileSource } from '../engine/terrarium';

export type LayerGroup = 'base' | 'overlay' | 'live' | 'detail';
export type LayerStatus = 'off' | 'loading' | 'on' | 'error' | 'locked';

export interface Fact {
  label: string;
  value: string;
  /** Marks a value that is an estimate rather than a measurement. */
  estimated?: boolean;
}

/** Anything the inspector can show: a place, a quake, a building, a satellite. */
export interface InspectTarget {
  kind: 'place' | 'quake' | 'event' | 'satellite' | 'building' | 'feature';
  title: string;
  subtitle?: string;
  position: LatLon;
  facts: Fact[];
  provenance: Provenance[];
  links?: Array<{ label: string; url: string }>;
  /** When true the inspector also loads weather, air quality and elevation for the point. */
  enrich?: boolean;
}

export interface LayerContext {
  widget: CesiumWidget;
  terrainSource: TileSource;
  ionToken: string | null;
  /** A Google Maps Platform key with the Map Tiles API enabled, when the host provides one. */
  googleKey: string | null;
  /** Set while something needs the globe surface itself (the imagery comparison), so 3D tiles step aside. */
  suspend3d: boolean;
  /** Current imagery date for daily products (YYYY-MM-DD, UTC). */
  imageryDate: string;
  notify(message: string, tone?: 'info' | 'warn' | 'error'): void;
  requestRender(): void;
}

export interface Legend {
  items?: Array<{ label: string; swatch: string; shape?: 'dot' | 'diamond' | 'square' | 'line' }>;
  imageUrl?: string;
  note?: string;
}

export interface LayerDef {
  id: string;
  title: string;
  group: LayerGroup;
  /** One line: what the layer shows and why it is useful. */
  purpose: string;
  provenance: Provenance;
  legend?: Legend;
  /** Requires a Cesium ion access token. */
  needsIon?: boolean;
  /** Overrides needsIon: whether the layer can run with the keys this page has. */
  available?(ctx: LayerContext): boolean;
  /** Base layers are mutually exclusive. */
  exclusive?: boolean;
  enable(ctx: LayerContext): Promise<void>;
  disable(ctx: LayerContext): void;
  /** Called when the imagery date changes while the layer is on. */
  onDateChange?(ctx: LayerContext): Promise<void>;
  /** Map a picked Cesium object to an inspector target, if it belongs to this layer. */
  pick?(picked: unknown): InspectTarget | null;
  /** Called every second while on (live feeds and satellites). */
  tick?(ctx: LayerContext, now: Date): void;
  /** Called when the camera settles, with the current view centre and altitude. */
  onViewChange?(ctx: LayerContext, view: { center: LatLon | null; altitude: number }): void;
  /** Short live status, e.g. "412 quakes, updated 3 min ago". */
  summary?(): string;
}

export interface LayerState {
  status: LayerStatus;
  message?: string;
}
