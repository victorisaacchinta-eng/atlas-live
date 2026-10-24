import { BillboardCollection, Cartesian3, Color, HeightReference, Material, NearFarScalar, PolylineCollection } from 'cesium';
import { loadQuakes, pagerText, type Quake } from '../data/usgs';
import { loadEvents, type NaturalEvent } from '../data/eonet';
import { relativeTime, utcStamp } from '../core/provenance';
import { toDecimal } from '../core/geo';
import { eventSwatch, marker, SWATCH } from './markers';
import type { InspectTarget, LayerContext, LayerDef } from './types';

const DAY = 86_400_000;
const REFRESH_QUAKES = 5 * 60_000;
const REFRESH_EVENTS = 30 * 60_000;

interface Tagged<T> {
  layer: string;
  item: T;
}

function tagOf<T>(picked: unknown, layer: string): T | null {
  const id = (picked as { id?: unknown } | undefined)?.id as Tagged<T> | undefined;
  return id && typeof id === 'object' && id.layer === layer ? id.item : null;
}

/* ---------------------------------------------------------- earthquakes */

export interface QuakeLayer extends LayerDef {
  quakes: Quake[];
  generated: number;
}

export function quakeLayer(): QuakeLayer {
  let collection: BillboardCollection | null = null;
  let lastLoad = 0;
  let loading = false;
  const def: QuakeLayer = {
    id: 'quakes',
    title: 'Earthquakes, past 7 days',
    group: 'live',
    quakes: [],
    generated: 0,
    purpose: 'Every magnitude 2.5 and larger earthquake USGS has located worldwide in the last week. Size is magnitude; filled marks happened in the last 24 hours.',
    provenance: {
      kind: 'live',
      source: 'USGS Earthquake Hazards Program',
      url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
      licence: 'U.S. public domain',
      note: 'USGS regenerates the feed every minute. The globe checks it every 5 minutes. Automatic solutions are revised by seismologists.',
    },
    legend: {
      items: [
        { label: 'Last 24 hours', swatch: SWATCH.quake, shape: 'dot' },
        { label: '1 to 7 days ago', swatch: SWATCH.quakeOld, shape: 'dot' },
      ],
      note: 'Larger mark, larger magnitude',
    },
    async enable(ctx) {
      collection = ctx.widget.scene.primitives.add(new BillboardCollection({ scene: ctx.widget.scene })) as BillboardCollection;
      await refresh(ctx);
    },
    disable(ctx) {
      if (collection) ctx.widget.scene.primitives.remove(collection);
      collection = null;
    },
    tick(ctx, now) {
      if (!loading && now.getTime() - lastLoad > REFRESH_QUAKES) void refresh(ctx).catch(() => undefined);
    },
    pick(picked): InspectTarget | null {
      const q = tagOf<Quake>(picked, 'quakes');
      return q ? quakeTarget(q, def.generated) : null;
    },
    summary: () => (def.quakes.length ? `${def.quakes.length} quakes, feed generated ${relativeTime(def.generated)}` : ''),
  };

  async function refresh(ctx: LayerContext) {
    loading = true;
    try {
      const res = await loadQuakes();
      def.quakes = res.quakes;
      def.generated = res.generated;
      def.provenance.observedAt = new Date(res.generated).toISOString();
      def.provenance.fetchedAt = new Date(res.fetchedAt).toISOString();
      lastLoad = Date.now();
      draw();
      ctx.requestRender();
    } finally {
      loading = false;
    }
  }

  function draw() {
    if (!collection) return;
    collection.removeAll();
    const now = Date.now();
    // Draw small first so large quakes sit on top.
    for (const q of [...def.quakes].sort((a, b) => a.mag - b.mag)) {
      const recent = now - q.time < DAY;
      const size = 5 + Math.max(0, q.mag - 2.5) * 3.4;
      collection.add({
        position: Cartesian3.fromDegrees(q.position.lon, q.position.lat, 0),
        image: marker(recent ? 'circle' : 'ring', size, recent ? SWATCH.quake : SWATCH.quakeOld),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        scaleByDistance: new NearFarScalar(3e5, 1.4, 2.2e7, 0.6),
        id: { layer: 'quakes', item: q } satisfies Tagged<Quake>,
      });
    }
  }

  return def;
}

export function quakeTarget(q: Quake, generated: number): InspectTarget {
  const facts = [
    { label: 'Magnitude', value: `${q.mag.toFixed(1)} ${q.magType}`.trim() },
    { label: 'Depth', value: `${q.depthKm.toFixed(1)} km` },
    { label: 'Origin time', value: `${utcStamp(q.time)} (${relativeTime(q.time)})` },
    { label: 'Coordinates', value: toDecimal(q.position, 3) },
    { label: 'Solution', value: q.status === 'reviewed' ? 'Reviewed by a seismologist' : 'Automatic, may be revised' },
  ];
  const pager = pagerText(q.alert);
  if (pager) facts.push({ label: 'PAGER alert', value: pager });
  if (q.tsunami) facts.push({ label: 'Tsunami', value: 'Flagged in a tsunami-prone region. Check official warning centres.' });
  if (q.felt) facts.push({ label: 'Felt reports', value: q.felt.toLocaleString('en-US') });
  return {
    kind: 'quake',
    title: `M ${q.mag.toFixed(1)} earthquake`,
    subtitle: q.place,
    position: q.position,
    facts,
    provenance: [
      {
        kind: 'live',
        source: 'USGS Earthquake Hazards Program',
        url: q.url,
        observedAt: new Date(q.updated).toISOString(),
        fetchedAt: new Date(generated).toISOString(),
        licence: 'U.S. public domain',
      },
    ],
    links: [{ label: 'USGS event page', url: q.url }],
    enrich: false,
  };
}

/* ------------------------------------------------------ natural events */

export interface EventLayer extends LayerDef {
  events: NaturalEvent[];
  hidden: Set<string>;
  setHidden(ctx: LayerContext, category: string, hide: boolean): void;
}

export function eventLayer(): EventLayer {
  let marks: BillboardCollection | null = null;
  let tracks: PolylineCollection | null = null;
  let lastLoad = 0;
  let loading = false;
  let fetchedAt = 0;
  const def: EventLayer = {
    id: 'events',
    title: 'Fires, storms and volcanoes',
    group: 'live',
    events: [],
    hidden: new Set(['seaLakeIce']),
    purpose: 'Natural events NASA is tracking right now, curated from agency feeds. Storms show their track.',
    provenance: {
      kind: 'live',
      source: 'NASA Earth Observatory Natural Event Tracker (EONET)',
      url: 'https://eonet.gsfc.nasa.gov/',
      licence: 'NASA open data',
      note: 'Open events from the last 30 days. Wildfire coverage is mostly the United States, from US agency feeds.',
    },
    legend: {
      items: [
        { label: 'Wildfire', swatch: SWATCH.fire, shape: 'diamond' },
        { label: 'Severe storm', swatch: SWATCH.storm, shape: 'diamond' },
        { label: 'Volcano', swatch: SWATCH.volcano, shape: 'diamond' },
        { label: 'Flood', swatch: SWATCH.flood, shape: 'diamond' },
        { label: 'Sea and lake ice (hidden)', swatch: SWATCH.ice, shape: 'diamond' },
      ],
    },
    async enable(ctx) {
      tracks = ctx.widget.scene.primitives.add(new PolylineCollection()) as PolylineCollection;
      marks = ctx.widget.scene.primitives.add(new BillboardCollection({ scene: ctx.widget.scene })) as BillboardCollection;
      await refresh(ctx);
    },
    disable(ctx) {
      if (marks) ctx.widget.scene.primitives.remove(marks);
      if (tracks) ctx.widget.scene.primitives.remove(tracks);
      marks = tracks = null;
    },
    tick(ctx, now) {
      if (!loading && now.getTime() - lastLoad > REFRESH_EVENTS) void refresh(ctx).catch(() => undefined);
    },
    setHidden(ctx, category, hide) {
      if (hide) def.hidden.add(category);
      else def.hidden.delete(category);
      draw();
      ctx.requestRender();
    },
    pick(picked) {
      const e = tagOf<NaturalEvent>(picked, 'events');
      return e ? eventTarget(e, fetchedAt) : null;
    },
    summary: () => {
      const shown = def.events.filter((e) => !def.hidden.has(e.category)).length;
      return def.events.length ? `${shown} open events shown, fetched ${relativeTime(fetchedAt)}` : '';
    },
  };

  async function refresh(ctx: LayerContext) {
    loading = true;
    try {
      const res = await loadEvents();
      def.events = res.events;
      fetchedAt = res.fetchedAt;
      def.provenance.fetchedAt = new Date(res.fetchedAt).toISOString();
      lastLoad = Date.now();
      draw();
      ctx.requestRender();
    } finally {
      loading = false;
    }
  }

  function draw() {
    if (!marks || !tracks) return;
    marks.removeAll();
    tracks.removeAll();
    for (const e of def.events) {
      if (def.hidden.has(e.category)) continue;
      const color = eventSwatch(e.category);
      if (e.track.length > 1) {
        tracks.add({
          positions: densify(e.track),
          width: 1.5,
          material: Material.fromType('Color', { color: Color.fromCssColorString(color).withAlpha(0.7) }),
        });
      }
      marks.add({
        position: Cartesian3.fromDegrees(e.position.lon, e.position.lat, 0),
        image: marker('diamond', e.category === 'seaLakeIce' ? 7 : 10, color),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        scaleByDistance: new NearFarScalar(3e5, 1.4, 2.2e7, 0.65),
        id: { layer: 'events', item: e } satisfies Tagged<NaturalEvent>,
      });
    }
  }

  return def;
}

export function eventTarget(e: NaturalEvent, fetchedAt: number): InspectTarget {
  const facts = [
    { label: 'Category', value: e.categoryTitle },
    { label: 'Latest report', value: `${utcStamp(e.date)} (${relativeTime(e.date)})` },
    { label: 'Position', value: toDecimal(e.position, 3) },
  ];
  if (e.magnitude) facts.push({ label: 'Magnitude', value: e.magnitude });
  if (e.track.length > 1) facts.push({ label: 'Track', value: `${e.track.length} reported positions since ${e.track[0].date.slice(0, 10)}` });
  if (e.description) facts.push({ label: 'Notes', value: e.description });
  return {
    kind: 'event',
    title: e.title,
    subtitle: e.categoryTitle,
    position: e.position,
    facts,
    provenance: [
      {
        kind: 'live',
        source: `NASA EONET${e.sources.length ? `, from ${e.sources.map((s) => s.id).join(', ')}` : ''}`,
        url: `https://eonet.gsfc.nasa.gov/api/v3/events/${e.id}`,
        observedAt: e.date,
        fetchedAt: new Date(fetchedAt).toISOString(),
        licence: 'NASA open data',
      },
    ],
    links: e.sources.map((s) => ({ label: `Source: ${s.id}`, url: s.url })),
    enrich: true,
  };
}

/** Interpolates between fixes so long track segments follow the surface instead of cutting a chord. */
function densify(track: Array<{ lat: number; lon: number }>): Cartesian3[] {
  const out: Cartesian3[] = [];
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    let dLon = b.lon - a.lon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const steps = 8;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push(Cartesian3.fromDegrees(a.lon + dLon * t, a.lat + (b.lat - a.lat) * t, 4000));
    }
  }
  const last = track[track.length - 1];
  out.push(Cartesian3.fromDegrees(last.lon, last.lat, 4000));
  return out;
}
