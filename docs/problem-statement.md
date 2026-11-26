# Nayan: problem statement (revised 24 Nov 2026, after the independent audit)

**Status:** hypothesis, pending user and technical validation. Not yet validated with real users.
**Decided by Victor on 24 Nov:** first user is the construction site supervisor near our campus (Medchal-Malkajgiri, Hyderabad, Ranga Reddy, Sangareddy); languages are Telugu, Hindi and English; "Check a forward" stays, marked experimental.
**Rule for this document:** every number has a source link. Our own measurements say so. Anything not measured is labelled hypothesis, assumption or illustration.

---

## 1. One line

When IMD or a state authority warns a district through SACHET, the site supervisor who has to warn the crew receives a short English alert with no site-level guidance, while the crew may read Telugu, Hindi or neither. Nayan turns that one official alert into a checked crew announcement in their language, with the source attached and a record that it was given.

## 2. The one job

> "When an official warning covers my site's district, help me understand where, when and what it means, then tell my crew accurately in a language they understand, and keep a record that I did."

Checking forwarded messages is a separate, experimental job. It is not part of this core loop.

## 3. What we know (verified)

### The alert system exists. Delivery is not the same as understanding.
- SACHET runs in all 36 states and UTs, is based on the Common Alerting Protocol, and has disseminated more than 134 billion SMS alerts in 19+ languages ([PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2257102)). That is a count of messages sent, not of people reached, alerts understood or actions taken.
- Cell Broadcast was launched nationwide on 2 May 2026 ([PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2257499)).
- SACHET's integration guide requires every consuming system to cache each CAP document with its ETag and send `If-None-Match` ([guide](https://sachet.ndma.gov.in/docs/Integration_Guide_For_Agencies.pdf)). Nayan now does.

### What the alerts actually say (our measurement, 24 Nov 2026)
We saved SACHET's all-India RSS index and all 100 CAP documents it listed at 11:05 IST (sent 20 to 24 Nov). Raw files: `data/cap/` in the repo.
- 60 of 100 were English only. 40 also carried a regional-language block (Odia 14, Bengali 12, Telugu 10, Hindi 3, Marathi 1).
- 81 carried `LGD District Code` geocodes; 19 did not. Ten of those 19 were Andhra Pradesh SDMA alerts for individual mandals, so they cover part of a district.
- 96 had an empty `description`. The `instruction` field almost always reads "Please follow SDMA guidelines."
- 24 headlines used short forms (`kmph`, `TS`, `TSL`).
- Example, IMD Chennai, 24 Nov: "Light to moderate Rain with TSL is likely to occur at isolated places over Cpattu, Chennai, Clore, ... Karaikal, Pondicherry in next 3 hours." TSL means thunderstorm and lightning; Cpattu is Chengalpattu. The headline also names Karaikal and Pondicherry, which are not in this alert's own area list (a separate Puducherry alert covers them).
- 64 of 100 were `Update` messages; each referenced an earlier version of the same alert.

### Official safety guidance exists, and already asks employers to do this
- NDMA publishes Do's & Don'ts for 18 hazards in 14 languages on SACHET, including Telugu and Hindi ([SACHET](https://sachet.ndma.gov.in/DosDont); site version 3.2.1, last updated 15 Oct 2026).
- NDMA's heat wave guidance has an "Employers and Workers" section. Its last line: "Notify workers about heat wave alerts." This is the supervisor's job that Nayan supports.
- Some official Telugu lines change the meaning (pending native-speaker confirmation): the lightning "30-30 rule" renders "clap of thunder" as చప్పట్లు (clapping of hands), and the heat wave line on pregnant workers reads as if they should take extra care themselves rather than be given extra attention. Nayan shows the official line, flags it, and shows the English beside it. It does not rewrite official text.

### The hazards that kill outdoor workers
- In 2023, forces of nature killed 6,444 people in India. Lightning caused 2,560 of these deaths (39.7%) and heat or sun stroke 804 (12.5%) ([NCRB ADSI 2023, Table 1.5](https://data.opencity.in/dataset/8b927e9c-a5b1-4f7b-abc5-4f34dd46b955/resource/9c820168-6556-4717-b7d1-3c0bf74f82b1/download/table15allindia.pdf)).
- In Telangana, heat or sun stroke caused 85 of the 137 forces-of-nature deaths in 2023 (62%) ([Down To Earth, from NCRB](https://www.downtoearth.org.in/natural-disasters/lightning-strikes-took-over-2500-lives-in-2023-ncrb-data)).
- Extreme weather hit India on 251 of the 273 days from January to September 2026 (92%), with 3,220 deaths ([CSE, Climate India 2026, 4 Nov 2026](https://www.cseindia.org/cse-and-down-to-earth-s-climate-india-2026-report-on-extreme-weather-events-released-13326)). The 2025 edition reported 99% of days and 4,064 deaths for the same months.
- In the pilot district itself: on 7 May 2024, after heavy rain, the retaining wall of an under-construction apartment in Bachupally (Medchal-Malkajgiri) collapsed onto the sheds where its workers slept, killing seven migrant workers from Odisha and Chhattisgarh ([Telangana Today](https://telanganatoday.com/seven-people-including-child-killed-in-wall-collapse-at-bachupally); [Siasat](https://www.siasat.com/hyderabad-rains-7-workers-die-after-wall-collapses-at-bachupally-3022367/amp/)). We do not know whether a warning was issued or received; we use this only to show that weather risk on sites includes where crews sleep.

### The workforce
- Construction employed 12% of India's workers in 2023-24 (PLFS, usual status; [Ministry of Labour reply, 12 Dec 2024](https://dge.gov.in/dge/sites/default/files/2025-05/2005_e.pdf)).
- Telangana's construction welfare board had 14.83 lakh registered workers; 3.34 lakh (22%) had not renewed as of June 2023 ([CAG Report No. 5 of 2024](https://saiindia.gov.in/uploads/download_audit_report/2024/Report-of-the-Comptroller-and-Auditor-General-of-India-on-Welfare-of-Building-and-Other-Construction-Workers-for-the-year-ended-March-2022_English-069ca258d72fd18.11391005.pdf)).
- There is no conclusive count of migrant workers in Telangana. Estimates range from 5 to 6 lakh (state labour department) to 8 to 10 lakh before the pandemic; Hyderabad's labour addas are frequented by migrants from Bihar, Uttar Pradesh, West Bengal, Odisha and Jharkhand (The Hindu, via [inkl](https://inkl.com/news/the-death-and-disappearance-of-migrant-workers) and [this report](https://webjosh.com/article/the-construction-worker-conundrum-premium-1724008265-16146)).
- Language is already a documented barrier on these sites: Human Rights Forum fact-findings found contractors in Hyderabad and Ranga Reddy failing to keep worker passbooks in a language the workers understand, as Section 23 of the Inter-State Migrant Workmen Act requires ([Countercurrents, 2025](https://countercurrents.org/2025/05/the-silent-struggles-of-migrant-workers-in-hyderabads-construction-boom)).
- Context only: 10.6% of Indians reported English as a first, second or third language in Census 2011. This does not measure our pilot crews.

## 4. What we do not know yet (to test, not to claim)
1. Do supervisors receive SACHET SMS or Cell Broadcast alerts, and what do they do today when one arrives?
2. Is comprehension the bottleneck, or is it reach, authority, time or trust?
3. Which languages do the crews read, speak and prefer for safety instructions? These can be three different answers. Is Hindi a working link language for migrant crews from Odisha and Jharkhand, or do they need Odia and others?
4. Literacy and phones on the crew side. The supervisor is assumed to have a smartphone; this is an assumption.
5. Who is allowed to stop work or move people: the supervisor, the contractor, the site safety officer? Nayan must never imply that it decides this.
6. Will crews trust and act on a message from their supervisor? We measure trust; we do not assume it.

## 5. User
- **Primary:** the construction site supervisor (site engineer, foreman or labour contractor's supervisor) on sites near the ACE campus. Already gives toolbox talks; accountable for the crew.
- **Beneficiaries:** the crew, local Telugu-speaking workers and migrant workers.
- **Not the first user:** Aapda Mitra volunteers (Direction A) and newsrooms (Direction C). Kept for later.
- **Illustration, not evidence:** a supervisor on a Medchal-Malkajgiri site gets an IMD Hyderabad thunderstorm alert at 6 am. Nayan shows that his district is covered, until when, what NDMA says workers should do, and a Telugu and Hindi message he checks, reads out and logs.

## 6. What is built now (prototype on the `nayan` branch)
Mapped to the audit's P0 list:
1. **Real official alerts:** SACHET's RSS index and CAP documents, with ETag caching, expiry, updates and dedup. A failed feed is shown as failed, never as "no alerts", and the time SACHET was last read is always visible.
2. **Provenance:** every card shows the alert as issued (headline, regional-language text, area, LGD codes with their code system, sender, sent, effective, onset, expires, instruction, identifier) beside the plain version, with a link to the CAP XML. Raw records are kept in `data/cap/`.
3. **No invented values:** empty fields show "not specified". Districts read from text instead of codes are flagged. Mandal-level alerts are flagged as covering part of a district. Headline places outside the area list are flagged.
4. **Plain card by code:** short forms expanded from a fixed list; district short forms expanded only against the alert's own list; What, Where and When written from a fixed glossary of IMD phrases. Every change is listed.
5. **Official guidance, cited separately:** NDMA's own lines from SACHET, verbatim in Telugu, Hindi and English, labelled "official safety guidance, not part of this alert", with the source file and retrieval date. Heavy rain maps to urban flood guidance and says so.
6. **Three languages with a human check:** the crew message (WhatsApp, SMS with segment count, read-aloud script) is locked until the supervisor ticks that it was read against the alert.
7. **Source and time in every message,** plus "This explains an official alert. Nayan does not issue warnings."
8. **Communication log:** who was told, when, in which language and how; CSV export; kept on the device.

Also: **practice mode** with eight real, expired SACHET alerts (including IMD Hyderabad's 20 Nov Telangana thunderstorm alert) for drills; **Check a forward**, experimental, answering only "match", "partial match", "no match in the sources checked" or "unable to verify", with the sources and check time; **Learn**, keeping IMD colour codes apart from CAP fields; the **3D globe** as an overview only.

**Cut:** Build, Library, Scan, the 60-second Short, 22-language claims, voice for 22 languages, IVR.

## 7. Where AI is used, and where it is not
- **No AI:** the alert card, the guidance and the crew message. They work when every model is down.
- **AI:** Check a forward (a model reads the forward or screenshot and labels each claim against the re-read official alert; code decides the verdict). Voice note (machine text-to-speech, offered only after the text is checked, labelled as machine voice).
- Voice for Indian languages: AI4Bharat's Indic Parler-TTS officially covers 21 languages (20 Indic plus English); its model card recommends Indic-Speak for 22 Indian languages ([model card](https://huggingface.co/ai4bharat/indic-parler-tts)). Not used yet.

## 8. Safety rules
Source-of-truth order (from the audit): the issuing authority's alert, then official updates or local instructions, then NDMA guidance, then Nayan's rendering, then the supervisor's own notes. Model output is never a safety fact.
- Nayan never calls a forward fake, never says "no alerts" when it could not read SACHET, never fills a missing field, and never implies NDMA endorsement.
- Privacy: no accounts; the site and the log stay on the device. A forward checked by "Check a forward" is sent to the model provider for that one check; Nayan stores nothing on its server.
- **Update/cancellation follow-up:** the prototype now reads SACHET Update and Cancel CAP entries, matches their exact references to alerts marked as shared in the local log, and offers a reviewable message plus a follow-up log entry. A cancellation is explicitly not described as an all-clear. Notices are retained in that browser after a successful feed refresh; Nayan cannot guarantee catching an item that disappears from SACHET's feed before a later refresh, and it does not send push notifications. Hindi and Telugu wording needs native-speaker review.
- The Disaster Management Act's Section 54 is not used as a claim or a threat.

## 9. Metrics (defined, to be measured; nothing measured yet)
- **Dangerous misreadings (primary safety metric):** in a scenario test, the number of people who choose a wrong or unsafe action after reading Nayan's message, against the raw SMS.
- **Comprehension:** share who correctly state the hazard, the place, the time window and the NDMA action, raw SMS against Nayan's message, per language.
- **Time to a checked message:** from opening an alert to the review tick, median and 90th percentile, in the pilot.
- **Unsupported lines:** per shared message, lines a reviewer cannot trace to the alert, NDMA guidance or the glossary. Target 0.
- **Check a forward:** on a labelled set with adversarial cases (old real alerts, edited screenshots, wrong district, mixed real and fake), the false-reassurance rate (a wrong "match") and the abstention rate.
- **Use:** in the pilot, the share of alerts covering the site that the supervisor logged as told.

## 10. Validation plan (25 Nov to 17 Dec)
- **25 Nov:** Level 1 submission with this hypothesis, the prototype and this plan.
- **26 to 30 Nov:** 5 supervisors and 5 workers on sites near campus. Ask about the last real alert, not a hypothetical one. Record devices, languages, who decides.
- **By 7 Dec:** native-speaker review of every Telugu and Hindi string, glossary term and flagged NDMA line (`data/REVIEW.md`).
- **By 12 Dec:** comprehension test (about 20 people, split by language) with a practice alert, raw SMS against Nayan's message; count dangerous misreadings.
- **By 15 Dec:** failure tests: SACHET down, stale copy, updated alert, cancellation, edited forward.
- **17 Dec baseline freeze:** proceed, narrow, pivot or stop, decided on that evidence.

## 11. Business (hypothesis, no traction claimed)
- Free for supervisors.
- Possible payers: builders and contractors who need a record that crews were warned (safety compliance), and their site safety teams. To test: who owns the budget, and whether the log is worth paying for.
- Possible channels: builder associations and the Telangana construction welfare board's worker programmes. No contact made yet.

## 12. What changed after the audit
| Audit point | Change |
|---|---|
| "Delivery is largely solved" | Removed. SMS totals described as messages sent, not people reached. |
| Puri study, Phailin, Kerala migrants | Removed from the core case; they do not describe our user. |
| CSE 2026 update | Used (92% of days, 3,220 deaths, Jan to Sep 2026). |
| 22 languages, Parler-TTS count | Cut to Telugu, Hindi, English; TTS count corrected to 21, Indic-Speak noted. |
| LGD claim unproven | Measured: 81 of 100 records carry LGD codes; text-derived districts are flagged. |
| Three jobs in one | One job; Check a forward is a separate experiment. |
| "Add nothing" contradiction | Replaced by provenance: alert facts, NDMA guidance and Nayan's rendering are labelled separately. |
| Guidance governance | Official NDMA text only, verbatim, with source and date; no Nayan-written safety advice. |
| Verify taxonomy | Four results only, with sources and check time; never "fake". |
| Feed down shown as "no alerts" | Fixed in code and UI. |
| Globe as primary | Globe is an overview; the desk works without it. |
| "Most severe first" | Lists sort by issue time; severity, urgency and certainty shown as separate fields. |
| IMD colours merged with CAP | Kept apart in Learn. |
| Short and video | Cut from the product. |
| Privacy missing | Section 8. |
| Metrics | Defined, with a safety metric and a false-reassurance rate. |
| Section 54 | Not used. |
| No endorsement | Stated in every message and in the app. |

## Sources
PIB (SACHET status; Cell Broadcast launch) · SACHET RSS integration guide · SACHET Do's & Don'ts and their JSON files (`data/ndma/`) · our SACHET feed snapshot (`data/cap/`) · NCRB ADSI 2023, Table 1.5 · Down To Earth on NCRB 2023 · CSE Climate India 2026 · Ministry of Labour Rajya Sabha reply No. 2005 (PLFS 2023-24) · CAG Report No. 5 of 2024 (Telangana BOCW) · The Hindu on migrant workers in Telangana · Countercurrents (HRF fact-finding, 2025) · Telangana Today and Siasat on Bachupally (8 May 2024) · Census 2011 language table · AI4Bharat Indic Parler-TTS model card · OASIS CAP 1.2 · IMD colour code graphic (PIB, 27 Apr 2021).
