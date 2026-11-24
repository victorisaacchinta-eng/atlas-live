# Nayan (नयन · నయన)

**When an official weather warning covers your site, Nayan helps you tell your crew what it means, in Telugu, Hindi or English, with the source attached and a record that you did.**

Team Ace Azael, ACE Engineering College, Hyderabad. HackWithAditya 2026, track 01: AI for Bharat.

> Status: a prototype and a hypothesis. We have not yet tested it with site supervisors. The plan to do that is below.

## Who it is for

A construction site supervisor near our campus (Medchal-Malkajgiri, Hyderabad, Ranga Reddy, Sangareddy) who has to warn a crew of local and migrant workers when IMD or the state disaster authority issues a warning.

## The problem, in numbers we checked

- India's official alerts (NDMA SACHET, Common Alerting Protocol) reach every state, but we read all 100 alerts in SACHET's feed on 24 Nov 2026: 60 were English only, 96 had no description, the instruction almost always said "Please follow SDMA guidelines", and 24 headlines used short forms like `TSL` (thunderstorm and lightning). Raw files: [`data/cap/`](data/cap/).
- Lightning killed 2,560 people in India in 2023 and heat stroke 804 (NCRB, Accidental Deaths and Suicides in India 2023, Table 1.5). In Telangana, heat stroke caused 85 of 137 forces-of-nature deaths that year.
- NDMA's own heat wave guidance tells employers to "Notify workers about heat wave alerts." Nayan is built for exactly that job.
- On 7 May 2024, after heavy rain, a retaining wall at an under-construction apartment in Bachupally (Medchal-Malkajgiri) fell on the workers' sheds and killed seven migrant workers from Odisha and Chhattisgarh.

Full problem statement, sources and open questions: [`docs/problem-statement.md`](docs/problem-statement.md).

## What it does

1. **Your site.** Pick the district once (763 LGD districts) and the languages your crew understands. Stored on your phone only.
2. **Alerts for your district.** Read live from SACHET's RSS feed and CAP documents, with the time SACHET was last read. If SACHET is down, Nayan says so; it never shows "no alerts" when it could not check.
3. **The alert, as issued and in plain words.** The official record (headline, Telugu or other regional text, area, LGD codes, times, instruction) sits beside the plain version. Every change is listed (`TSL → thunderstorm and lightning`, `Cpattu → Chengalpattu`). Missing fields say "not specified". Places in the headline that are outside the alert's area are flagged.
4. **What to do.** NDMA's own Do's & Don'ts from SACHET, word for word, in Telugu, Hindi and English, marked as official guidance and not as part of the alert. Where an official Telugu line changes the meaning, Nayan flags it and shows the English beside it.
5. **A message for your crew.** WhatsApp text, SMS (with the real segment count) and a read-aloud script. It stays locked until you tick that you checked it against the alert. Every message carries the source, the time and "Nayan does not issue warnings."
6. **A log.** Mark an alert as told: when, in which language, how, to how many workers. Export it as CSV for your safety records.
7. **Practice.** Eight real SACHET alerts saved on 24 Nov 2026, now expired, for drills when nothing is live.
8. **Check a forward (experimental).** Paste a WhatsApp warning or a screenshot. Nayan answers only "matches", "partly matches", "no match in the sources checked" or "unable to verify", shows which sources it checked and when, and never calls anything fake.
9. **Learn.** IMD's colour codes and the three CAP fields (severity, urgency, certainty), kept apart.

The 3D globe behind the desk is an overview of the alerts in force. Everything works without it.

## Where AI is used

- **Not used:** the alert card, the safety steps and the crew message. They are built by code from the official record, NDMA's text and a fixed glossary, so they work when every model is down.
- **Used:** Check a forward (a model reads the forward and labels each claim against the official alert, which the server re-reads from SACHET; code decides the result) and the optional voice note (machine text-to-speech, offered only after the text is checked, labelled as a machine voice).

## Data and sources

- NDMA SACHET RSS and CAP 1.2 documents, read with ETag caching as SACHET's integration guide requires (`api/_sachet.ts`).
- LGD district codes (`api/_lgd.ts`).
- NDMA Do's & Don'ts JSON files from SACHET, en/hi/te, saved in [`data/ndma/`](data/ndma/); the app's copy is generated from them (`src/desk/ndma.ts`).
- What every evidence file is: [`data/README.md`](data/README.md).

## Honest limits

- Not yet tested with supervisors or workers. Interviews, a comprehension test and native-speaker review come next.
- Hindi and Telugu interface text and the glossary are drafts awaiting native-speaker review ([`data/REVIEW.md`](data/REVIEW.md)).
- District names stay in English letters inside Hindi and Telugu messages.
- If an alert is updated or cancelled after you shared it, Nayan does not yet tell you.
- Check a forward only knows alerts in force on SACHET; it cannot see district WhatsApp groups, local announcements or expired alerts.

## Run it

```bash
npm install
cp .env.example .env   # a model key is needed only for Check a forward and the voice note
npx vercel dev         # the API runs as Vercel Functions under /api
```

## Stack

TypeScript, Vite, three.js, Vercel Functions, NDMA SACHET (RSS, CAP 1.2), LGD codes, NDMA Do's & Don'ts, Google Gemini (Check a forward, voice), Noto Sans Telugu and Devanagari.

## How it was built

Built by team Ace Azael on top of Victor Isaac's earlier ATLAS Live globe (this repository's `main` history, from 21 Oct 2026). We used AI coding assistants to help write and review code; the team chose the problem, the user and every guardrail, and checks the results.

## License

See [LICENSE](LICENSE).
