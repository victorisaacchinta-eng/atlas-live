export interface LibraryEntry {
  id: string;
  title: string;
  /** One line under the title: era or maker, and source. */
  kind: string;
  /** Catalog category id (see CATEGORIES). */
  cat: string;
  url: string;
  credit: string;
  licence: string;
  source: string;
  /**
   * Display names for the model's part nodes. Parts given the same name join into one piece,
   * so a boom split into segments, or four solar panels, explode as one labelled part.
   * Names were checked against highlighted renders of each part, not guessed from node ids.
   */
  parts?: Record<string, string>;
}

export interface Category { id: string; label: string; short: string }

/** Order here is the order of the catalog and the shelf. */
export const CATEGORIES: Category[] = [
  { id: 'mars', label: 'Mars & planets', short: 'Mars' },
  { id: 'human', label: 'Human spaceflight', short: 'Crewed' },
  { id: 'observe', label: 'Observatories & probes', short: 'Probes' },
  { id: 'robots', label: 'Robots', short: 'Robots' },
  { id: 'aircraft', label: 'Aircraft', short: 'Aircraft' },
  { id: 'drones', label: 'Drones', short: 'Drones' },
  { id: 'cars', label: 'Cars', short: 'Cars' },
  { id: 'bikes', label: 'Motorbikes', short: 'Bikes' },
  { id: 'engines', label: 'Engines & mechanisms', short: 'Engines' },
  { id: 'phones', label: 'Phones', short: 'Phones' },
  { id: 'cameras', label: 'Cameras & film', short: 'Cameras' },
  { id: 'retro', label: 'Computers & consoles', short: 'Retro' },
  { id: 'audio', label: 'Audio & radio', short: 'Audio' },
  { id: 'instruments', label: 'Scientific instruments', short: 'Science' },
  { id: 'workshop', label: 'Workshop machines', short: 'Workshop' },
];

const NASA = 'https://github.com/nasa/NASA-3D-Resources';
const KHRONOS = 'https://github.com/KhronosGroup/glTF-Sample-Assets';
const PH = (id: string) => `https://polyhaven.com/a/${id}`;

/** Openly licensed models. Textures were stripped at build time, so no logos ship. */
export const LIBRARY: LibraryEntry[] = [
  // ---------------- Mars & planets ----------------
  {
    id: 'perseverance', cat: 'mars', title: 'Perseverance rover', kind: 'Mars 2020 · NASA/JPL', url: '/models/perseverance.glb',
    credit: 'NASA/JPL-Caltech, NASA 3D Resources', licence: 'Public domain', source: NASA,
  },
  {
    id: 'ingenuity', cat: 'mars', title: 'Ingenuity helicopter', kind: 'Mars 2020 · NASA/JPL', url: '/models/ingenuity.glb',
    credit: 'NASA/JPL-Caltech, NASA 3D Resources', licence: 'Public domain', source: NASA,
  },
  {
    id: 'viking', cat: 'mars', title: 'Viking lander', kind: 'Mars 1976 · NASA', url: '/models/viking.glb',
    credit: 'NASA, NASA 3D Resources', licence: 'Public domain', source: NASA,
    parts: {
      p01: 'Meteorology boom', p03: 'Meteorology boom', p02: 'S-band high-gain antenna', p04: 'Facsimile cameras', p09: 'Facsimile cameras',
      p05: 'Deck instruments', p06: 'Deck instruments', p07: 'Lander body', p08: 'Lander body', p11: 'Lander body',
      p10: 'Surface sampler arm', p12: 'Surface sampler arm', p13: 'Landing legs', p14: 'Landing legs',
    },
  },
  // ---------------- Human spaceflight ----------------
  {
    id: 'apollo-lm', cat: 'human', title: 'Apollo Lunar Module', kind: 'Apollo · NASA', url: '/models/apollo-lm.glb',
    credit: 'NASA, NASA 3D Resources', licence: 'Public domain', source: NASA,
    parts: {
      p01: 'Rendezvous radar antenna', p02: 'Docking hatch and VHF antennas', p03: 'Docking hatch and VHF antennas', p04: 'Aft equipment bay',
      p05: 'Ascent stage cabin', p06: 'Ascent propellant tank', p07: 'RCS thruster quads', p08: 'RCS thruster quads', p09: 'RCS thruster quads',
      p10: 'Forward hatch and porch', p11: 'Descent stage', p12: 'Ladder', p13: 'Landing gear', p14: 'Footpads',
    },
  },
  {
    id: 'shuttle', cat: 'human', title: 'Space Shuttle', kind: 'Launch stack · NASA', url: '/models/shuttle.glb',
    credit: 'NASA, NASA 3D Resources', licence: 'Public domain', source: NASA,
    parts: {
      p01: 'Vertical stabilizer', p05: 'Main engines', p08: 'Main engines', p09: 'Main engines', p12: 'Delta wing',
      p13: 'Solid rocket boosters', p14: 'External tank',
      p02: 'Orbiter fuselage', p03: 'Orbiter fuselage', p04: 'Orbiter fuselage', p06: 'Orbiter fuselage', p07: 'Orbiter fuselage', p10: 'Orbiter fuselage', p11: 'Orbiter fuselage',
    },
  },
  {
    id: 'crawler', cat: 'human', title: 'Crawler-transporter', kind: 'Launch pad hauler · NASA', url: '/models/crawler.glb',
    credit: 'NASA, NASA 3D Resources', licence: 'Public domain', source: NASA,
    parts: {
      p01: 'Main deck', p03: 'Main deck', p06: 'Main deck', p08: 'Main deck', p09: 'Operator cab', p05: 'Stairs and catwalk',
      p02: 'Truck support frames', p04: 'Truck support frames',
      p07: 'Track truck A', p10: 'Track truck B', p11: 'Track truck C', p12: 'Track truck D',
    },
  },
  // ---------------- Observatories & probes ----------------
  {
    id: 'jwst', cat: 'observe', title: 'James Webb telescope', kind: 'Space telescope · NASA', url: '/models/jwst.glb',
    credit: 'NASA, NASA 3D Resources', licence: 'Public domain', source: NASA,
  },
  {
    id: 'chandra', cat: 'observe', title: 'Chandra X-ray Observatory', kind: 'X-ray telescope · NASA', url: '/models/chandra.glb',
    credit: 'NASA, NASA 3D Resources', licence: 'Public domain', source: NASA,
    parts: {
      p01: 'Sunshade door', p02: 'Optical bench', p03: 'Science instrument module', p04: 'Spacecraft module', p10: 'Spacecraft module',
      p05: 'Solar arrays', p06: 'Solar arrays', p07: 'Solar arrays', p08: 'Solar arrays', p09: 'Solar arrays',
    },
  },
  {
    id: 'voyager', cat: 'observe', title: 'Voyager', kind: 'Deep space · NASA/JPL', url: '/models/voyager.glb',
    credit: 'NASA/JPL, NASA 3D Resources', licence: 'Public domain', source: NASA,
    parts: {
      p01: 'Magnetometer boom', p02: 'Magnetometer boom', p03: 'Magnetometer boom', p04: 'Magnetometer boom', p05: 'High-gain antenna',
      p06: 'Science boom and scan platform', p07: 'Science boom and scan platform', p08: 'Radioisotope generators (RTGs)',
      p09: 'Plasma wave antennas', p10: 'Ten-sided bus', p11: 'Lower struts and thrusters', p12: 'Lower struts and thrusters',
    },
  },
  {
    id: 'landsat8', cat: 'observe', title: 'Landsat 8', kind: 'Earth observation · NASA/USGS', url: '/models/landsat8.glb',
    credit: 'NASA, NASA 3D Resources', licence: 'Public domain', source: NASA,
    parts: {
      p01: 'Imaging instruments', p03: 'Imaging instruments', p06: 'Imaging instruments', p08: 'Imaging instruments',
      p02: 'Bus equipment', p04: 'Bus equipment', p05: 'Bus equipment', p07: 'Spacecraft bus',
      p09: 'Solar array', p10: 'Solar array', p11: 'Solar array', p12: 'Solar array',
    },
  },
  // ---------------- Robots ----------------
  {
    id: 'robonaut2', cat: 'robots', title: 'Robonaut 2', kind: 'Humanoid robot · NASA/GM', url: '/models/robonaut2.glb',
    credit: 'NASA, NASA 3D Resources', licence: 'Public domain', source: NASA,
    parts: {
      p01: 'Head and neck', p02: 'Left shoulder', p03: 'Right shoulder', p04: 'Right hand', p05: 'Left hand', p06: 'Right arm', p07: 'Left arm',
      p08: 'Backpack', p09: 'Torso', p10: 'Right leg, upper', p12: 'Right leg, lower', p11: 'Left leg, upper', p13: 'Left leg, lower',
      p14: 'Right leg end effector', p15: 'Left leg end effector', p16: 'Hips',
    },
  },
  // ---------------- Aircraft ----------------
  {
    id: 'x57', cat: 'aircraft', title: 'X-57 Maxwell', kind: 'All-electric X-plane · NASA', url: '/models/x57.glb',
    credit: 'NASA, NASA 3D Resources', licence: 'Public domain', source: NASA,
    parts: {
      p01: 'Vertical tail', p09: 'Horizontal stabilator', p14: 'Fuselage', p05: 'High-aspect-ratio wing',
      p02: 'Wingtip nacelles', p04: 'Wingtip nacelles', p03: 'Wingtip cruise motors', p06: 'Wingtip cruise motors',
      p07: 'High-lift motors, left outer', p08: 'High-lift motors, left middle', p11: 'High-lift motors, left inner',
      p13: 'High-lift motors, right inner', p10: 'High-lift motors, right middle', p12: 'High-lift motors, right outer',
    },
  },
  // ---------------- Cars ----------------
  {
    id: 'car', cat: 'cars', title: 'Concept car', kind: 'Automotive · Khronos sample', url: '/models/car.glb',
    credit: 'Eric Chadwick, (c) 2024 Darmstadt Graphics Group GmbH', licence: 'CC BY 4.0', source: KHRONOS,
  },
  // ---------------- Engines & mechanisms ----------------
  {
    id: 'watch', cat: 'engines', title: 'Chronograph watch', kind: 'Mechanical · Khronos sample', url: '/models/watch.glb',
    credit: 'Eric Chadwick, (c) 2025 Darmstadt Graphics Group GmbH', licence: 'CC BY 4.0', source: KHRONOS,
  },
  {
    id: 'generator', cat: 'engines', title: 'Portable generator', kind: 'Open-frame petrol genset · Poly Haven', url: '/models/generator.glb',
    credit: 'James Ray Cock, Poly Haven', licence: 'CC0', source: PH('portable_generator'),
    parts: {
      p01: 'Fuel cap', p02: 'Fuel tank', p05: 'Fuel tank', p03: 'Control panel', p06: 'Control panel',
      p04: 'Tubular frame', p08: 'Tubular frame', p09: 'Tubular frame', p10: 'Tubular frame', p12: 'Tubular frame',
      p07: 'Engine switch', p11: 'Air filter and carburettor', p13: 'Engine block', p14: 'Recoil starter',
      p15: 'Muffler', p16: 'Alternator', p17: 'Engine mounts', p18: 'Engine mounts',
    },
  },
  // ---------------- Poly Haven (CC0) ----------------
  {
    id: 'payphone', cat: 'phones', title: 'Public payphone', kind: 'Card and coin phone · Poly Haven', url: '/models/payphone.glb',
    credit: 'UM JOORIN, Poly Haven', licence: 'CC0', source: PH('korean_public_payphone_01'),
    parts: {
      p01: 'Display and function keys', p02: 'Side fitting', p03: 'Handset and hook', p04: 'Keypad faceplate', p05: 'Steel housing',
      p06: 'Shelf', p07: 'Handset cord', p08: 'Coin return', p09: 'Coin vault door', p10: 'Base plate',
    },
  },
  {
    id: 'rangefinder', cat: 'cameras', title: 'Rangefinder camera', kind: 'Vintage 35 mm · Poly Haven', url: '/models/rangefinder.glb',
    credit: 'Rajil Jose Macatangay, Poly Haven', licence: 'CC0', source: PH('Camera_01'),
    parts: {
      p01: 'Rewind knob', p02: 'Accessory shoe', p03: 'Speed dial and shutter release', p04: 'Strap lugs', p05: 'Strap lugs',
      p06: 'Camera body', p07: 'Lens', p08: 'Front controls', p09: 'Leather strap', p10: 'Base fittings',
    },
  },
  {
    id: 'cine-camera', cat: 'cameras', title: 'Turret film camera', kind: 'WWII-era cine camera · Poly Haven', url: '/models/cine-camera.glb',
    credit: 'James Ray Cock, Jenelle van Heerden, Poly Haven', licence: 'CC0', source: PH('vintage_video_camera'),
    parts: {
      p01: 'Top cover', p02: 'Viewfinder', p03: 'Dial', p04: 'Turret lens', p05: 'Side latch', p06: 'Side door',
      p07: 'Camera body', p08: 'Lens turret', p09: 'Turret plate', p10: 'Turret fittings',
    },
  },
  {
    id: 'film-projector', cat: 'cameras', title: '8 mm film projector', kind: 'Home cinema · Poly Haven', url: '/models/film-projector.glb',
    credit: 'PeterM, Poly Haven', licence: 'CC0', source: PH('filmstrip_projector_8mm'),
    parts: {
      p01: 'Film', p04: 'Film', p02: 'Feed reel holder', p03: 'Feed spool', p05: 'Spool arm', p06: 'Feed roller', p07: 'Take-up holder',
      p08: 'Take-up spool', p09: 'Projector body', p10: 'Focus lens', p11: 'Power switch', p12: 'Speed dial', p13: 'Mode dial',
      p14: 'Power cable', p15: 'Mains plug', p16: 'Connector',
    },
  },
  {
    id: 'laptop', cat: 'retro', title: 'Classic laptop', kind: '1990s DOS portable · Poly Haven', url: '/models/laptop.glb',
    credit: 'Arrangemonk, Poly Haven', licence: 'CC0', source: PH('classic_laptop'),
    parts: {
      p01: 'Screen latches', p02: 'Screen latches', p03: 'Display lid', p04: 'Keys, top left', p05: 'Keys, top right', p06: 'Base and palm rest',
      p07: 'Trackball and keys', p08: 'Keys, bottom right', p09: 'Keys, bottom left', p10: 'Side ports', p11: 'Status lights', p12: 'Hinge',
    },
  },
  {
    id: 'boombox', cat: 'audio', title: 'Boombox', kind: '1980s portable stereo · Poly Haven', url: '/models/boombox.glb',
    credit: 'Thomas Paul Mouilleron, Poly Haven', licence: 'CC0', source: PH('boombox'),
    parts: {
      p01: 'Telescoping antenna', p02: 'Carry handle', p03: 'Handle mounts', p04: 'Tuner knobs', p05: 'Switches', p06: 'Cabinet',
      p07: 'Cassette deck door', p08: 'Right speaker', p09: 'Left speaker', p10: 'Front plate',
    },
  },
  {
    id: 'cassette-player', cat: 'audio', title: 'Portable cassette player', kind: 'Personal stereo · Poly Haven', url: '/models/cassette-player.glb',
    credit: 'Mateusz Sadek, Poly Haven', licence: 'CC0', source: PH('portable_cassette_player'),
    parts: {
      p01: 'Transport buttons', p02: 'Top switches', p03: 'Radio tuning dial', p04: 'Side controls', p05: 'Cassette door',
      p06: 'Cassette tape', p07: 'Hinge and latch', p08: 'Player body', p09: 'Volume wheel', p10: 'Player body',
    },
  },
  {
    id: 'radio-transceiver', cat: 'audio', title: 'Military radio transceiver', kind: 'Field radio with Morse key · Poly Haven', url: '/models/radio-transceiver.glb',
    credit: 'Mateusz Sadek, Poly Haven', licence: 'CC0', source: PH('vintage_radio_transceiver'),
    parts: {
      p01: 'Whip antenna', p02: 'Speaker', p03: 'Antenna plugs', p06: 'Antenna plugs', p04: 'Desk microphone', p05: 'Speaker plug',
      p07: 'Microphone plug', p08: 'Cables', p14: 'Cables', p09: 'Transceiver case', p10: 'Morse key plug', p11: 'Frequency dial',
      p12: 'Morse key arm', p13: 'Morse key base',
    },
  },
  {
    id: 'microscope', cat: 'instruments', title: 'Brass microscope', kind: 'Vintage optics · Poly Haven', url: '/models/microscope.glb',
    credit: 'Luis José Fernández Rodríguez, Poly Haven', licence: 'CC0', source: PH('vintage_microscope'),
    parts: {
      p01: 'Eyepiece', p02: 'Focus adjustment', p03: 'Rack mount and arm', p04: 'Objective revolver', p05: 'Condenser',
      p06: 'Mirror arm', p07: 'Base', p08: 'Mirror base',
    },
  },
  {
    id: 'lab-microscope', cat: 'instruments', title: 'Industrial microscope', kind: 'Binocular, triple objective · Poly Haven', url: '/models/lab-microscope.glb',
    credit: 'Lukas Walzer, Poly Haven', licence: 'CC0', source: PH('industrial_microscope'),
    parts: {
      p01: 'Binocular head', p02: 'Objective turret', p03: 'Stage drive', p04: 'Slide holder', p05: 'Stand and stage',
      p06: 'Condenser', p07: 'Fine focus knob', p08: 'Illuminator', p09: 'Focus knob, inner', p10: 'Focus knob, outer',
    },
  },
  {
    id: 'binoculars', cat: 'instruments', title: 'Binoculars', kind: 'Porro prism, vintage · Poly Haven', url: '/models/binoculars.glb',
    credit: 'Luke, Poly Haven', licence: 'CC0', source: PH('vintage_binocular'),
    parts: {
      p01: 'Eyecups', p02: 'Focus wheel', p03: 'Centre hinge', p04: 'Left objective', p05: 'Right objective',
      p06: 'Left prism housing', p07: 'Right prism housing', p08: 'Diopter adjustment',
    },
  },
  {
    id: 'multimeter', cat: 'instruments', title: 'Analog multimeter', kind: 'Needle gauge tester · Poly Haven', url: '/models/multimeter.glb',
    credit: 'elli moeller, Poly Haven', licence: 'CC0', source: PH('retro_multimeter'),
    parts: {
      p01: 'Carry handle', p02: 'Carry handle', p03: 'Gauge needle', p04: 'Case and gauge', p05: 'Function buttons',
      p06: 'Lead plugs', p08: 'Lead plugs', p07: 'Adjustment knob', p09: 'Probe tips', p10: 'Test leads',
    },
  },
  {
    id: 'spacecraft-panel', cat: 'instruments', title: 'Spacecraft globe panel', kind: 'Cockpit navigation display · Poly Haven', url: '/models/spacecraft-panel.glb',
    credit: 'Michał Wiśniewski, Poly Haven', licence: 'CC0', source: PH('vintage_spacecraft_instrument'),
    parts: {
      p01: 'Top plate', p02: 'Toggle switches', p03: 'Side plate', p04: 'Control knobs', p10: 'Control knobs', p05: 'Front panel',
      p06: 'Housing', p07: 'Earth globe display', p08: 'Globe bezel', p09: 'Viewing glass', p11: 'Mount', p12: 'Base plate',
    },
  },
  {
    id: 'drill-press', cat: 'workshop', title: 'Belt-drive drill press', kind: 'Bench machine · Poly Haven', url: '/models/drill-press.glb',
    credit: 'Viktor, Poly Haven', licence: 'CC0', source: PH('drill_press_01'),
    parts: {
      p01: 'Belt guard lid', p02: 'Stepped pulleys', p03: 'Stepped pulleys', p04: 'Drive belt', p05: 'Switch buttons', p06: 'Switch buttons',
      p07: 'Feed handle', p08: 'Depth limiter', p09: 'Chuck and drill bit', p10: 'Column, head and motor', p11: 'Plug and cord',
      p12: 'Table catch', p13: 'Spec plate',
    },
  },
  {
    id: 'compressor', cat: 'workshop', title: 'Air compressor', kind: 'Belt-drive, military surplus · Poly Haven', url: '/models/compressor.glb',
    credit: 'Brian Speight, Poly Haven', licence: 'CC0', source: PH('old_military_compressor'),
    parts: {
      p01: 'Pump head', p02: 'Drive motor', p03: 'Compressor pump', p04: 'Flywheel pulley', p05: 'Air line', p06: 'Regulator and gauge',
      p07: 'Mounting plate', p08: 'Drive belt', p09: 'Air tank', p10: 'Side handle', p11: 'Wheel and axle', p12: 'Wheel',
    },
  },
];

export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id);
