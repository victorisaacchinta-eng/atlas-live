# Language review before the pilot

Nayan's Hindi and Telugu come from three places. Each needs a native speaker's sign-off.

| What | Where | Status |
|---|---|---|
| NDMA's own Do's & Don'ts | `data/ndma/`, shown verbatim | Official text. Two Telugu lines flagged in the app where the official translation changes the meaning (Lightning 30-30 rule: "చప్పట్లు"; Heat wave, pregnant workers). Confirm. |
| IMD phrase glossary (hazards, "at isolated places", "in next N hours") | `src/desk/explain.ts` (`HAZARDS`, `SPREAD`, `CHANCE`) | Draft. Review every Hindi and Telugu term. |
| Interface strings | `src/desk/strings.ts` | Draft. Review. |
| CAP term meanings | `src/desk/explain.ts` (`CAP`) | Draft translation of the OASIS CAP 1.2 definitions. Review. |

How to review: open the app with `?view=learn`, switch to हि or తె, and read every screen; then open each
practice alert and read the crew message in all three formats. Note any line a site worker would misread.
