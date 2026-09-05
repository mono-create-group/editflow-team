const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');

function sourceOf(name, from = 0) {
  const start = editor.indexOf(`function ${name}(`, from);
  assert.notEqual(start, -1, `${name} must be defined`);
  let depth = 0, opened = false;
  for (let i = start; i < editor.length; i += 1) {
    if (editor[i] === '{') { depth += 1; opened = true; }
    if (editor[i] === '}' && opened && --depth === 0) return editor.slice(start, i + 1);
  }
  assert.fail(`${name} must close`);
}

// The effective definitions live in the override block at the end of editor.html,
// so assignments are matched instead of the earlier `function` declarations.
function overrideOf(name) {
  const start = editor.indexOf(`  ${name}=`);
  assert.notEqual(start, -1, `${name} must be overridden`);
  return editor.slice(start, editor.indexOf('\n', start));
}

// 上書きは何段か重なるので、最後に代入された関数式が実際に動く定義になる。
function effectiveOf(name) {
  let start = -1;
  for (const shape of [`\n  ${name}=function`, `\n  ${name}=async function`]) {
    const at = editor.lastIndexOf(shape);
    if (at > start) start = at;
  }
  if (start >= 0) start += 1; else start = editor.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must be defined`);
  let paren = 0, body = -1;
  for (let i = editor.indexOf('(', start); i < editor.length; i += 1) {
    if (editor[i] === '(') paren += 1;
    if (editor[i] === ')' && --paren === 0) { body = editor.indexOf('{', i); break; }
  }
  let depth = 0;
  for (let i = body; i < editor.length; i += 1) {
    if (editor[i] === '{') depth += 1;
    if (editor[i] === '}' && --depth === 0) return editor.slice(start, i + 1);
  }
  assert.fail(`${name} must close`);
}

function issuerContext() {
  const context = vm.createContext({ profile: {}, String, Array, RegExp });
  vm.runInContext(`${editor.match(/const INVOICE_ISSUER_FIELDS=\[[\s\S]*?\];/)[0]}
${sourceOf('invoiceIssuerMissingFields')}
${sourceOf('invoiceIssuerFromDocument')}
this.missing=invoiceIssuerMissingFields;this.fromDocument=invoiceIssuerFromDocument;`, context);
  return context;
}

test('the five required issuer fields match saveProfile and are reported by name when missing', () => {
  const save = sourceOf('saveProfile');
  assert.match(save, /if\(!issuerName\|\|!bankName\|\|!bankBranch\|\|!bankNumber\|\|!bankHolder\)/);
  const { missing } = issuerContext();
  assert.deepEqual(Array.from(missing({})), ['発行者名・屋号', '金融機関名', '支店名', '口座番号', '口座名義（カナ）']);
  assert.deepEqual(Array.from(missing({ issuerName: '山田 美咲', bankName: '北海道銀行', bankBranch: ' ', bankNumber: '1234567', bankHolder: '' })), ['支店名', '口座名義（カナ）']);
  assert.deepEqual(Array.from(missing({ issuerName: '山田 美咲', bankName: '北海道銀行', bankBranch: '旭川支店', bankNumber: '1234567', bankHolder: 'ヤマダ ミサキ' })), []);
});

test('the invoice page always shows how many issuer fields are filled and a way to open them', () => {
  const card = sourceOf('invoiceIssuerStatusCard');
  assert.match(card, /請求者情報 \$\{filled\}\/\$\{INVOICE_ISSUER_FIELDS\.length\} 項目 入力済み/);
  assert.match(card, /onclick="setView\('settings'\)">請求者情報を開く<\/button>/);
  assert.match(card, /未入力：\$\{esc\(missing\.join\('・'\)\)\}/);
  // The card is rendered by the effective (overridden) create panel, not the legacy one.
  assert.match(effectiveOf('invoiceCreatePanel'), /\$\{invoiceStepsHtml\(state\)\}\$\{invoiceIssuerStatusCard\(\)\}/);
});

test('the editor menu names the settings page after the invoice information it holds', () => {
  assert.match(features, /\['settings','請求者情報・登録'\]/);
  assert.doesNotMatch(features, /\['settings','登録情報'\]/);
  const items = features.match(/const items=\[\[.*?\]\];/)[0];
  const tools = features.match(/tools=\[\[.*?\]\];/)[0];
  const mobilePrimary = ['dashboard', 'jobs', 'dm', 'notifications'];
  const order = [...items.matchAll(/\['([a-z-]+)'/g)].map(m => m[1]);
  const more = order.filter(key => !mobilePrimary.includes(key));
  assert.deepEqual(more.slice(0, 2), ['invoices', 'settings']);
  assert.deepEqual([...tools.matchAll(/\['([a-z-]+)'/g)].map(m => m[1]).slice(0, 2), ['invoices', 'settings']);
});

test('draft creation stops before writing when any issuer field is missing', () => {
  const guard = /const issuerMissing=invoiceIssuerMissingFields\(profile\);\s*if\(issuerMissing\.length\)return toast\(`請求者情報が未入力です（\$\{issuerMissing\.join\('・'\)\}）。「請求者情報・登録」で入力してください`\);/;
  assert.match(effectiveOf('draftInvoice'), guard);
  assert.match(effectiveOf('draftManualInvoice'), guard);
  // The guard runs before the form is read, so no Firestore batch can start.
  assert.ok(effectiveOf('draftManualInvoice').indexOf('issuerMissing') < effectiveOf('draftManualInvoice').indexOf('db.batch()'));
});

test('submitting re-checks the issuer details stored on the invoice itself', () => {
  const submit = effectiveOf('submitInvoice');
  assert.match(submit, /const issuerMissing=invoiceIssuerMissingFields\(invoiceIssuerFromDocument\(x\)\);/);
  assert.match(submit, /「請求者情報を開く」から入力し、請求書を作り直してください/);
  // 確定はネイティブの confirm() ではなく確認ブロックのチェックで行う。
  assert.doesNotMatch(submit, /confirm\(/);
  assert.ok(submit.indexOf('issuerMissing') < submit.indexOf('invoiceConfirmedIds.has(iid)'), 'the check must stop the submit before the confirmation gate');
  const { missing, fromDocument } = issuerContext();
  assert.deepEqual(Array.from(missing(fromDocument({ issuer: { name: '山田 美咲', bankName: '北海道銀行', bankBranch: '旭川支店', bankNumber: '1234567', bankHolder: 'ヤマダ ミサキ' } }))), []);
  assert.deepEqual(Array.from(missing(fromDocument({ issuer: { name: '山田 美咲', bankName: '北海道銀行', bankNumber: '1234567' } }))), ['支店名', '口座名義（カナ）']);
  assert.equal(missing(fromDocument({})).length, 5);
});

test('"8月分" style lump descriptions are rejected but per-case names pass', () => {
  const context = vm.createContext({ String, RegExp });
  vm.runInContext(`${editor.match(/const MONTHLY_LUMP_PATTERN=[^\n]*\n/)[0]}
${sourceOf('isMonthlyLumpInvoiceDescription')}
this.lump=isMonthlyLumpInvoiceDescription;`, context);
  const lump = context.lump;
  ['8月分', '８月分', '8月分 まとめ', '八月分', '12月分', '9ヶ月分', '10月分・編集', '8月分（動画編集）'].forEach(value => {
    assert.equal(lump(value), true, `${value} must be rejected`);
  });
  ['ショート動画 003', 'ショート動画 003 / ロング動画 014', '8月分 ショート動画 003', 'ロング動画 014', '', 'サムネイル 12枚'].forEach(value => {
    assert.equal(lump(value), false, `${value} must be accepted`);
  });
});

test('line items come from completed cases, so a lump "8月分" description cannot be typed at all', () => {
  const panel = effectiveOf('invoiceCreatePanel');
  // 自由入力の請求内容そのものを廃止したので、まとめ書きの入り口がない。
  assert.doesNotMatch(panel, /id="manual-invoice-description"/);
  assert.match(panel, /2 明細 ・ 請求する完了案件を選ぶ/);
  assert.match(panel, /明細の案件名には使いません/);
  const draft = effectiveOf('draftManualInvoice');
  // 明細は選択した完了案件から組み立てる。案件名は案件ドキュメントの title。
  assert.match(draft, /const selection=invoiceSelectionResult\(\);/);
  assert.ok(draft.indexOf('invoiceSelectionResult') < draft.indexOf('db.batch()'));
  const rows = effectiveOf('invoiceSelectionResult');
  assert.match(rows, /title:x\.title,serviceDescription:x\.title,transactionDate:x\.deliveryDate/);
});

test('a cancelled Drive reconnect during retry no longer flags every failure as a reconnect', () => {
  const retry = sourceOf('retryInvoiceUpload');
  assert.match(retry, /if\(\['auth_cancelled','auth_popup','upload'\]\.includes\(e\?\.driveStage\)\)\{driveToken=null;invoiceDriveReconnectId=iid\}toast\(invoiceDriveError\(e\)\)/);
  assert.doesNotMatch(retry, /includes\(e\?\.driveStage\)\)driveToken=null;invoiceDriveReconnectId=iid;/);
});

test('the uploaded-original input really receives its invoice-scoped id', () => {
  const override = overrideOf('invoiceCard');
  assert.match(override, /\.replace\(`原本をアップロード<input type="file" hidden accept="application\/pdf,image\/jpeg,image\/png" onchange="uploadInvoiceFile\('\$\{x\.id\}',this\)">`/);
  assert.doesNotMatch(override, /\.replace\('原本をアップロード<input type="file"/);
  const before = `<label class="btn small">原本をアップロード<input type="file" hidden accept="application/pdf,image/jpeg,image/png" onchange="uploadInvoiceFile('inv-1',this)"></label><div class="actions"></div>`;
  const context = vm.createContext({
    invoiceCardBeforeBillingTerms: () => before,
    pendingInvoiceUploadFile: null,
    driveToken: 'token',
    invoiceDriveReconnectId: '',
    esc: v => String(v == null ? '' : v),
    String,
  });
  vm.runInContext(`${override.replace(/^\s*invoiceCard=/, 'this.invoiceCard=')}`, context);
  const html = context.invoiceCard({ id: 'inv-1', invoiceAvailableOn: '', paymentDueDate: '' });
  assert.match(html, /id="invoice-upload-inv-1"/);
  assert.doesNotMatch(html, /invoice-upload-\$\{x\.id\}/);
});
