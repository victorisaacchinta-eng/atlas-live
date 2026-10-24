import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  HeightReference,
  LabelCollection,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
  type CesiumWidget,
} from 'cesium';
import type { LatLon } from '../core/geo';
import type { Provenance } from '../core/provenance';
import { marker, SWATCH } from './markers';
import type { InspectTarget } from './types';

export interface ResultItem {
  name: string;
  detail: string | null;
  position: LatLon;
  url?: string;
}

/** Marks the answers to an assistant question on the globe, so a list in the panel has a place on the map. */
export class ResultMarks {
  private readonly marks: BillboardCollection;
  private readonly labels: LabelCollection;
  private provenance: Provenance | null = null;
  private title = '';

  constructor(widget: CesiumWidget) {
    this.marks = widget.scene.primitives.add(new BillboardCollection({ scene: widget.scene })) as BillboardCollection;
    this.labels = widget.scene.primitives.add(new LabelCollection({ scene: widget.scene })) as LabelCollection;
  }

  show(title: string, items: ResultItem[], provenance: Provenance): void {
    this.clear();
    this.title = title;
    this.provenance = provenance;
    items.slice(0, 60).forEach((it, i) => {
      const position = Cartesian3.fromDegrees(it.position.lon, it.position.lat, 0);
      this.marks.add({
        position,
        image: marker('square', 11, SWATCH.result),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 50_000,
        id: { layer: 'results', item: it },
      });
      if (i < 14) {
        this.labels.add({
          position,
          text: it.name,
          font: '560 12px "Hubot Sans Variable", system-ui, sans-serif',
          fillColor: Color.fromCssColorString('#eef0ea'),
          outlineColor: Color.fromCssColorString('#05070a'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(9, 0),
          verticalOrigin: VerticalOrigin.CENTER,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: 50_000,
          translucencyByDistance: new NearFarScalar(5e4, 1, 3e6, 0),
        });
      }
    });
  }

  clear(): void {
    this.marks.removeAll();
    this.labels.removeAll();
    this.provenance = null;
  }

  get count(): number {
    return this.marks.length;
  }

  pick(picked: unknown): InspectTarget | null {
    const id = (picked as { id?: { layer?: string; item?: ResultItem } })?.id;
    if (id?.layer !== 'results' || !id.item || !this.provenance) return null;
    const it = id.item;
    return {
      kind: 'feature',
      title: it.name,
      subtitle: this.title,
      position: it.position,
      facts: it.detail ? [{ label: 'Detail', value: it.detail }] : [],
      provenance: [this.provenance],
      links: it.url ? [{ label: 'View on OpenStreetMap', url: it.url }] : [],
      enrich: true,
    };
  }
}
