const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const editor = fs.readFileSync(path.join(__dirname, '..', 'editor.html'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function sourceOf(name, nextName) {
  const asyncStart = editor.indexOf(`async function ${name}`);
  const start = asyncStart >= 0 ? asyncStart : editor.indexOf(`function ${name}`);
  const end = editor.indexOf(nextName, start);
  assert.ok(start >= 0 && end > start, `${name} source is present`);
  return editor.slice(start, end);
}

test('generated invoice obtains Drive authorization before asynchronous PDF generation', () => {
  const source = sourceOf('saveGeneratedInvoice', 'function uploadInvoiceFile');
  assert.ok(source.indexOf('await driveConnect()') < source.indexOf('await generateInvoicePdf(x)'), 'Drive OAuth must finish before PDF rendering');
  assert.match(source, /pdfBuilding=true/);
  assert.match(source, /finally\{pdfBuilding=false\}/);
  assert.match(source, /await saveInvoiceBlob\(/);
  assert.match(source, /driveStage='pdf'/);
});

test('Drive authorization is promise based and concurrent authorization is coalesced', () => {
  const source = sourceOf('driveConnect', 'async function hashBlob');
  assert.match(source, /async function driveConnect\(\)/);
  assert.match(source, /if\(driveConnectPromise\)return driveConnectPromise/);
  assert.match(source, /requestAccessToken\(\{prompt:'consent select_account'\}\)/);
  assert.match(source, /driveStage='auth_sdk'/);
  assert.match(source, /driveStage='auth_cancelled'/);
  assert.match(source, /driveStage='auth_popup'/);
  assert.match(source, /error_callback:r=>/);
  assert.match(source, /popup_failed_to_open/);
});

test('Drive authorization returns a token and does not request it twice after success', async () => {
  const context = {
    DEMO: false,
    GOOGLE_CLIENT_ID: 'client-id',
    DRIVE_SCOPE: 'scope',
    setTimeout,
    clearTimeout,
    requests: 0,
    google: { accounts: { oauth2: { initTokenClient: ({ callback }) => ({ requestAccessToken: () => { context.requests += 1; callback({ access_token: 'token-1' }); } }) } } }
  };
  vm.createContext(context);
  vm.runInContext(`let driveToken=null,driveConnectPromise=null;${sourceOf('driveConnect', 'async function hashBlob')}this.connect=driveConnect;`, context);
  assert.equal(await context.connect(), 'token-1');
  assert.equal(await context.connect(), 'token-1');
  assert.equal(context.requests, 1);
});

test('a synchronous popup failure clears the pending authorization so retry can open it again', async () => {
  const context = {
    DEMO: false,
    GOOGLE_CLIENT_ID: 'client-id',
    DRIVE_SCOPE: 'scope',
    setTimeout,
    clearTimeout,
    requests: 0,
    google: { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken: () => { context.requests += 1; throw new Error('popup blocked'); } }) } } }
  };
  vm.createContext(context);
  vm.runInContext(`let driveToken=null,driveConnectPromise=null;${sourceOf('driveConnect', 'async function hashBlob')}this.connect=driveConnect;this.pending=()=>driveConnectPromise;`, context);
  await assert.rejects(context.connect());
  assert.equal(context.pending(), null);
  await assert.rejects(context.connect());
  assert.equal(context.requests, 2);
});

test('Drive upload, owner sharing, and Firestore persistence expose distinct results', () => {
  const upload = sourceOf('uploadDrive', 'function invoiceDriveSavedMessage');
  const persist = sourceOf('persistInvoiceFile', 'async function saveInvoiceBlob');
  const message = sourceOf('invoiceDriveError', 'async function driveConnect');
  assert.match(upload, /driveStage='upload'/);
  assert.match(upload, /shareFailures\.push/);
  assert.match(persist, /driveStage='firestore'/);
  assert.match(message, /Google Driveの認証/);
  assert.match(message, /請求書PDFを作成/);
  assert.match(message, /DriveへPDFを保存/);
  assert.match(message, /アプリへの保存記録/);
});

test('generated and uploaded invoice files share one busy guard', () => {
  const generated = sourceOf('saveGeneratedInvoice', 'function uploadInvoiceFile');
  const uploaded = sourceOf('uploadInvoiceFile', 'async function submitInvoice');
  const submitted = sourceOf('submitInvoice', 'async function createRevision');
  const persisted = sourceOf('persistInvoiceFile', 'async function saveInvoiceBlob');
  assert.match(generated, /if\(pdfBuilding\)return toast\('Drive保存処理中です'\)/);
  assert.match(uploaded, /if\(pdfBuilding\)return toast\('Drive保存処理中です'\)/);
  assert.match(uploaded, /pdfBuilding=true/);
  assert.match(uploaded, /finally\{pdfBuilding=false\}/);
  assert.match(submitted, /if\(pdfBuilding\)return toast\('Drive保存処理中です。完了後に提出してください'\)/);
  assert.ok(persisted.indexOf('await batch.commit()') < persisted.lastIndexOf('Object.assign(x,data)'), 'real local invoice state updates only after commit');
});

test('invoice drafts have an explicit correction route and revisions preserve version history', () => {
  const card = sourceOf('invoiceCard', 'function hasVideoEditorPermission');
  const revision = sourceOf('createRevision', 'function invoiceTermsForDelivery');
  const edit = sourceOf('saveInvoiceDraft', 'function invoiceDriveError');
  assert.match(card, /下書き内容を修正/);
  assert.match(edit, /file:null,ownerShareStatus:'not_uploaded'/);
  assert.match(revision, /const manual=x\.authorizationId==='manual'/);
  assert.match(revision, /supersedesInvoiceId:x\.id/);
  assert.match(revision, /authorization\.invoiceAvailableOn/);
});

test('Drive failures retain the selected original and distinguish authorization, upload, share, and persistence stages', () => {
  const uploaded = sourceOf('uploadInvoiceFile', 'async function retryInvoiceUpload');
  const errors = sourceOf('invoiceDriveError', 'async function driveConnect');
  assert.match(uploaded, /pendingInvoiceUploadFile=\{iid,file,name:/);
  assert.match(errors, /stage==='upload'/);
  assert.match(errors, /stage==='share'/);
  assert.match(errors, /stage==='firestore'/);
});

test('manager approval fails closed without a shared, integrity-checked Drive original', () => {
  const manager = fs.readFileSync(path.join(__dirname, '..', 'manager-features.js'), 'utf8');
  const start = manager.indexOf('async function invoiceAction');
  const end = manager.indexOf('async function sendMessage', start);
  const source = manager.slice(start, end);
  assert.match(source, /x\.file\?\.provider!=='google-drive'/);
  assert.match(source, /!x\.file\?\.id/);
  assert.match(source, /!x\.file\?\.sha256/);
  assert.match(source, /x\.ownerShareStatus!=='shared'/);
  assert.match(source, /requiredOwners\.every\(email=>sharedWith\.has\(email\)\)/);
  assert.match(source, /state\.invoiceActionPending\.has\(actionKey\)/);
});

test('legacy owner invoice route also requires every owner share and locks repeated actions', () => {
  const checkStart = index.indexOf('function _portalInvoiceCheck');
  const checkEnd = index.indexOf('async function portalRegistrationReview', checkStart);
  const actionStart = index.indexOf('async function portalInvoiceAction');
  const actionEnd = index.indexOf('function _videoInvoiceHtml', actionStart);
  assert.ok(checkStart >= 0 && checkEnd > checkStart && actionStart >= 0 && actionEnd > actionStart);
  const check = index.slice(checkStart, checkEnd), action = index.slice(actionStart, actionEnd);
  assert.match(check, /requiredOwners\.every\(v=>shared\.includes\(v\)\)/);
  assert.doesNotMatch(check, /shared\.some\(/);
  assert.match(action, /PORTAL_INVOICE_ACTION_PENDING\.has\(actionKey\)/);
  assert.match(action, /PORTAL_INVOICE_ACTION_PENDING\.add\(actionKey\)/);
  assert.match(action, /finally\{PORTAL_INVOICE_ACTION_PENDING\.delete\(actionKey\)\}/);
});

test('invoice submission has an in-flight guard and draft edits invalidate prior PDF evidence', () => {
  const submitted = sourceOf('submitInvoice', 'async function createRevision');
  const edit = sourceOf('saveInvoiceDraft', 'function invoiceDriveError');
  assert.match(submitted, /invoiceSubmittingIds\.has\(iid\)/);
  assert.match(submitted, /invoiceSubmittingIds\.add\(iid\)/);
  assert.match(submitted, /finally\{invoiceSubmittingIds\.delete\(iid\)\}/);
  assert.match(edit, /file:null,ownerShareStatus:'not_uploaded'/);
});

test('Drive is considered shared only after every configured owner has access and failed sharing keeps a retry', () => {
  const persisted = sourceOf('persistInvoiceFile', 'async function saveInvoiceBlob');
  const uploaded = sourceOf('uploadInvoiceFile', 'async function retryInvoiceUpload');
  const retried = sourceOf('retryInvoiceUpload', 'async function submitInvoice');
  assert.match(persisted, /OWNER_EMAILS\.every\(email=>\(result\.shared\|\|\[\]\)\.includes\(email\)\)/);
  assert.match(uploaded, /if\(result\.ownerShareStatus==='shared'\)pendingInvoiceUploadFile=null;else render\(\)/);
  assert.match(retried, /if\(result\.ownerShareStatus==='shared'\)pendingInvoiceUploadFile=null;else render\(\)/);
});

test('invoice revision creation has a stable manual document id and an in-flight guard', () => {
  const revision = sourceOf('createRevision', 'function invoiceTermsForDelivery');
  assert.match(revision, /invoiceRevisionIds\.has\(iid\)/);
  assert.match(revision, /invoiceRevisionIds\.add\(iid\)/);
  assert.match(revision, /nid=manual\?`\$\{x\.id\}-v\$\{version\}`/);
  assert.match(revision, /finally\{invoiceRevisionIds\.delete\(iid\)\}/);
});

test('manual invoice rules bind the only line, tax rate, and totals before allowing a revision', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const start = rules.indexOf('function validManualInvoice');
  const end = rules.indexOf('function validCompletedJobEvidence', start);
  const source = rules.slice(start, end);
  for (const required of [
    'lines[0].jobId == request.resource.data.jobIds[0]',
    'lines[0].amount == request.resource.data.subtotal',
    "lines[0].taxRate in [0, 10]",
    "taxByRate.get('0', -1)",
    "taxByRate.get('10', -1)",
    'int((request.resource.data.subtotal * request.resource.data.lines[0].taxRate + 50) / 100)',
    'supersedesInvoiceId is string'
  ]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
