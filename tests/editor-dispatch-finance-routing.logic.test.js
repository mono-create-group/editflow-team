const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const editor = read('editor-features.js');
const manager = read('manager-features.js');
const index = read('index.html');
const rules = read('firestore.rules');

test('editor-created dispatch requires and stores only the editor payment amount', () => {
  assert.match(editor, /編集者支払額（円） \*/);
  assert.match(editor, /new-subcase-editor-pay/);
  assert.match(editor, /editorPayAmount:subcase\.editorPayAmount/);
  assert.doesNotMatch(editor, /clientUnitPrice/);
  assert.match(rules, /validEditorPayAmountForCreate\(\)/);
  assert.match(rules, /request\.resource\.data\.editorPayAmount > 0/);
});

test('client pricing is held in an owner-only master and never in editor catalog', () => {
  assert.match(manager, /collection\('owner_client_pricing'\)/);
  assert.match(manager, /クライアント単価はオーナーだけが確認・設定できます/);
  assert.match(manager, /pricingRevision/);
  assert.match(manager, /if\(matches\.length===1\)client=matches\[0\]/);
  assert.match(rules, /match \/owner_client_pricing\/\{pricingId\}/);
  assert.match(rules, /allow read: if owner\(\)/);
  const catalogValidator = rules.slice(rules.indexOf('function validClientCatalogDocument'), rules.indexOf('function validOwnerClientPricingDocument'));
  assert.doesNotMatch(catalogValidator, /UnitPrice|unitPrice|price/);
});

test('owner case integration auto-fills client price and routes editor payment separately', () => {
  assert.match(index, /function _ownerPortalClientPricingSnapshot\(j\)/);
  assert.match(index, /クライアント一覧の標準単価・アカウント別単価を自動入力しています/);
  assert.match(index, /今回だけ金額が違う場合/);
  assert.match(index, /vp-director-settlement/);
  assert.match(index, /collection\('owner_job_finance'\)/);
  assert.match(index, /batch\.set\(financeRef,financeData\)/);
  assert.match(index, /editorPayReference:editorPay/);
  assert.match(index, /approvedPayAmount:ownerWorkerPay/);
  assert.match(index, /payRoute:recipient\.route/);
  assert.match(index, /legacy\.unitPrice=0;legacy\.workerPay=0;legacy\.profit=0/);
  assert.match(index, /if\(!external&&portalBiz==='haken'\)linkData\.ownPay=ownerWorkerPay/);
  const financeRules = rules.slice(rules.indexOf('match /owner_job_finance/{financeId}'), rules.indexOf('match /editor_portals/{uid}'));
  assert.match(financeRules, /allow read: if owner\(\)/);
  assert.match(financeRules, /allow create: if owner\(\)/);
  assert.match(financeRules, /allow update, delete: if false/);
});

test('dispatch invoice approval uses the immutable owner ledger instead of a portal amount', () => {
  assert.match(index, /function _portalApprovedPayAmount\(job\)/);
  const refresh = index.slice(index.indexOf('async function _refreshInvoiceAuthorization'), index.indexOf('function _videoDriveUrl'));
  const check = index.slice(index.indexOf('function _portalInvoiceCheck'), index.indexOf('async function portalRegistrationReview'));
  assert.match(refresh, /approvedPay=_portalApprovedPayAmount\(j\)/);
  assert.match(refresh, /amount:_portalApprovedPayAmount\(j\)/);
  assert.match(check, /const approvedPay=_portalApprovedPayAmount\(j\)/);
  assert.match(check, /Number\(line\.amount\)!==approvedPay/);
  assert.match(rules, /function validDispatchPayableMirror\(uid, jobId\)/);
  assert.match(rules, /existsAfter\(financePath\)/);
  assert.match(rules, /getAfter\(financePath\)\.data\.approvedPayAmount/);
});

test('client price never enters editor-readable portal records', () => {
  const portalCreate = editor.slice(editor.indexOf('async function createDispatchJob'), editor.indexOf('async function saveCaseDraft'));
  assert.doesNotMatch(portalCreate, /clientUnitPrice|unitPrice|profit/);
  const portalAllowlist = rules.slice(rules.indexOf("match /editor_jobs/{jobId}"), rules.indexOf('// Only the owner can expose'));
  assert.doesNotMatch(portalAllowlist, /clientUnitPrice/);
  assert.match(portalAllowlist, /'sourceClientId'/);
});
