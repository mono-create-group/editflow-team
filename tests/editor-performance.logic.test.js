const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');

test('Firestore snapshot bursts are coalesced to one animation frame while direct render remains available', () => {
  assert.match(editor, /function scheduleSnapshotRender\(\)\{\s*if\(editorIsTypingInApp\(\)\)[\s\S]*?if\(snapshotRenderFrame!==null\)return/);
  assert.match(editor, /window\.requestAnimationFrame\|\|\(\(fn\)=>setTimeout\(fn,16\)\)/);
  assert.match(editor, /snapshotRenderFrame=enqueue\(\(\)=>\{snapshotRenderFrame=null;render\(\)\}\)/);
  for (const collection of ['editor_profile', 'editor_jobs', 'editor_invoices', 'invoice_authorizations']) {
    const line = editor.match(new RegExp(`${collection}[\\s\\S]{0,260}scheduleSnapshotRender\\(\\)`));
    assert.ok(line, `${collection} snapshot uses the coalesced render path`);
  }
  assert.match(features, /mergeBoard\(items\)\{[^}]*scheduleSnapshotRender\(\)/);
  assert.match(features, /editor_schedules[^\n]*scheduleSnapshotRender\(\)/);
});

test('message subscriptions begin only for a case the editor opens or a notification targets', () => {
  assert.match(features, /function ensureJobMessages\(jid,opened=true\)/);
  assert.match(features, /if\(!opened\)\{/);
  assert.match(features, /const unsub=feature\.messageUnsubs\.get\(jid\);if\(unsub\)\{try\{unsub\(\)\}/);
  assert.match(features, /feature\.messages\.delete\(jid\);feature\.messageLoading\.delete\(jid\);syncEditorAppBadge\(\);return/);
  assert.match(features, /if\(DEMO\|\|!db\|\|!user\|\|window\.EditflowFirestoreQuota\?\.isOpen\?\.\(\)\|\|feature\.messageUnsubs\.has\(jid\)/);
  assert.match(features, /ontoggle="ensureJobMessages\('\$\{jid\}',this\.open\)"/);
  assert.match(features, /function openEditorJob\(jobId\)[\s\S]{0,280}ensureJobMessages\(jobId\)/);
  assert.match(features, /この詳細を開くと、案件内チャットを読み込みます。/);
  assert.match(features, /案件内チャットを読み込んでいます/);
  assert.doesNotMatch(features, /jobs\.filter\(j=>!j\.previewLegacy\)\.forEach\(j=>\{if\(feature\.messageUnsubs/);
  assert.match(features, /window\.ensureJobMessages=ensureJobMessages/);
});

test('PDF rendering libraries are deferred until an invoice PDF is actually generated', () => {
  assert.doesNotMatch(editor, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/(html2canvas|jspdf)/);
  assert.match(editor, /function ensurePdfLibraries\(\)/);
  assert.match(editor, /function loadPdfScript\(src,integrity\)/);
  assert.match(editor, /await ensurePdfLibraries\(\);/);
  assert.match(editor, /html2canvas@1\.4\.1/);
  assert.match(editor, /jspdf@2\.5\.1/);
});
