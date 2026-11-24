# Evidence files

Raw sources behind Nayan, kept so every fact the app shows can be traced.

## `cap/`
- `rss_india_2026-11-24T1105IST.xml`: SACHET's all-India RSS index as read on 24 Nov 2026, 11:05 IST (100 items).
- `feed_2026-11-24/<id>.xml`: the CAP 1.2 document behind each of those 100 items, fetched once from
  `https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=<id>`.
- `cap_<id>.xml`: the three alerts that were in force at that time.

What the 100 records show (counted by script, 24 Nov 2026):
- 81 carry `LGD District Code` geocodes; 19 do not (10 of them Andhra Pradesh SDMA mandal-level alerts).
- 60 are English only; 40 also carry a regional-language block (Odia 14, Bengali 12, Telugu 10, Hindi 3, Marathi 1).
- 64 are `Update` messages; each references an earlier version of the same alert.
- 96 have an empty `description`; 6 have an empty `instruction`; the rest mostly say "Please follow SDMA guidelines."
- 24 headlines use short forms (`kmph`, `TS`, `TSL`).

`public/practice.json` is built from eight of these records for practice mode. They have expired.

## `ndma/`
NDMA's Do's & Don'ts as published on SACHET (`https://sachet.ndma.gov.in/locales/<lang>/<Hazard>Dosdont.json`),
for ten hazards in English, Hindi and Telugu, retrieved 24 Nov 2026 (site version V 3.2.1, last updated 15 Oct 2026).
`src/desk/ndma.ts` is generated from these files; every line Nayan shows is copied verbatim.
