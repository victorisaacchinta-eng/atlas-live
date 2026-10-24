import { $, clear, closeButton, h } from './dom';

export const DATA_SOURCES: Array<{ name: string; url: string; what: string; freshness: string; licence: string; limits: string }> = [
  { name: 'CesiumJS', url: 'https://cesium.com/platform/cesiumjs/', what: 'Globe, terrain and 3D rendering engine', freshness: 'Library', licence: 'Apache 2.0', limits: 'None' },
  { name: 'EOX Sentinel-2 cloudless', url: 'https://cloudless.eox.at', what: 'Yearly cloud-free mosaics, 10 m', freshness: 'One mosaic per year, 2018 to 2025', licence: 'CC BY-NC-SA 4.0', limits: 'Non-commercial; commercial use needs an EOX licence' },
  { name: 'NASA GIBS', url: 'https://www.earthdata.nasa.gov/gibs', what: 'Daily VIIRS imagery, Blue Marble, Black Marble, IMERG rain, reference labels and borders', freshness: 'Daily; rain every 30 min, about 4 to 6 h behind', licence: 'NASA open data, acknowledgement requested', limits: 'Fair use' },
  { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright', what: 'Street map tiles, building footprints, rivers, stations and other features', freshness: 'Edited continuously by volunteers', licence: 'ODbL 1.0', limits: 'Tile and Overpass usage policies: light, cached use only' },
  { name: 'Terrain Tiles on AWS', url: 'https://registry.opendata.aws/terrain-tiles/', what: 'Global elevation (SRTM, GMTED2010, 3DEP, ETOPO1, EU-DEM and more)', freshness: 'Static compilation', licence: 'Open data, per-source attribution', limits: 'None stated' },
  { name: 'USGS Earthquake Hazards Program', url: 'https://earthquake.usgs.gov/earthquakes/feed/', what: 'Earthquakes M2.5+, past 7 days', freshness: 'Feed regenerated every minute', licence: 'U.S. public domain', limits: 'None stated' },
  { name: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov/', what: 'Open natural events: wildfires, storms, volcanoes, ice', freshness: 'As agencies report, checked every 30 min', licence: 'NASA open data', limits: 'Wildfires mostly US' },
  { name: 'CelesTrak', url: 'https://celestrak.org/NORAD/elements/', what: 'Orbital elements for stations and bright satellites', freshness: 'Several updates a day; cached for 2 h as CelesTrak asks', licence: 'Public', limits: 'Positions are computed, a few km accuracy' },
  { name: 'Open-Meteo', url: 'https://open-meteo.com/', what: 'Weather, 24 h forecast, air quality (CAMS), elevation (Copernicus GLO-90)', freshness: '15-minute model analysis', licence: 'CC BY 4.0', limits: 'Non-commercial, under 10,000 calls a day' },
  { name: 'Photon by komoot', url: 'https://photon.komoot.io', what: 'Place search and reverse geocoding', freshness: 'OSM data, refreshed regularly', licence: 'ODbL 1.0 data', limits: 'Fair use, throttled when heavy' },
  { name: 'Cesium ion (optional)', url: 'https://cesium.com/platform/cesium-ion/', what: 'Cesium World Terrain, Bing aerial imagery, OSM 3D Buildings, Google Photorealistic 3D Tiles', freshness: 'Varies by asset', licence: 'Cesium ion terms; Google and Bing terms', limits: 'Free tier is personal and non-commercial, session quotas' },
];

export function mountSourcesDialog(api: { token(): string | null; hostToken?: boolean; setToken(t: string | null): void; modelStatus(): string }) {
  const dlg = $('#sources') as HTMLDialogElement;

  function render() {
    clear(dlg);
    const tokenInput = h('input', { id: 'ion-token', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste a Cesium ion access token', value: api.token() ?? '' }) as HTMLInputElement;
    const keyForm = h(
      'form',
      { class: 'key-form' },
      h('label', { for: 'ion-token', class: 'vh' }, 'Cesium ion access token'),
      tokenInput,
      h('button', { class: 'btn primary', type: 'submit' }, 'Save token'),
      api.token() ? h('button', { class: 'btn', type: 'button', onclick: () => (api.setToken(null), render()) }, 'Remove') : null,
    );
    keyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      api.setToken(tokenInput.value.trim() || null);
      render();
    });

    dlg.append(
      h(
        'div',
        { class: 'sources-inner' },
        h('div', { class: 'dialog-close' }, closeButton(() => dlg.close(), 'Close sources')),
        h('h2', { id: 'sources-title' }, 'Sources and keys'),
        h('p', null, 'Everything on the globe comes from the providers below. Each layer and each answer names its source and how old the data is. Nothing is simulated.'),
        h('h3', null, 'Data'),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'src-table' },
            h('thead', null, h('tr', null, h('th', null, 'Provider'), h('th', null, 'Used for'), h('th', null, 'How fresh'), h('th', null, 'Licence'), h('th', null, 'Limits'))),
            h(
              'tbody',
              null,
              ...DATA_SOURCES.map((s) => h('tr', null, h('td', null, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.name)), h('td', null, s.what), h('td', null, s.freshness), h('td', null, s.licence), h('td', null, s.limits))),
            ),
          ),
        ),
        h('h3', null, 'Cesium ion token'),
        h(
          'p',
          null,
          api.hostToken
            ? 'This site already provides a Cesium ion token, so world terrain, sub-metre aerial imagery and 3D buildings are unlocked. You can paste your own to use your account instead; it is stored only in this browser.'
            : 'Optional. A free Cesium ion account adds world terrain, sub-metre aerial imagery and 3D buildings. The token is stored only in this browser. Ion tokens are made for browser use: restrict yours to this site in the ion dashboard.',
        ),
        keyForm,
        h('h3', null, 'Assistant'),
        h('p', null, api.modelStatus()),
        h('h3', null, 'Keyboard'),
        h(
          'div',
          { class: 'kbd-list' },
          ...[
            ['/', 'Search or ask'],
            ['Arrow keys', 'Move around the globe'],
            ['+ and -', 'Zoom in and out'],
            ['[ and ]', 'Tilt down and up'],
            ['1 to 6', 'Jump to planet, continent, country, region, city or street scale'],
            ['H', 'Whole planet'],
            ['B', 'Previous view'],
            ['L', 'Show or hide layers'],
            ['Esc', 'Close the open panel'],
          ].flatMap(([k, v]) => [h('kbd', null, k), h('span', null, v)]),
        ),
      ),
    );
  }

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });

  return {
    open() {
      render();
      dlg.showModal();
    },
  };
}
