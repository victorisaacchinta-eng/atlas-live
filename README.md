# ATLAS Live

**Ask the live Earth what just happened. Turn it into a cited Short.**

When an earthquake or a wildfire trends, explainer creators have about an hour before the moment passes. Making a good 60-second Short about it today means a dozen tabs of USGS pages and news, a hand-keyframed map flight in After Effects or Google Earth Studio, or a Fiverr map animation that arrives in one to three days.

ATLAS Live does the research, the script and the camera plan in under a minute. Click a quake on a live globe and NVIDIA Nemotron writes six beats, a second Nemotron model checks every claim against the source it cites, and ATLAS plays the result in a 9:16 frame. One click exports a Google Earth tour, the script with its sources, captions and a voiceover script, ready to render and publish.

- **Live:** https://atlas-live-xi.vercel.app
- **Video (under 3 min):** _link added at submission_
- **Built for:** Nebius x NVIDIA Global AI Hackathon 2026, track Best Apps and Agents
- **Author:** Chintha Victor Isaac, ACE Engineering College, Hyderabad. I run a faceless explainer channel ([Lumen | Under 90 Seconds](https://www.youtube.com/@LumenUnder90Seconds)), so I am its first user.

---

## The flow

1. **Globe.** ATLAS opens on the whole Earth with live USGS earthquakes (M2.5+, past 7 days) and NASA EONET natural events. Every point shows its source and when the feed last updated.
2. **Ask or click.** "What was the biggest earthquake this week?" The agent queries the feed, answers with the USGS record cited, and flies there.
3. **Make a Short.** From any card, or by asking. ATLAS reads the official record and the web, writes, checks and stages the Short.
4. **Review.** Every beat shows its spoken line, its caption, the claim it makes, the source, and the checker's verdict (checked or partly). Unsupported claims are already gone.
5. **Export.** `tour.kml` (Google Earth tour, one flight and hold per beat), `script.md` (script, claims, sources, a ready YouTube description), `captions.srt`, `voiceover.txt`.

Build mode is still there: name a structure and Nemotron agents research it, model it from typed primitives and critique the result against a real photo, then you can pull it apart.

---

## How Nebius Token Factory and NVIDIA models are used

Every model call runs server-side in a Vercel function against the **Nebius Token Factory** OpenAI-compatible API. Keys never reach the browser. The model behind each role is resolved at start-up from Token Factory's live `/v1/models` list, and `/api/status` reports which provider and model ids are serving right now. Each answer and each Short names the models that produced it.

| Job | Role | Model family | Code |
|---|---|---|---|
| Short writer: six beats, one claim and one numbered source per beat, a camera shot from a fixed list | agent | Nemotron 3 Super | `api/short.ts` |
| Short checker: reads each claim beside its source text and returns supported, partly or unsupported | fast | Nemotron 3.5 Lightning / Nano | `api/short.ts` |
| Globe agent: picks tools, writes the cited answer, moves the camera | agent | Nemotron 3 Super | `api/ask.ts` |
| Build architect and parallel builders | agent | Nemotron 3 Super | `api/construct.ts` |
| Build critic: render beside a real photo, part-level fixes | vision | Nemotron 3.5 Super VL | `api/construct.ts` |

Two models, two jobs: the checker never sees the writer's reasoning, only the claim and the source.

### Guardrails that live in code

- **No claim without a source.** A beat whose claim the checker marks unsupported is cut before the viewer sees it. The script reports how many claims were checked and how many were cut.
- **The official record wins.** For a live event the USGS or NASA EONET record is source 0, and the writer is told to prefer it over the web.
- **The model never places the camera.** It picks a shot type and a named focus; the server geocodes the focus and drops anything more than 3,000 km from the subject.
- **Honest wording for live data.** EONET events are "open in NASA EONET" with a last-observed date, never "burning right now"; prescribed burns are left out.
- **Actions report what will happen,** never what already did, and the agent cannot claim a flight to a place the geocoder could not find.

### Tavily

Tavily Search runs at runtime for every Short (two queries: the event or place, and its background), for the globe agent's `web_search` tool, and for Build's research step.

### Reliability

Calls time out (22 s for short replies, 120 s for long JSON) and fail over through up to six live Nemotron ids for the same role. A model that returns 429 is skipped for 15 minutes. Nemotron's thinking mode is off by default because ATLAS needs fast structured output. If a live Build fails for Charminar, ATLAS shows a saved build, labelled with its date.

---

## Why the footage is rendered in Google Earth

The globe streams Google Photorealistic 3D Tiles. Google's Map Tiles policy allows those tiles to be shown inside an app, and allows only short promotional video of them. Google Earth and Earth Studio content, on the other hand, may be used in online video, monetised included, with attribution. So ATLAS never records or exports Google's 3D tiles: it exports a Google Earth tour, and the creator renders the footage in Google Earth Pro (Tools, Movie Maker) with the attribution in frame.

---

## Built for this hackathon

The repository was created on 21 Oct 2026 for this hackathon and every commit dates from then. The exploded-view idea grew out of my earlier project [JAMES](https://github.com/victorisaacchinta-eng/james) (1st prize, AgentX-2026). ATLAS Live is a separate codebase.

---

## Feedback on the tools

**Nebius Token Factory**
- *Used for:* every model call: Short writer, Short checker, globe agent, Build.
- *Worked:* the OpenAI-compatible API meant the provider layer needed only a base URL and a key. `/v1/models` let ATLAS resolve live model ids at start-up instead of hard-coding them.
- *Needs work:* onboarding. Billing asks for a Visa or Mastercard for a $0 check even when promo credits are applied, and Indian RuPay cards are rejected. Support (case AISTUDIOSUP-2312) and the Discord confirmed there is no card-free route. Builders from India, Pakistan and Nigeria reported the same wall on the forum. The hackathon activation code also looks like a promo code but is entered on a separate form, which is easy to miss. The quickstart shows one base URL while my account's dashboard showed a regional one (`us-central1`).
- *Zero to hello world:* a few minutes once a supported card is on file. Getting to that card took me about a week.
- *Would I use it again:* yes, for open-model inference with one API across Nemotron sizes.

**NVIDIA Nemotron**
- *Used for:* writing, fact-checking, tool calling, structured 3D modelling and visual critique.
- *Worked:* tool calling is dependable across an 11-tool set, and a small fast model is a good strict checker when it only has to read one claim and one source at a time.
- *Needs work:* thinking is on by default and long JSON answers can take minutes, so ATLAS disables it per request. During development the VL endpoint rejected a second image in one message, so the Build critic receives one composed image. In Build the models know facts about a building far better than its geometry: the critic averages about 4/10 on proportions.
- *Would I use it again:* yes.

**Tavily**
- *Used for:* runtime web search behind every Short and every cited answer.
- *Worked:* fast, clean results with URLs and readable content, and the free tier covered all development.
- *Needs work:* nothing blocking.
- *Would I use it again:* yes.

---

## Limitations, published on purpose

1. **The checker is a model.** It judges claims only against the source text it is shown, which catches invented numbers and dates but cannot catch a source that is itself wrong. The script links every source so the creator can check.
2. **Signals:** earthquakes are M2.5+ for the past 7 days; EONET wildfires are mostly in the US. Exploratory data, not for safety decisions.
3. **Google Earth step:** the tour opens in Google Earth Pro; rendering and voicing the final video is still the creator's job.
4. **Build likeness:** recognisable shapes, rough proportions, 80 to 150 s per build.
5. **One real user so far:** me. No outside creators have tried it yet.
6. **Google's terms:** 3D tiles are display only in the app, never cached, extracted or recorded, and attribution stays on screen.

---

## Run it

```bash
npm install
cp .env.example .env   # NEBIUS_API_KEY, TOKEN_FACTORY_URL, TAVILY_API_KEY, CESIUM_ION_TOKEN
npx vercel dev         # app plus the /api functions
```

`?lab=1` shows the experimental Library (explodable NASA models) and Scan (webcam object to 3D) modes.

## Stack

Vite, TypeScript, three.js 0.185, `3d-tiles-renderer`, JSZip, MediaPipe, transformers.js, Vercel Functions.

## Credits

- Google Photorealistic 3D Tiles via Cesium ion.
- Live data: USGS Earthquake Hazards Program, NASA EONET, Open-Meteo (CC BY 4.0). Place search © OpenStreetMap contributors (Nominatim).
- 3D models: see `public/models/NOTICE.md` (NASA public domain; Khronos sample assets CC BY 4.0).
- Splat sources: Wikimedia Commons contributors, credited per file in `public/splats/`.
- Depth Anything V2 Small (Apache-2.0).
- Fonts: Science Gothic, Mona Sans, Monaspace Krypton (SIL OFL 1.1).

## Licence

MIT, see `LICENSE`.
