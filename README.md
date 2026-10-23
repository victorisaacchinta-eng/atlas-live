# ATLAS Live

A browser app for looking at real things in 3D. It opens on the whole Earth with live earthquakes and natural events on it, flies into photoreal landmarks, and turns machines, scanned objects and buildings into holograms you can pull apart with your hands and ask questions about.

I built it solo for the Nebius x NVIDIA Global AI Hackathon (2026). NVIDIA Nemotron models on Nebius Token Factory do the seeing and the reasoning.

## Modes

**Places** is where it starts. The camera sits in orbit over the globe with two live layers switched on: USGS earthquakes (M2.5+, past 7 days) and NASA EONET open natural events (wildfires, storms, sea ice). Every dot can be clicked for its time, size and a link to the source's own page. From there you pick one of 23 preset landmarks or search any place, and the camera dives into Google Photorealistic 3D Tiles. Over a place you can:

- switch lenses: Photo, Hologram (blueprint colours with height contours), Thermal, Night and Riso
- Isolate the landmark, which cuts it out of the city so it floats on its own
- open a photo reconstruction, where one exists (see below)
- send it to Build

**Library** has five openly licensed models (Perseverance, Ingenuity, the James Webb telescope, a chronograph watch and a concept car). Open palm explodes them, pinch picks a part, and you can ask about anything.

**Scan**: hold an object up to the webcam or drop in a photo. Nemotron vision names it and boxes its visible parts, Depth Anything V2 runs in the browser and lifts the photo into a point cloud, and the cloud is split into those parts so you can pull them out.

**Build**: name a structure ("Charminar, Hyderabad") and a small team of model calls makes a version you can take apart. A researcher reads the web (Tavily) for dimensions and grabs a reference photo from Wikipedia, a planner splits the structure into 3 to 5 zones, one builder per zone writes its parts in a small shape grammar (boxes, tapers, domes, onion domes, arches and so on, with ring/row/mirror repeats), and a critic compares a render of the result with the reference photo and sends back fixes, for up to two rounds. Builders run in parallel and each zone appears as soon as it lands.

### The agent

You can type or speak a question in any mode, and the answer is read aloud. Around a machine the agent has to search the web (Tavily) before stating a fact, and it can highlight a part and explode the model. On the globe it can also fly the camera to a place or to a specific earthquake, query the live layers (`find_signals`), get current weather from Open-Meteo, change lens, orbit, isolate, pull back to the whole Earth and start a Build. There it is told to say where a fact came from (USGS, NASA EONET, Open-Meteo or the web), and to only say it did something if the tool result says it worked. Places it is asked to fly to are geocoded on the server first, so it does not describe a flight that cannot happen.

### Photo reconstructions

Google's 3D is coarse over a lot of India, so the India presets are flagged in the list. For the Taj Mahal I trained a Gaussian splat from 176 Wikimedia Commons photos with `tools/reconstruct.ipynb` (a Colab notebook: hloc structure from motion, then gsplat with a per-photo colour correction, a crop to the monument and a `.splat` export). After landing at the Taj the view switches to it automatically. The splat was cleaned of the reflecting pool's mirror image, sky specks and floaters, and it is rendered with Spark inside the normal three.js pipeline. It only looks right from the front, since that is where the tourist photos were taken, so it sways across that side instead of spinning. The other India presets point you to Build instead.

## Models

All model calls run server-side in Vercel functions. Keys never reach the browser.

| Job | Role | Default on Nebius Token Factory | Where |
|---|---|---|---|
| Identify a scanned object and locate its parts | vision | `nvidia/Nemotron-3.5-Super-VL` | `api/scan.ts` |
| Agent with tool calls | agent | `nvidia/nemotron-3-super-120b-a12b` | `api/ask.ts` |
| Cited facts for a landmark (with Tavily) | agent | same | `api/facts.ts`, `api/_places.ts` |
| Build: plan and builders | agent | same | `api/construct.ts` |
| Build: critic | vision | `nvidia/Nemotron-3.5-Super-VL` | `api/construct.ts` |

Any OpenAI-compatible provider works and the first one with a key wins: Nebius Token Factory, then the NVIDIA API catalog, Gemini and Groq (`api/_nebius.ts`). On first use the server checks the configured ids against the provider's live model list and swaps a retired one for the closest match. If a call is overloaded, rate limited, retired or stalls (22 s for short replies, 120 s for long ones), it moves on to the next live model, then to any other provider that has a key. A model that says its quota is used up is skipped for 15 minutes. Nemotron's thinking is switched off because the app needs fast structured answers, and each answer and Build step shows which model actually answered. Ids can be pinned with `ATLAS_VISION_MODEL`, `ATLAS_AGENT_MODEL` and `ATLAS_FAST_MODEL`.

## Run it

```bash
npm install
cp .env.example .env   # one model key, TAVILY_API_KEY, and a map token
npx vercel dev         # serves the app and the /api functions
```

The map token is either `CESIUM_ION_TOKEN` (free Community plan, add asset 2275207 to My Assets) or `GOOGLE_MAPS_KEY` with the Map Tiles API enabled. Unlike the model keys, these reach the browser, so restrict them to your site's URL in the provider console.

Without a model key the Library and the 3D scan still work; identification, answers and captions say they are offline. Without a map token, Places falls back to a hologram city built from OpenStreetMap footprints and heights, with a sun dial showing where the sun is at any hour.

## Controls

| Gesture | Action |
|---|---|
| Open palm, held | Explode; bring your hand closer to pull it further apart |
| Fist | Put it back together |
| Move your hand sideways | Turn the model |
| Point | Aim the cursor at a part |
| Pinch | Pick the part you are aiming at |
| Two open hands | Zoom |

Keys: `E` explode or reassemble, `Esc` deselect. In Places: `1` to `5` lenses, `I` Isolate, `R` photo reconstruction, `B` Build this landmark, `G` back to the whole Earth.

Mouse and touch work everywhere too. Hand tracking is MediaPipe Hand Landmarker running locally; camera frames never leave the browser except the single frame you choose to scan.

Share links keep the view: `?place=taj&lens=thermal`, or `?at=lat,lon,Name` for any point.

## Limitations

- Google's photoreal 3D is coarse over much of India, and there is none for mainland China (so the Great Wall is not a preset).
- Only the Taj Mahal has a photo reconstruction so far, and it is only good from the front.
- The Build critic's likeness score is unreliable, so the first round of fixes is always applied whatever the score says. Builds are made only of simple shapes from the grammar.
- Free model endpoints drop the odd request under parallel load. Build retries a failed step once.
- Voice input needs Chrome or Edge.
- NASA EONET has no feed timestamp, so a layer's "updated" time is its newest observation.

## Credits

- 3D models: see `public/models/NOTICE.md` (NASA public domain; Khronos sample assets CC BY 4.0). Textures and logos removed.
- Taj Mahal reconstruction: trained from 176 Wikimedia Commons photos (CC BY-SA, CC BY, CC0 and public domain). Every photo, author and licence is listed in `public/splats/taj.credits.json`, linked from the app.
- Photoreal 3D: Google Photorealistic 3D Tiles, with the attribution shown in the app. Splats rendered with Spark (World Labs, MIT).
- Live data: USGS Earthquake Hazards Program and NASA EONET (U.S. public domain), Open-Meteo weather (CC BY 4.0) and elevation.
- Depth: Depth Anything V2 Small (Apache-2.0) via transformers.js.
- Map data and place search: © OpenStreetMap contributors, ODbL.
- Fonts: Science Gothic, Mona Sans, Monaspace Krypton (SIL OFL 1.1).

## Licence

MIT, see `LICENSE`.
