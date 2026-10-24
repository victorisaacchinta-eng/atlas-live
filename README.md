# ATLAS Live

Take machines apart with your bare hands, in the browser.

ATLAS Live turns real machines, real objects and real places into holograms you can pull apart with an open palm, pick with a pinch and question out loud. NVIDIA Nemotron models on Nebius Token Factory do the seeing and the reasoning; every fact it speaks comes from a web search it cites.

Built for the Nebius x NVIDIA Global AI Hackathon (2026) by Chintha Victor Isaac.

## Modes

| Mode | What you do | What happens |
|---|---|---|
| **Library** | Pick a machine: Perseverance rover, Ingenuity, James Webb telescope, a chronograph watch, a concept car | The real model loads as a hologram. Open palm explodes it, pinch picks a part, ask anything |
| **Scan** | Hold any object up to the webcam, or drop in a photo | Nemotron vision names the object and boxes its visible parts. Depth Anything V2 runs in your browser and lifts the photo into a 3D point cloud, split into those parts, ready to pull apart |
| **Places** | Name a place ("Charminar, Hyderabad") | OpenStreetMap footprints and heights become a city hologram. Nemotron and Tavily write cited captions for its landmarks. A sun dial shows where the sun is at any hour |
| **God's Eye** (`/earth/`) | Start in orbit and come down to any street, or pick a landmark | A CesiumJS globe with real terrain, Sentinel-2 and NASA imagery, live USGS earthquakes, NASA EONET events, weather and satellites. Below 40 km Google Photorealistic 3D Tiles take over, so cities and landmarks can be circled in 3D. Click a building and its OpenStreetMap outline lights up on the mesh with its mapped details |

## How NVIDIA models and Token Factory are used

| Job | Model (Token Factory) | Where |
|---|---|---|
| Identify a scanned object and locate its parts | Nemotron 3.5 Super VL (vision) | `api/scan.ts` |
| Agent that answers, searches and drives the hologram with tool calls (`web_search`, `focus_part`, `set_explode`) | Nemotron 3 Super | `api/ask.ts` |
| Cited landmark captions for Places | Nemotron 3 Super + Tavily | `api/place.ts` |
| Plan God's Eye requests ("show me the Taj Mahal and circle it", "earthquakes near Japan") as whitelisted globe operations; the page runs them against the live data sources | Nemotron fast model | `api/earth.ts` |

All model calls run server-side (Vercel functions). Keys never reach the browser. Model ids are set in `api/_nebius.ts` and can be overridden with environment variables.

## Run it

```bash
npm install
cp .env.example .env   # add NEBIUS_API_KEY and TAVILY_API_KEY
npx vercel dev         # serves the app and the /api functions
```

Without keys the Library and the 3D scan still work; identification, answers and captions say they are offline.

God's Eye uses `CESIUM_ION_TOKEN` (or `GOOGLE_MAPS_KEY`) from `/api/status` for Cesium World Terrain, Bing aerial imagery and Google Photorealistic 3D Tiles. Without one it falls back to open terrain tiles and OpenStreetMap buildings raised from their footprints, and the assistant falls back to built-in rules when no model key is set.

### God's Eye coverage, honestly

- Google's photorealistic mesh is detailed in the cities Google has captured (about 2,500 cities in 49 countries when Cesium announced it). Everywhere else it is satellite imagery draped on terrain.
- The mesh is one surface, so buildings are not separate objects in it. Selection comes from the OpenStreetMap outline under the click, drawn onto the mesh.
- No interiors. Facts about a building are whatever OpenStreetMap mappers recorded.
- Google's tiles are for display only: never cached, extracted or analysed. While they are on, place search goes through Google's geocoder, as Google's terms require.

## Hand controls

| Gesture | Action |
|---|---|
| Open palm, held | Explode; bring your hand closer to pull it further apart |
| Fist | Put it back together |
| Move your hand sideways | Turn the model |
| Point | Aim the cursor at a part |
| Pinch | Pick the part you are aiming at |
| Two open hands | Zoom |

Mouse and touch work everywhere too. Hand tracking is MediaPipe Hand Landmarker, running locally; camera frames never leave the browser except the single frame you choose to scan.

## Credits

- 3D models: see `public/models/NOTICE.md` (NASA public domain; Khronos sample assets CC BY 4.0). Textures and logos removed.
- Depth: Depth Anything V2 Small (Apache-2.0) via transformers.js.
- Map data: © OpenStreetMap contributors, ODbL.
- God's Eye: CesiumJS (Apache-2.0); Google Photorealistic 3D Tiles; EOX Sentinel-2 cloudless (CC BY-NC-SA 4.0); NASA GIBS; Terrain Tiles on AWS; USGS; NASA EONET; CelesTrak; Open-Meteo (CC BY 4.0); Photon by komoot. Fonts Michroma, Instrument Sans, Fragment Mono (SIL OFL 1.1).
- Fonts: Science Gothic, Mona Sans, Monaspace Krypton (SIL OFL 1.1).

## Licence

MIT, see `LICENSE`.
