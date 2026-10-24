import type { LatLon } from '../core/geo';

/**
 * Landmarks to open straight into 3D. Positions are the structure itself, so
 * the camera can circle it. Heights are approximate overall heights used only
 * to frame the shot; the inspector gets its facts from OpenStreetMap.
 */
export interface Landmark {
  id: string;
  name: string;
  city: string;
  position: LatLon;
  /** Approximate overall height in metres, for framing. */
  height: number;
  /** Camera distance from the middle of the structure, in metres. */
  range: number;
}

export const LANDMARKS: Landmark[] = [
  { id: 'charminar', name: 'Charminar', city: 'Hyderabad, India', position: { lat: 17.3616, lon: 78.4747 }, height: 56, range: 260 },
  { id: 'taj-mahal', name: 'Taj Mahal', city: 'Agra, India', position: { lat: 27.1751, lon: 78.0421 }, height: 73, range: 480 },
  { id: 'eiffel-tower', name: 'Eiffel Tower', city: 'Paris, France', position: { lat: 48.8584, lon: 2.2945 }, height: 330, range: 780 },
  { id: 'burj-khalifa', name: 'Burj Khalifa', city: 'Dubai, United Arab Emirates', position: { lat: 25.1972, lon: 55.2744 }, height: 828, range: 1500 },
  { id: 'statue-of-liberty', name: 'Statue of Liberty', city: 'New York, United States', position: { lat: 40.6892, lon: -74.0445 }, height: 93, range: 360 },
  { id: 'sydney-opera-house', name: 'Sydney Opera House', city: 'Sydney, Australia', position: { lat: -33.8568, lon: 151.2153 }, height: 65, range: 520 },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Matches "the taj mahal", "Eiffel tower, Paris" and similar to a landmark. */
export function findLandmark(text: string): Landmark | null {
  const t = ` ${norm(text)} `;
  return LANDMARKS.find((l) => t.includes(` ${norm(l.name)} `)) ?? null;
}
