import { EVENT_CATEGORIES } from '../data/eonet';
import type { Op, Plan, PlannerContext } from './ops';

/**
 * Deterministic planner that runs in the browser with no model and no key.
 * It covers the common requests; the model planner (api/assist) handles
 * open-ended phrasing when a key is configured, and both emit the same
 * validated operations.
 */

const HERE = /\b(here|this (area|region|place|location|spot|city|town|country|range|valley|mountain range|island)|around me|the view|current (view|location))\b/;

const PLACE_TAIL = /\s+(please|now|for me|on the map|in 3d|in three d)$/;

function cleanPlace(s: string): string {
  return s
    .replace(/[?.!]+$/, '')
    .replace(PLACE_TAIL, '')
    .replace(/^(the city of|the town of|the)\s+/, '')
    .trim();
}

/** Extracts "X" from "... in X", "... near X", "... around X" unless X means the current view. */
function placeAfter(text: string, words: string[]): string | undefined {
  for (const w of words) {
    const m = new RegExp(`\\b${w}\\s+(.+)$`).exec(text);
    if (m) {
      const candidate = cleanPlace(m[1]);
      if (!candidate || HERE.test(candidate) || /^(the )?(last|past) /.test(candidate)) return undefined;
      return candidate;
    }
  }
  return undefined;
}

function yearsIn(text: string): string[] {
  return [...text.matchAll(/\b(20[12]\d)\b/g)].map((m) => m[1]);
}

function datesIn(text: string): string[] {
  return [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => m[1]);
}

function categoryIn(text: string): string | undefined {
  for (const [id, words] of Object.entries(EVENT_CATEGORIES)) {
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(text))) return id;
  }
  return undefined;
}

export function planLocally(input: string, ctx: PlannerContext): Plan {
  const text = input.toLowerCase().replace(/\s+/g, ' ').trim();
  const ops: Op[] = [];
  const planner = 'Built-in rules (offline)';
  const here = HERE.test(text) || !!ctx.selected;

  if (!text) return { ops, planner };

  // Navigation
  if (/^(reset|home|whole (earth|planet|world)|show (me )?the (whole )?(earth|planet|world)|zoom out (all the way|fully))$/.test(text)) {
    return { ops: [{ op: 'reset' }], planner };
  }
  if (/^(go )?back$|^previous( view)?$|^undo$/.test(text)) return { ops: [{ op: 'back' }], planner };
  if (/^(orbit|circle|spin|rotate)( (it|around( it| here| this)?|this|here))?$|^go around( it| this)?$/.test(text)) return { ops: [{ op: 'orbit' }], planner };

  const fly = /^(take me to|go to|fly( me)? to|show me|zoom (in )?(to|on)|navigate to|find|where is|locate)\s+(.+)$/.exec(text);

  // Satellites
  if (/\b(iss|space station|tiangong)\b/.test(text)) {
    ops.push({ op: 'set_layer', layer: 'satellites', on: true });
    ops.push({ op: 'fly_to_satellite', name: /tiangong/.test(text) ? 'tiangong' : 'iss' });
    return { ops, planner };
  }
  if (/\bsatellites?\b/.test(text) && !/\bimagery|image|photo|view\b/.test(text)) {
    ops.push({ op: 'set_layer', layer: 'satellites', on: !/\b(hide|off|remove)\b/.test(text) });
    return { ops, planner };
  }

  // Comparisons over time
  if (/\b(compare|changed?|growth|grown|before and after|over time|difference)\b/.test(text)) {
    const dates = datesIn(text);
    const years = yearsIn(text);
    const place = placeAfter(text, ['of', 'in', 'for', 'around']);
    if (place && !/\b(these|two|both)\b/.test(place)) ops.push({ op: 'fly_to', place: place.replace(/\b(between|from)\b.*$/, '').trim(), scale: 'city' });
    if (dates.length >= 2) ops.push({ op: 'compare', kind: 'days', a: dates[0], b: dates[1] });
    else ops.push({ op: 'compare', kind: 'years', a: years[0] ?? '2018', b: years[1] ?? '2025' });
    ops.push({
      op: 'note',
      text: 'Drag the divider to compare the two dates. The globe shows the imagery side by side; it does not measure change in the pixels yet, so read the difference with your own eyes.',
    });
    if (/\btwo cities|these cities|both cities\b/.test(text)) {
      ops.push({ op: 'note', text: 'The comparison works on one place at a time. Fly to the second city and the divider stays in place.' });
    }
    return { ops, planner };
  }

  // Weather and environment
  if (/\b(weather|temperature|forecast|rain(ing)?|humid|wind|air quality|aqi|pollution|climate now|conditions)\b/.test(text)) {
    const place = placeAfter(text, ['in', 'at', 'for', 'near', 'around']);
    ops.push({ op: 'conditions', place: here && !place ? undefined : place });
    if (/\b(rain|raining|precip\w*|storm|snow)\b/.test(text)) ops.push({ op: 'set_layer', layer: 'precipitation', on: true });
    return { ops, planner };
  }
  if (/\b(environment(al)?|hazards?|what('s| is) (happening|going on)|summar(y|ise|ize))\b/.test(text)) {
    const place = placeAfter(text, ['in', 'at', 'for', 'near', 'around', 'of']);
    if (place) ops.push({ op: 'fly_to', place, scale: 'region' });
    ops.push({ op: 'conditions', place: undefined });
    ops.push({ op: 'find_events', near: undefined, radius_km: 800 });
    ops.push({ op: 'find_quakes', near: undefined, radius_km: 800 });
    return { ops, planner };
  }

  // Hazards
  if (/\b(earthquakes?|quakes?|seismic|tremors?)\b/.test(text)) {
    const place = placeAfter(text, ['in', 'near', 'around', 'off']);
    const mag = /\b(?:m|magnitude|above|over)\s*(\d(?:\.\d)?)\b/.exec(text)?.[1];
    ops.push({ op: 'set_layer', layer: 'quakes', on: true });
    ops.push({ op: 'find_quakes', near: place, radius_km: place || here ? 600 : undefined, min_magnitude: mag ? Number(mag) : undefined });
    return { ops, planner };
  }
  const cat = categoryIn(text);
  if (cat && !/\b(rivers?|peaks?)\b/.test(text)) {
    const place = placeAfter(text, ['in', 'near', 'around', 'over']);
    ops.push({ op: 'set_layer', layer: 'events', on: true });
    ops.push({ op: 'find_events', category: cat, near: place, radius_km: place || here ? 1000 : undefined });
    return { ops, planner };
  }

  // Features from OpenStreetMap
  const feature: Array<[RegExp, Extract<Op, { op: 'find_features' }>['kind']]> = [
    [/\brivers?\b/, 'rivers'],
    [/\b(transit|transport(ation)?|metro|subway|train|railway|bus) (hubs?|stations?|terminals?)\b|\bstations\b/, 'transit'],
    [/\b(peaks?|summits?|mountains?|highest point)\b/, 'peaks'],
    [/\bairports?\b/, 'airports'],
    [/\bhospitals?\b/, 'hospitals'],
    [/\b(universities|university|colleges?)\b/, 'universities'],
    [/\bparks?\b/, 'parks'],
  ];
  for (const [re, kind] of feature) {
    if (re.test(text)) {
      const place = placeAfter(text, ['in', 'near', 'around', 'of', 'across']);
      ops.push({ op: 'find_features', kind, place });
      if (/\b(geography|explain|describe)\b/.test(text)) {
        ops.push({ op: 'set_layer', layer: 'terrain', on: true }, { op: 'set_exaggeration', factor: 2 }, { op: 'tilt', degrees: 30 });
        ops.push({
          op: 'unsupported',
          reason: 'A written explanation of the geography needs the language-model planner, which is not configured.',
          suggestion: 'Set an LLM key on the server (see .env.example). The peaks, terrain and labels shown are real data.',
        });
      }
      return { ops, planner };
    }
  }

  // Terrain and 3D
  if (/\b(terrain|relief|elevation|topograph\w*|mountains|landscape|3d terrain)\b/.test(text)) {
    ops.push({ op: 'set_layer', layer: 'terrain', on: true });
    ops.push({ op: 'set_exaggeration', factor: /\b(exaggerat|dramatic|more)\b/.test(text) ? 3 : 2 });
    ops.push({ op: 'tilt', degrees: 30 });
    return { ops, planner };
  }
  if (/\bbuildings?\b|\b3d city\b|\bskyline\b/.test(text)) {
    if (/\bphotoreal|realistic|google\b/.test(text)) ops.push({ op: 'set_layer', layer: 'photoreal-3d', on: true });
    else ops.push({ op: 'set_layer', layer: 'buildings', on: true });
    const place = placeAfter(text, ['in', 'of', 'around']);
    if (place) ops.push({ op: 'fly_to', place, scale: 'street' });
    else if (ctx.view && ctx.view.altitude_m > 4500) ops.push({ op: 'set_scale', scale: 'street' });
    return { ops, planner };
  }

  // Imagery and overlays
  if (/\b(night|city lights|lights at night)\b/.test(text)) return { ops: [{ op: 'set_layer', layer: 'night-lights', on: !/\b(hide|off)\b/.test(text) }], planner };
  if (/\b(borders?|boundaries|coastlines?)\b/.test(text)) return { ops: [{ op: 'set_layer', layer: 'borders', on: !/\b(hide|off)\b/.test(text) }], planner };
  if (/\b(labels?|names)\b/.test(text)) return { ops: [{ op: 'set_layer', layer: 'labels', on: !/\b(hide|off)\b/.test(text) }], planner };
  if (/\b(street map|streets|road map|map view|openstreetmap)\b/.test(text)) return { ops: [{ op: 'set_base', base: 'streets' }], planner };
  if (/\b(today|yesterday|daily|clouds?|this week)\b/.test(text) && /\b(imagery|satellite|image|clouds?|view|earth)\b/.test(text)) {
    const date = datesIn(text)[0];
    ops.push({ op: 'set_base', base: 'daily' });
    if (date) ops.push({ op: 'set_date', date });
    return { ops, planner };
  }
  if (/\bblue marble\b/.test(text)) return { ops: [{ op: 'set_base', base: 'bluemarble' }], planner };
  if (/\b(sentinel|cloud.?free|satellite (view|imagery|map))\b/.test(text)) return { ops: [{ op: 'set_base', base: 'sentinel' }], planner };

  // Plain navigation, last so "show me earthquakes" is caught above.
  if (fly) {
    const place = cleanPlace(fly[5]);
    if (place) return { ops: [{ op: 'fly_to', place }], planner };
  }

  // Questions this planner cannot answer
  if (/^(why|how|explain|describe|tell me|what is|what are|who)\b/.test(text)) {
    return {
      ops: [
        {
          op: 'unsupported',
          reason: 'Open questions need the language-model planner, which is not configured on this server.',
          suggestion: 'Try "weather here", "rivers in this area", "earthquakes near Japan", or a place name.',
        },
      ],
      planner,
    };
  }

  // Anything else is treated as a place name.
  return { ops: [{ op: 'fly_to', place: cleanPlace(text) }], planner };
}
