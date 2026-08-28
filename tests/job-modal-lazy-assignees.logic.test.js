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
