import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false, root: process.cwd(), appType: 'custom', logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [], entries: [] }, server: { middlewareMode: true },
});

try {
  const { relatedChanges, originalAlertId } = await vite.ssrLoadModule('/src/desk/changes.ts');
  const alert = (id) => ({ id, references: [], msgType: 'Update', sent: '2026-11-25T10:00:00Z', sender: 'IMD', event: 'Rain', title: 'Rain', url: 'https://sachet.ndma.gov.in/cap_public_website/a.xml' });
  const first = { ...alert('update-1'), references: ['alert-1'] };
  const second = { ...alert('update-2'), sent: '2026-11-25T11:00:00Z', references: ['update-1'] };
  const cancel = { ...alert('cancel-1'), msgType: 'Cancel', sent: '2026-11-25T12:00:00Z', references: ['update-2'] };
  const unrelated = { ...alert('other'), references: ['other-alert'] };
  const shared = { alertId: 'alert-1', practice: false };
  const practice = { alertId: 'practice-alert', practice: true };

  assert.deepEqual(relatedChanges([first], [shared]).map((x) => x.id), ['update-1'], 'matches a direct CAP reference');
  assert.deepEqual(relatedChanges([first, second, cancel], [shared]).map((x) => x.id), ['cancel-1'], 'shows only the latest change in an Update to Update to Cancel chain');
  assert.equal(originalAlertId(cancel, [first, second, cancel], [shared]), 'alert-1', 'records a chained cancellation against the originally shared alert');
  assert.deepEqual(relatedChanges([first], [practice]), [], 'practice alerts never trigger live follow-ups');
  assert.deepEqual(relatedChanges([unrelated], [shared]), [], 'unrelated identifiers do not match');
  assert.deepEqual(relatedChanges([first, second, cancel], [shared, { alertId: 'update-1', practice: false, followUpChangeId: 'update-1' }]).map((x) => x.id), ['cancel-1'], 'latest cancellation remains the actionable follow-up');
  assert.deepEqual(relatedChanges([first], [shared, { alertId: 'update-1', practice: false, followUpChangeId: 'update-1' }]), [], 'a logged follow-up is no longer pending');
  const branch = { ...alert('update-branch'), sent: '2026-11-25T13:00:00Z', references: ['alert-1'] };
  assert.deepEqual(relatedChanges([first, branch], [shared]).map((x) => x.id), ['update-branch', 'update-1'], 'keeps independent updates that both refer to the shared alert');

  const { parseChange, supersededAlertFamilies } = await vite.ssrLoadModule('/api/_sachet.ts');
  const xml = `<alert><identifier>cancel-7</identifier><sender>IMD</sender><sent>2026-11-25T12:00:00+05:30</sent><status>Actual</status><msgType>Cancel</msgType><scope>Public</scope><references>sender,alert-7,2026-11-25T10:00:00+05:30</references><info><language>en-US</language><event>Heavy Rain</event><headline>Cancellation for Srikakulam</headline></info></alert>`;
  const parsed = parseChange(xml, 'https://sachet.ndma.gov.in/cap_public_website/cancel.xml');
  assert.equal(parsed.msgType, 'Cancel');
  assert.deepEqual(parsed.references, ['alert-7']);
  assert.equal(parseChange(xml.replace('<msgType>Cancel</msgType>', '<msgType>Alert</msgType>'), 'https://sachet.ndma.gov.in/cap_public_website/no-change.xml'), null, 'ordinary alerts are not change notices');
  const sameFamilyAlert = { id: 'IN-12345_17', references: [] };
  const sameFamilyUpdate = { ...alert('IN-12345_18'), references: ['IN-12345_17'] };
  const sameFamilyCancel = { ...sameFamilyUpdate, id: 'IN-12345_19', msgType: 'Cancel' };
  assert.equal(supersededAlertFamilies([], [sameFamilyUpdate]).has('12345'), false, 'same-family Update keeps the new version active');
  assert.equal(supersededAlertFamilies([], [sameFamilyCancel]).has('12345'), true, 'same-family Cancel removes the active alert');
  console.log('Alert update/cancellation checks passed: direct references, chains, practice exclusion, acknowledgement, and CAP parsing.');
} finally {
  await vite.close();
}
