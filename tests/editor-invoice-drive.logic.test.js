const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const editor = fs.readFileSync(path.join(__dirname, '..', 'editor.html'), 'utf8');

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
