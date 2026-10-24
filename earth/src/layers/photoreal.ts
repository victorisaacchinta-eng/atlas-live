import {
  Cesium3DTileFeature,
  Cesium3DTileStyle,
  ClassificationType,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  GroundPrimitive,
  PolygonGeometry,
  PolygonHierarchy,
  Cartesian3,
  createGooglePhotorealistic3DTileset,
  createOsmBuildingsAsync,
  type Cartesian2,
  type Cesium3DTileset,
} from 'cesium';
import { toDecimal, type LatLon } from '../core/geo';
import type { Provenance } from '../core/provenance';
import { addressOf, buildingHeight, humanKind, structureAt, type Structure } from '../data/overpass';
import type { Fact, InspectTarget, LayerContext, LayerDef } from './types';

/** Below this camera height the textured mesh replaces the globe; above the exit height the globe returns. */
export const ENTER_3D_M = 40_000;
export const LEAVE_3D_M = 55_000;
/** How long the globe stays under the mesh while the first tiles stream in, at most. */
const HANDOVER_MS = 3000;

const HIGHLIGHT = Color.fromCssColorString('#ffb24d').withAlpha(0.5);
/** OpenStreetMap boxes are kept all but invisible inside the mesh, so they can be picked. */
const GHOST = Color.WHITE.withAlpha(0.004);
const GHOST_STYLE = "color('white', 0.004)";

/** Whether the mesh should be on for a camera height, with hysteresis so it does not flicker at the boundary. */
export function wants3d(altitude: number, shownNow: boolean): boolean {
  return shownNow ? altitude < LEAVE_3D_M : altitude < ENTER_3D_M;
}

export interface PhotorealLayer extends LayerDef {
  /** True when the textured mesh is what the viewer sees right now. */
  active(): boolean;
  onActive(fn: (on: boolean) => void): void;
  owns(picked: unknown): boolean;
  /** Looks up the mapped structure under a point on the mesh, outlines it, and describes it. */
  inspectAt(ctx: LayerContext, p: LatLon, screen?: Cartesian2): Promise<InspectTarget>;
  clearHighlight(ctx: LayerContext): void;
}

/**
 * Google Photorealistic 3D Tiles: textured meshes of real cities and landmarks
 * that you can circle and tilt around. The mesh streams by level of detail,
 * so only what is on screen is fetched. It covers the whole planet, but is
 * detailed 3D only in the cities Google has captured (about 2,500 in 49
 * countries when Cesium announced it); elsewhere it is satellite imagery on
 * terrain. The globe with all its data layers stays in charge from orbit, and
 * the mesh takes over as the camera comes down to city scale.
 */
export function photorealLayer(): PhotorealLayer {
  let tileset: Cesium3DTileset | null = null;
  let unhook: (() => void) | null = null;
  let shown = false;
  let shownAt = 0;
  let loadedSinceShown = false;
  let highlight: GroundPrimitive | null = null;
  // Cesium OSM Buildings, one feature per building with its OpenStreetMap tags, loaded
  // alongside the mesh when there is an ion token. It answers instantly, where Overpass
  // can be slow or blocked.
  let osm: Cesium3DTileset | null = null;
  let litFeature: Cesium3DTileFeature | null = null;
  const activeListeners = new Set<(on: boolean) => void>();
  const setShown = (on: boolean) => {
    shown = on;
    for (const fn of activeListeners) fn(on);
  };

  const via = (ctx: LayerContext) => (ctx.googleKey ? 'Map Tiles API' : 'Cesium ion');

  const def: PhotorealLayer = {
    id: 'photoreal-3d',
    title: 'Photorealistic 3D cities',
    group: 'detail',
    available: (ctx) => !!(ctx.googleKey || ctx.ionToken),
    purpose: `Google's textured 3D mesh of cities and landmarks. Takes over from the globe below ${ENTER_3D_M / 1000} km. Detailed where Google has captured a city, satellite imagery on terrain elsewhere.`,
    provenance: {
      kind: 'static',
      source: 'Google Photorealistic 3D Tiles',
      url: 'https://developers.google.com/maps/documentation/tile/3d-tiles',
      licence: 'Google Maps Platform terms: for display only, never cached or extracted',
      note: 'Capture dates vary by city and are not given per tile. Buildings are part of one mesh, so selection uses OpenStreetMap outlines.',
    },
    async enable(ctx) {
      const options = { maximumScreenSpaceError: 16, showCreditsOnScreen: true };
      tileset = ctx.googleKey
        ? await createGooglePhotorealistic3DTileset({ key: ctx.googleKey, onlyUsingWithGoogleGeocoder: true }, options)
        : await createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }, options);
      def.provenance = { ...def.provenance, source: `Google Photorealistic 3D Tiles via ${via(ctx)}` };
      const t = tileset;
      t.show = false;
      shown = false;
      t.allTilesLoaded.addEventListener(() => {
        if (shown) loadedSinceShown = true;
      });
      ctx.widget.scene.primitives.add(t);
      const scene = ctx.widget.scene;
      if (ctx.ionToken) {
        try {
          osm = await createOsmBuildingsAsync({ style: new Cesium3DTileStyle({ color: GHOST_STYLE }) });
          osm.show = false;
          scene.primitives.add(osm);
        } catch {
          osm = null;
        }
      }
      unhook = scene.preRender.addEventListener(() => {
        const want = !ctx.suspend3d && wants3d(scene.camera.positionCartographic.height, shown);
        if (want !== shown) {
          t.show = want;
          if (osm) osm.show = want;
          shownAt = performance.now();
          loadedSinceShown = false;
          if (!want) scene.globe.show = true;
          setShown(want);
        }
        // Hand over only once the mesh has something to show, so the view never drops into a black hole.
        if (shown && scene.globe.show && (loadedSinceShown || performance.now() - shownAt > HANDOVER_MS)) scene.globe.show = false;
      });
    },
    disable(ctx) {
      unhook?.();
      unhook = null;
      if (tileset) ctx.widget.scene.primitives.remove(tileset);
      tileset = null;
      if (osm) ctx.widget.scene.primitives.remove(osm);
      osm = null;
      litFeature = null;
      ctx.widget.scene.globe.show = true;
      def.clearHighlight(ctx);
      if (shown) setShown(false);
    },
    summary: () => (shown ? 'Google 3D mesh in view' : `Takes over below ${ENTER_3D_M / 1000} km`),
    active: () => shown,
    onActive: (fn) => void activeListeners.add(fn),
    owns: (picked) => {
      const prim = (picked as { primitive?: unknown } | undefined)?.primitive;
      return !!prim && (prim === tileset || prim === osm);
    },
    clearHighlight(ctx) {
      if (highlight) ctx.widget.scene.groundPrimitives.remove(highlight);
      highlight = null;
      if (litFeature) {
        try {
          litFeature.color = GHOST;
        } catch {
          /* tile already unloaded */
        }
      }
      litFeature = null;
    },
    async inspectAt(ctx, p, screen) {
      const google: Provenance = { ...def.provenance, fetchedAt: new Date().toISOString() };
      def.clearHighlight(ctx);
      if (osm && screen) {
        const feature = ctx.widget.scene
          .drillPick(screen, 8)
          .find((x): x is Cesium3DTileFeature => x instanceof Cesium3DTileFeature && x.primitive === osm);
        if (feature) {
          feature.color = HIGHLIGHT;
          litFeature = feature;
          return osmFeatureTarget(feature, p, google);
        }
        // Cesium OSM Buildings holds every mapped building, so a miss means none is mapped here.
        return {
          kind: 'place',
          title: 'Point on the 3D mesh',
          subtitle: 'No OpenStreetMap building is mapped here',
          position: p,
          facts: [],
          provenance: [google],
          enrich: true,
        };
      }
      let found: Awaited<ReturnType<typeof structureAt>> | null = null;
      try {
        found = await structureAt(p);
      } catch {
        found = null;
      }
      const s = found?.structure;
      if (!s) {
        return {
          kind: 'place',
          title: 'Point on the 3D mesh',
          subtitle: found ? 'No building is mapped here in OpenStreetMap' : 'OpenStreetMap could not be reached to name this building',
          position: p,
          facts: [],
          provenance: [google],
          enrich: true,
        };
      }
      if (s.outline) {
        try {
          highlight = ctx.widget.scene.groundPrimitives.add(
            new GroundPrimitive({
              geometryInstances: new GeometryInstance({
                geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(s.outline.flatMap((q) => [q.lon, q.lat]))) }),
                attributes: { color: ColorGeometryInstanceAttribute.fromColor(HIGHLIGHT) },
              }),
              classificationType: ClassificationType.BOTH,
            }),
          ) as GroundPrimitive;
        } catch {
          highlight = null;
        }
      }
      return structureTarget(s, p, google, found!.osmBase, found!.fetchedAt);
    },
  };
  return def;
}

function wikiLink(tag: string | undefined): { label: string; url: string } | null {
  if (!tag) return null;
  const m = /^([a-z-]+):(.+)$/.exec(tag);
  if (!m) return null;
  return { label: 'Wikipedia', url: `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].replace(/ /g, '_'))}` };
}

export function structureTarget(s: Structure, clicked: LatLon, google: Provenance, osmBase: string | null, fetchedAt: number): InspectTarget {
  const facts: Fact[] = [{ label: 'Type', value: s.kind }];
  if (s.height != null && s.heightSource) {
    facts.push({
      label: 'Height',
      value: s.heightSource === 'tagged' ? `${s.height.toFixed(1)} m (mapped)` : s.heightSource === 'levels' ? `About ${Math.round(s.height)} m, from ${s.levels} floors` : `Not mapped (drawn at about ${Math.round(s.height)} m)`,
      estimated: s.heightSource !== 'tagged',
    });
  }
  if (s.levels != null && s.heightSource !== 'levels') facts.push({ label: 'Floors', value: String(s.levels) });
  if (s.address) facts.push({ label: 'Address', value: s.address });
  if (s.tags.start_date) facts.push({ label: 'Built', value: s.tags.start_date });
  if (s.tags.architect) facts.push({ label: 'Architect', value: s.tags.architect });
  if (s.tags.heritage_operator || s.tags['heritage:operator']) facts.push({ label: 'Heritage listing', value: s.tags.heritage_operator ?? s.tags['heritage:operator'] });
  facts.push({ label: 'Clicked at', value: toDecimal(clicked, 5) });
  const osmUrl = `https://www.openstreetmap.org/${s.type}/${s.id}`;
  const links = [{ label: 'View on OpenStreetMap', url: osmUrl }];
  const wiki = wikiLink(s.tags.wikipedia);
  if (wiki) links.unshift(wiki);
  if (s.tags.wikidata) links.push({ label: 'Wikidata', url: `https://www.wikidata.org/wiki/${s.tags.wikidata}` });
  return {
    kind: 'building',
    title: s.name ?? s.kind,
    subtitle: s.outline ? 'Outline from OpenStreetMap, drawn on Google’s 3D mesh' : 'Mapped in OpenStreetMap',
    position: clicked,
    facts,
    provenance: [
      {
        kind: 'cached',
        source: 'OpenStreetMap contributors via the Overpass API',
        url: osmUrl,
        observedAt: osmBase ?? undefined,
        fetchedAt: new Date(fetchedAt).toISOString(),
        licence: 'ODbL 1.0',
      },
      google,
    ],
    links,
    enrich: false,
  };
}

/** Describes a Cesium OSM Buildings feature from the OpenStreetMap tags it carries. */
function osmFeatureTarget(f: Cesium3DTileFeature, clicked: LatLon, google: Provenance): InspectTarget {
  const tags: Record<string, string> = {};
  for (const id of f.getPropertyIds()) {
    const v = f.getProperty(id);
    if (v != null && v !== '' && !id.startsWith('cesium#')) tags[id] = String(v);
  }
  const h = buildingHeight(tags);
  const estimated = f.getProperty('cesium#estimatedHeight');
  const type = String(f.getProperty('elementType') ?? 'way') === 'relation' ? 'relation' : 'way';
  const s: Structure = {
    id: Number(f.getProperty('elementId') ?? 0),
    type,
    name: tags.name ?? tags['name:en'] ?? null,
    kind: humanKind(tags),
    outline: null,
    height: h.source === 'default' && Number.isFinite(Number(estimated)) ? Number(estimated) : h.height,
    heightSource: h.source,
    levels: h.levels,
    address: addressOf(tags),
    tags,
  };
  const t = structureTarget(s, clicked, google, null, Date.now());
  return {
    ...t,
    subtitle: 'OpenStreetMap building, shown on Google’s 3D mesh',
    provenance: [
      {
        kind: 'cached',
        source: 'Cesium OSM Buildings via Cesium ion (© OpenStreetMap contributors)',
        url: s.id ? `https://www.openstreetmap.org/${s.type}/${s.id}` : 'https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/',
        licence: 'ODbL 1.0 + Cesium ion terms',
        fetchedAt: new Date().toISOString(),
      },
      google,
    ],
  };
}
