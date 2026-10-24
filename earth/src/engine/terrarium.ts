import { Credit, CustomHeightmapTerrainProvider, GeographicTilingScheme, Math as CesiumMath } from 'cesium';

/**
 * Keyless global terrain.
 *
 * The open Terrain Tiles dataset on AWS (Mapzen/Tilezen, SRTM, GMTED, ETOPO1,
 * EU-DEM, 3DEP and others) is published as Web Mercator PNG tiles where each
 * pixel encodes elevation as RGB. Cesium's terrain engine works on a
 * geographic grid, so each Cesium tile is resampled from whichever Mercator
 * tiles cover it. This gives real relief everywhere without a Cesium ion
 * account; with an ion token the app switches to Cesium World Terrain.
 */

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRARIUM_MAX_ZOOM = 15;
const TILE = 256;
const GRID = 65;
const MAX_LAT = 85.05112878;

/** Terrarium encoding: (R * 256 + G + B / 256) - 32768 metres. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Longitude/latitude (degrees) to global Web Mercator pixel coordinates at zoom z. */
export function mercatorPixel(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = TILE * 2 ** z;
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const phi = (clamped * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Mercator zoom used to fill a geographic terrain tile at the given level. */
export function zoomForLevel(level: number): number {
  // A level-L geographic tile spans 180/2^L degrees sampled on a 65-point grid;
  // a zoom-L Mercator tile has half that pixel spacing, so detail is preserved.
  return Math.max(0, Math.min(TERRARIUM_MAX_ZOOM, level));
}

export interface TileSource {
  (z: number, x: number, y: number): Promise<Float32Array | null>;
}

/** Decodes an RGB(A) pixel buffer into elevations. */
export function decodeBuffer(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = decodeTerrarium(rgba[p], rgba[p + 1], rgba[p + 2]);
  return out;
}

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const gate = new Semaphore(8);

async function decodePng(blob: Blob): Promise<Float32Array> {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(TILE, TILE) : Object.assign(document.createElement('canvas'), { width: TILE, height: TILE });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return decodeBuffer(ctx.getImageData(0, 0, TILE, TILE).data);
}

/** Browser tile loader with an LRU of decoded tiles. Failed tiles resolve to null (treated as sea level). */
export function createTerrariumSource(url = TERRARIUM_URL, capacity = 384): TileSource {
  const cache = new Map<string, Promise<Float32Array | null>>();
  return (z, x, y) => {
    const key = `${z}/${x}/${y}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const p = gate.run(async () => {
      try {
        const res = await fetch(url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
        if (!res.ok) return null;
        return await decodePng(await res.blob());
      } catch {
        return null;
      }
    });
    cache.set(key, p);
    if (cache.size > capacity) cache.delete(cache.keys().next().value as string);
    return p;
  };
}

/**
 * Fills a GRID x GRID heightmap (row 0 = north) for a geographic rectangle,
 * by bilinear sampling of the covering Mercator tiles.
 */
export async function sampleRectangle(
  source: TileSource,
  rect: { west: number; south: number; east: number; north: number },
  z: number,
  size = GRID,
  floor = 0,
): Promise<Float32Array> {
  const out = new Float32Array(size * size);
  const nTiles = 2 ** z;
  const nw = mercatorPixel(rect.west, rect.north, z);
  const se = mercatorPixel(rect.east, rect.south, z);
  const tx0 = Math.floor(Math.max(0, nw.x - 1) / TILE);
  const tx1 = Math.floor(Math.min(nTiles * TILE - 1, se.x + 1) / TILE);
  const ty0 = Math.floor(Math.max(0, nw.y - 1) / TILE);
  const ty1 = Math.floor(Math.min(nTiles * TILE - 1, se.y + 1) / TILE);

  const tiles = new Map<string, Float32Array | null>();
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(source(z, tx, ty).then((t) => void tiles.set(`${tx}/${ty}`, t)));
    }
  }
  await Promise.all(jobs);

  const px = (gx: number, gy: number): number => {
    const cx = Math.max(0, Math.min(nTiles * TILE - 1, gx));
    const cy = Math.max(0, Math.min(nTiles * TILE - 1, gy));
    const tile = tiles.get(`${Math.floor(cx / TILE)}/${Math.floor(cy / TILE)}`);
    if (!tile) return 0;
    return tile[(cy % TILE) * TILE + (cx % TILE)];
  };

  for (let j = 0; j < size; j++) {
    const lat = rect.north - (j / (size - 1)) * (rect.north - rect.south);
    for (let i = 0; i < size; i++) {
      const lon = rect.west + (i / (size - 1)) * (rect.east - rect.west);
      const p = mercatorPixel(lon, lat, z);
      // pixel centres sit at +0.5
      const fx = p.x - 0.5;
      const fy = p.y - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const h =
        px(x0, y0) * (1 - ax) * (1 - ay) + px(x0 + 1, y0) * ax * (1 - ay) + px(x0, y0 + 1) * (1 - ax) * ay + px(x0 + 1, y0 + 1) * ax * ay;
      out[j * size + i] = Math.max(floor, h);
    }
  }
  return out;
}

/** Single-point elevation from the same tiles (used for placing buildings). */
export async function heightAt(source: TileSource, lat: number, lon: number, z = 14): Promise<number> {
  const eps = 1e-6;
  const grid = await sampleRectangle(source, { west: lon - eps, east: lon + eps, south: lat - eps, north: lat + eps }, z, 2, -500);
  return grid[0];
}

export const TERRARIUM_CREDIT =
  'Terrain Tiles on AWS (Mapzen/Tilezen): SRTM, GMTED2010 and 3DEP courtesy of the U.S. Geological Survey; ETOPO1 from NOAA; EU-DEM produced using Copernicus data';

export function createTerrariumTerrainProvider(source: TileSource = createTerrariumSource()): CustomHeightmapTerrainProvider {
  const tilingScheme = new GeographicTilingScheme();
  return new CustomHeightmapTerrainProvider({
    width: GRID,
    height: GRID,
    tilingScheme,
    credit: new Credit(TERRARIUM_CREDIT),
    callback: (x: number, y: number, level: number) => {
      const r = tilingScheme.tileXYToRectangle(x, y, level);
      return sampleRectangle(
        source,
        {
          west: CesiumMath.toDegrees(r.west),
          east: CesiumMath.toDegrees(r.east),
          south: CesiumMath.toDegrees(r.south),
          north: CesiumMath.toDegrees(r.north),
        },
        zoomForLevel(level),
      );
    },
  });
}
