/**
 * The plain alert, built by code alone. Nothing in this file calls a language model.
 *
 * - Short forms come from a fixed list of IMD abbreviations.
 * - District short forms ("Cpattu") are expanded only against the alert's own district list.
 * - The hazard, the spread ("at isolated places") and the time window ("in next 3 hours") are read
 *   from IMD's standard phrasing and written in Hindi or Telugu from a fixed glossary. A phrase the
 *   glossary does not know is left out of the summary and stays in the official text.
 * - Safety steps are NDMA's own published lines (ndma.ts), picked, never rewritten.
 * Every change is recorded so the card can show what Nayan did to the official words.
 */
import type { Signal } from '../signals';
import { tr, type DLang } from './strings';
import { NDMA, type GItem } from './ndma';

// ---------------------------------------------------------------------------------------------
// Short forms and district names
// ---------------------------------------------------------------------------------------------

/** Short forms IMD uses to fit an alert into one SMS. Only unambiguous ones. */
export const ABBREV: [RegExp, string, string][] = [
  [/\bTSL\b/g, 'thunderstorm and lightning', 'TSL'],
  [/\bTS\b/g, 'thunderstorm', 'TS'],
  [/\bLtng\b/gi, 'lightning', 'Ltng'],
  [/\bExtr?y?\.?\s?Hvy\b/gi, 'extremely heavy', 'Extr Hvy'],
  [/\bV\.?\s?Hvy\b/gi, 'very heavy', 'V Hvy'],
  [/\bHvy\b/gi, 'heavy', 'Hvy'],
  [/\bRF\b/g, 'rainfall', 'RF'],
  [/\bkmph\b/gi, 'km per hour', 'kmph'],
  [/\bhrs\b/gi, 'hours', 'hrs'],
];

export interface Change { kind: 'abbrev' | 'district'; from: string; to: string }

const isSubsequence = (short: string, long: string) => { let i = 0; for (const ch of long) if (ch === short[i]) i++; return i === short.length; };
const key = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');

/** District names this alert itself uses: its LGD list plus the names written in its area. */
export function areaNames(s: Signal): string[] {
  const fromArea = (s.area ?? '').replace(/\s+districts? of\s+.+$/i, '').split(/,|\band\b/).map((x) => x.trim()).filter((x) => x.length >= 3 && /^[A-Za-z .-]+$/.test(x));
  return [...new Set([...(s.districts ?? []), ...fromArea])];
}

/**
 * "Cpattu" -> "Chengalpattu". A capitalised word is replaced only when exactly one of the alert's own
 * district names matches it: as a prefix, or with its letters in order and the same first and last letter.
 */
export function expandDistricts(text: string, names: string[]): { text: string; changes: Change[] } {
  const list = names.map((d) => ({ full: d, k: key(d) })).filter((d) => d.k.length >= 4);
  const changes: Change[] = [];
  // Names already written in full ("Bhadradri Kothagudem") are set aside first, so their first word
  // is never read as a short form of themselves.
  const kept: string[] = [];
  let work = text;
  for (const d of [...list].filter((x) => /\s/.test(x.full)).sort((a, b) => b.full.length - a.full.length)) {
    const re = new RegExp(`\\b${d.full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'gi');
    work = work.replace(re, (m) => { kept.push(m); return `\u0001${kept.length - 1}\u0002`; });
  }
  const out = work.replace(/\b[A-Z][a-z]{3,}\b/g, (w) => {
    const k = w.toLowerCase();
    if (list.some((d) => d.k === k)) return w;
    const hits = [...new Map(list.filter((d) => d.k.length > k.length && d.k[0] === k[0] && (d.k.startsWith(k) || (d.k.at(-1) === k.at(-1) && isSubsequence(k, d.k)))).map((d) => [d.k, d])).values()];
    if (hits.length !== 1) return w;
    if (!changes.some((c) => c.from === w)) changes.push({ kind: 'district', from: w, to: hits[0].full });
    return hits[0].full;
  }).replace(/\u0001(\d+)\u0002/g, (_, i) => kept[Number(i)]);
  return { text: out, changes };
}

export function expandAbbrev(text: string): { text: string; changes: Change[] } {
  const changes: Change[] = [];
  let t = text;
  for (const [re, full] of ABBREV) t = t.replace(re, (m) => { if (!changes.some((c) => c.from === m)) changes.push({ kind: 'abbrev', from: m, to: full }); return full; });
  return { text: t, changes };
}

/** The official English headline with short forms expanded, and the list of what changed. */
export function plainHeadline(s: Signal) {
  const en = (s.texts ?? []).find((x) => /^en/i.test(x.lang)) ?? s.texts?.[0];
  const raw = (en?.headline || s.title || '').replace(/\s+/g, ' ').trim();
  const a = expandAbbrev(raw);
  const d = expandDistricts(a.text, areaNames(s));
  const text = d.text.replace(/\s+([,.])/g, '$1').trim();
  return { raw, text, changes: [...a.changes, ...d.changes] };
}

/** Places the headline names that are not in this alert's own area list (only when that list is authoritative). */
export function placesOutside(s: Signal, plain: string): string[] {
  if (s.districtSource !== 'lgd') return [];
  const m = plain.match(/\bover\s+(.+?)(?:\s+(?:in|during|within)\s+(?:the\s+)?next\b|\.\s|$)/i);
  if (!m) return [];
  const inArea = new Set(areaNames(s).map(key));
  return m[1].split(/,|\band\b/).map((x) => x.trim().replace(/\.$/, '')).filter((x) => /^[A-Z][A-Za-z .-]{2,30}$/.test(x) && !inArea.has(key(x)));
}

// ---------------------------------------------------------------------------------------------
// Glossary: IMD's standard phrases in Hindi and Telugu (draft, under native-speaker review)
// ---------------------------------------------------------------------------------------------

type G = 'lightning' | 'thunderstorm' | 'heat' | 'cold' | 'flood' | 'rain' | 'cyclone' | 'landslide';
interface Phrase { re: RegExp; en: string; hi: string; te: string; g?: G }

export const HAZARDS: Phrase[] = [
  { re: /very heavy to extremely heavy rain(?:fall)?/, en: 'very heavy to extremely heavy rain', hi: 'बहुत भारी से अत्यधिक भारी बारिश', te: 'అతి భారీ నుండి అత్యంత భారీ వర్షం', g: 'rain' },
  { re: /heavy to very heavy rain(?:fall)?/, en: 'heavy to very heavy rain', hi: 'भारी से बहुत भारी बारिश', te: 'భారీ నుండి అతి భారీ వర్షం', g: 'rain' },
  { re: /extremely heavy rain(?:fall)?/, en: 'extremely heavy rain', hi: 'अत्यधिक भारी बारिश', te: 'అత్యంత భారీ వర్షం', g: 'rain' },
  { re: /very heavy rain(?:fall)?/, en: 'very heavy rain', hi: 'बहुत भारी बारिश', te: 'అతి భారీ వర్షం', g: 'rain' },
  { re: /moderate to heavy rain(?:fall)?/, en: 'moderate to heavy rain', hi: 'मध्यम से भारी बारिश', te: 'మోస్తరు నుండి భారీ వర్షం', g: 'rain' },
  { re: /heavy rain(?:fall)?/, en: 'heavy rain', hi: 'भारी बारिश', te: 'భారీ వర్షం', g: 'rain' },
  { re: /light to moderate rain(?:fall)?/, en: 'light to moderate rain', hi: 'हल्की से मध्यम बारिश', te: 'తేలికపాటి నుండి మోస్తరు వర్షం' },
  { re: /moderate rain(?:fall)?/, en: 'moderate rain', hi: 'मध्यम बारिश', te: 'మోస్తరు వర్షం' },
  { re: /light rain(?:fall)?/, en: 'light rain', hi: 'हल्की बारिश', te: 'తేలికపాటి వర్షం' },
  { re: /thunder ?showers?/, en: 'thundershowers', hi: 'गरज के साथ बौछारें', te: 'ఉరుములతో కూడిన జల్లులు', g: 'lightning' },
  { re: /(?:light |moderate |severe )?thunderstorms?(?: accompanied)? (?:with|and) (?:light |moderate |severe )?lightning/, en: 'thunderstorm with lightning', hi: 'गरज-चमक', te: 'ఉరుములు, మెరుపులు', g: 'lightning' },
  { re: /lightning/, en: 'lightning', hi: 'आकाशीय बिजली', te: 'పిడుగులు', g: 'lightning' },
  { re: /(?:light |moderate |severe )?thunderstorms?/, en: 'thunderstorm', hi: 'मेघगर्जन', te: 'ఉరుములు', g: 'thunderstorm' },
  { re: /hail ?storms?|\bhail\b/, en: 'hail', hi: 'ओलावृष्टि', te: 'వడగళ్ళు', g: 'thunderstorm' },
  { re: /squalls?/, en: 'squall', hi: 'तेज़ आंधी', te: 'ఈదురు గాలులు', g: 'thunderstorm' },
  { re: /gusty winds?|strong (?:surface )?winds?|surface winds?/, en: 'gusty winds', hi: 'तेज़ हवाएँ', te: 'ఈదురు గాలులు', g: 'thunderstorm' },
  { re: /dust ?storms?|dust raising winds?/, en: 'dust storm', hi: 'धूल भरी आंधी', te: 'దుమ్ము తుఫాను', g: 'thunderstorm' },
  { re: /severe heat ?wave/, en: 'severe heat wave', hi: 'भीषण लू', te: 'తీవ్ర వడగాలులు', g: 'heat' },
  { re: /heat ?wave/, en: 'heat wave', hi: 'लू', te: 'వడగాలులు', g: 'heat' },
  { re: /hot and humid/, en: 'hot and humid weather', hi: 'गर्म और उमस भरा मौसम', te: 'వేడి, ఉక్కపోత', g: 'heat' },
  { re: /warm night/, en: 'warm night', hi: 'गर्म रात', te: 'వేడి రాత్రి', g: 'heat' },
  { re: /severe cold ?wave/, en: 'severe cold wave', hi: 'भीषण शीतलहर', te: 'తీవ్ర చలిగాలులు', g: 'cold' },
  { re: /cold ?wave/, en: 'cold wave', hi: 'शीतलहर', te: 'చలిగాలులు', g: 'cold' },
  { re: /cold day/, en: 'cold day', hi: 'शीत दिवस', te: 'చలి దినం', g: 'cold' },
  { re: /dense fog/, en: 'dense fog', hi: 'घना कोहरा', te: 'దట్టమైన పొగమంచు' },
  { re: /\bfog\b/, en: 'fog', hi: 'कोहरा', te: 'పొగమంచు' },
  { re: /flash floods?/, en: 'flash flood', hi: 'अचानक बाढ़', te: 'ఆకస్మిక వరదలు', g: 'flood' },
  { re: /floods?|inundation/, en: 'flood', hi: 'बाढ़', te: 'వరదలు', g: 'flood' },
  { re: /cyclon(?:e|ic storm)/, en: 'cyclone', hi: 'चक्रवात', te: 'తుఫాను', g: 'cyclone' },
  { re: /deep depression/, en: 'deep depression', hi: 'गहरा अवदाब', te: 'తీవ్ర వాయుగుండం' },
  { re: /depression/, en: 'depression', hi: 'अवदाब', te: 'వాయుగుండం' },
  { re: /landslides?|landslips?|mudslides?/, en: 'landslide', hi: 'भूस्खलन', te: 'కొండచరియలు విరిగిపడటం', g: 'landslide' },
];

export const SPREAD: Phrase[] = [
  { re: /(?:at )?isolated (?:places|pockets)/, en: 'at isolated places', hi: 'कहीं-कहीं', te: 'అక్కడక్కడ' },
  { re: /(?:at )?a few places/, en: 'at a few places', hi: 'कुछ स्थानों पर', te: 'కొన్ని చోట్ల' },
  { re: /(?:at )?many places/, en: 'at many places', hi: 'अनेक स्थानों पर', te: 'చాలా చోట్ల' },
  { re: /(?:at )?most places/, en: 'at most places', hi: 'अधिकांश स्थानों पर', te: 'దాదాపు అన్ని చోట్ల' },
];

const CHANCE: Phrase[] = [
  { re: /very likely/, en: 'very likely', hi: 'प्रबल संभावना', te: 'ఎక్కువ అవకాశం ఉంది' },
  { re: /\blikely\b/, en: 'likely', hi: 'संभावना है', te: 'అవకాశం ఉంది' },
  { re: /\bpossib(?:le|ility)\b/, en: 'possible', hi: 'हो सकता है', te: 'రావచ్చు' },
];

const NEXT: Record<DLang, string> = { en: 'in the next {n} hours', hi: 'अगले {n} घंटों में', te: 'రాబోయే {n} గంటల్లో' };

/** What the glossary understood in the headline, and which NDMA guidance fits, in order. */
export function readHeadline(plain: string) {
  let t = ` ${plain.toLowerCase()} `;
  const hazards: Phrase[] = [];
  for (const p of HAZARDS) {
    const m = t.match(p.re);
    if (!m) continue;
    // Each word is used once: "very heavy rain" must not also count as "heavy rain".
    t = t.replace(p.re, ' · ');
    if (!hazards.some((x) => x.en === p.en || (x.te === p.te && x.hi === p.hi))) hazards.push(p);
  }
  const spread = SPREAD.find((p) => p.re.test(plain.toLowerCase()));
  const chance = CHANCE.find((p) => p.re.test(plain.toLowerCase()));
  const hours = plain.match(/(?:in|during|within)\s+(?:the\s+)?next\s+(\d{1,3})\s*(?:hours|hrs|hour)/i)?.[1];
  const wind = plain.match(/\((\d{2,3})\s*[-–]\s*(\d{2,3})\s*(?:kmph|km per hour|km\/h)/i);
  const order: G[] = ['cyclone', 'lightning', 'flood', 'rain', 'thunderstorm', 'heat', 'cold', 'landslide'];
  const gs = [...new Set(hazards.map((h) => h.g).filter(Boolean) as G[])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { hazards, spread, chance, hours, wind: wind ? `${wind[1]}-${wind[2]} km/h` : '', guidance: gs };
}

/** NDMA guidance file for a hazard family, and whether it is a direct fit or a related one. */
export const GUIDE_FOR: Record<G, { key: string; related?: boolean }> = {
  lightning: { key: 'Lighting' }, thunderstorm: { key: 'Thunderstorm' }, heat: { key: 'HeatWaves' }, cold: { key: 'ColdWave' },
  flood: { key: 'Floods' }, rain: { key: 'UrbanFloods', related: true }, cyclone: { key: 'Cyclone' }, landslide: { key: 'Landslides' },
};

export function guidanceFor(s: Signal) {
  const ph = plainHeadline(s);
  const r = readHeadline(`${ph.text} ${s.event ?? ''}`);
  return r.guidance.slice(0, 2).map((g) => ({ g, ...GUIDE_FOR[g], hazard: NDMA[GUIDE_FOR[g].key] })).filter((x) => x.hazard);
}

// ---------------------------------------------------------------------------------------------
// CAP fields and IMD colours
// ---------------------------------------------------------------------------------------------

type Terms = Record<string, [string, string]>;
export const CAP: Record<DLang, { severity: Terms; urgency: Terms; certainty: Terms }> = {
  en: {
    severity: { Extreme: ['Extreme', 'Extraordinary threat to life or property'], Severe: ['Severe', 'Significant threat to life or property'], Moderate: ['Moderate', 'Possible threat to life or property'], Minor: ['Minor', 'Minimal to no known threat to life or property'], Unknown: ['Unknown', 'Severity not known'] },
    urgency: { Immediate: ['Immediate', 'Act now'], Expected: ['Expected', 'Act soon, within the next hour'], Future: ['Future', 'Act in the near future'], Past: ['Past', 'No action needed any more'], Unknown: ['Unknown', 'Urgency not known'] },
    certainty: { Observed: ['Observed', 'Has happened or is happening'], Likely: ['Likely', 'More likely than not (above about 50%)'], Possible: ['Possible', 'Possible but not likely (about 50% or less)'], Unlikely: ['Unlikely', 'Not expected to happen'], Unknown: ['Unknown', 'Certainty not known'] },
  },
  hi: {
    severity: { Extreme: ['अत्यधिक', 'जान-माल को असाधारण ख़तरा'], Severe: ['गंभीर', 'जान-माल को बड़ा ख़तरा'], Moderate: ['मध्यम', 'जान-माल को संभावित ख़तरा'], Minor: ['मामूली', 'जान-माल को बहुत कम या कोई ज्ञात ख़तरा नहीं'], Unknown: ['अज्ञात', 'गंभीरता ज्ञात नहीं'] },
    urgency: { Immediate: ['तुरंत', 'अभी कदम उठाएँ'], Expected: ['जल्द', 'जल्द, अगले एक घंटे में कदम उठाएँ'], Future: ['आगे', 'निकट भविष्य में कदम उठाएँ'], Past: ['बीत गया', 'अब कदम की ज़रूरत नहीं'], Unknown: ['अज्ञात', 'तात्कालिकता ज्ञात नहीं'] },
    certainty: { Observed: ['हो रहा है', 'हो चुका है या हो रहा है'], Likely: ['संभावित', 'होने की संभावना ज़्यादा (लगभग 50% से अधिक)'], Possible: ['संभव', 'हो सकता है, पर संभावना कम (लगभग 50% या कम)'], Unlikely: ['असंभावित', 'होने की उम्मीद नहीं'], Unknown: ['अज्ञात', 'निश्चितता ज्ञात नहीं'] },
  },
  te: {
    severity: { Extreme: ['అత్యంత తీవ్రం', 'ప్రాణాలకు, ఆస్తులకు అసాధారణ ముప్పు'], Severe: ['తీవ్రం', 'ప్రాణాలకు, ఆస్తులకు గణనీయమైన ముప్పు'], Moderate: ['మధ్యస్థం', 'ప్రాణాలకు, ఆస్తులకు ముప్పు ఉండే అవకాశం'], Minor: ['స్వల్పం', 'ముప్పు చాలా తక్కువ లేదా తెలియదు'], Unknown: ['తెలియదు', 'తీవ్రత తెలియదు'] },
    urgency: { Immediate: ['వెంటనే', 'ఇప్పుడే చర్య తీసుకోండి'], Expected: ['త్వరలో', 'త్వరలో, గంటలోపు చర్య తీసుకోండి'], Future: ['తర్వాత', 'సమీప భవిష్యత్తులో చర్య తీసుకోండి'], Past: ['ముగిసింది', 'ఇక చర్య అవసరం లేదు'], Unknown: ['తెలియదు', 'అత్యవసరత తెలియదు'] },
    certainty: { Observed: ['జరుగుతోంది', 'జరిగింది లేదా జరుగుతోంది'], Likely: ['ఎక్కువ అవకాశం', 'జరిగే అవకాశం ఎక్కువ (దాదాపు 50% పైగా)'], Possible: ['అవకాశం ఉంది', 'జరగవచ్చు, కానీ అవకాశం తక్కువ (దాదాపు 50% లేదా తక్కువ)'], Unlikely: ['అవకాశం లేదు', 'జరుగుతుందని అనుకోవడం లేదు'], Unknown: ['తెలియదు', 'నిశ్చయత తెలియదు'] },
  },
};
export const capTerm = (lang: DLang, field: 'severity' | 'urgency' | 'certainty', v?: string) => CAP[lang][field][v && CAP.en[field][v] ? v : 'Unknown'];

/** IMD's colour codes, kept apart from CAP severity on purpose. Wording from IMD's heat wave
 *  warning graphic published by PIB (27 Apr 2021); the same four words are used for other hazards. */
export const IMD_SOURCE = 'https://static.pib.gov.in/WriteReadData/userfiles/PIB%20Delhi/27-04-2021Graphics%20Heat%20Wave.pdf';
export const IMD_COLOURS: { c: string; hex: string; en: [string, string]; hi: [string, string]; te: [string, string] }[] = [
  { c: 'Green', hex: '#3FB96A', en: ['Green', 'No action'], hi: ['हरा', 'कोई कदम ज़रूरी नहीं'], te: ['ఆకుపచ్చ', 'ఏ చర్యా అవసరం లేదు'] },
  { c: 'Yellow', hex: '#F2C230', en: ['Yellow', 'Be updated'], hi: ['पीला', 'जानकारी लेते रहें'], te: ['పసుపు', 'సమాచారం తెలుసుకుంటూ ఉండండి'] },
  { c: 'Orange', hex: '#F28A1E', en: ['Orange', 'Be prepared'], hi: ['नारंगी', 'तैयार रहें'], te: ['నారింజ', 'సిద్ధంగా ఉండండి'] },
  { c: 'Red', hex: '#E5383B', en: ['Red', 'Take action'], hi: ['लाल', 'कदम उठाएँ'], te: ['ఎరుపు', 'చర్య తీసుకోండి'] },
];

// ---------------------------------------------------------------------------------------------
// Time, always shown in IST
// ---------------------------------------------------------------------------------------------

const ist = (iso: string) => {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
};
const DAYPART: Record<'hi' | 'te', (h: number) => string> = {
  hi: (h) => (h >= 4 && h < 12 ? 'सुबह' : h < 16 && h >= 12 ? 'दोपहर' : h >= 16 && h < 19 ? 'शाम' : 'रात'),
  te: (h) => (h >= 4 && h < 12 ? 'ఉదయం' : h < 16 && h >= 12 ? 'మధ్యాహ్నం' : h >= 16 && h < 19 ? 'సాయంత్రం' : 'రాత్రి'),
};
const LOCALE: Record<DLang, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };

/** "8:30 am" · "सुबह 8:30" · "ఉదయం 8:30", in IST. */
export function clock(iso: string, lang: DLang) {
  const t = ist(iso);
  const h12 = t.h % 12 || 12;
  const hm = `${h12}:${String(t.mi).padStart(2, '0')}`;
  return lang === 'en' ? `${hm} ${t.h < 12 ? 'am' : 'pm'}` : `${DAYPART[lang](t.h)} ${hm}`;
}

/** "today", "tomorrow", or "Fri 21 Nov", in IST. */
export function dayOf(iso: string, lang: DLang, now = Date.now()) {
  const a = ist(iso), b = ist(new Date(now).toISOString());
  const da = Date.UTC(a.y, a.mo - 1, a.d), db = Date.UTC(b.y, b.mo - 1, b.d);
  const diff = Math.round((da - db) / 864e5);
  if (diff === 0) return { en: 'today', hi: 'आज', te: 'ఈ రోజు' }[lang];
  if (diff === 1) return { en: 'tomorrow', hi: 'कल', te: 'రేపు' }[lang];
  const d = new Date(iso);
  const wd = d.toLocaleDateString(LOCALE[lang], { timeZone: 'Asia/Kolkata', weekday: 'short' });
  const mo = d.toLocaleDateString(LOCALE[lang], { timeZone: 'Asia/Kolkata', month: lang === 'en' ? 'short' : 'long' });
  return lang === 'en' ? `${wd} ${a.d} ${mo}` : `${wd}, ${a.d} ${mo}`;
}

/** "today 11:00 am" · "आज सुबह 11:00" · "ఈ రోజు ఉదయం 11:00" */
export function at(iso: string | undefined, lang: DLang, now = Date.now()) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  return `${dayOf(iso, lang, now)} ${clock(iso, lang)}`;
}

export function timeLeft(iso: string | undefined, lang: DLang, now = Date.now()) {
  if (!iso) return '';
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return tr(lang, 'expired');
  const h = Math.floor(ms / 36e5);
  return h >= 1 ? tr(lang, 'h_left', { n: h }) : tr(lang, 'm_left', { n: Math.max(1, Math.round(ms / 6e4)) });
}

// ---------------------------------------------------------------------------------------------
// The message for the crew
// ---------------------------------------------------------------------------------------------

export interface Summary { what: string; where: string; when: string; level: string; sender: string; understood: boolean }

const SEP: Record<DLang, string> = { en: ', ', hi: ', ', te: ', ' };
const MORE: Record<DLang, string> = { en: 'and {n} more districts', hi: 'और {n} अन्य ज़िले', te: 'మరో {n} జిల్లాలు' };
const YOURS: Record<DLang, string> = { en: '{d} (your site)', hi: '{d} (आपकी साइट)', te: '{d} (మీ సైట్)' };
const UNTIL: Record<DLang, string> = { en: 'until {t}', hi: '{t} तक', te: '{t} వరకు' };
const FROM: Record<DLang, string> = { en: 'from {t}', hi: '{t} से', te: '{t} నుండి' };

/** The What / Where / When lines in one language, from the official record and the glossary only. */
export function summarise(s: Signal, lang: DLang, siteDistrict = '', now = Date.now()): Summary {
  const ph = plainHeadline(s);
  const r = readHeadline(ph.text);
  const words = r.hazards.map((h) => h[lang]);
  if (r.wind && r.hazards.some((h) => h.en === 'gusty winds' || h.en === 'squall')) {
    const i = r.hazards.findIndex((h) => h.en === 'gusty winds' || h.en === 'squall');
    words[i] = `${words[i]} (${r.wind})`;
  }
  const understood = words.length > 0;
  // Nothing recognised: use the issuer's own event name, in quotes, untranslated.
  const what = [understood ? words.join(SEP[lang]) : `“${s.event || s.title}”`, r.chance?.[lang]].filter(Boolean).join(' · ');

  const sub = s.areaLevel === 'sub-district';
  let names = sub ? [s.area ?? ''] : [...(s.districts ?? [])];
  if (siteDistrict && names.includes(siteDistrict)) names = [YOURS[lang].replace('{d}', siteDistrict), ...names.filter((d) => d !== siteDistrict)];
  const shown = names.length > 5 ? [...names.slice(0, 4), MORE[lang].replace('{n}', String(names.length - 4))] : names;
  const place = shown.join(SEP[lang]) || s.area || s.state || '';
  const where = [r.spread?.[lang], place].filter(Boolean).join(' · ');

  const parts: string[] = [];
  if (r.hours) parts.push(NEXT[lang].replace('{n}', r.hours));
  const start = s.effective && Date.parse(s.effective) > now ? s.effective : undefined;
  if (start) parts.push(FROM[lang].replace('{t}', at(start, lang, now)));
  if (s.expires) parts.push(UNTIL[lang].replace('{t}', at(s.expires, lang, now)));
  const when = parts.join(', ');

  const level = capTerm(lang, 'severity', s.severity)[0];
  const sender = (s.sender || 'NDMA SACHET').replace(/[-_]/g, ' ');
  return { what, where, when, level, sender, understood };
}

const MSG: Record<DLang, { head: string; what: string; where: string; when: string; doTitle: string; source: string; via: string; issued: string; not: string; sos: string; attn: string; issuedBy: string; ours: string; doIt: string; again: string; level: string }> = {
  en: { head: '{s} alert', what: 'What', where: 'Where', when: 'When', doTitle: 'What to do (NDMA)', source: 'Source', via: 'via NDMA SACHET', issued: 'issued', not: 'This explains an official alert. Nayan does not issue warnings.', sos: 'Emergency: 112', attn: 'Attention, everyone.', issuedBy: '{s} has issued an alert.', ours: 'Our district, {d}, is in it.', doIt: 'Please do this.', again: 'Again', level: 'Severity' },
  hi: { head: '{s} की चेतावनी', what: 'क्या', where: 'कहाँ', when: 'कब', doTitle: 'क्या करें (NDMA)', source: 'स्रोत', via: 'NDMA SACHET के ज़रिए', issued: 'जारी', not: 'यह आधिकारिक चेतावनी का विवरण है। Nayan चेतावनी जारी नहीं करता।', sos: 'आपात स्थिति: 112', attn: 'सब लोग ध्यान दें।', issuedBy: '{s} ने चेतावनी जारी की है।', ours: 'हमारा ज़िला {d} इसमें शामिल है।', doIt: 'कृपया ये करें।', again: 'फिर से', level: 'गंभीरता' },
  te: { head: '{s} హెచ్చరిక', what: 'ఏమిటి', where: 'ఎక్కడ', when: 'ఎప్పుడు', doTitle: 'ఏం చేయాలి (NDMA)', source: 'మూలం', via: 'NDMA SACHET ద్వారా', issued: 'జారీ', not: 'ఇది అధికారిక హెచ్చరికకు వివరణ. Nayan హెచ్చరికలు జారీ చేయదు.', sos: 'అత్యవసరం: 112', attn: 'అందరూ వినండి.', issuedBy: '{s} హెచ్చరిక జారీ చేసింది.', ours: 'మన జిల్లా {d} ఇందులో ఉంది.', doIt: 'దయచేసి ఇలా చేయండి.', again: 'మళ్ళీ చెబుతున్నాను', level: 'తీవ్రత' },
};

export interface Message { whatsapp: string; sms: string; read: string; summary: Summary; guideKey?: string; items: string[] }

/** All three formats for one language. `items` are NDMA's own lines in that language. */
export function buildMessage(s: Signal, lang: DLang, siteDistrict = '', now = Date.now()): Message {
  const S = summarise(s, lang, siteDistrict, now);
  const M = MSG[lang];
  const g = guidanceFor(s)[0];
  const items = (g?.hazard.crew ?? []).map((x: GItem) => x.text[lang]);
  const sent = s.sent ? at(s.sent, lang, now) : '';
  const inSite = !!siteDistrict && (s.districts ?? []).includes(siteDistrict);
  const end = (x: string) => (/[.!?।]$/.test(x.trim()) ? x.trim() : `${x.trim()}.`);

  const head = [
    `*${M.head.replace('{s}', S.sender)}* (${M.level}: ${S.level})`,
    `${M.what}: ${S.what}`,
    `${M.where}: ${S.where}`,
    ...(S.when ? [`${M.when}: ${S.when}`] : []),
  ];
  const steps = items.length ? [`*${M.doTitle}*`, ...items.map((x) => `• ${x}`)] : [];
  const foot = [`${M.source}: ${S.sender}, ${M.via}${sent ? `, ${M.issued} ${sent}` : ''}`, s.url, M.not, M.sos];
  const whatsapp = [head, steps, foot].filter((b) => b.length).map((b) => b.join('\n')).join('\n\n');

  // SMS: the shortest honest version. Plain ASCII punctuation keeps English in one 160-character part.
  const names = s.areaLevel === 'sub-district' ? [] : (s.districts ?? []);
  const lead = siteDistrict && names.includes(siteDistrict) ? siteDistrict : names[0];
  const shortWhere = lead ? `${lead}${names.length > 1 ? ` +${names.length - 1}` : ''}` : (s.area || s.state || '');
  const sms = [
    `${M.head.replace('{s}', S.sender)}: ${S.what}`,
    shortWhere,
    S.when,
    items[0] ?? '',
    `${M.source}: SACHET`,
    M.sos,
  ].filter(Boolean).map((x) => x.replace(/\s*·\s*/g, ', ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/–/g, '-').replace(/\s+/g, ' ').replace(/[.]$/, '').trim()).join('. ');

  // Read aloud: the same three lines with their labels, then the steps, then the key facts again.
  const P = summarise(s, lang, '', now);
  const cap = (x: string) => (lang === 'en' ? x.replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase()) : x);
  const read = cap([
    M.attn,
    end(M.issuedBy.replace('{s}', S.sender)),
    end(`${M.what}: ${P.what.replace(/\s*·\s*/g, ', ')}`),
    end(`${M.where}: ${P.where.replace(/\s*·\s*/g, ', ')}`),
    P.when ? end(`${M.when}: ${P.when}`) : '',
    inSite ? end(M.ours.replace('{d}', siteDistrict)) : '',
    items.length ? M.doIt : '',
    ...items.map(end),
    end(`${M.again}: ${P.what.replace(/\s*·\s*/g, ', ')}${P.when ? `, ${P.when}` : ''}`),
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
  const smsOut = cap(sms);

  return { whatsapp, sms: smsOut, read, summary: S, guideKey: g?.key, items };
}

// ---------------------------------------------------------------------------------------------
// SMS length: GSM-7 for plain English, UCS-2 (70 characters a part) for Hindi and Telugu
// ---------------------------------------------------------------------------------------------

const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';
export function smsParts(text: string) {
  const gsm = [...text].every((c) => GSM.includes(c) || GSM_EXT.includes(c));
  if (gsm) {
    const len = [...text].reduce((n, c) => n + (GSM_EXT.includes(c) ? 2 : 1), 0);
    return { chars: len, parts: len <= 160 ? 1 : Math.ceil(len / 153), enc: 'GSM-7' as const };
  }
  const len = text.length; // UTF-16 code units
  return { chars: len, parts: len <= 70 ? 1 : Math.ceil(len / 67), enc: 'Unicode' as const };
}
