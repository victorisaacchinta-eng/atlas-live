import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
} from 'cesium';
import { loadBuildings, type Building } from '../data/overpass';
import { boxAround, haversineKm, toDecimal, type LatLon } from '../core/geo';
import { isAbort } from '../core/http';
import { relativeTime } from '../core/provenance';
import { groundHeights } from '../engine/ground';
import type { InspectTarget, LayerContext, LayerDef } from './types';

const SHOW_BELOW_M = 4_500;
const HALF_WIDTH_KM = 0.7;
const RELOAD_AFTER_KM = 0.45;

const COLOR = {
  tagged: Color.fromCssColorString('#dfe2db'),
  levels: Color.fromCssColorString('#c3c8c1'),
  default: Color.fromCssColorString('#8d949a'),
  selected: Color.fromCssColorString('#f3a83b'),
};

export interface BuildingLayer extends LayerDef {
  buildings: Building[];
  status: string;
}

/**
 * Keyless 3D buildings: OpenStreetMap footprints for the area under the
 * camera, extruded to their tagged height. Buildings without a height tag
 * are drawn darker so estimates never pass for measurements.
 */
export function buildingLayer(): BuildingLayer {
  let primitive: Primitive | null = null;
  let loadedAt: LatLon | null = null;
  let controller: AbortController | null = null;
  let fetchedAt = 0;
  let osmBase: string | null = null;
  let selected: Building | null = null;
  // After a failed load, wait before asking Overpass again so a busy server is not hammered.
  let failedAt = 0;
  // Geometry instance attributes are looked up by the exact id object used at creation.
  const ids = new Map<Building, { layer: 'buildings'; item: Building }>();

  const def: BuildingLayer = {
    id: 'buildings',
    title: 'Buildings in view',
    group: 'detail',
    buildings: [],
    status: `Zoom below ${SHOW_BELOW_M / 1000} km to load buildings`,
    purpose: 'OpenStreetMap building footprints around the centre of the view, raised to their mapped height.',
    provenance: {
      kind: 'cached',
      source: 'OpenStreetMap contributors via the Overpass API',
      url: 'https://www.openstreetmap.org/copyright',
      licence: 'ODbL 1.0',
      note: 'Loaded for about 1.4 km around the view centre. Coverage depends on local mappers.',
    },
    legend: {
      items: [
        { label: 'Height mapped', swatch: '#dfe2db', shape: 'square' },
        { label: 'Height from floor count', swatch: '#c3c8c1', shape: 'square' },
        { label: 'No height mapped, estimated', swatch: '#8d949a', shape: 'square' },
      ],
    },
    async enable() {
      loadedAt = null;
    },
    disable(ctx) {
      controller?.abort();
      clear(ctx);
      loadedAt = null;
      def.buildings = [];
    },
    onViewChange(ctx, view) {
      if (!view.center) return;
      if (view.altitude > SHOW_BELOW_M) {
        def.status = `Zoom below ${SHOW_BELOW_M / 1000} km to load buildings`;
        return;
      }
      if (loadedAt && haversineKm(loadedAt, view.center) < RELOAD_AFTER_KM) return;
      if (Date.now() - failedAt < 30_000) return;
      void load(ctx, view.center);
    },
    pick(picked) {
      const id = (picked as { id?: { layer?: string; item?: Building } })?.id;
      if (id?.layer !== 'buildings' || !id.item) return null;
      highlight(id.item);
      return target(id.item);
    },
    summary: () => def.status,
  };

  function clear(ctx: LayerContext) {
    if (primitive) ctx.widget.scene.primitives.remove(primitive);
    primitive = null;
    selected = null;
    ids.clear();
  }

  async function load(ctx: LayerContext, center: LatLon) {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    loadedAt = center;
    def.status = 'Loading buildings from OpenStreetMap';
    try {
      const res = await loadBuildings(boxAround(center, HALF_WIDTH_KM), signal);
      if (signal.aborted) return;
      const ground = await groundHeights(ctx.widget, ctx.terrainSource, res.buildings.map((b) => b.centroid));
      if (signal.aborted) return;
      fetchedAt = res.fetchedAt;
      osmBase = res.osmBase;
      def.buildings = res.buildings;
      clear(ctx);
      const instances: GeometryInstance[] = [];
      res.buildings.forEach((b, i) => {
        const base = ground[i] ?? 0;
        const id = { layer: 'buildings' as const, item: b };
        try {
          instances.push(
            new GeometryInstance({
              geometry: new PolygonGeometry({
                polygonHierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(b.outline.flatMap((p) => [p.lon, p.lat]))),
                height: base + b.minHeight,
                extrudedHeight: base + b.height,
                vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
              }),
              id,
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(COLOR[b.heightSource]) },
            }),
          );
          ids.set(b, id);
        } catch {
          /* self-intersecting footprint: skip it */
        }
      });
      if (instances.length) {
        primitive = ctx.widget.scene.primitives.add(
          new Primitive({
            geometryInstances: instances,
            appearance: new PerInstanceColorAppearance({ closed: true, translucent: false }),
            asynchronous: true,
            releaseGeometryInstances: false,
          }),
        ) as Primitive;
      }
      const tagged = res.buildings.filter((b) => b.heightSource !== 'default').length;
      def.status = res.buildings.length
        ? `${res.buildings.length} buildings, ${tagged} with mapped heights`
        : 'No buildings are mapped in OpenStreetMap here yet';
      def.provenance.fetchedAt = new Date(res.fetchedAt).toISOString();
      if (res.osmBase) def.provenance.observedAt = res.osmBase;
      ctx.requestRender();
    } catch (err) {
      if (isAbort(err)) return;
      loadedAt = null;
      const quiet = Date.now() - failedAt < 5 * 60_000;
      failedAt = Date.now();
      def.status = err instanceof Error && /reach|answer/.test(err.message) ? 'The OpenStreetMap Overpass API could not be reached. Move the view to retry.' : err instanceof Error ? err.message : 'Buildings could not load';
      if (!quiet) ctx.notify(`Buildings: ${def.status}`, 'warn');
    }
  }

  function highlight(b: Building) {
    if (!primitive?.ready) return;
    const paint = (bb: Building, c: Color) => {
      const id = ids.get(bb);
      const attrs = id ? primitive!.getGeometryInstanceAttributes(id) : undefined;
      if (attrs) attrs.color = ColorGeometryInstanceAttribute.toValue(c);
    };
    if (selected) paint(selected, COLOR[selected.heightSource]);
    paint(b, COLOR.selected);
    selected = b;
  }

  function target(b: Building): InspectTarget {
    const heightValue =
      b.heightSource === 'tagged'
        ? `${b.height.toFixed(1)} m (mapped)`
        : b.heightSource === 'levels'
          ? `About ${Math.round(b.height)} m, from ${b.levels} floors`
          : `No height mapped. Drawn at ${b.height} m.`;
    const facts = [
      { label: 'Type', value: b.kind },
      { label: 'Height', value: heightValue, estimated: b.heightSource !== 'tagged' },
    ];
    if (b.address) facts.push({ label: 'Address', value: b.address, estimated: false });
    if (b.tags['building:material']) facts.push({ label: 'Material', value: b.tags['building:material'], estimated: false });
    if (b.tags.start_date) facts.push({ label: 'Built', value: b.tags.start_date, estimated: false });
    facts.push({ label: 'Centre', value: toDecimal(b.centroid, 5), estimated: false });
    return {
      kind: 'building',
      title: b.name ?? b.kind,
      subtitle: b.name ? b.kind : 'Unnamed in OpenStreetMap',
      position: b.centroid,
      facts,
      provenance: [
        {
          kind: 'cached',
          source: 'OpenStreetMap contributors via Overpass API',
          url: `https://www.openstreetmap.org/way/${b.id}`,
          observedAt: osmBase ?? undefined,
          fetchedAt: new Date(fetchedAt).toISOString(),
          licence: 'ODbL 1.0',
          note: osmBase ? `OpenStreetMap data as of ${relativeTime(osmBase)}` : undefined,
        },
      ],
      links: [
        { label: 'View on OpenStreetMap', url: `https://www.openstreetmap.org/way/${b.id}` },
        { label: 'Improve this building', url: `https://www.openstreetmap.org/edit?way=${b.id}` },
      ],
      enrich: false,
    };
  }

  return def;
}
