const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const modalSource = html.slice(html.indexOf('function _jobModalWorkerIds()'), html.indexOf('function updPaidBtn()'));

test('job editor opens with assignment summary only and defers the directory', () => {
  assert.match(modalSource, /id="j-worker-list" class="job-assignee-control" data-selected-worker-ids/);
  assert.match(modalSource, /<button type="button" class="btn btn-g btn-sm" onclick="toggleJobAssigneePicker\(\)">担当者を変更<\/button>/);
  assert.match(modalSource, /id="j-worker-picker" class="job-assignee-picker" hidden/);
  assert.doesNotMatch(modalSource, /workers\.map\(w=>`<label/);
  assert.match(modalSource, /function _renderJobAssigneePicker\(query\)/);
  assert.match(modalSource, /matches\.slice\(0,60\)/);
});

test('assignment selection is kept separately from the optional picker and saved unchanged', () => {
  assert.match(modalSource, /dataset\.selectedWorkerIds/);
  assert.match(modalSource, /function toggleJobWorkerSelection\(id,checked\)/);
  assert.match(html, /const selWorkerIds=_jobModalWorkerIds\(\);/);
  assert.match(html, /_setJobModalWorkerIds\(\[\.\.\._jobModalWorkerIds\(\),w\.id\]\)/);
});

test('a 500-person fixture creates only the first 60 optional picker controls', () => {
  const list = { dataset: { selectedWorkerIds: JSON.stringify(['w499']) } };
  const picker = { innerHTML: '' };
  const summary = { innerHTML: '' };
  const elements = { 'j-worker-list': list, 'j-worker-picker': picker, 'j-worker-summary': summary };
  const context = {
    S: { workers: Array.from({ length: 500 }, (_, i) => ({ id: `w${i}`, name: `編集者 ${i}` })) },
    SELF_WID: '__self',
    esc: value => String(value),
    document: { getElementById: id => elements[id] || null },
  };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('function _jobModalWorkerIds()'), html.indexOf('function openJobModal(')), context);
  context._renderJobAssigneeSummary();
  context._renderJobAssigneePicker('');
  assert.equal((picker.innerHTML.match(/type="checkbox"/g) || []).length, 60);
  assert.match(summary.innerHTML, /編集者 499/);
});

test('assignee checkboxes keep a fixed width and full names can wrap', () => {
  assert.match(html, /\.job-assignee-options input\[type="checkbox"\]\{width:18px;height:18px;min-width:18px/);
  assert.match(html, /\.job-assignee-options label span\{[^}]*white-space:normal[^}]*overflow-wrap:anywhere/);
});

test('parent cases render lightweight child summaries and preserve unopened children on save', () => {
  assert.match(modalSource, /JOB_MODAL_SUB_RECORDS=subs\.map\(_jobModalSubRecordClone\)/);
  assert.match(modalSource, /subs\.map\(\(s,i\)=>_jobModalSubCompactHtml\(s,i,jbiz,ownerFinanceLocked\)\)/);
  assert.match(modalSource, /function expandJobSubEditor\(button\)/);
  assert.doesNotMatch(modalSource, /subs\.map\(\(s,i\)=>mkSubRow/);
  assert.match(html, /const subShells=\[\.\.\.document\.querySelectorAll\('#j-sub-cont \.j-sub-shell'\)\]/);
  assert.match(html, /if\(!el\)return _jobModalSubRecordClone\(stateRecord\)/);
});

test('only one child editor stays open and edits are cached before another child opens', () => {
  assert.match(modalSource, /function _readJobSubEditorState\(shell\)/);
  assert.match(modalSource, /function collapseJobSubEditor\(shell\)/);
  assert.match(modalSource, /JOB_MODAL_SUB_RECORDS\[index\]=_jobModalSubRecordClone\(result\.record\)/);
  assert.match(modalSource, /function _collapseOtherJobSubEditors\(exceptShell\)/);
  assert.match(modalSource, /if\(!_collapseOtherJobSubEditors\(shell\)\)return;/);
  assert.match(html, /if\(!_collapseOtherJobSubEditors\(null\)\)return;/);
  assert.match(html, /onclick="collapseJobSubEditor\(this\.closest\('\.j-sub-shell'\)\)">閉じる<\/button>/);
});

test('the large parent-case editor avoids full-screen backdrop blur work', () => {
  assert.match(html, /\.overlay\.job-modal-overlay\{background:rgba\(15,23,42,\.5\);backdrop-filter:none\}/);
  assert.match(modalSource, /<\/div>`,'job-modal-overlay'\);/);
});

test('collapsed child cache retains scheduling, money, payment and link fields', () => {
  const cacheSource = html.slice(html.indexOf('function _readJobSubEditorState('), html.indexOf('function collapseJobSubEditor('));
  for (const field of ['unitPrice', 'workerPay', 'editorDraftDate', 'clientDraftDate', 'deliveryDate', 'invoiceDate', 'dueDate', 'paymentDate', 'payoutDate', 'attachments']) {
    assert.match(cacheSource, new RegExp(`${field}:`), `${field} is retained when collapsing an editor`);
  }
  assert.match(cacheSource, /requestUrl,sourceUrl,attachments:attachmentRead\.items/);
});

test('collapsing a child records its edited values without loading the worker directory', () => {
  const childSource = html.slice(html.indexOf('function _readJobSubEditorState('), html.indexOf('function expandJobSubEditor('));
  const field = value => ({ value });
  const values = {
    '.j-sub-inp': field('台本100'), '.j-sub-worker': field('editor-a'), '.j-sub-price': field('6000'), '.j-sub-pay': field('3000'),
    '.j-sub-status': field('編集者進行中'), '.j-sub-shared': field('2026-08-29'), '.j-sub-editor-setter': field('creator'),
    '.j-sub-editor': field('2026-09-01'), '.j-sub-client': field('2026-09-03'), '.j-sub-deliver': field('2026-09-05'),
    '.j-sub-invoice': field('2026-09-20'), '.j-sub-due': field('2026-09-30'), '.j-sub-payment': field('2026-10-01'),
    '.j-sub-payout': field('2026-10-02'), '.j-sub-request': field('https://example.test/script'), '.j-sub-source': field('https://example.test/assets'),
    '.chk': { classList: { contains: () => true } },
  };
  const shell = { dataset: { stateIndex: '0' }, querySelector: selector => selector === '.j-sub-row' ? row : values[selector] || null };
  const row = { querySelector: selector => values[selector] || null };
  const context = {
    JOB_MODAL_SUB_RECORDS: [{ id: 'sub-100', completedDeliveryDate: '2026-09-06' }],
    _videoSafeUrl: value => value.startsWith('https://') ? value : '', _videoCanEdit: () => false, _curJobBiz: () => 'edit',
    _videoAttachments: items => items || [], _paymentRecipientSnapshot: workerId => ({ billingWorkerId: workerId }),
    _editorDraftDateSetter: () => 'creator', uid: () => 'new-id',
  };
  vm.createContext(context);
  vm.runInContext(childSource, context);
  const { record, error } = context._readJobSubEditorState(shell);
  assert.equal(error, '');
  assert.deepEqual(JSON.parse(JSON.stringify(record)), {
    id: 'sub-100', completedDeliveryDate: '2026-09-06', title: '台本100', done: true, unitPrice: 6000, workerPay: 3000,
    status: '編集者進行中', workerId: 'editor-a', billingWorkerId: 'editor-a', sharedDate: '2026-08-29', editorDraftDateSetter: 'creator',
    editorDraftDate: '2026-09-01', clientDraftDate: '2026-09-03', deliveryDate: '2026-09-05', invoiceDate: '2026-09-20',
    dueDate: '2026-09-30', paymentDate: '2026-10-01', payoutDate: '2026-10-02', requestUrl: 'https://example.test/script',
    sourceUrl: 'https://example.test/assets', attachments: [],
  });
});

test('child editor loads the full worker directory only when its worker select is opened', () => {
  const rowSource=html.slice(html.indexOf('function mkSubRow('),html.indexOf('function addWorkerInline('));
  assert.match(rowSource, /data-hydrated="0"/);
  assert.match(rowSource, /onpointerdown="hydrateJobSubWorkerSelect\(this\)"/);
  assert.doesNotMatch(rowSource, /\(S\.workers\|\|\[\]\)\.map/);
  assert.match(modalSource, /function hydrateJobSubWorkerSelect\(select\)/);
});

test('dispatch parent and child cases use plain, distinct labels without changing the data schema', () => {
  assert.match(modalSource, /親案件名 \*/);
  assert.match(modalSource, /親案件に「9月分」などを入力し、ここに各動画名を追加します。/);
  assert.match(modalSource, /＋ サブ案件を追加/);
  assert.match(html, /mkSubRow\(\{},'サブ案件'/);
  assert.match(html, /subtasks,/);
});

test('video cards distinguish both draft dates from the legacy deadline', () => {
  assert.match(html, /function _videoDraftDateSummary\(job\)/);
  assert.match(html, /編集者初稿 <b>\$\{esc\(job\.editorDraftDate\|\|'未設定'\)\}<\/b>/);
  assert.match(html, /クライアント初稿 <b>\$\{esc\(job\.clientDraftDate\|\|'未設定'\)\}<\/b>/);
  assert.match(html, /\$\{_videoDraftDateSummary\(j\)\}/);
});
