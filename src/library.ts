export interface LibraryEntry {
  id: string;
  title: string;
  kind: string;
  url: string;
  credit: string;
  licence: string;
  source: string;
}

/** Openly licensed models. Textures were stripped at build time, so no logos ship. */
export const LIBRARY: LibraryEntry[] = [
  {
    id: 'perseverance',
    title: 'Perseverance rover',
    kind: 'Mars 2020 · NASA/JPL',
    url: '/models/perseverance.glb',
    credit: 'NASA/JPL-Caltech, NASA 3D Resources',
    licence: 'Public domain',
    source: 'https://github.com/nasa/NASA-3D-Resources',
  },
  {
    id: 'ingenuity',
    title: 'Ingenuity helicopter',
    kind: 'Mars 2020 · NASA/JPL',
    url: '/models/ingenuity.glb',
    credit: 'NASA/JPL-Caltech, NASA 3D Resources',
    licence: 'Public domain',
    source: 'https://github.com/nasa/NASA-3D-Resources',
  },
  {
    id: 'jwst',
    title: 'James Webb telescope',
    kind: 'Space telescope · NASA',
    url: '/models/jwst.glb',
    credit: 'NASA, NASA 3D Resources',
    licence: 'Public domain',
    source: 'https://github.com/nasa/NASA-3D-Resources',
  },
  {
    id: 'watch',
    title: 'Chronograph watch',
    kind: 'Mechanical · Khronos sample',
    url: '/models/watch.glb',
    credit: 'Eric Chadwick, (c) 2025 Darmstadt Graphics Group GmbH',
    licence: 'CC BY 4.0',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets',
  },
  {
    id: 'car',
    title: 'Concept car',
    kind: 'Automotive · Khronos sample',
    url: '/models/car.glb',
    credit: 'Eric Chadwick, (c) 2024 Darmstadt Graphics Group GmbH',
    licence: 'CC BY 4.0',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets',
  },
];
