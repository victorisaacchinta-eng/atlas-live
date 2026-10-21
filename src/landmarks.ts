/**
 * Preset places. Coordinates come from OpenStreetMap's Nominatim (looked up 21 Oct 2026,
 * tools/geocode-presets.py), not from memory. `view` is the orbit radius in metres that frames
 * the landmark with some of its surroundings; `lift` raises the orbit target above the ground
 * so tall subjects sit in the middle of the frame.
 */
export interface Landmark {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  view: number;
  lift: number;
  /** Half-width in metres of the block cut out by Isolate (default: 0.45 × view). */
  iso?: number;
}

export const LANDMARKS: Landmark[] = [
  { id: 'charminar', name: 'Charminar', city: 'Hyderabad, India', lat: 17.361602, lon: 78.474642, view: 210, lift: 20 },
  { id: 'taj', name: 'Taj Mahal', city: 'Agra, India', lat: 27.175007, lon: 78.042101, view: 480, lift: 30 },
  { id: 'india-gate', name: 'India Gate', city: 'New Delhi, India', lat: 28.612933, lon: 77.229493, view: 320, lift: 18 },
  { id: 'gateway', name: 'Gateway of India', city: 'Mumbai, India', lat: 18.921966, lon: 72.834566, view: 260, lift: 12 },
  { id: 'golden-gate', name: 'Golden Gate Bridge', city: 'San Francisco, USA', lat: 37.818292, lon: -122.478384, view: 1900, lift: 80 },
  { id: 'liberty', name: 'Statue of Liberty', city: 'New York, USA', lat: 40.689253, lon: -74.044548, view: 330, lift: 45 },
  { id: 'empire', name: 'Empire State Building', city: 'New York, USA', lat: 40.748442, lon: -73.985659, view: 820, lift: 190 },
  { id: 'big-ben', name: 'Big Ben', city: 'London, UK', lat: 51.500694, lon: -0.124575, view: 420, lift: 45 },
  { id: 'eiffel', name: 'Eiffel Tower', city: 'Paris, France', lat: 48.85826, lon: 2.294501, view: 720, lift: 140 },
  { id: 'colosseum', name: 'Colosseum', city: 'Rome, Italy', lat: 41.890942, lon: 12.491903, view: 430, lift: 20 },
  { id: 'sagrada', name: 'Sagrada Família', city: 'Barcelona, Spain', lat: 41.403505, lon: 2.174428, view: 380, lift: 60 },
  { id: 'acropolis', name: 'Acropolis', city: 'Athens, Greece', lat: 37.971503, lon: 23.726618, view: 520, lift: 20 },
  { id: 'hagia', name: 'Hagia Sophia', city: 'Istanbul, Türkiye', lat: 41.008505, lon: 28.980011, view: 430, lift: 30 },
  { id: 'burj', name: 'Burj Khalifa', city: 'Dubai, UAE', lat: 25.197034, lon: 55.274133, view: 1500, lift: 380 },
  { id: 'pyramids', name: 'Great Pyramid of Giza', city: 'Giza, Egypt', lat: 29.979165, lon: 31.134213, view: 760, lift: 50 },
  { id: 'opera', name: 'Sydney Opera House', city: 'Sydney, Australia', lat: -33.857198, lon: 151.215123, view: 480, lift: 25 },
  { id: 'tokyo-tower', name: 'Tokyo Tower', city: 'Tokyo, Japan', lat: 35.658449, lon: 139.745536, view: 620, lift: 110 },
  { id: 'marina-bay', name: 'Marina Bay Sands', city: 'Singapore', lat: 1.283697, lon: 103.860723, view: 760, lift: 80 },
  { id: 'petronas', name: 'Petronas Towers', city: 'Kuala Lumpur, Malaysia', lat: 3.157968, lon: 101.711205, view: 900, lift: 180 },
  { id: 'christ', name: 'Christ the Redeemer', city: 'Rio de Janeiro, Brazil', lat: -22.951917, lon: -43.210459, view: 340, lift: 15 },
];
