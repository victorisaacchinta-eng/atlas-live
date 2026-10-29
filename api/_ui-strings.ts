/**
 * Interface strings that follow the viewer's language. English is the source; other languages are
 * machine-translated once by the server, cached, and labelled as machine-translated in the UI.
 * Keep this list short: every key costs a translation in 22 languages.
 */
export const UI_STRINGS = {
  eyebrow: 'Official alerts, explained',
  headline: 'A warning just went out. Explain it in your language within the hour, straight from the official alert.',
  lede: "Every alert India's disaster authorities have in force right now, on the globe. Pick one and ATLAS writes a 60-second Short in your language. Each claim is checked against the alert itself, and anything the alert does not say is cut.",
  place_placeholder: 'Go to any place, e.g. Golconda Fort',
  ask_placeholder: 'Ask ATLAS: any flood alerts in Andhra Pradesh?',
  live_signals: 'Live signals',
  whole_earth: 'Whole Earth',
  layer_india: 'India alerts',
  layer_quakes: 'Earthquakes',
  layer_events: 'Natural events',
  make_short: 'Make a Short',
  fly_here: 'Fly here',
  ask_atlas: 'Ask ATLAS',
  short_in: 'Short in',
  as_issued: 'As issued, in',
  storyboard: 'Storyboard',
  source_check: 'Source check',
  deliver: 'Deliver',
  play_preview: 'Play preview',
  stop: 'Stop',
  back_to_earth: 'Back to Earth',
  download_kit: 'Download kit',
  language: 'Language',
  machine_translated: 'Interface machine-translated',
} as const;

export type UiKey = keyof typeof UI_STRINGS;
