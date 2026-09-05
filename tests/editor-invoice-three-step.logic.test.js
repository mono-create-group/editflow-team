const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const billing = require(path.join(root, 'billing-terms.js'));

// 実効定義は editor.html 末尾の上書きブロックにあるので、`function` 宣言と
// `名前=function` の両方を拾えるようにする。
function sourceOf(name) {
  // 上書き代入（`名前=function` / `名前=async function`）があればそちらが実効定義。
  // portalGuardWrite の巻き直し行と取り違えないよう、関数式の形だけを見る。
  let start = -1;
  for (const shape of [`\n  ${name}=function`, `\n  ${name}=async function`]) {
    const at = editor.lastIndexOf(shape);
    if (at > start) start = at;
  }
  if (start >= 0) start += 1; else start = editor.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must be defined`);
  // 引数の分割代入 `({a,b})` を本体と取り違えないよう、括弧が閉じてから波括弧を数える。
  let paren = 0, body = -1;
  for (let i = editor.indexOf('(', start); i < editor.length; i += 1) {
    if (editor[i] === '(') paren += 1;
    if (editor[i] === ')' && --paren === 0) { body = editor.indexOf('{', i); break; }
  }
  assert.ok(body > 0, `${name} must have a body`);
  let depth = 0;
  for (let i = body; i < editor.length; i += 1) {
    if (editor[i] === '{') depth += 1;
    if (editor[i] === '}' && --depth === 0) return editor.slice(start, i + 1);
  }
  assert.fail(`${name} must close`);
}

function lineWith(fragment) {
  const at = editor.indexOf(fragment);
  assert.ok(at >= 0, `${fragment} must exist`);
  const from = editor.lastIndexOf('\n', at) + 1;
  const to = editor.indexOf('\n', at);
  return editor.slice(from, to < 0 ? editor.length : to);
}

// ライブの請求書画面を触らずに、選択ロジックだけを使い捨てのコンテキストで動かす。
function selectionContext({ jobs = [], invoices = [], authorizations = [], profile = {}, invoiceMonth = '2026-09', today = '2026-09-26' } = {}) {
  const context = vm.createContext({
    jobs, invoices, authorizations, profile, invoiceMonth,
    window: { EditflowBilling: billing },
    Number, String, Math, Set, Map, Object, Array, Date, JSON, console,
    directBillingEnabled: () => true,
    render: () => {},
  });
  const names = [
    'claimedJobIds', 'jobDelivery', 'activeAuthorization', 'invoiceTermsForDelivery',
    'invoiceReadyOn', 'invoiceIssuerMissingFields', 'invoiceSelectedRate',
    'invoiceJobDeliveryDate', 'invoiceAuthorizedAmount', 'invoiceFixedAmount',
    'invoiceSelectableJobs', 'invoiceDefaultSelectedIds', 'invoiceSelectedIds',
    'toggleInvoiceJob', 'setInvoiceJobAmount', 'invoiceRowAmount',
    'invoiceSelectionResult', 'invoiceStepState',
  ];
  const source = [
    `const localDate=()=>${JSON.stringify(today)};`,
    editor.match(/const INVOICE_ISSUER_FIELDS=\[[\s\S]*?\];/)[0],
    lineWith('let invoiceJobSelection=null'),
    `const INVOICE_LINE_LIMIT=${editor.match(/const INVOICE_LINE_LIMIT=(\d+);/)[1]};`,
    ...names.map(sourceOf),
    `this.api={${names.join(',')}};this.reset=()=>{invoiceJobSelection=null;invoiceJobAmounts={};invoiceTaxRateChoice=null};`,
  ].join('\n');
  vm.runInContext(source, context);
  return context;
}

// 画面そのものを組み立てて、実際に出るHTMLを見る（ライブの請求書データには触れない）。
function renderContext(options = {}) {
  const context = selectionContext(options);
  const extra = [
    'invoiceScheduleText', 'invoiceStepsHtml', 'invoiceIssuerStatusCard',
    'invoiceJobRowHtml', 'invoiceCreatePanel', 'invoiceConfirmBlockHtml',
    'invoiceSubmitReady', 'invoiceIssuerFromDocument',
  ];
  vm.runInContext([
    editor.match(/const esc=[^\n]*\n/)[0],
    editor.match(/const money=[^\n]*\n/)[0],
    ...extra.map(sourceOf),
    `this.ui={${extra.join(',')}};this.confirmed=invoiceConfirmedIds;`,
  ].join('\n'), context);
  return context;
}

const completedJob = (overrides = {}) => ({
  id: 'j1', title: 'ショート動画 003', clientDisplay: 'ReVALUE', status: '完了',
  completedDeliveryDate: '2026-09-10', ...overrides,
});

test('only completed cases with a delivery date, not already invoiced, can become line items', () => {
  const { api } = selectionContext({
    jobs: [
      completedJob(),
      completedJob({ id: 'j2', title: '進行中', status: '編集者進行中' }),
      completedJob({ id: 'j3', title: '納品日なし', completedDeliveryDate: '', deliveryDate: '', deadline: '' }),
      completedJob({ id: 'j4', title: '請求済み' }),
    ],
    invoices: [{ id: 'inv1', status: '提出済み', jobIds: ['j4'] }],
  });
  assert.deepEqual(api.invoiceSelectableJobs().map(x => x.id), ['j1']);
  // 取消済みの請求書は重複扱いにしない（既存の重複ガードと同じ判定）。
  const revived = selectionContext({
    jobs: [completedJob({ id: 'j4' })],
    invoices: [{ id: 'inv1', status: '取消', jobIds: ['j4'] }],
  });
  assert.deepEqual(revived.api.invoiceSelectableJobs().map(x => x.id), ['j4']);
});

test('a case with a confirmed reward is preselected and carries that amount', () => {
  const context = selectionContext({
    jobs: [completedJob(), completedJob({ id: 'j2', title: 'ロング動画 014' })],
    authorizations: [{
      id: '2026-09', month: '2026-09', active: true, taxInclusive: true, jobIds: ['j1'],
      lines: [{ jobId: 'j1', amount: 12000, taxRate: 10 }],
    }],
    profile: { taxRate: 10, issuerName: 'a', bankName: 'b', bankBranch: 'c', bankNumber: 'd', bankHolder: 'e' },
  });
  assert.deepEqual([...context.api.invoiceSelectedIds()], ['j1']);
  const result = context.api.invoiceSelectionResult();
  assert.equal(result.error, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.lines)), [{
    jobId: 'j1', title: 'ショート動画 003', serviceDescription: 'ショート動画 003',
    transactionDate: '2026-09-10', amount: 12000, taxRate: 10,
  }]);
  assert.equal(result.total, 12000);
  assert.equal(result.month, '2026-09');
});

test('an unconfirmed case needs a typed amount before the invoice can be built', () => {
  const context = selectionContext({ jobs: [completedJob()] });
  context.api.toggleInvoiceJob('j1', true);
  assert.match(context.api.invoiceSelectionResult().error, /金額が未入力/);
  context.api.setInvoiceJobAmount('j1', '12500');
  const result = context.api.invoiceSelectionResult();
  assert.equal(result.error, undefined);
  assert.equal(result.lines[0].amount, 12500);
});

test('cases from different billing months ask to be split instead of silently merging', () => {
  const context = selectionContext({
    jobs: [completedJob(), completedJob({ id: 'j2', completedDeliveryDate: '2026-08-10' })],
  });
  context.api.toggleInvoiceJob('j1', true);
  context.api.toggleInvoiceJob('j2', true);
  context.api.setInvoiceJobAmount('j1', '1000');
  context.api.setInvoiceJobAmount('j2', '2000');
  assert.match(context.api.invoiceSelectionResult().error, /2026-08 と 2026-09/);
});

test('nothing selected reports the missing step instead of building an empty invoice', () => {
  const context = selectionContext({ jobs: [completedJob()] });
  assert.match(context.api.invoiceSelectionResult().error, /1件以上/);
});

test('the step indicator starts on the issuer step until the five required fields are filled', () => {
  const blank = selectionContext({ jobs: [completedJob()] });
  assert.equal(blank.api.invoiceStepState().current, 0);
  assert.equal(blank.api.invoiceStepState().issuerReady, false);
  const filled = selectionContext({
    jobs: [completedJob()],
    profile: { issuerName: 'a', bankName: 'b', bankBranch: 'c', bankNumber: 'd', bankHolder: 'e' },
  });
  assert.equal(filled.api.invoiceStepState().current, 1);
  const drafting = selectionContext({
    jobs: [completedJob()],
    invoices: [{ id: 'inv1', status: '下書き', jobIds: [] }],
    profile: { issuerName: 'a', bankName: 'b', bankBranch: 'c', bankNumber: 'd', bankHolder: 'e' },
  });
  assert.equal(drafting.api.invoiceStepState().current, 2);
});

test('the invoice page shows the three steps and locks the line step behind the issuer step', () => {
  const panel = sourceOf('invoiceCreatePanel');
  assert.match(panel, /invoiceStepsHtml\(state\)/);
  assert.match(panel, /2 明細 ・ 請求する完了案件を選ぶ/);
  assert.match(panel, /先に 1 請求者情報 を入力してください/);
  // 未完了なら次段の操作を無効化する。
  assert.match(panel, /locked=!state\.issuerReady/);
  assert.match(panel, /\$\{locked\|\|!ready\?' disabled':''\} onclick="createInvoiceFromSelection\(\)"/);
  const steps = sourceOf('invoiceStepsHtml');
  assert.match(steps, /\['1','請求者情報'\],\['2','明細'\],\['3','確認して提出'\]/);
  assert.match(steps, /aria-current="step"/);
});

test('free text is demoted to an optional note and never becomes a line title', () => {
  const panel = sourceOf('invoiceCreatePanel');
  assert.match(panel, /補足（任意）/);
  assert.match(panel, /明細の案件名には使いません/);
  assert.doesNotMatch(panel, /manual-invoice-description/);
  const draft = sourceOf('draftManualInvoice');
  assert.match(draft, /note:invoiceNoteDraft/);
  // 明細は選択した案件から組み立てる。自由入力は title に混ぜない。
  assert.match(draft, /lines=selection\.lines\.map/);
  assert.doesNotMatch(draft, /serviceDescription:description/);
});

test('submitting uses the confirmation block, not a native confirm dialog', () => {
  const submit = sourceOf('submitInvoice');
  assert.doesNotMatch(submit, /confirm\(/);
  assert.match(submit, /invoiceConfirmedIds\.has\(iid\)/);
  assert.match(submit, /内容を確認した/);
  const block = sourceOf('invoiceConfirmBlockHtml');
  for (const label of ['請求先', '明細', '税込合計', '振込先', 'Drive原本']) {
    assert.ok(block.includes(`<dt>${label}</dt>`), `confirmation block must show ${label}`);
  }
  assert.match(block, /1 請求者情報へ/);
  assert.match(block, /2 明細へ/);
  assert.match(block, /invoiceConfirmToggled\('\$\{x\.id\}',this\.checked\)/);
  // 提出ボタンは確認チェックが入るまで押せない。
  assert.match(sourceOf('invoiceSubmitReady'), /invoiceConfirmedIds\.has\(x\.id\)/);
});

test('the rendered panel locks the line step, then unlocks it once the issuer is complete', () => {
  const jobs = [completedJob(), completedJob({ id: 'j2', title: 'ロング動画 014', completedDeliveryDate: '2026-09-12' })];
  const locked = renderContext({ jobs });
  const lockedHtml = locked.ui.invoiceCreatePanel();
  assert.match(lockedHtml, /class="invoice-step current"[^>]*aria-current="step"><span class="invoice-step-no">1</);
  assert.match(lockedHtml, /先に 1 請求者情報 を入力してください/);
  // 1段目が終わるまで、チェックボックスも作成ボタンも押せない。
  assert.equal((lockedHtml.match(/<input type="checkbox" disabled/g) || []).length, 2);
  assert.match(lockedHtml, /<button class="btn primary" type="button" disabled onclick="createInvoiceFromSelection\(\)"/);
  assert.match(lockedHtml, /<textarea id="manual-invoice-note" maxlength="500" disabled/);

  const ready = renderContext({
    jobs,
    profile: { taxRate: 10, issuerName: '山田 美咲', bankName: '北海道銀行', bankBranch: '旭川支店', bankNumber: '1234567', bankHolder: 'ヤマダ ミサキ' },
  });
  ready.api.toggleInvoiceJob('j1', true);
  ready.api.setInvoiceJobAmount('j1', '12500');
  const readyHtml = ready.ui.invoiceCreatePanel();
  assert.doesNotMatch(readyHtml, /<input type="checkbox" disabled/);
  assert.match(readyHtml, /1件 ・ 税込合計 ¥12,500/);
  assert.match(readyHtml, /請求可能日 2026-09-25 ・ 支払予定日 2026-10-31/);
  assert.match(readyHtml, /<button class="btn primary" type="button" onclick="createInvoiceFromSelection\(\)"/);
  assert.match(readyHtml, /class="invoice-step current"[^>]*><span class="invoice-step-no">2</);
  // 案件名はエスケープされたうえで一覧に出る。
  assert.match(readyHtml, /<b>ショート動画 003<\/b>/);
  assert.match(readyHtml, /納品 2026-09-10 ・ 請求月 2026-09/);
});

test('the rendered confirmation block shows every item the editor must check before submitting', () => {
  const context = renderContext({});
  const draft = {
    id: 'inv-1', status: '下書き', recipientName: 'mono.create', total: 12500, taxInclusive: true,
    lines: [{ jobId: 'j1', serviceDescription: 'ショート動画 003', transactionDate: '2026-09-10', amount: 12500, taxRate: 10 }],
    issuer: { name: '山田 美咲', address: '北海道旭川市1条通1丁目1-1', bankName: '北海道銀行', bankBranch: '旭川支店', bankType: '普通', bankNumber: '1234567', bankHolder: 'ヤマダ ミサキ' },
    file: { id: 'drive-1' }, ownerShareStatus: 'shared',
  };
  const html = context.ui.invoiceConfirmBlockHtml(draft);
  assert.match(html, /<dd>mono\.create 御中<\/dd>/);
  assert.match(html, /2026-09-10 ・ ショート動画 003 ・ ¥12,500/);
  assert.match(html, /<dd><b>¥12,500<\/b><\/dd>/);
  assert.match(html, /北海道銀行 旭川支店 普通 1234567/);
  assert.match(html, /北海道旭川市1条通1丁目1-1/);
  assert.match(html, /保存・全管理者への共有まで完了/);
  assert.match(html, /<input type="checkbox" id="invoice-confirm-inv-1" onchange="invoiceConfirmToggled\('inv-1',this\.checked\)"> 内容を確認した/);
  assert.equal(context.ui.invoiceSubmitReady(draft), false, 'the submit stays blocked until the box is ticked');
  context.confirmed.add('inv-1');
  assert.equal(context.ui.invoiceSubmitReady(draft), true);
  // 未充足の項目には、その段へ戻るボタンが出る。
  const incomplete = context.ui.invoiceConfirmBlockHtml({ ...draft, ownerShareStatus: 'not_uploaded', issuer: { name: '山田 美咲' } });
  assert.match(incomplete, /振込先が未入力：金融機関名・支店名・口座番号・口座名義（カナ）/);
  assert.match(incomplete, /onclick="setView\('settings'\)">1 請求者情報へ<\/button>/);
  assert.match(incomplete, /Drive原本の保存と管理者共有が未完了です。/);
});

test('editing a draft keeps every line instead of collapsing the invoice to its first one', () => {
  // 明細が複数になったので、下書き修正は行ごとの金額を読み直す。
  // 修正フォームの markup は最下層の invoiceCard 宣言にある。
  assert.match(editor, /id="invoice-line-amount-\$\{x\.id\}-\$\{i\}"/);
  assert.match(editor, /<label>明細（税込金額）<\/label><ul class="invoice-edit-lines">/);
  assert.equal(editor.includes('id="invoice-description-${x.id}"'), false);
  assert.equal(editor.includes('id="invoice-amount-${x.id}"'), false);
  const save = sourceOf('saveInvoiceDraft');
  assert.match(save, /\(x\.lines\|\|\[\]\)\.map\(\(l,i\)=>\(\{\.\.\.l,amount:Math\.round\(Number\(\$\(`#invoice-line-amount-\$\{iid\}-\$\{i\}`\)\?\.value\)\|\|0\),taxRate:rate\}\)\)/);
  assert.match(save, /jobIds:lines\.map\(/);
  assert.doesNotMatch(save, /lines:\[line\]/);
});

test('the optional issuer address is saved, snapshotted, and printed on the invoice', () => {
  assert.match(editor, /<label for="issuer-address">住所<\/label>/);
  assert.match(sourceOf('saveProfile'), /address=\$\('#issuer-address'\)\?\.value\.trim\(\)\|\|''/);
  assert.match(sourceOf('saveProfile'), /data=\{issuerName,address,/);
  // 必須にはしない。5項目の必須集合は変えない。
  assert.doesNotMatch(sourceOf('saveProfile'), /!issuerName\|\|!address/);
  assert.match(sourceOf('currentIssuer'), /address:profile\.address\|\|''/);
  assert.match(sourceOf('scheduledInvoiceData'), /address:profile\.address\|\|''/);
  // 住所のない既存データでも壊れないこと。
  assert.match(sourceOf('invoiceDocument'), /\$\{x\.issuer\?\.address\?`<br>\$\{esc\(x\.issuer\.address\)\}`:''\}/);
});
