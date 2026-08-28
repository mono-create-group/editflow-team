const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname, '..', 'editor.html'), 'utf8');
const editorFeatures = fs.readFileSync(path.join(__dirname, '..', 'editor-features.js'), 'utf8');
const manager = fs.readFileSync(path.join(__dirname, '..', 'manager-features.js'), 'utf8');

function blockAfter(marker, nextMarker) {
  const start = rules.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const end = nextMarker ? rules.indexOf(nextMarker, start + marker.length) : rules.length;
  return rules.slice(start, end === -1 ? rules.length : end);
}

test('external editor classification is excluded from core staff financial access', () => {
  const coreStaff = blockAfter('function coreStaff()', 'function videoManager()');
  assert.match(coreStaff, /editorKind\(request\.auth\.uid\) != 'external'/);
  assert.match(rules, /function externalEditor\(uid\)/);
});

test('legacy external portal jobs containing settlement fields fail closed for the external editor', () => {
  const jobs = blockAfter('match /editor_jobs/{jobId}', 'match /invoice_authorizations/{authorizationId}');
  assert.match(jobs, /!externalEditor\(uid\) \|\| !containsExternalSettlement\(resource\.data\)/);
  for (const field of ['ownPay', 'payableApproved', 'payableApprovedAt', 'payableMonth']) {
    assert.match(rules, new RegExp(`'${field}' in data`));
  }
  assert.match(jobs, /!externalEditor\(uid\) \|\| !containsExternalSettlement\(request\.resource\.data\)/);
});

test('external editors cannot access mono.create invoice records or invoice events', () => {
  const authorization = blockAfter('match /invoice_authorizations/{authorizationId}', 'match /editor_invoices/{invoiceId}');
  const invoices = blockAfter('match /editor_invoices/{invoiceId}', 'match /submissions/{submissionId}');
  assert.match(authorization, /editor\(uid\) && !externalEditor\(uid\)/);
  assert.match(invoices, /allow read: if owner\(\) \|\| \(editor\(uid\) && !externalEditor\(uid\)\)/);
  assert.match(invoices, /allow create: if editor\(uid\) && !externalEditor\(uid\)/);
  assert.match(invoices, /allow update: if editor\(uid\) && !externalEditor\(uid\)/);
  assert.match(invoices, /request\.resource\.data\.byUid == uid/);
});

test('legacy external settlement archive is owner-only and cannot be deleted', () => {
  const archive = blockAfter('match /external_compensation_archive/{archiveId}', '// Required for collection-group dashboards');
  assert.match(archive, /allow read, create, update: if owner\(\);/);
  assert.match(archive, /allow delete: if false;/);
  assert.doesNotMatch(archive, /editor\(uid\)|portalManager\(uid\)|coreStaff\(\)/);
});

test('external editor portal never subscribes to or renders invoice amounts', () => {
  assert.match(editor, /const directBillingEnabled=\(\)=>String\(access\?\.editorKind\|\|['"]direct['"]\)!==['"]external['"]/);
  assert.match(editor, /if\(!directBillingEnabled\(\)\)return`\$\{pageHead\('支払いのご案内'/);
  assert.match(editor, /mono\.createからディレクターへの単価や請求額は共有されません/);
  assert.match(editor, /if\(directBillingEnabled\(\)\)\{\s*next\.push\(root\.collection\('editor_invoices'\)/);
  assert.match(editorFeatures, /isExternal\(\)\?'支払い案内':'請求書'/);
});

test('dispatch entry keeps the editor pay but never transports client price or profit through the editor portal', () => {
  assert.match(editorFeatures, /編集者支払額（円） \*/);
  assert.match(editorFeatures, /editorPayAmount:subcase\.editorPayAmount/);
  assert.doesNotMatch(editorFeatures, /clientUnitPrice|new-client-unit-price/);
});

test('manager and owner UI route external settlement away from the external portal', () => {
  assert.doesNotMatch(manager, /approveExternalPay|managerApproveExternalPay|externalPayHtml/);
  assert.match(manager, /external_compensation_archive/);
  assert.match(manager, /firebase\.firestore\.FieldValue\.delete\(\)/);
  assert.match(manager, /mono\.createからディレクターへの依頼単価も表示しません/);
  assert.match(index, /if\(_portalIsExternal\(x\._portalUid\)\)return\{ok:false/);
  assert.match(index, /filter\(x=>!_portalIsExternal\(x\._portalUid\)\)/);
  assert.match(index, /vp-director-settlement/);
  assert.match(index, /editorPayReference:editorPay/);
  assert.match(index, /approvedPayAmount:ownerWorkerPay/);
  assert.match(index, /payRoute:recipient\.route/);
  assert.match(index, /legacy\.unitPrice=0;legacy\.workerPay=0;legacy\.profit=0/);
  assert.doesNotMatch(index, /workerPay=biz==='haken'&&editorPay/);
});

test('role assignment copy explicitly protects the mono.create to director rate', () => {
  assert.match(index, /mono\.createから担当ディレクターへの依頼単価・請求額も表示しません/);
  assert.match(editor, /mono\.createからディレクターへの単価・請求額・利益は共有されません/);
});
