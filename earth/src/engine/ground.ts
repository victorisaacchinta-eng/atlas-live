import { Cartographic, CustomHeightmapTerrainProvider, EllipsoidTerrainProvider, sampleTerrainMostDetailed, type CesiumWidget } from 'cesium';
import type { LatLon } from '../core/geo';
import { heightAt, type TileSource } from './terrarium';

/**
 * Ground height at points, measured on whichever terrain is active, so
 * objects placed on the surface agree with the surface that is drawn.
 */
export async function groundHeights(widget: CesiumWidget, source: TileSource, points: LatLon[]): Promise<number[]> {
  const provider = widget.scene.terrainProvider;
  if (provider instanceof EllipsoidTerrainProvider) return points.map(() => 0);
  if (provider instanceof CustomHeightmapTerrainProvider) {
    return Promise.all(points.map((p) => heightAt(source, p.lat, p.lon, 15)));
  }
  try {
    const carto = points.map((p) => Cartographic.fromDegrees(p.lon, p.lat));
    const sampled = await sampleTerrainMostDetailed(provider, carto);
    return sampled.map((c) => c.height ?? 0);
  } catch {
    return points.map(() => 0);
  }
}
