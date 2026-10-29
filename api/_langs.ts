/**
 * The 22 languages of the Eighth Schedule of the Constitution of India, plus English.
 * Shared by the server (writer and checker prompts) and the browser (menus, fonts, direction).
 *
 * voice: the Gemini TTS locale when Gemini lists that language (Google Cloud docs, Oct 2026);
 *        null means captions and script only, no generated voice yet.
 * beta:  languages where general-purpose models write less reliably; the UI says so.
 */
export interface Lang {
  code: string; name: string; native: string; script: string; rtl?: boolean;
  voice: string | null; beta?: boolean;
}

export const LANGS: Lang[] = [
  { code: 'en', name: 'English', native: 'English', script: 'Latin', voice: 'en-IN' },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া', script: 'Bengali-Assamese', voice: null },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', script: 'Bengali', voice: 'bn-BD' },
  { code: 'brx', name: 'Bodo', native: 'बड़ो', script: 'Devanagari', voice: null, beta: true },
  { code: 'doi', name: 'Dogri', native: 'डोगरी', script: 'Devanagari', voice: null, beta: true },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', script: 'Gujarati', voice: 'gu-IN' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', script: 'Devanagari', voice: 'hi-IN' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', script: 'Kannada', voice: 'kn-IN' },
  { code: 'ks', name: 'Kashmiri', native: 'کٲشُر', script: 'Perso-Arabic', rtl: true, voice: null, beta: true },
  { code: 'kok', name: 'Konkani', native: 'कोंकणी', script: 'Devanagari', voice: 'kok-IN', beta: true },
  { code: 'mai', name: 'Maithili', native: 'मैथिली', script: 'Devanagari', voice: 'mai-IN', beta: true },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', script: 'Malayalam', voice: 'ml-IN' },
  { code: 'mni', name: 'Manipuri', native: 'ꯃꯩꯇꯩꯂꯣꯟ', script: 'Meitei Mayek', voice: null, beta: true },
  { code: 'mr', name: 'Marathi', native: 'मराठी', script: 'Devanagari', voice: 'mr-IN' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', script: 'Devanagari', voice: null },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', script: 'Odia', voice: 'or-IN' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', script: 'Gurmukhi', voice: 'pa-IN' },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्', script: 'Devanagari', voice: null, beta: true },
  { code: 'sat', name: 'Santali', native: 'ᱥᱟᱱᱛᱟᱲᱤ', script: 'Ol Chiki', voice: null, beta: true },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي', script: 'Perso-Arabic', rtl: true, voice: 'sd-IN', beta: true },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', script: 'Tamil', voice: 'ta-IN' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', script: 'Telugu', voice: 'te-IN' },
  { code: 'ur', name: 'Urdu', native: 'اردو', script: 'Perso-Arabic (Nastaliq)', rtl: true, voice: null },
];

export const LANG_BY_CODE: Record<string, Lang> = Object.fromEntries(LANGS.map((l) => [l.code, l]));
export const langOf = (x: unknown): string => (typeof x === 'string' && LANG_BY_CODE[x] ? x : 'en');
