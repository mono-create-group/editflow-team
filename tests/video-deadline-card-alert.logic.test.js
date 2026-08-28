const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const VIDEO_OVERDUE_EXCLUDED_STATUSES=');
const end = html.indexOf('\nfunction _portalVideoBiz(', start);
const helpers = html.slice(start, end);

function alertFor(job, baseDate = '2026-08-28') {
  const context = {
    today: () => baseDate,
    _videoWorkflow: value => value.workflow || { stage: 'editing' },
  };
  vm.createContext(context);
  vm.runInContext(`${helpers}\nthis.alert=_videoDeadlineAlert;`, context);
  return JSON.parse(JSON.stringify(context.alert(job, baseDate)));
}

test('next deadline follows the current workflow, not the earliest stored date', () => {
  assert.equal(alertFor({ status: '進行中', editorDraftDate: '2026-08-30', clientDraftDate: '2026-08-29', deadline: '2026-08-28' }).label, '2日後：編集者初稿');
  assert.equal(alertFor({ status: '進行中', editorDraftDate: '2026-09-05', clientDraftDate: '2026-08-29', deadline: '2026-08-28', workflow: { stage: 'client_submission' } }).label, '明日：クライアント初稿');
  assert.equal(alertFor({ status: '進行中', editorDraftDate: '', clientDraftDate: '', deadline: '2026-08-29' }).label, '明日：納品予定');
});

test('tomorrow, today, and overdue are red; two days away is yellow', () => {
  assert.equal(alertFor({ status: '進行中', editorDraftDate: '2026-08-29' }).level, 'danger');
  assert.equal(alertFor({ status: '進行中', editorDraftDate: '2026-08-28' }).label, '本日：編集者初稿');
  assert.equal(alertFor({ status: '進行中', editorDraftDate: '2026-08-27' }).label, '期限超過：編集者初稿');
  assert.equal(alertFor({ status: '進行中', editorDraftDate: '2026-08-30' }).level, 'warning');
});

test('completed, cancelled, review, and revision statuses are never colored', () => {
  for (const status of ['完了', 'キャンセル', '確認待ち', '修正中', 'FB待ち', 'D確認OK']) {
    assert.equal(alertFor({ status, editorDraftDate: '2026-08-27', deadline: '2026-08-27' }), null, status);
  }
});

test('parent and child card markup render the deadline border class and visible label', () => {
  assert.match(html, /video-job-card \$\{alert\?`video-deadline-\$\{alert\.level\}`/);
  assert.match(html, /video-subcase-row \$\{subAlert\?`video-deadline-\$\{subAlert\.level\}`/);
  assert.match(html, /_videoDeadlineAlertHtml\(alert\)/);
  assert.match(html, /_videoDeadlineAlertHtml\(subAlert\)/);
});
