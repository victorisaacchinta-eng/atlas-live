import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

// Local, offline check against the saved SACHET practice alerts.
// It never sends a message or contacts a crew member.
const practice = JSON.parse(await readFile(new URL('../public/practice.json', import.meta.url), 'utf8'));
const byId = new Map(practice.alerts.map((alert) => [alert.id, alert]));
const requiredIds = [
  'IN-1795162562135030_56', // Telangana lightning / thunderstorm, includes Mulugu
  'IN-1795468902061008_8', // Andhra Pradesh mandals, no district mapping
  'IN-1795483307084007_43', // Tamil Nadu rain with abbreviated district names
  'IN-1795138125725008_68', // Andhra Pradesh extremely heavy rain
];
for (const id of requiredIds) assert.ok(byId.has(id), `practice fixture is missing ${id}`);

const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [], entries: [] },
  server: { middlewareMode: true },
});

try {
  const { buildMessage } = await vite.ssrLoadModule('/src/desk/explain.ts');
  const langs = ['en', 'hi', 'te'];
  const emergency = { en: 'Emergency: 112', hi: 'आपात स्थिति: 112', te: 'అత్యవసరం: 112' };
  let checks = 0;

  for (const id of requiredIds) {
    const alert = byId.get(id);
    for (const lang of langs) {
      const message = buildMessage(alert, lang, 'Mulugu', Date.parse('2026-11-25T12:00:00+05:30'));
      assert.ok(message.summary.what, `${id}/${lang}: missing hazard summary`);
      assert.ok(message.summary.where, `${id}/${lang}: missing location summary`);
      assert.ok(message.whatsapp.includes(message.summary.sender), `${id}/${lang}: sender missing from WhatsApp message`);
      assert.ok(message.whatsapp.includes(alert.url), `${id}/${lang}: official alert link missing`);
      assert.ok(message.whatsapp.includes(emergency[lang]), `${id}/${lang}: emergency number missing`);
      assert.ok(message.whatsapp.includes('NDMA'), `${id}/${lang}: NDMA source/guidance label missing`);
      for (const step of message.items) assert.ok(message.whatsapp.includes(step), `${id}/${lang}: selected NDMA step missing`);
      checks += 6 + message.items.length;
    }
  }

  const mulugu = byId.get(requiredIds[0]);
  const unsupported = byId.get(requiredIds[1]);
  const siteWords = {
    en: ['Mulugu (your site)', 'Our district, Mulugu, is in it.'],
    hi: ['Mulugu (आपकी साइट)', 'हमारा ज़िला Mulugu इसमें शामिल है।'],
    te: ['Mulugu (మీ సైట్)', 'మన జిల్లా Mulugu ఇందులో ఉంది.'],
  };
  for (const lang of langs) {
    const included = buildMessage(mulugu, lang, 'Mulugu', Date.parse('2026-11-25T12:00:00+05:30'));
    assert.ok(included.summary.where.includes(siteWords[lang][0]), `${lang}: matching district is not marked as the site`);
    assert.ok(included.read.includes(siteWords[lang][1]), `${lang}: matching site is not stated in read-aloud message`);

    const unknown = buildMessage(unsupported, lang, 'Mulugu', Date.parse('2026-11-25T12:00:00+05:30'));
    assert.ok(!unknown.read.includes(siteWords[lang][1]), `${lang}: unrelated site was claimed to be in the alert`);
    checks += 3;
  }

  const heavyRain = byId.get(requiredIds[3]);
  assert.ok(buildMessage(heavyRain, 'hi', 'Srikakulam').summary.what.includes('अत्यधिक भारी बारिश'), 'Hindi heavy-rain term changed or is missing');
  assert.ok(buildMessage(heavyRain, 'te', 'Srikakulam').summary.what.includes('అత్యంత భారీ వర్షం'), 'Telugu heavy-rain term changed or is missing');
  checks += 2;

  console.log(`Crew-message checks passed: ${checks} assertions across ${requiredIds.length} saved alerts and 3 languages.`);
} finally {
  await vite.close();
}
