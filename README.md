# Nayan (नयन)

**Official Indian disaster alerts, explained in your language, without adding a word the alert did not say.**

Team Ace Azael, ACE Engineering College, Hyderabad. HackWithAditya 2026, track 01: AI for Bharat.

## The problem

When a cyclone, flood or heavy-rain warning goes out, the official alert (NDMA SACHET) reaches people as short text, often in one language. What spreads faster is unverified video. Regional explainer creators, local news pages and district information officers need a clear, map-led explainer in the local language within the hour, and it has to say only what the official alert says.

## What Nayan does

1. **Reads the official record.** The server pulls the NDMA SACHET public RSS index and each alert's CAP 1.2 document (`api/_sachet.ts`).
2. **Puts each alert on the map.** CAP areas carry LGD district codes, not shapes, so `api/_lgd.ts` maps 763 LGD districts to points (Census 2011 boundaries for older districts, OpenStreetMap for newer ones). Alerts without codes fall back to district names in the text, then geocoded place names, then the state centre.
3. **Writes a Short in any of 23 languages**: the 22 Eighth Schedule languages plus English (`api/short.ts`, `api/_langs.ts`). The research step re-reads the CAP document on the server, so the facts never come from the browser.
4. **Checks itself.** A separate checker confirms that the local-language line says no more than the checked English claim. Quotes must appear in the source, in order.
5. **Speaks it.** AI voice in the languages Gemini TTS supports, labelled AI-generated, with beats retimed to the voice (`api/voice.ts`).
6. **Works for everyone using it.** A language menu switches the whole interface, with Noto fonts per script and correct `lang` and `dir` tags for screen readers.

The globe also shows live USGS earthquakes and NASA EONET natural events, each with its source and last update.

## Honest limits

- Some languages have no AI voice yet.
- The India layer takes several seconds on a cold load.
- Free-tier models get overloaded at peak; the server time-boxes each model and falls back.
- The rule that a beat without a declared claim may not carry facts is enforced by the writer prompt, not yet by code.

## Run it

```bash
npm install
cp .env.example .env   # set GEMINI_API_KEY (or another provider key)
npx vercel dev         # the API lives in Vercel Functions under /api
```

Keys stay on the server. `/api/status` reports which provider and models are live.

## Stack

TypeScript, Vite, three.js, Vercel Functions (Mumbai region), NDMA SACHET RSS and CAP 1.2, LGD district codes, Census 2011 and OpenStreetMap, Google Gemini for writing, checking and translation, Gemini TTS, Noto fonts.

## How it was built

Built by team Ace Azael on top of Victor Isaac's earlier ATLAS Live globe (this repository's `main` history, from 21 Oct 2026). We used AI coding assistants to help write and review code; the team designed the product, chose every guardrail and verified the results.

## License

See [LICENSE](LICENSE).
