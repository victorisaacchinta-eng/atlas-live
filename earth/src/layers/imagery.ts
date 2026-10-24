import {
  Cesium3DTileset,
  CesiumTerrainProvider,
  type TerrainProvider,
  Color,
  Credit,
  EllipsoidTerrainProvider,
  ImageryLayer,
  IonWorldImageryStyle,
  SplitDirection,
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme,
  createOsmBuildingsAsync,
  createWorldImageryAsync,
} from 'cesium';
import { createTerrariumTerrainProvider, TERRARIUM_CREDIT } from '../engine/terrarium';
import { fetchText } from '../core/http';
import type { LayerContext, LayerDef } from './types';
import type { Provenance } from '../core/provenance';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const GIBS_CREDIT = "Imagery: NASA Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)";

export function utcDate(offsetDays = 0, from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offsetDays));
  return d.toISOString().slice(0, 10);
}

export function gibsTemplate(layer: string, time: string, matrixSet: string, ext: 'jpg' | 'png'): string {
  return `${GIBS}/${layer}/default/${time}/${matrixSet}/{z}/{y}/{x}.${ext}`;
}

function gibsProvider(layer: string, time: string, level: number, ext: 'jpg' | 'png', credit = GIBS_CREDIT) {
  return new UrlTemplateImageryProvider({
    url: gibsTemplate(layer, time, `GoogleMapsCompatible_Level${level}`, ext),
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: level,
    credit: new Credit(credit),
  });
}

export function eoxTemplate(year: number): string {
  return `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${year}_3857/default/g/{z}/{y}/{x}.jpg`;
}

export function eoxCredit(year: number): string {
  return `EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${year})`;
}

function eoxProvider(year: number) {
  return new UrlTemplateImageryProvider({
    url: eoxTemplate(year),
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: 15,
    credit: new Credit(eoxCredit(year)),
  });
}

/** Adds a layer at the bottom of the stack (base) or on top (overlay). */
function addLayer(ctx: LayerContext, layer: ImageryLayer, base: boolean): ImageryLayer {
  ctx.widget.imageryLayers.add(layer);
  if (base) ctx.widget.imageryLayers.lowerToBottom(layer);
  return layer;
}

function removeLayer(ctx: LayerContext, layer: ImageryLayer | null): void {
  if (layer && ctx.widget.imageryLayers.contains(layer)) ctx.widget.imageryLayers.remove(layer, true);
}

export const S2_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
export const S2_DEFAULT_YEAR = 2025;

/* ------------------------------------------------------------------ bases */

export function sentinelBase(): LayerDef & { setYear(ctx: LayerContext, y: number): void; year: number } {
  let layer: ImageryLayer | null = null;
  const def = {
    id: 'base-sentinel',
    title: 'Sentinel-2 cloudless',
    group: 'base' as const,
    exclusive: true,
    year: S2_DEFAULT_YEAR,
    purpose: 'A cloud-free mosaic of a whole year of Sentinel-2 passes. 10 m per pixel: streets are visible, single buildings are not.',
    provenance: {
      kind: 'static' as const,
      source: 'EOX IT Services, Copernicus Sentinel-2',
      url: 'https://cloudless.eox.at',
      licence: 'CC BY-NC-SA 4.0 (non-commercial)',
      note: 'One mosaic per year. Not a live image.',
    },
    async enable(ctx: LayerContext) {
      layer = addLayer(ctx, new ImageryLayer(eoxProvider(def.year)), true);
    },
    disable(ctx: LayerContext) {
      removeLayer(ctx, layer);
      layer = null;
    },
    setYear(ctx: LayerContext, y: number) {
      def.year = y;
      if (layer) {
        removeLayer(ctx, layer);
        layer = addLayer(ctx, new ImageryLayer(eoxProvider(y)), true);
      }
    },
    summary: () => `Mosaic year ${def.year}`,
  };
  return def;
}

export function dailyBase(): LayerDef {
  let under: ImageryLayer | null = null;
  let layer: ImageryLayer | null = null;
  let shown = '';
  const build = (ctx: LayerContext) => {
    removeLayer(ctx, layer);
    shown = ctx.imageryDate;
    layer = addLayer(ctx, new ImageryLayer(gibsProvider('VIIRS_NOAA20_CorrectedReflectance_TrueColor', shown, 9, 'jpg')), true);
    // Blue Marble sits underneath so polar night and swath gaps are not empty.
    if (under) ctx.widget.imageryLayers.lowerToBottom(under);
  };
  return {
    id: 'base-daily',
    title: 'Daily satellite',
    group: 'base',
    exclusive: true,
    purpose: 'One day of NOAA-20 VIIRS passes: real clouds, smoke and snow for the chosen date. About 375 m per pixel.',
    provenance: {
      kind: 'daily',
      source: 'NASA GIBS, NOAA-20 VIIRS Corrected Reflectance',
      url: 'https://www.earthdata.nasa.gov/gibs',
      licence: 'NASA open data',
      note: 'Assembled from passes during the UTC day. Black wedges are gaps between passes.',
    },
    async enable(ctx) {
      under = addLayer(ctx, new ImageryLayer(gibsProvider('BlueMarble_NextGeneration', 'default', 8, 'jpg')), true);
      build(ctx);
    },
    disable(ctx) {
      removeLayer(ctx, layer);
      removeLayer(ctx, under);
      layer = under = null;
    },
    async onDateChange(ctx) {
      if (layer && shown !== ctx.imageryDate) build(ctx);
    },
    summary: () => (shown ? `Showing ${shown}` : ''),
  };
}

export function blueMarbleBase(): LayerDef {
  let layer: ImageryLayer | null = null;
  return {
    id: 'base-bluemarble',
    title: 'Blue Marble',
    group: 'base',
    exclusive: true,
    purpose: "NASA's cloud-free composite of 2004, with shaded relief. Best at planet and continent scale.",
    provenance: { kind: 'static', source: 'NASA Blue Marble Next Generation via GIBS', url: 'https://www.earthdata.nasa.gov/gibs', licence: 'NASA open data', note: 'Composite of 2004 imagery.' },
    async enable(ctx) {
      layer = addLayer(ctx, new ImageryLayer(gibsProvider('BlueMarble_NextGeneration', 'default', 8, 'jpg')), true);
    },
    disable(ctx) {
      removeLayer(ctx, layer);
      layer = null;
    },
  };
}

export function streetsBase(): LayerDef {
  let layer: ImageryLayer | null = null;
  return {
    id: 'base-streets',
    title: 'Streets',
    group: 'base',
    exclusive: true,
    purpose: 'The OpenStreetMap cartographic map: roads, names, parks and water, legible down to single streets.',
    provenance: {
      kind: 'cached',
      source: 'OpenStreetMap contributors (OSMF tile servers)',
      url: 'https://www.openstreetmap.org/copyright',
      licence: 'ODbL 1.0',
      note: 'Rendered tiles refresh as mappers edit. Light use only under the OSMF tile policy.',
    },
    async enable(ctx) {
      const provider = new UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        maximumLevel: 19,
        credit: new Credit('© OpenStreetMap contributors'),
      });
      layer = addLayer(ctx, new ImageryLayer(provider, { brightness: 0.92, saturation: 0.75, contrast: 1.05 }), true);
    },
    disable(ctx) {
      removeLayer(ctx, layer);
      layer = null;
    },
  };
}

export function aerialBase(): LayerDef {
  let layer: ImageryLayer | null = null;
  return {
    id: 'base-aerial',
    title: 'Aerial, high resolution',
    group: 'base',
    exclusive: true,
    needsIon: true,
    purpose: 'Bing Maps aerial imagery through Cesium ion. Sub-metre in most cities, so single buildings resolve.',
    provenance: { kind: 'cached', source: 'Bing Maps via Cesium ion', url: 'https://cesium.com/platform/cesium-ion/', licence: 'Cesium ion terms (session-metered)', note: 'Capture dates vary by area and are not exposed per tile.' },
    async enable(ctx) {
      const provider = await createWorldImageryAsync({ style: IonWorldImageryStyle.AERIAL });
      layer = addLayer(ctx, new ImageryLayer(provider), true);
    },
    disable(ctx) {
      removeLayer(ctx, layer);
      layer = null;
    },
  };
}

/* --------------------------------------------------------------- overlays */

export function labelsOverlay(): LayerDef {
  let layer: ImageryLayer | null = null;
  return {
    id: 'labels',
    title: 'Place names',
    group: 'overlay',
    purpose: 'Country, region and city names drawn from OpenStreetMap, thinned by zoom level so they never crowd the view.',
    provenance: { kind: 'static', source: 'NASA GIBS Reference Labels (© OpenStreetMap contributors)', url: 'https://www.earthdata.nasa.gov/gibs', licence: 'ODbL 1.0' },
    async enable(ctx) {
      layer = addLayer(ctx, new ImageryLayer(gibsProvider('Reference_Labels_15m', 'default', 13, 'png', `${GIBS_CREDIT}; labels © OpenStreetMap contributors`)), false);
    },
    disable(ctx) {
      removeLayer(ctx, layer);
      layer = null;
    },
  };
}

export function bordersOverlay(): LayerDef {
  let layer: ImageryLayer | null = null;
  return {
    id: 'borders',
    title: 'Borders and coastlines',
    group: 'overlay',
    purpose: 'National and first-level boundaries, coastlines and major roads.',
    provenance: { kind: 'static', source: 'NASA GIBS Reference Features (© OpenStreetMap contributors)', url: 'https://www.earthdata.nasa.gov/gibs', licence: 'ODbL 1.0', note: 'Boundaries follow OpenStreetMap; disputed borders are drawn as mapped there.' },
    async enable(ctx) {
      layer = addLayer(ctx, new ImageryLayer(gibsProvider('Reference_Features_15m', 'default', 13, 'png', `${GIBS_CREDIT}; features © OpenStreetMap contributors`), { alpha: 0.75 }), false);
    },
    disable(ctx) {
      removeLayer(ctx, layer);
      layer = null;
    },
  };
}

/** Full city lights above 1,800 km, none below 400 km (where terrain takes over), eased between. */
export function nightLightsAlpha(altitude: number): number {
  const t = Math.min(1, Math.max(0, (altitude - 400_000) / (1_800_000 - 400_000)));
  return t * t * (3 - 2 * t);
}

export function nightLightsOverlay(): LayerDef {
  let layer: ImageryLayer | null = null;
  let unhook: (() => void) | null = null;
  return {
    id: 'night-lights',
    title: 'City lights at night',
    group: 'overlay',
    purpose: 'Where people light the night. Drawn only on the side of the planet that is in darkness right now.',
    provenance: { kind: 'static', source: 'NASA Black Marble (Suomi NPP VIIRS) via GIBS', url: 'https://www.earthdata.nasa.gov/gibs', licence: 'NASA open data', note: '2016 annual composite, not tonight.' },
    async enable(ctx) {
      const l = addLayer(ctx, new ImageryLayer(gibsProvider('VIIRS_Black_Marble', '2016-01-01', 8, 'png'), { dayAlpha: 0, nightAlpha: 1, brightness: 1.25 }), false);
      layer = l;
      // Black Marble is about 500 m a pixel. From orbit that reads as cities; at
      // city scale a lit metro becomes one white sheet over the ground, so the
      // lights fade out as the camera comes down, frame by frame during flights.
      const scene = ctx.widget.scene;
      unhook = scene.preRender.addEventListener(() => {
        l.nightAlpha = nightLightsAlpha(scene.camera.positionCartographic.height);
      });
    },
    disable(ctx) {
      unhook?.();
      unhook = null;
      removeLayer(ctx, layer);
      layer = null;
    },
  };
}

/** Reads the newest timestep GIBS has for a layer from its DescribeDomains document. */
export async function latestGibsTime(layer: string, matrixSet: string): Promise<string> {
  const end = new Date(Date.now() + 3600_000).toISOString().slice(0, 19) + 'Z';
  const start = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const xml = await fetchText(`${GIBS}/1.0.0/${layer}/default/${matrixSet}/all/${start}--${end}.xml`, { timeoutMs: 12_000 });
  const domain = /<Domain>([^<]+)<\/Domain>/.exec(xml)?.[1];
  const parts = domain?.split('/');
  if (!parts || parts.length < 2) throw new Error('NASA did not report a recent timestep.');
  return parts[1];
}

export function precipitationOverlay(): LayerDef & { time: string } {
  let layer: ImageryLayer | null = null;
  const def = {
    id: 'precipitation',
    title: 'Rain and snow rate',
    group: 'live' as const,
    time: '',
    purpose: 'Satellite-estimated precipitation, averaged over 30 minutes. Shows where it is raining or snowing heavily right now, to within a few hours.',
    provenance: <Provenance>{
      kind: 'near-real-time',
      source: 'NASA GPM IMERG Early Run via GIBS',
      url: 'https://gpm.nasa.gov/data/imerg',
      licence: 'NASA open data',
      note: 'Arrives about 4 to 6 hours after observation. About 10 km resolution.',
    },
    legend: { imageUrl: 'https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg', note: 'Rate in mm per hour' },
    async enable(ctx: LayerContext) {
      def.time = await latestGibsTime('IMERG_Precipitation_Rate_30min', 'GoogleMapsCompatible_Level6');
      def.provenance.observedAt = def.time;
      layer = addLayer(ctx, new ImageryLayer(gibsProvider('IMERG_Precipitation_Rate_30min', def.time, 6, 'png'), { alpha: 0.62 }), false);
    },
    disable(ctx: LayerContext) {
      removeLayer(ctx, layer);
      layer = null;
    },
    summary: () => (def.time ? `Latest step ${def.time.slice(11, 16)} UTC, ${def.time.slice(0, 10)}` : ''),
  };
  return def;
}

/* -------------------------------------------------------------- compare */

/** Split-screen comparison of two Sentinel-2 years or two daily dates. */
export class Comparison {
  private left: ImageryLayer | null = null;
  private right: ImageryLayer | null = null;
  private hiddenNight: ImageryLayer[] = [];
  private lighting = true;
  active: { kind: 'years' | 'days'; a: string; b: string } | null = null;

  constructor(private readonly ctx: LayerContext) {}

  start(kind: 'years' | 'days', a: string, b: string): void {
    this.stop();
    const make = (v: string) =>
      kind === 'years' ? new ImageryLayer(eoxProvider(Number(v))) : new ImageryLayer(gibsProvider('VIIRS_NOAA20_CorrectedReflectance_TrueColor', v, 9, 'jpg'));
    this.left = make(a);
    this.right = make(b);
    this.left.splitDirection = SplitDirection.LEFT;
    this.right.splitDirection = SplitDirection.RIGHT;
    this.ctx.widget.imageryLayers.add(this.left);
    this.ctx.widget.imageryLayers.add(this.right);
    // Overlays (labels, borders) stay on top of both halves.
    for (let i = this.ctx.widget.imageryLayers.length - 1; i >= 0; i--) {
      const l = this.ctx.widget.imageryLayers.get(i);
      if (l !== this.left && l !== this.right && l.splitDirection === SplitDirection.NONE && i > 0) {
        this.ctx.widget.imageryLayers.raiseToTop(l);
      }
    }
    // Both halves must be readable even on the night side, so the sun's shading
    // and the night-only city lights are paused while comparing.
    const globe = this.ctx.widget.scene.globe;
    this.lighting = globe.enableLighting;
    globe.enableLighting = false;
    for (let i = 0; i < this.ctx.widget.imageryLayers.length; i++) {
      const l = this.ctx.widget.imageryLayers.get(i);
      if (l.dayAlpha === 0 && l.nightAlpha > 0 && l.show) {
        l.show = false;
        this.hiddenNight.push(l);
      }
    }
    this.ctx.widget.scene.splitPosition = 0.5;
    // The split is drawn on the globe surface, so 3D city tiles step aside while comparing.
    this.ctx.suspend3d = true;
    this.active = { kind, a, b };
  }

  setPosition(fraction: number): void {
    this.ctx.widget.scene.splitPosition = Math.max(0.02, Math.min(0.98, fraction));
  }

  stop(): void {
    const wasActive = !!this.active;
    removeLayer(this.ctx, this.left);
    removeLayer(this.ctx, this.right);
    this.left = this.right = null;
    this.active = null;
    this.ctx.suspend3d = false;
    if (wasActive) {
      this.ctx.widget.scene.globe.enableLighting = this.lighting;
      for (const l of this.hiddenNight) if (this.ctx.widget.imageryLayers.contains(l)) l.show = true;
      this.hiddenNight = [];
    }
  }
}

/* ------------------------------------------------------------- terrain */

/** Terrain relief is swapped in below the first height and out above the second. */
export const TERRAIN_ON_M = 300_000;
export const TERRAIN_OFF_M = 400_000;

export function terrainLayer(): LayerDef & { exaggeration: number; setExaggeration(ctx: LayerContext, v: number): void } {
  let usingIon = false;
  let relief: TerrainProvider | null = null;
  let unhook: (() => void) | null = null;
  const def = {
    id: 'terrain',
    title: 'Terrain relief',
    group: 'detail' as const,
    exaggeration: 1,
    purpose: 'Real elevation under the imagery: mountains, valleys and coastal plains in true proportion, or exaggerated to read gentle relief.',
    provenance: {
      kind: 'static' as const,
      source: 'Terrain Tiles on AWS (SRTM, GMTED2010, 3DEP, ETOPO1, EU-DEM)',
      url: 'https://registry.opendata.aws/terrain-tiles/',
      licence: 'Open data, attribution required',
      note: 'About 30 m in most land areas, coarser elsewhere. Oceans drawn at sea level.',
    },
    async enable(ctx: LayerContext) {
      relief = null;
      if (ctx.ionToken) {
        try {
          relief = await CesiumTerrainProvider.fromIonAssetId(1, { requestVertexNormals: true });
          usingIon = true;
          def.provenance = { ...def.provenance, source: 'Cesium World Terrain via Cesium ion', url: 'https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/', licence: 'Cesium ion terms' };
        } catch {
          ctx.notify('Cesium World Terrain did not load, using open terrain tiles instead.', 'warn');
        }
      }
      if (!relief) {
        usingIon = false;
        relief = createTerrariumTerrainProvider(ctx.terrainSource);
      }
      // With any terrain mesh under it, Cesium 1.146 shades the whole globe as night for
      // layers that use day and night alpha, so the city lights would cover the day side.
      // Relief barely shows from that high, so the smooth ellipsoid is used while the
      // lights are visible and terrain comes in below them, with a gap between the two
      // heights so it never flickers.
      const scene = ctx.widget.scene;
      const flat = new EllipsoidTerrainProvider();
      let high = scene.camera.positionCartographic.height > TERRAIN_OFF_M;
      scene.terrainProvider = high ? flat : relief;
      const r = relief;
      unhook = scene.preRender.addEventListener(() => {
        const h = scene.camera.positionCartographic.height;
        const next = high ? h > TERRAIN_ON_M : h > TERRAIN_OFF_M;
        if (next !== high) {
          high = next;
          scene.terrainProvider = high ? flat : r;
        }
      });
    },
    disable(ctx: LayerContext) {
      unhook?.();
      unhook = null;
      relief = null;
      ctx.widget.scene.terrainProvider = new EllipsoidTerrainProvider();
    },
    setExaggeration(ctx: LayerContext, v: number) {
      def.exaggeration = v;
      ctx.widget.scene.verticalExaggeration = v;
    },
    summary: () => `${usingIon ? 'Cesium World Terrain' : 'Open terrain tiles'}, ${def.exaggeration}x height`,
  };
  return def;
}

export const TERRAIN_ATTRIBUTION = TERRARIUM_CREDIT;

/* ---------------------------------------------------------- 3D (ion) */

export function osmBuildings3dLayer(): LayerDef {
  let tileset: Cesium3DTileset | null = null;
  return {
    id: 'buildings-ion',
    title: '3D buildings, worldwide',
    group: 'detail',
    needsIon: true,
    purpose: 'Every OpenStreetMap building on Earth as streamed 3D Tiles. Heights come from tags where mapped, estimated elsewhere.',
    provenance: { kind: 'cached', source: 'Cesium OSM Buildings via Cesium ion (© OpenStreetMap contributors)', url: 'https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/', licence: 'ODbL 1.0 + Cesium ion terms' },
    async enable(ctx) {
      tileset = await createOsmBuildingsAsync({ defaultColor: Color.fromCssColorString('#cfd3cc') });
      ctx.widget.scene.primitives.add(tileset);
    },
    disable(ctx) {
      if (tileset) ctx.widget.scene.primitives.remove(tileset);
      tileset = null;
    },
  };
}


