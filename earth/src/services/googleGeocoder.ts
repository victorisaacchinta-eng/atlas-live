import {
  Cartesian3,
  Cartographic,
  GoogleGeocoderService,
  IonGeocodeProviderType,
  IonGeocoderService,
  Math as CesiumMath,
  Rectangle,
  type GeocoderService,
  type Scene,
} from 'cesium';
import type { ForwardGeocoder, Place } from './geocode';

/** Turns a Cesium geocoder result into a Place. */
export function resultToPlace(r: GeocoderService.Result, i: number): Place | null {
  const [name, ...rest] = r.displayName.split(',').map((s) => s.trim());
  if (!name) return null;
  let position: { lat: number; lon: number };
  let bbox: Place['bbox'] = null;
  if (r.destination instanceof Rectangle) {
    const c = Rectangle.center(r.destination);
    position = { lat: CesiumMath.toDegrees(c.latitude), lon: CesiumMath.toDegrees(c.longitude) };
    const d = r.destination;
    bbox = { west: CesiumMath.toDegrees(d.west), south: CesiumMath.toDegrees(d.south), east: CesiumMath.toDegrees(d.east), north: CesiumMath.toDegrees(d.north) };
  } else if (r.destination instanceof Cartesian3) {
    const c = Cartographic.fromCartesian(r.destination);
    position = { lat: CesiumMath.toDegrees(c.latitude), lon: CesiumMath.toDegrees(c.longitude) };
  } else return null;
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)) return null;
  return { id: `G${i}:${r.displayName}`, name, context: rest.join(', '), kind: 'Place', position, bbox, osm: null };
}

/**
 * Google place search, used while Google's 3D tiles are on: straight to the
 * Geocoding API with the host's key, or through Cesium ion's Google provider.
 */
export function googleForwardGeocoder(scene: Scene, key: string | null): ForwardGeocoder {
  const service = key ? new GoogleGeocoderService({ key }) : new IonGeocoderService({ scene, geocodeProviderType: IonGeocodeProviderType.GOOGLE });
  return {
    label: 'Google',
    async search(query, limit) {
      const results = await service.geocode(query);
      return results
        .slice(0, limit)
        .map(resultToPlace)
        .filter((p): p is Place => !!p);
    },
  };
}
